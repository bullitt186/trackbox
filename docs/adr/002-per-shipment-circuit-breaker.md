# ADR 002: Per-Shipment Circuit-Breaker for Scraping (3-Failure Threshold)

**Status:** Accepted  
**Date:** 2026-01-01  
**Deciders:** bullitt

## Context

Trackbox's scraper scheduler polls carrier APIs periodically to detect state changes without waiting for new emails. Carrier APIs occasionally:
- Return HTTP 403 (rate-limiting or bot detection)
- Return 404 (tracking number expired or purged)
- Time out
- Return malformed responses

Without any failure-handling, the scheduler would retry endlessly, wasting requests and accumulating scrape log noise.

## Decision

Implement a per-shipment circuit-breaker using a `scrape_fail_count` column in the `shipments` table:

- Each `ScraperError` (non-timeout failure) increments `scrape_fail_count`.
- When `scrape_fail_count >= 3`, `scrape_enabled` is set to `0` and scraping stops permanently for that shipment.
- Network timeouts (`httpx.TimeoutException`) do **not** increment the counter — they are transient and should be retried.
- Re-enabling via `PUT /api/shipments/{id}/scrape` with `{"enabled": true}` resets `scrape_fail_count` to 0.

The threshold of 3 was chosen to distinguish transient errors (e.g. a single 403 during DHL maintenance) from persistent errors (tracking number expired). Three is the minimum that filters out single transient failures while still triggering within a reasonable timeframe.

## Consequences

**Positive:**
- Stalled shipments stop consuming API quota automatically.
- The scrape log records the exact error message at the time of each failure, giving operators context for why scraping stopped.
- Operators can reset the circuit-breaker once the underlying issue is resolved.
- The per-shipment granularity means one bad shipment does not affect others using the same carrier.

**Negative:**
- Three transient errors in a row (e.g. DHL is down for an hour during the hourly scrape cycle) will trip the breaker and require manual reset.
- Users have no visible alert when the circuit-breaker trips; they must notice the stall warning in the UI or check logs.
- The threshold is not configurable; a more sophisticated system might use exponential backoff.

**Mitigations:**
- The stall warning in the shipment detail UI makes tripped circuit-breakers visible to users.
- `GET /api/scrape-log?status=disabled` allows operators to find all tripped shipments programmatically.
- Timeout errors are deliberately excluded from the counter to prevent transient network hiccups from triggering the breaker.
