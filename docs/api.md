# REST API Reference

Interactive API documentation is available at `GET /docs` (Swagger UI) and `GET /redoc` when the app is running.

This document covers all endpoints with their request parameters, response shapes, and notable side effects.

## Base URL

```
http://localhost:8000
```

All API endpoints return `application/json`. The `/ingest` endpoint has a dedicated reference: [api-ingest.md](api-ingest.md).

---

## POST /ingest

Process an incoming shipping email. See [api-ingest.md](api-ingest.md) for the full reference including all `action` and `parser_status` values.

**Rate limit:** 30 requests/minute.

---

## GET /health

Liveness check. Verifies database connectivity.

**Response:**
```json
{
  "status": "ok",
  "version": "1.2.3",
  "build_time": "2026-01-20T15:00:00Z",
  "uptime_seconds": 86400
}
```

---

## GET /api/stats

Aggregate system statistics.

**Response:**
```json
{
  "shipments_by_state": {
    "in_transit": 3,
    "delivered": 12,
    "preparing": 1
  },
  "total_parsers": 8,
  "total_events": 47
}
```

---

## GET /api/shipments

List shipments with optional state filtering.

**Query parameters:**

| Parameter | Values | Description |
|-----------|--------|-------------|
| `state` | `active`, `delivered`, `archived` | Filter by state group. `active` = all non-delivered, non-archived. `archived` shows archived shipments. |
| `archived` | `true` | Alternative way to request archived shipments. |

If neither `state` nor `archived` is provided, returns all non-archived shipments.

Results are sorted by state urgency: `out_for_delivery` first, then `delayed`/`exception`, `in_transit`, `shipped`, `preparing`, `unknown`, `delivered` last.

**Response:** Array of shipment objects. Each includes a `last_event` summary (most recent event), plus `stalled` and `stall_reason` annotations:

```json
[
  {
    "id": 42,
    "title": "Wireless Keyboard",
    "tracking_number": "1234567890",
    "order_number": null,
    "carrier": "DHL",
    "tracking_link": "https://www.dhl.de/...",
    "current_state": "in_transit",
    "first_seen_at": "2026-01-20T10:00:00Z",
    "last_updated_at": "2026-01-25T14:30:00Z",
    "scrape_enabled": 1,
    "scrape_fail_count": 0,
    "last_scraped_at": "2026-01-27T09:45:00Z",
    "archived": 0,
    "stalled": false,
    "stall_reason": null,
    "last_event": {
      "state": "in_transit",
      "notes": "Paket befindet sich im Zustellzentrum",
      "occurred_at": "2026-01-25T14:30:00Z"
    }
  }
]
```

---

## GET /api/shipments/{id}

Single shipment with full event history and a computed `tracking_expires_at` field.

**Path parameters:** `id` — integer shipment ID.

**Response:**
```json
{
  "id": 42,
  "title": "Wireless Keyboard",
  "tracking_number": "1234567890",
  "carrier": "DHL",
  "current_state": "delivered",
  "stalled": false,
  "stall_reason": null,
  "tracking_expires_at": "2026-04-25T14:30:00Z",
  "events": [
    {
      "id": 101,
      "shipment_id": 42,
      "state": "delivered",
      "notes": "Paket zugestellt",
      "source": "scraper",
      "occurred_at": "2026-01-27T11:00:00Z",
      "message_id": null
    }
  ]
}
```

`tracking_expires_at` is computed for delivered shipments only: `last_updated_at + effective_retention_days`. Returns `null` for non-delivered shipments.

---

## PUT /api/shipments/{id}

Update shipment fields.

**Request body** (all fields optional):
```json
{
  "title": "New title",
  "carrier": "DHL",
  "tracking_number": "1234567890",
  "order_number": "ORD-999",
  "tracking_link": "https://...",
  "current_state": "delivered",
  "archived": 1,
  "notes": "Manual correction",
  "force": false
}
```

**State transition rules:**
- State changes respect the state machine: forward-only progression (e.g. cannot go from `delivered` to `in_transit`).
- `delayed` and `exception` are always allowed regardless of current state.
- If the transition is not permitted, returns HTTP 409 with `{"detail": "Cannot transition from 'X' to 'Y'"}`.
- Set `"force": true` to bypass the state machine check.
- When `current_state` is updated, an event is recorded with `source: "manual"` and the optional `notes` value.

**Response:** Updated shipment object.

---

## DELETE /api/shipments/{id}

Delete a shipment and all its events.

**Response:**
```json
{"deleted": 42}
```

---

## GET /api/parsers

List all stored parsers ordered by use count descending.

**Response:**
```json
[
  {
    "id": 1,
    "sender_domain": "dhl.de",
    "subject_keywords": "[\"abgeholt\",\"sendung\"]",
    "field_map": "{\"tracking_number\": {\"strategy\": \"after_label\", \"label\": \"Sendungsnummer:\"}, ...}",
    "created_at": "2026-01-01T00:00:00Z",
    "use_count": 23
  }
]
```

---

## DELETE /api/parsers/{id}

Delete a stored parser. The next email matching this parser's fingerprint will trigger a new AI extraction and store a fresh parser.

**Response:**
```json
{"deleted": 1}
```

---

## GET /api/settings

Return all settings as a flat key-value object. Includes defaults for any settings not yet explicitly configured.

**Response:**
```json
{
  "scraper_dhl_enabled": "true",
  "scraper_dhl_interval_minutes": "60",
  "scraper_dhl_active": "dhl_web",
  "scraper_dhl_retention_days": "30",
  "scraper_dhl_api_key": "",
  "scraper_hermes_enabled": "true",
  "scraper_hermes_interval_minutes": "60",
  "scraper_hermes_active": "hermes",
  "scraper_hermes_retention_days": "30",
  "mqtt_enabled": "false",
  "mqtt_topic_prefix": "trackbox",
  "trackbox_url": "http://192.168.0.50:8900"
}
```

All values are strings (SQLite storage constraint).

---

## PUT /api/settings

Update one or more settings. Accepts a flat JSON object of key-value pairs.

**Request body:**
```json
{
  "scraper_dhl_enabled": "true",
  "scraper_dhl_interval_minutes": "120",
  "mqtt_enabled": "true"
}
```

**Enforcement rules:**
- `*_interval_minutes` values are clamped to a minimum of 10 minutes.
- `*_retention_days` values are clamped to a minimum of 1 day and a maximum of the carrier's `max_retention_days`.

**Response:** Updated full settings object (same shape as `GET /api/settings`).

---

## GET /api/scrape-log

Query the scrape attempt history.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `shipment_id` | integer | Filter to a specific shipment. |
| `carrier` | string | Filter to a specific carrier (e.g. `"dhl"`). |
| `status` | string | Filter by scrape status: `success`, `no_change`, `error`, `timeout`, `disabled`. |
| `limit` | integer | Maximum results. Default: 50. |

**Response:**
```json
[
  {
    "id": 99,
    "shipment_id": 42,
    "carrier": "dhl",
    "tracking_number": "1234567890",
    "status": "error",
    "state_before": "in_transit",
    "state_after": null,
    "message": "DHL search returned 403: ...",
    "duration_ms": 1234,
    "occurred_at": "2026-01-27T09:00:00Z"
  }
]
```

---

## GET /api/scrapers

List all registered carrier scrapers with their current configuration and status.

**Response:**
```json
{
  "scrapers": [
    {
      "carrier": "dhl",
      "name": "DHL Web",
      "default_interval_minutes": 60,
      "max_retention_days": 90,
      "available_scrapers": [
        {"key": "dhl_web", "name": "DHL Web"},
        {"key": "dhl_api", "name": "DHL Unified API"}
      ],
      "active_scraper": "dhl_web",
      "enabled": true,
      "configured": true,
      "retention_days": 30
    }
  ],
  "scheduler_running": true,
  "last_cycle_at": "2026-01-27T09:58:00Z"
}
```

---

## GET /api/imap/status

IMAP poller status. Use this as a health check for the email polling subsystem.

**Response:**
```json
{
  "enabled": true,
  "running": true,
  "last_poll_at": "2026-01-27T10:00:00Z",
  "last_error": null,
  "emails_processed": 47
}
```

`enabled` is `true` if both `IMAP_HOST` and `IMAP_USER` are set. `running` is `true` if the async task is active. `last_error` contains the last exception string if the most recent poll failed.

---

## POST /api/shipments/{id}/scrape

Trigger an immediate scrape for a single shipment. Bypasses the scheduler.

**Rate limit:** One manual scrape every 6 seconds (global, across all shipments).

**Response on success:**
```json
{
  "success": true,
  "status": "in_transit",
  "description": "Paket befindet sich im Zustellzentrum",
  "state_changed": false,
  "events_count": 3
}
```

**Response on error (HTTP 422):**
```json
{"error": "Rate limited. Try again in 4s (min 6s between manual scrapes)"}
```

---

## PUT /api/shipments/{id}/scrape

Enable or disable scraping for a shipment.

**Request body:**
```json
{"enabled": true}
```

**Side effect:** When `enabled` is `true`, `scrape_fail_count` is reset to 0. This is the correct way to re-enable a shipment whose circuit-breaker was tripped by 3 consecutive failures.

**Response:** Updated shipment object.

---

## Error responses

All error responses follow FastAPI's standard format:

```json
{"detail": "Error description"}
```

| Code | Meaning |
|------|---------|
| 404 | Shipment or parser not found |
| 409 | State transition not permitted (use `force: true` to override) |
| 422 | Invalid request body (Pydantic validation error) or manual scrape rate limited |
| 429 | Ingest rate limit exceeded (30/min) |
| 500 | Unhandled exception (check logs) |

For `/ingest`-specific errors, see [api-ingest.md](api-ingest.md).
