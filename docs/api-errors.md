# API Error Responses

All errors return JSON:
```json
{"detail": "Error description"}
```

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success (includes `skipped`, `rejected`, and `error` action values from `/ingest`) |
| 201 | Created (new shipment from `/ingest`) |
| 404 | Shipment or parser not found |
| 409 | State transition not permitted — use `"force": true` in `PUT /api/shipments/{id}` to override |
| 422 | Invalid request body (Pydantic validation) or manual scrape rate-limited |
| 429 | Ingest rate limit exceeded (30 req/min on `/ingest`) |
| 500 | Internal error (check logs) |

## /ingest action values

The `/ingest` endpoint always returns HTTP 200 or 201 and communicates outcome via the `action` field, not HTTP status codes (except 201 for new shipments and 429 for rate limits).

| `action` | HTTP | Meaning |
|----------|------|---------|
| `created` | 201 | New shipment created |
| `updated` | 200 | Existing shipment matched and updated |
| `skipped` | 200 | Duplicate `message_id` — email already processed, no write performed |
| `rejected` | 200 | Email processed but contained no trackable fields (not a tracking email) |
| `error` | 200 | Unhandled exception — check `error` field in response for details |

See [api-ingest.md](api-ingest.md) for the full `/ingest` request/response reference including `parser_status` values.
