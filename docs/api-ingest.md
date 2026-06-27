# POST /ingest — API Reference

The `/ingest` endpoint is the primary integration surface for Trackbox. Every email-driven shipment enters the system through this endpoint — whether sent by n8n, the built-in IMAP poller, or a custom integration.

## Request

```
POST /ingest
Content-Type: application/json
```

### Rate limit

30 requests per minute (in-memory sliding window per process). Exceeding the limit returns HTTP 429.

### Request body

| Field | Type | Required | Max length | Description |
|-------|------|----------|------------|-------------|
| `from` | string | yes | 500 | Sender address, e.g. `"DHL Paket <noreply@dhl.de>"`. Used to compute the sender domain for parser lookup and carrier auto-detection. |
| `subject` | string | yes | 1000 | Email subject line. Used to compute subject keywords for parser lookup and merchant-name extraction. |
| `body` | string | yes | 100,000 | Plain-text email body. The primary source for `after_label` and `link_containing` parser strategies. |
| `html` | string | no | 500,000 | Raw HTML email body. Used as fallback when `body` is empty or very short (< 100 chars), and as secondary search target for `link_containing` strategies. |
| `product_name` | string | no | 200 | If provided, overrides the AI-extracted title. Useful when the n8n workflow already has a clean product name from a separate lookup. |
| `message_id` | string | no | 500 | RFC 5322 Message-ID for deduplication. Surrounding angle brackets are stripped automatically. If omitted, no dedup check is performed. |
| `date` | string | no | 50 | Email sent timestamp (RFC 2822 or ISO 8601). If provided, used as the `occurred_at` of the created event and as `first_seen_at` on a new shipment, preserving the original email date instead of server receipt time. |

**Example:**

```json
{
  "from": "DHL Paket <noreply@dhl.de>",
  "subject": "Ihre Muster GmbH Sendung wurde abgeholt",
  "body": "Sendungsnummer: 1234567890\nVoraussichtliche Lieferung: Morgen",
  "html": "<html>...</html>",
  "product_name": "Wireless Keyboard",
  "message_id": "abc123@mail.example.com",
  "date": "Mon, 27 Jan 2026 10:00:00 +0100"
}
```

## Response

### HTTP status codes

| Code | Meaning |
|------|---------|
| 201 | Shipment created (`action == "created"`) |
| 200 | All other outcomes (updated, skipped, rejected, error) |
| 429 | Rate limit exceeded |

### Response body fields

| Field | Type | Description |
|-------|------|-------------|
| `action` | string | What the pipeline did. See [Action values](#action-values) below. |
| `shipment_id` | integer \| null | Database ID of the created or updated shipment. `null` for `skipped`, `rejected`, and `error`. |
| `state` | string \| null | Final shipment state after processing (e.g. `"in_transit"`). `null` when no shipment was created or updated. |
| `parser_status` | string | How parsing was performed. See [Parser status values](#parser-status-values) below. |
| `title` | string \| null | Resolved shipment title (product name, merchant, or subject-derived). Present only when a shipment was created or updated. |
| `tracking_number` | string \| null | Extracted tracking number, if found. |
| `tracking_link` | string \| null | Normalized public tracking URL for the carrier. |
| `carrier` | string \| null | Detected carrier name (e.g. `"DHL"`, `"Hermes"`). |
| `request_id` | string | 8-character hex ID for correlating this request in logs. Always present. |
| `reason` | string | Present only on `rejected`. Explains why the email was not tracked (currently always `"not a tracking email"`). |
| `error` | string | Present only on `error`. The exception message. |

### Action values

| Value | HTTP | Meaning |
|-------|------|---------|
| `created` | 201 | A new shipment was created in the database. |
| `updated` | 200 | An existing shipment was matched by tracking number or order number and one or more fields were updated. |
| `skipped` | 200 | The `message_id` was already seen. The email was a duplicate; no database write was performed. |
| `rejected` | 200 | The email was processed but contained no trackable fields (no tracking number, order number, or carrier). This typically means the email is not a shipping notification. |
| `error` | 200 | An unhandled exception occurred during processing. The `error` field contains the exception message. The request should be retried after investigation. |

### Parser status values

The `parser_status` field describes which parsing path was taken:

| Value | Meaning |
|-------|---------|
| `existing` | A stored parser matched this email's fingerprint and successfully extracted fields. No AI call was made. |
| `new` | No stored parser matched. AI extraction was used and a new parser was stored for future emails. |
| `failed` | No stored parser matched and AI extraction failed (e.g. `OPENAI_API_KEY` not set, API error). Extracted fields default to `status: "unknown"`. |
| `dedup` | Returned only with `action: "skipped"` — the `message_id` matched a previously processed event. |

### Example responses

**Created (new shipment, new AI parser):**
```json
{
  "action": "created",
  "shipment_id": 42,
  "state": "in_transit",
  "parser_status": "new",
  "title": "Muster GmbH",
  "tracking_number": "1234567890",
  "tracking_link": "https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=1234567890",
  "carrier": "DHL",
  "request_id": "a3f7c1b2"
}
```

**Updated (existing shipment, reused parser):**
```json
{
  "action": "updated",
  "shipment_id": 42,
  "state": "delivered",
  "parser_status": "existing",
  "title": "Wireless Keyboard",
  "tracking_number": "1234567890",
  "tracking_link": "https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=1234567890",
  "carrier": "DHL",
  "request_id": "b9e2d4a5"
}
```

**Skipped (duplicate):**
```json
{
  "action": "skipped",
  "shipment_id": null,
  "state": null,
  "parser_status": "dedup",
  "request_id": "c1f8e3d7"
}
```

**Rejected (not a tracking email):**
```json
{
  "action": "rejected",
  "shipment_id": null,
  "state": null,
  "parser_status": "new",
  "reason": "not a tracking email",
  "request_id": "d4a6b2e9"
}
```

**Error:**
```json
{
  "action": "error",
  "shipment_id": null,
  "state": null,
  "parser_status": "error",
  "error": "Connection refused",
  "request_id": "e7c3f5a1"
}
```

## Notes

- The `from` field name collides with a Python keyword; the JSON key is `"from"` but the Pydantic model uses the alias `from_`. Always use `"from"` in JSON requests.
- The endpoint does not validate that `date` is a parseable timestamp. Invalid dates are stored as-is and may cause `null` timestamps in the UI.
- MQTT notifications are fired asynchronously after ingest returns. If the MQTT broker is unavailable, ingest still succeeds.
- See [Ingest Pipeline](ingest-pipeline.md) for a detailed explanation of how the two-stage AI-then-parser pipeline works.
