# Carrier Scraper Reference

Trackbox can automatically poll carrier tracking APIs to keep shipment states up to date without waiting for new emails. This document covers the four supported carriers, their scraping methods, rate limits, and failure behavior.

## Supported carriers

| Carrier | Scraper key(s) | Default interval | Max retention | Auth required |
|---------|----------------|-----------------|---------------|---------------|
| DHL | `dhl_web` (default), `dhl_api` | 60 min / 120 min | 90 days | No / Yes (API key) |
| Hermes | `hermes` | 60 min | 30 days | No |
| DPD | `dpd` | 60 min | 90 days | No |
| GLS | `gls` | 60 min | 90 days | No |

The active scraper for each carrier is configured in the Settings UI. The default choice (DHL Web, Hermes, DPD, GLS) works without any API keys.

## DHL

DHL has two scraper backends. You switch between them in Settings > DHL scraper card.

### DHL Web (`dhl_web`) — default

Scrapes the public `dhl.de` tracking JSON endpoint. No API key required.

- **Interval:** 60 minutes
- **Rate limit:** The endpoint is rate-sensitive; Trackbox enforces a 6-second minimum gap between requests to avoid triggering DHL's anti-bot measures.
- **Authentication:** None. Uses a CSRF token fetched from the DHL config endpoint on each request.
- **Fragility:** This scraper fetches an undocumented public endpoint. DHL may respond with HTTP 403 or change the endpoint structure without notice. If scraping consistently fails with 403, switch to the DHL API scraper or wait 24 hours.
- **Retention:** DHL removes tracking data approximately 90 days after delivery. After that, the scraper returns `null` (tracking number not found).

**Status mapping:**

| DHL `fortschritt` / field | Trackbox state |
|--------------------------|----------------|
| `istZugestellt = true` | `delivered` |
| `fortschritt >= 4` | `out_for_delivery` |
| `fortschritt >= 2` | `in_transit` |
| `fortschritt == 1` | `preparing` |
| `fortschritt == 0` | `unknown` |

### DHL Unified API (`dhl_api`)

Uses the official [DHL Shipment Tracking - Unified API](https://developer.dhl.com/api-reference/shipment-tracking).

- **Interval:** 120 minutes (halved to stay within the 250 calls/day free tier)
- **Rate limit:** 250 calls/day on the free tier; 6 seconds minimum between requests.
- **Authentication:** Requires `DHL_API_KEY` environment variable (or set via Settings > DHL API key). Without a key, the scraper raises `ScraperError("DHL API key not configured")` and the circuit-breaker will eventually disable the shipment.
- **Reliability:** More stable than web scraping; the API contract is versioned.
- **Retention:** Same 90-day window as the web endpoint.

**Status mapping:**

| DHL API `statusCode` | Trackbox state |
|---------------------|----------------|
| `pre-transit` | `preparing` |
| `transit` | `in_transit` |
| `delivered` | `delivered` |
| `failure` | `exception` |
| `unknown` | `unknown` |
| Contains `delivery` / `out-for-delivery` | `out_for_delivery` |
| Contains `customs` / `held` | `delayed` |

## Hermes (`hermes`)

Scrapes the Hermes public tracking REST API (`api.my-deliveries.de`).

- **Interval:** 60 minutes
- **Rate limit:** 3-second minimum between requests.
- **Authentication:** None.
- **Retention:** 30 days after delivery. This is significantly shorter than DHL. Expect `null` returns for shipments older than a month. The Settings UI will show such shipments as "stalled" with `stall_reason: retention_expired`.

**Status mapping:**

| Hermes `parcelStatus` | Trackbox state |
|----------------------|----------------|
| `DELIVERED*` | `delivered` |
| `DELIVERY_TOUR_STARTED` | `out_for_delivery` |
| `PARCEL_ANNOUNCED` | `preparing` |
| Everything else | `in_transit` |

## DPD (`dpd`)

Scrapes the DPD public tracking HTML page and parses the status SVG image number and delivery text.

- **Interval:** 60 minutes
- **Rate limit:** 5-second minimum between requests.
- **Authentication:** None.
- **Retention:** 90 days (DPD's default; not explicitly enforced by Trackbox, which uses the `BaseScraper` default of 90 days).
- **Fragility:** Uses HTML parsing. Layout changes to the DPD tracking page may break status extraction. If DPD returns a page without the expected SVG image element, the scraper returns `None` (tracking number not found).

**Status mapping:**

| DPD status SVG number | Trackbox state |
|----------------------|----------------|
| 6 | `delivered` |
| 5 | `out_for_delivery` |
| 4, 3 | `in_transit` |
| 2, 1 | `preparing` |

## GLS (`gls`)

Scrapes the GLS Next.js server-rendered tracking page. Extracts tracking data from the RSC (React Server Components) JSON payload embedded in the HTML.

- **Interval:** 60 minutes
- **Rate limit:** 3-second minimum between requests.
- **Authentication:** None.
- **Retention:** 90 days.
- **Fragility:** Relies on parsing the Next.js RSC payload format from HTML. GLS framework upgrades may change the embedded JSON structure. If the regex does not match, the scraper returns `None`.

**Status mapping:**

| GLS `deliveryStatus` | Trackbox state |
|---------------------|----------------|
| `DELIVERED*` | `delivered` |
| Contains `OUT_FOR_DELIVERY` | `out_for_delivery` |
| `PREADVICE` | `preparing` |
| Everything else | `in_transit` |

## Scraper scheduling

The scheduler runs every 60 seconds and finds shipments that are due for scraping. A shipment is due if:
- `scrape_enabled = 1`
- `scrape_fail_count < 3`
- `current_state != 'delivered'`
- `last_scraped_at` is older than the carrier's configured interval

Shipments are scraped in random order to distribute load across carriers. A per-scraper minimum spacing is enforced between consecutive requests to the same carrier.

## Circuit-breaker behavior

After 3 consecutive scraping failures, a shipment's `scrape_enabled` is set to 0 and scraping stops. This is a **per-shipment** circuit-breaker, not a per-carrier one. Other shipments using the same carrier continue scraping normally.

Failures that trigger the counter:
- HTTP error from carrier API (e.g. 403, 500, parse failure)
- Tracking number not found (`null` result from scraper)
- Unhandled exception

Failures that do **not** trigger the counter:
- Network timeout (`httpx.TimeoutException`) — these are retried next cycle without incrementing the counter

To reset a tripped circuit-breaker, see [Resetting a stalled shipment](runbook.md#resetting-a-stalled-shipment).

## `max_retention_days` behavior

Each carrier has a maximum retention window. When a delivered shipment's `last_updated_at` is older than the effective retention days, the scheduler auto-archives it:
- `scrape_enabled` is set to `0`
- `archived` is set to `1`
- The shipment disappears from the active list

You can configure a shorter retention window per carrier in Settings. The effective retention is `min(configured_retention, carrier_max_retention)`. You cannot set retention longer than the carrier's maximum.

**Practical example:** If you configure Hermes retention to 60 days but Hermes's max is 30 days, the effective retention is 30 days. The extra 30 days in your setting is silently capped.

## Adding tracking links for unsupported carriers

For carriers without a built-in scraper, Trackbox still creates shipments from email. The tracking link is normalized to a known public URL for recognized carriers (DHL, Hermes, DPD, GLS, UPS, FedEx). For unknown carriers, the link falls back to `https://parcelsapp.com/en/tracking/{tracking_number}`, which supports 300+ carriers.

Scraping does not occur for carriers without a registered scraper. The shipment will only update when new emails arrive.
