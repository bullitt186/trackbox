# Ops Runbook

This runbook covers day-to-day operations for a self-hosted Trackbox instance: reading logs, interpreting health endpoints, diagnosing degraded behavior, and recovering from common failure modes.

For hard-failure recovery (data loss, container crash), see [disaster-recovery.md](disaster-recovery.md).

## Log format

All logs are emitted as JSON (via `pythonjsonlogger`) to stdout. Each line is one JSON object:

```json
{
  "timestamp": "2026-01-27T10:00:00.123456",
  "level": "INFO",
  "name": "trackbox.scheduler",
  "message": "Scraper cycle: 3 shipment(s) due"
}
```

Read them with `docker logs trackbox -f`. To filter by level or subsystem:

```bash
# Show only warnings and errors
docker logs trackbox 2>&1 | grep '"level":"WARNING"\|"level":"ERROR"'

# Show only IMAP events
docker logs trackbox 2>&1 | grep '"name":"trackbox.imap"'

# Show only scraper events
docker logs trackbox 2>&1 | grep '"name":"trackbox.scheduler"'
```

## Log message reference

### Normal operations

| Logger | Message | Meaning |
|--------|---------|---------|
| `trackbox.scheduler` | `Scraper scheduler started` | Scheduler is running. Appears on startup. |
| `trackbox.scheduler` | `Scraper cycle: N shipment(s) due` | Normal cycle. N shipments are eligible for scraping this minute. |
| `trackbox.scheduler` | `Shipment N: X -> Y (scraper)` | State transition detected by scraper. |
| `trackbox.scheduler` | `Retention expired: auto-archived N shipment(s)` | Delivered shipments past retention window were archived and scraping disabled. |
| `trackbox.imap` | `IMAP poller started — host=X folder=Y interval=Zs` | IMAP polling active. |
| `trackbox.imap` | `IMAP: N unseen message(s) in INBOX` | Normal poll with new emails found. |
| `trackbox.imap` | `IMAP uid=X action=created tracking=1234567890` | Email processed successfully. |
| `trackbox.mqtt` | `MQTT connected to host:port` | MQTT broker connection established. |
| `trackbox.mqtt` | `MQTT notifier started` | MQTT is enabled and connected. |

### Degraded / warning states

| Logger | Message | Meaning | Action |
|--------|---------|---------|--------|
| `trackbox.startup` | `OPENAI_API_KEY not set - AI extraction will fail` | No OpenAI key. Parsers will still work; new email formats will produce `status: unknown`. | Set `OPENAI_API_KEY` in `.env` |
| `trackbox.mqtt` | `MQTT connect failed, rc=X` | MQTT broker refused connection. rc=5 = bad credentials; rc=3 = broker unavailable. | Check broker, credentials in `.env` |
| `trackbox.mqtt` | `MQTT unexpectedly disconnected, rc=X` | Broker dropped the connection mid-session. Automatic reconnect occurs on next publish event. | Check broker logs |
| `trackbox.mqtt` | `MQTT: sensor X attributes are N bytes (>16KB), HA may truncate` | Attributes payload is large; HA may not display all shipment items. | Archive old shipments |
| `trackbox.imap` | `IMAP poll failed` | Full stack trace follows. Usually a connection/auth error. | Check IMAP credentials and network |
| `trackbox.scheduler` | `Shipment N: scraping disabled after 3 failures` | Circuit-breaker tripped. See [Resetting a stalled shipment](#resetting-a-stalled-shipment). | Check scrape log for root cause |
| `trackbox.scheduler` | `Scraper cycle failed unexpectedly` | Unhandled exception in the scheduler loop. Full stack trace follows. | File a bug; the loop will continue |

## Health endpoints

### GET /health

Quick liveness check. Verifies database connectivity.

```bash
curl http://localhost:8000/health
```

```json
{
  "status": "ok",
  "version": "1.2.3",
  "build_time": "2026-01-20T15:00:00Z",
  "uptime_seconds": 86400
}
```

### GET /api/scrapers

Shows scraper status for all carriers. Use this to check if scraping is active and configured.

```bash
curl http://localhost:8000/api/scrapers
```

Key fields to check:

| Field | Healthy value | Problem value |
|-------|---------------|---------------|
| `scheduler_running` | `true` | `false` — scheduler crashed |
| `scrapers[n].enabled` | `true` | `false` — disabled in Settings |
| `scrapers[n].configured` | `true` | `false` — DHL API key missing |

### GET /api/imap/status

IMAP poller health. Shows last poll time and last error.

```bash
curl http://localhost:8000/api/imap/status
```

```json
{
  "enabled": true,
  "running": true,
  "last_poll_at": "2026-01-27T10:00:00Z",
  "last_error": null,
  "emails_processed": 47
}
```

If `last_error` is non-null, IMAP polling encountered an error on the last cycle. The poller will retry on the next interval.

### GET /api/scrape-log

Query the scrape attempt log for a specific shipment or carrier.

```bash
# Last 20 scrape attempts for shipment #42
curl "http://localhost:8000/api/scrape-log?shipment_id=42&limit=20"

# All failures for DHL
curl "http://localhost:8000/api/scrape-log?carrier=dhl&status=error&limit=50"

# All disabled events
curl "http://localhost:8000/api/scrape-log?status=disabled&limit=20"
```

Scrape log status values:

| Status | Meaning |
|--------|---------|
| `success` | State changed; event recorded. |
| `no_change` | Scrape succeeded but state did not change. |
| `error` | Scraper raised a `ScraperError` (e.g. HTTP 403, 404, parse failure). |
| `timeout` | HTTP request timed out (15-second threshold). |
| `disabled` | Circuit-breaker fired: scraping disabled after 3 failures. |

## Alert triage

### "My package hasn't updated in days"

1. Open the shipment detail page. Check the "Source & sync" card for a stall warning.
2. If `stall_reason == "scrape_failures"`: open the Scrape Log section and read the `message` column of the most recent `error` or `disabled` entries.
3. Common root causes:
   - `DHL search returned 403` — DHL's web endpoint is temporarily rate-limiting. Wait 24 hours and re-enable.
   - `Request timed out` — Carrier endpoint is slow or unreachable. Try a manual scrape after a few hours.
   - `Tracking number not found` — The carrier has purged the tracking data. The shipment has likely been delivered; check `max_retention_days`.
4. If `stall_reason == "retention_expired"`: the carrier's tracking retention window has passed. No further updates are possible. Archive the shipment.

### Scraping silently stopped

The circuit-breaker disables a shipment's scraping after 3 consecutive failures without logging a user-visible alert. To find all stalled shipments:

```bash
curl "http://localhost:8000/api/shipments" | jq '.[] | select(.stalled == true)'
```

Or via the scrape log:

```bash
curl "http://localhost:8000/api/scrape-log?status=disabled"
```

### IMAP polling stopped

1. Check `GET /api/imap/status` for the `last_error` field.
2. If `enabled: false` — `IMAP_HOST` or `IMAP_USER` are not set in the environment.
3. If `running: false` but `enabled: true` — the poller task crashed. Restart the container.
4. Common IMAP errors: authentication failure (wrong password or expired app password), connection refused (firewall or wrong port), SSL certificate errors.

## Resetting a stalled shipment

When a shipment's scraping has been disabled by the circuit-breaker (`scrape_fail_count >= 3`):

**Via the UI:**  
Open the shipment detail page and click the "Re-enable" button in the "Source & sync" card.

**Via the API:**

```bash
curl -X PUT http://localhost:8000/api/shipments/42/scrape \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

This sets `scrape_enabled = 1` **and resets `scrape_fail_count` to 0**. The shipment will be scraped on the next scheduler cycle (within 1 minute).

**Important:** Reset is only worthwhile if the underlying error is resolved. If DHL returned 403, wait at least 24 hours before re-enabling. If the tracking number is not found, the carrier has likely purged the data and further scraping will continue to fail.

## Scrape circuit-breaker behavior

The circuit-breaker is a per-shipment counter, not a per-carrier one. Each scraping attempt that raises a `ScraperError` (HTTP error, parse failure, not-found) increments `scrape_fail_count`. A network timeout does **not** increment the counter.

- After 1–2 failures: scraping continues on the normal schedule.
- After 3 failures: `scrape_enabled` is set to `0`. Scraping stops permanently until manually re-enabled. A `disabled` entry is written to the scrape log.

The scheduler query explicitly filters for `scrape_fail_count < 3`, so stalled shipments are never attempted again until reset.

## Manual scrape

To trigger an immediate scrape for a single shipment (bypasses the scheduler):

```bash
curl -X POST http://localhost:8000/api/shipments/42/scrape
```

A 6-second cooldown applies between manual scrapes (to respect carrier rate limits). If called too quickly, returns HTTP 422 with a retry-after message.

## Checking retained parsers

Parsers are the AI-learned extraction rules that eliminate repeat AI calls. To see all stored parsers and their use counts:

```bash
curl http://localhost:8000/api/parsers
```

A parser with `use_count = 0` was created but never reused (self-healing may have regenerated it). High use counts indicate stable, well-functioning parsers.

## Viewing structured stats

```bash
curl http://localhost:8000/api/stats
```

Returns shipment counts by state, total parser count, total event count.
