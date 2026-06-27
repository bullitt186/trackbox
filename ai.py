import json
import re

from openai import OpenAI

import config

VALID_STATES = [
    "unknown", "preparing", "shipped", "in_transit",
    "out_for_delivery", "delivered", "delayed", "exception"
]

SYSTEM_PROMPT = """You are an email parser for a parcel tracking system. Given a shipping notification email, you must:

1. Extract these fields from the email content:
   - order_number: the merchant's order identifier (if present)
   - tracking_number: the carrier tracking number (if present)
   - carrier: shipping carrier name (e.g. UPS, FedEx, USPS, DHL, DPD, GLS, Hermes, Amazon Logistics) (if identifiable)
   - tracking_link: full URL for tracking the package (if present)
   - title: brief description of what was ordered. If no product details are present, use just the merchant/sender name (e.g. "voelkner", "Amazon", "Banggood"). Never use the full email subject as title.
   - status: the shipment state. Must be one of: unknown, preparing, shipped, in_transit, out_for_delivery, delivered, delayed, exception

2. Generate a field_map that describes HOW each field can be extracted from similar future emails from the same sender with the same email type. The field_map uses these strategies only:
   - {"strategy": "after_label", "label": "<text>"} — the field value appears on the same line after this label text
   - {"strategy": "link_containing", "contains": "<url_substring>"} — first URL in the body containing this substring
   - {"strategy": "literal", "value": "<fixed_value>"} — this email type always implies this value
   - {"strategy": "none"} — this field is not extractable from this email type

Respond with JSON only:
{
  "extracted": {
    "order_number": "..." or null,
    "tracking_number": "..." or null,
    "carrier": "..." or null,
    "tracking_link": "..." or null,
    "title": "..." or null,
    "status": "..."
  },
  "field_map": {
    "order_number": {"strategy": "...", ...},
    "tracking_number": {"strategy": "...", ...},
    "carrier": {"strategy": "...", ...},
    "tracking_link": {"strategy": "...", ...},
    "title": {"strategy": "...", ...},
    "status": {"strategy": "...", ...}
  }
}"""

# Limits for prompt-injection mitigation: cap how much untrusted content
# reaches the LLM. Large values still allow normal shipping emails while
# preventing injection via oversized payloads.
_MAX_FROM_LEN = 200
_MAX_SUBJECT_LEN = 300
_MAX_BODY_LEN = 8_000
_MAX_HTML_HINT_LEN = 1_000

# Regex that strips common LLM prompt-injection patterns from text before
# it is interpolated into the user message.  We remove lines that look like
# system-level directives so they cannot override the system prompt.
_INJECTION_PATTERN = re.compile(
    r"(ignore\s+(all\s+)?(previous|prior|above)\s+instructions?|"
    r"you\s+are\s+now|act\s+as|disregard\s+(all\s+)?instructions?|"
    r"new\s+instructions?:|system\s+prompt:|<\s*/?\s*system\s*>)",
    re.IGNORECASE,
)


def _sanitize(text: str, max_len: int) -> str:
    """Truncate to max_len and strip obvious prompt-injection patterns."""
    if not text:
        return ""
    text = text[:max_len]
    # Replace injection patterns with a placeholder so surrounding content
    # is preserved but the directive is neutralised.
    text = _INJECTION_PATTERN.sub("[REMOVED]", text)
    return text


def extract_and_generate_parser(email: dict) -> tuple[dict | None, dict | None]:
    """
    Call OpenAI to extract shipment fields AND generate a field_map.
    Returns (extracted_fields, field_map) or (None, None) on failure.
    """
    client = OpenAI(api_key=config.OPENAI_API_KEY)
    model = config.OPENAI_MODEL

    # Sanitize all untrusted fields before interpolation to mitigate prompt injection.
    safe_from = _sanitize(email.get("from", ""), _MAX_FROM_LEN)
    safe_subject = _sanitize(email.get("subject", ""), _MAX_SUBJECT_LEN)
    body = _sanitize(email.get("body", ""), _MAX_BODY_LEN)
    html = email.get("html", "") or ""

    # If body is very short but HTML is available, include a small excerpt for context.
    html_hint = ""
    if html and len(body) < 100:
        html_hint = f"\n\nHTML (raw, first {_MAX_HTML_HINT_LEN} chars):\n{_sanitize(html, _MAX_HTML_HINT_LEN)}"

    user_content = f"From: {safe_from}\nSubject: {safe_subject}\n\nBody:\n{body}{html_hint}"

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )
        data = json.loads(response.choices[0].message.content)
    except Exception:
        return None, None

    extracted = data.get("extracted", {})
    field_map = data.get("field_map", {})

    # Validate status
    if extracted.get("status") not in VALID_STATES:
        extracted["status"] = "unknown"

    # Validate tracking_link: must be a plausible URL or discarded
    tracking_link = extracted.get("tracking_link")
    if tracking_link and not re.match(r"^https?://", str(tracking_link)):
        extracted["tracking_link"] = None

    # Validate field_map strategies
    valid_strategies = {"after_label", "link_containing", "literal", "none"}
    for key in list(field_map.keys()):
        if not isinstance(field_map[key], dict) or field_map[key].get("strategy") not in valid_strategies:
            field_map[key] = {"strategy": "none"}

    return extracted, field_map
