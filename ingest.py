import asyncio
import json
import re

import ai
import db

_notifier = None


def set_notifier(notifier) -> None:
    global _notifier
    _notifier = notifier

URL_RE = re.compile(r'https?://[^\s<>"\')\]]+')

STATE_ORDER = {
    "unknown": 0, "preparing": 1, "shipped": 2, "in_transit": 3,
    "out_for_delivery": 4, "delivered": 5, "delayed": 3, "exception": 3
}


def process_email(email: dict) -> dict:
    """
    Main pipeline. email has keys: from, subject, body, html (optional), message_id (optional).
    Returns {shipment_id, state, action, parser_status}.
    """
    # Dedup: skip if this message_id was already processed
    # Normalize to strip surrounding <> so n8n and IMAP poller both match the same value
    msg_id = (email.get("message_id") or "").strip().strip("<>").strip() or None
    if msg_id and db.event_exists_for_message_id(msg_id):
        return {"shipment_id": None, "state": None, "action": "skipped", "parser_status": "dedup"}

    body = get_effective_body(email)
    email_with_body = {**email, "body": body}

    domain, keywords = compute_fingerprint(email["from"], email["subject"])
    parser = db.find_parser(domain, keywords)

    extracted = None
    field_map = None
    parser_status = "none"

    raw_html = email.get("html", "")

    if parser:
        extracted = apply_field_map(json.loads(parser["field_map"]), body, raw_html)
        # Self-healing: if all fields are None, fall back to AI
        if all(v is None for v in extracted.values()):
            extracted = None
        else:
            db.increment_parser_use(parser["id"])
            parser_status = "existing"

    if extracted is None:
        extracted, field_map = ai.extract_and_generate_parser(email_with_body)
        if extracted is None:
            extracted = {"status": "unknown"}
            parser_status = "failed"
        else:
            parser_status = "new"
            if field_map:
                if parser:
                    db.update_parser_field_map(parser["id"], field_map)
                else:
                    db.create_parser(domain, keywords, field_map)

    # Auto-detect carrier from sender domain if not set
    if not extracted.get("carrier"):
        extracted["carrier"] = detect_carrier_from_domain(domain)

    # Override title with product_name if provided
    if email.get("product_name"):
        extracted["title"] = email["product_name"]
    # Fallback: extract merchant from DHL-style "Ihre X Sendung" subject
    elif not extracted.get("title") or extracted["title"] in ("DHL Paket", "DHL", "Paket", "Hermes Sendung", "Hermes"):
        merchant = extract_merchant_from_subject(email["subject"])
        if merchant:
            extracted["title"] = merchant

    # Extract tracking number from tracking_link if not already present
    if not extracted.get("tracking_number") and extracted.get("tracking_link"):
        extracted["tracking_number"] = extract_tracking_from_url(extracted["tracking_link"])

    # Clean tracking number (strip non-alphanumeric trailing garbage)
    if extracted.get("tracking_number"):
        m = re.match(r'[\w\-]+', extracted["tracking_number"])
        if m:
            extracted["tracking_number"] = m.group(0)

    # Normalize tracking link to persistent public URL
    if extracted.get("tracking_number"):
        extracted["tracking_link"] = normalize_tracking_link(
            extracted.get("tracking_link"), extracted["tracking_number"], extracted.get("carrier")
        )

    status = extracted.get("status", "unknown")

    # Reject if nothing trackable was extracted
    if not any([extracted.get("tracking_number"), extracted.get("order_number"), extracted.get("carrier")]):
        return {
            "shipment_id": None, "state": None, "action": "rejected",
            "parser_status": parser_status, "reason": "not a tracking email",
        }

    # Match to existing shipment
    shipment = db.find_shipment(
        extracted.get("tracking_number"),
        extracted.get("order_number")
    )

    old_state = None
    if shipment:
        old_state = shipment["current_state"]
        updates = {}
        for field in ("tracking_number", "order_number", "carrier"):
            val = extracted.get(field)
            if val and not shipment.get(field):
                updates[field] = val
        # Always update tracking_link if new one is a normalized public URL
        new_link = extracted.get("tracking_link")
        if new_link and new_link != shipment.get("tracking_link"):
            if "dhl.de/de/privatkunden" in new_link or "myhermes.de" in new_link or "parcelsapp.com" in new_link:
                updates["tracking_link"] = new_link
            elif not shipment.get("tracking_link"):
                updates["tracking_link"] = new_link
        # Title: update if new title is better (longer or existing is generic)
        new_title = extracted.get("title")
        if new_title and (not shipment.get("title") or len(new_title) > len(shipment["title"])):
            updates["title"] = new_title
        # estimated_delivery: update if we have a new one and none is stored yet
        new_eta = extracted.get("estimated_delivery")
        if new_eta and not shipment.get("estimated_delivery"):
            updates["estimated_delivery"] = new_eta
        if should_update_state(shipment["current_state"], status):
            updates["current_state"] = status
        if updates:
            db.update_shipment(shipment["id"], updates, occurred_at=email.get("date"))
        shipment_id = shipment["id"]
        action = "updated"
        final_state = updates.get("current_state") or shipment["current_state"]
    else:
        extracted["_first_seen_at"] = email.get("date")
        shipment_id = db.create_shipment(extracted)
        action = "created"
        final_state = status
    db.add_event(shipment_id, final_state, email["subject"], "email", message_id=msg_id, occurred_at=email.get("date"))

    if _notifier and (action == "created" or final_state != old_state):
        try:
            loop = asyncio.get_event_loop()
            loop.create_task(_notifier.publish("state_change", {
                "shipment_id": shipment_id, "old_state": old_state, "new_state": final_state,
            }))
        except RuntimeError:
            pass  # no running event loop (e.g. tests)

    return {
        "shipment_id": shipment_id,
        "state": final_state,
        "action": action,
        "parser_status": parser_status,
        "title": extracted.get("title"),
        "tracking_number": extracted.get("tracking_number"),
        "tracking_link": extracted.get("tracking_link"),
        "carrier": extracted.get("carrier"),
    }


def should_update_state(current: str, new: str) -> bool:
    if current == "delivered":
        return False
    if new in ("delayed", "exception"):
        return True
    return STATE_ORDER.get(new, 0) > STATE_ORDER.get(current, 0)


def compute_fingerprint(sender: str, subject: str) -> tuple[str, list[str]]:
    domain = extract_domain(sender)
    # Strip quoted/bracketed content (product names, variable descriptions)
    cleaned = re.sub(r'[„"\"\'].*?["\"\'\.]\.\.\.?', '', subject)
    cleaned = re.sub(r'\[.*?\]', '', cleaned)
    cleaned = re.sub(r'\(.*?\)', '', cleaned)
    # Strip DHL-style merchant name: "Ihre {MERCHANT} Sendung" → "ihre sendung"
    cleaned = re.sub(r'(?i)\bihre\s+.+?\s+sendung\b', 'ihre sendung', cleaned)
    # Strip Hermes merchant: "Sendung von X ist" → "Sendung ist"
    cleaned = re.sub(r'(?i)\bsendung\s+von\s+.+?\s+ist\b', 'sendung ist', cleaned)
    # Strip DHL apology prefix
    cleaned = re.sub(r'(?i)^es tut uns leid\s*[-–]\s*', '', cleaned)
    # Strip trailing "Jetzt Live verfolgen" / "Jetzt live verfolgen..."
    cleaned = re.sub(r'(?i)\s*-?\s*jetzt\s+live\s+verfolgen.*$', '', cleaned)
    tokens = re.split(r'[\s\-_/|:,;]+', cleaned.lower())
    tokens = [re.sub(r'[^a-z0-9]', '', t) for t in tokens]
    # ponytail: stopwords list covers German/English filler in carrier subjects
    stopwords = {"ihre", "deine", "jetzt", "live", "heute", "uns", "tut", "leid",
                 "the", "your", "for", "has", "been", "und", "von", "dem", "auf",
                 "ist", "wird", "mit", "Sie", "wir", "dir", "sich"}
    keywords = sorted(set(
        t for t in tokens
        if len(t) >= 3 and not is_variable_token(t) and t not in stopwords
    ))
    return domain, keywords


def extract_domain(sender: str) -> str:
    match = re.search(r'[\w.+-]+@([\w.-]+)', sender)
    if match:
        return match.group(1).lower()
    return sender.lower().strip()


def is_variable_token(token: str) -> bool:
    if re.match(r'^\d+$', token):
        return True
    if re.search(r'\d', token):
        return True
    if re.match(r'\d{1,4}[/\-\.]\d{1,2}', token):
        return True
    return False


CARRIER_DOMAINS = {
    "dhl.de": "DHL", "dhl.com": "DHL",
    "paketankuendigung.myhermes.de": "Hermes", "myhermes.de": "Hermes",
    "dpd.de": "DPD", "dpd.com": "DPD",
    "gls-group.eu": "GLS", "gls-pakete.de": "GLS",
    "ups.com": "UPS",
    "fedex.com": "FedEx",
    "amazon.de": "Amazon Logistics", "amazon.com": "Amazon Logistics",
}


def detect_carrier_from_domain(domain: str) -> str | None:
    """Detect carrier from sender domain."""
    for pattern, carrier in CARRIER_DOMAINS.items():
        if domain == pattern or domain.endswith("." + pattern):
            return carrier
    return None


def normalize_tracking_link(current_link: str | None, tracking_number: str, carrier: str | None) -> str:
    """Return a persistent public tracking URL for known carriers."""
    c = (carrier or "").lower()
    if "dhl" in c or (current_link and "dhl" in current_link):
        return f"https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode={tracking_number}"
    if "hermes" in c or (current_link and "hermes" in current_link):
        return f"https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation/#{tracking_number}"
    if "dpd" in c:
        return f"https://tracking.dpd.de/status/de_DE/parcel/{tracking_number}"
    if "gls" in c:
        return f"https://gls-group.eu/DE/de/paketverfolgung?match={tracking_number}"
    if "ups" in c:
        return f"https://www.ups.com/track?tracknum={tracking_number}"
    if "fedex" in c:
        return f"https://www.fedex.com/fedextrack/?trknbr={tracking_number}"
    return current_link or f"https://parcelsapp.com/en/tracking/{tracking_number}"


def extract_merchant_from_subject(subject: str) -> str | None:
    """Extract merchant name from carrier subject patterns."""
    # DHL: "Ihre X Sendung ..."
    match = re.search(r'(?i)\bihre\s+(.+?)\s+sendung\b', subject)
    if match:
        merchant = match.group(1).strip().rstrip('.')
        if merchant and merchant.lower() not in ('dhl', 'paket'):
            return merchant
    # Hermes: "Deine Hermes Sendung von X ist auf dem Weg"
    match = re.search(r'(?i)\bsendung\s+von\s+(.+?)\s+ist\b', subject)
    if match:
        return match.group(1).strip()
    return None


def extract_tracking_from_url(url: str) -> str | None:
    """Extract tracking number from known carrier URL patterns."""
    from urllib.parse import parse_qs, urlparse
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    # DHL: piececode parameter
    if "piececode" in params:
        return params["piececode"][0]
    # GLS: match parameter
    if "match" in params:
        return params["match"][0]
    # UPS/FedEx: tracknum/trknbr
    if "tracknum" in params:
        return params["tracknum"][0]
    if "trknbr" in params:
        return params["trknbr"][0]
    # Amazon: orderId parameter
    if "orderId" in params:
        return params["orderId"][0]
    # Hermes: fragment contains tracking number (e.g. #H1018660616235701042)
    if parsed.fragment and re.match(r'^[A-Z0-9]{10,}', parsed.fragment):
        return parsed.fragment.split('/')[0]
    return None


def get_effective_body(email: dict) -> str:
    if email.get("body") and email["body"].strip():
        return email["body"]
    if email.get("html"):
        return strip_html(email["html"])
    return ""


def strip_html(html: str) -> str:
    # Preserve href URLs as inline text
    text = re.sub(r'<a\s[^>]*href=["\']([^"\']+)["\'][^>]*>', r' \1 ', html, flags=re.IGNORECASE)
    text = re.sub(r'<br\s*/?\s*>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n ', '\n', text)
    return text.strip()


def apply_field_map(field_map: dict, body: str, html: str = "") -> dict:
    return {field: apply_strategy(strat, body, html) for field, strat in field_map.items()}


def apply_strategy(strategy_def: dict, body: str, html: str = "") -> str | None:
    strategy = strategy_def.get("strategy")
    if strategy == "literal":
        return strategy_def.get("value")
    elif strategy == "after_label":
        label = strategy_def.get("label", "")
        for line in body.splitlines():
            if label.lower() in line.lower():
                idx = line.lower().index(label.lower()) + len(label)
                value = line[idx:].strip().rstrip(':').strip()
                if value:
                    return value
        return None
    elif strategy == "link_containing":
        contains = strategy_def.get("contains", "")
        # Search both plain text body and raw HTML for URLs
        for url in URL_RE.findall(body):
            if contains in url:
                return url
        for url in URL_RE.findall(html):
            if contains in url:
                return url
        return None
    elif strategy == "none":
        return None
    return None
