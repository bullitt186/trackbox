# Ingest Pipeline: How Emails Become Parcels

This document explains the complete journey from an email POST to a shipment record in the database. Understanding this pipeline is essential for debugging why an email did not create a shipment, why a title is wrong, or what `parser_status: "failed"` means.

## Pipeline overview

```
POST /ingest
     │
     ▼
1. Deduplication check (message_id)
     │
     ├─ already seen → return {action: "skipped"}
     │
     ▼
2. Compute fingerprint (sender domain + subject keywords)
     │
     ▼
3. Parser lookup (match fingerprint in DB)
     │
     ├─ match found → apply field_map
     │       │
     │       ├─ all fields None → fall back to AI (self-healing)
     │       └─ fields extracted → parser_status = "existing"
     │
     └─ no match → AI extraction (OpenAI)
             │
             ├─ success → store new parser → parser_status = "new"
             └─ failure → default to {status: "unknown"} → parser_status = "failed"
     │
     ▼
4. Post-processing
   - Carrier auto-detection from sender domain
   - Title resolution (product_name > AI title > merchant from subject)
   - Tracking number extraction from URL parameters
   - Tracking link normalization to persistent public URL
     │
     ▼
5. Rejection check
     │
     ├─ no tracking_number AND no order_number AND no carrier
     │       → return {action: "rejected", reason: "not a tracking email"}
     │
     ▼
6. Shipment match (tracking_number or order_number)
     │
     ├─ existing shipment found → update fields, check state transition
     │       → return {action: "updated"}
     │
     └─ no match → create new shipment
             → return {action: "created"}
     │
     ▼
7. Event record (always written)
8. MQTT notification (if state changed)
```

## Stage 1: Deduplication

If a `message_id` is provided in the request, the pipeline checks the `events` table for any event with that message ID. If found, it returns immediately:

```json
{"action": "skipped", "parser_status": "dedup", "shipment_id": null, "state": null}
```

No database write occurs. The `message_id` check normalizes surrounding angle brackets, so `<abc@mail.com>` and `abc@mail.com` are treated as the same ID. The IMAP poller also synthesizes a stable ID from sender+subject+date for emails that lack a Message-ID header.

## Stage 2: Fingerprinting

The pipeline computes a fingerprint from the sender email and subject line. This fingerprint is the lookup key for stored parsers.

**Domain extraction:** The sender domain is extracted from the `from` address using a regex. `"DHL Paket <noreply@dhl.de>"` → `"dhl.de"`.

**Subject keyword extraction:**
1. Strip variable content: quoted strings, bracketed text, parenthesized text.
2. Strip carrier-specific merchant name patterns ("Ihre X Sendung" → "ihre sendung").
3. Tokenize on whitespace and punctuation.
4. Remove tokens that contain digits (order numbers, tracking numbers — variable across emails).
5. Remove stopwords (common German/English filler words).
6. Keep tokens of 3+ characters, sorted.

The result is a sorted JSON array like `["abgeholt","pakete","sendung"]`. Two emails from the same sender with the same type of notification will produce the same fingerprint even if they have different merchant names or product descriptions.

## Stage 3: Parser lookup and extraction

The pipeline looks up `(sender_domain, subject_keywords)` in the `parsers` table.

### Path A: Parser found

The stored `field_map` is applied to the email body. A `field_map` is a JSON object mapping field names to extraction strategies:

```json
{
  "tracking_number": {"strategy": "after_label", "label": "Sendungsnummer:"},
  "tracking_link": {"strategy": "link_containing", "contains": "dhl.de/verfolgen"},
  "carrier": {"strategy": "literal", "value": "DHL"},
  "status": {"strategy": "literal", "value": "in_transit"}
}
```

Available strategies:

| Strategy | Parameters | Description |
|----------|-----------|-------------|
| `after_label` | `label` | Scans body line by line; returns text on the same line after the label text. |
| `link_containing` | `contains` | Returns the first URL in `body` or `html` containing the given substring. |
| `literal` | `value` | Returns a fixed value regardless of email content. Used for fields that are always the same for a given email type (e.g. carrier). |
| `none` | — | Field is not extractable from this email type. Returns `null`. |

**Self-healing:** If the parser extracts **all** fields as `None` (the email format changed and the old patterns no longer match), the parser is considered broken. The pipeline falls back to AI extraction and, on success, **replaces the stored parser's field_map** with a new one generated from the current email. The parser's `use_count` is reset to 0. This is the self-healing mechanism.

If the parser extracts at least one non-null field, it is used as-is even if some fields are null. `parser_status` is set to `"existing"`.

### Path B: No parser found (AI extraction)

When no matching parser exists, the pipeline calls `ai.extract_and_generate_parser()`. This makes a single OpenAI API call with a system prompt that asks the model to both:
1. Extract tracking fields from this email.
2. Generate a `field_map` describing how to extract those fields from similar future emails.

The extracted fields and generated `field_map` are returned together. If the AI call succeeds:
- `parser_status` = `"new"`
- A new parser is stored in the `parsers` table with the generated `field_map`.
- The next email from the same sender with the same subject structure will use the stored parser (no AI call).

If the AI call fails (network error, invalid API key, malformed response):
- `parser_status` = `"failed"`
- Extracted fields default to `{"status": "unknown"}`
- **No parser is stored.** The next identical email will also attempt AI extraction.

## Stage 4: Post-processing

After extraction (via parser or AI), several enrichment steps run:

**Carrier auto-detection:** If the AI/parser did not extract a carrier, the pipeline checks the sender domain against a hardcoded domain-to-carrier map:

| Domain | Carrier |
|--------|---------|
| `dhl.de`, `dhl.com` | DHL |
| `myhermes.de`, `paketankuendigung.myhermes.de` | Hermes |
| `dpd.de`, `dpd.com` | DPD |
| `gls-group.eu`, `gls-pakete.de` | GLS |
| `ups.com` | UPS |
| `fedex.com` | FedEx |
| `amazon.de`, `amazon.com` | Amazon Logistics |

**Title resolution (priority order):**
1. `product_name` from the request body (highest priority — caller-supplied)
2. AI-extracted `title`
3. Generic AI titles (`"DHL"`, `"Hermes Sendung"`, etc.) are overridden by merchant names extracted from the subject pattern "Ihre X Sendung" or "Sendung von X ist"
4. If no title at all: the shipment is created without a title

**Tracking number extraction from URL:** If no tracking number was extracted but a tracking link was, the pipeline parses the URL to extract the tracking number from known parameters:

| Parameter | Carrier |
|-----------|---------|
| `piececode` | DHL |
| `match` | GLS |
| `tracknum` | UPS |
| `trknbr` | FedEx |
| `orderId` | Amazon |
| URL fragment | Hermes (e.g. `#H1018660616235701042`) |

**Tracking link normalization:** The tracking link is replaced with a stable, permanent public URL for recognized carriers. This ensures the link remains valid even if the email's original link expires:

| Carrier | Normalized URL |
|---------|---------------|
| DHL | `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode={tracking_number}` |
| Hermes | `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation/#{tracking_number}` |
| DPD | `https://tracking.dpd.de/status/de_DE/parcel/{tracking_number}` |
| GLS | `https://gls-group.eu/DE/de/paketverfolgung?match={tracking_number}` |
| UPS | `https://www.ups.com/track?tracknum={tracking_number}` |
| FedEx | `https://www.fedex.com/fedextrack/?trknbr={tracking_number}` |
| Unknown | `https://parcelsapp.com/en/tracking/{tracking_number}` |

## Stage 5: Rejection check

After all extraction and enrichment, the pipeline checks whether anything trackable was found:

```python
if not any([
    extracted.get("tracking_number"),
    extracted.get("order_number"),
    extracted.get("carrier")
]):
    return {"action": "rejected", "reason": "not a tracking email"}
```

This is the last gate before database writes. A `rejected` response means the email was successfully processed but contained nothing the system could track. Common causes:
- The email is a newsletter or receipt without shipment information.
- The AI extraction failed and the domain is not in the carrier-detection map.
- The email format is genuinely non-tracking (e.g. a "we received your return" email with no tracking number).

## Stage 6: Shipment match and create/update

The pipeline looks up an existing shipment by tracking number (exact match) or order number (exact match, only if no tracking number match was found).

**If a match exists (`action: "updated"`):**
- Missing fields are backfilled (e.g. tracking number added if previously only order number existed).
- Tracking link is updated if the new link is a normalized public URL and the current one is not.
- Title is updated if the new title is longer than the current one (progressive enrichment).
- State is updated only if the transition is valid (see state machine below).

**If no match exists (`action: "created"`):**
- A new shipment is created with all extracted and enriched fields.
- `first_seen_at` is set to the `date` request field (or current time if not provided).

## State machine

The state machine is encoded in the `STATE_ORDER` dict:

```python
STATE_ORDER = {
    "unknown": 0, "preparing": 1, "shipped": 2, "in_transit": 3,
    "out_for_delivery": 4, "delivered": 5, "delayed": 3, "exception": 3
}
```

`should_update_state(current, new)` returns `True` if:
- The new state has a higher order value than the current state, **or**
- The new state is `delayed` or `exception` (always allowed regardless of order)

`delivered` is a terminal state: no transition out of it is permitted. This means a re-delivered shipment (rare but possible) requires a manual state override via `PUT /api/shipments/{id}` with `"force": true`.

## Stage 7: Event record

An event is always written to the `events` table after a successful create or update. The event records:
- `state`: the final state
- `notes`: the email subject line
- `source`: `"email"`
- `message_id`: the deduplication key
- `occurred_at`: the `date` field from the request, or current time

## Stage 8: MQTT notification

If the MQTT notifier is running and either a new shipment was created or the state changed, an async task publishes updated sensor state to the MQTT broker. This happens after the response is returned and does not block the HTTP response.

## Diagnosing unexpected responses

| Symptom | Likely cause | How to investigate |
|---------|-------------|-------------------|
| `action: "rejected"` | Email has no tracking data | Check `carrier`, `tracking_number`, `order_number` fields in the response; check raw email content |
| `action: "skipped"` | Duplicate message_id | Expected behavior; check if your n8n IF node is routing correctly |
| `parser_status: "failed"` | AI extraction failed | Check `OPENAI_API_KEY` env var; check OpenAI API status |
| `parser_status: "new"` on every email | Parser not matching | The subject fingerprint may be unstable (digits in subject); check `GET /api/parsers` to see what was stored |
| Wrong `carrier` | Sender domain not in map | Pass `carrier` explicitly in the email body if AI doesn't extract it |
| Wrong `title` | Generic title not overridden | Pass `product_name` in the request if you have a better title available |
| State not advancing | State machine check | The `should_update_state` check prevents regressions; `delivered` is a terminal state |
