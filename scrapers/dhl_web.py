"""DHL public web scraper (no API key required)."""

from __future__ import annotations

import httpx

from scrapers.base import BaseScraper, ScraperError, ScraperResult

DHL_CONFIG_URL = "https://www.dhl.de/int-verfolgen/data/config"
DHL_SEARCH_URL = "https://www.dhl.de/int-verfolgen/data/search"

_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"


def _map_status(details: dict) -> str:
    if details.get("istZugestellt"):
        return "delivered"
    verlauf = details.get("sendungsverlauf", {})
    fortschritt = verlauf.get("fortschritt", 0)
    if fortschritt >= 4:
        return "out_for_delivery"
    if fortschritt >= 2:
        return "in_transit"
    if fortschritt == 1:
        return "preparing"
    return "unknown"


class DHLWebScraper(BaseScraper):
    """Scraper using DHL.de public tracking JSON endpoint (no API key)."""

    name = "DHL Web"
    key = "dhl_web"
    carrier = "dhl"
    default_interval_minutes = 60
    min_request_spacing = 6.0

    async def scrape(self, tracking_number: str) -> ScraperResult | None:
        async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": _UA}) as client:
            config_resp = await client.get(DHL_CONFIG_URL, params={"domain": "de", "language": "de"})
            if config_resp.status_code != 200:
                raise ScraperError(
                    f"DHL config returned {config_resp.status_code}",
                    status_code=config_resp.status_code,
                )
            csrf = config_resp.json().get("verfolgenCsrfToken", "")

            resp = await client.get(
                DHL_SEARCH_URL,
                params={"piececode": tracking_number, "language": "de"},
                headers={"X-CSRF-Token": csrf},
            )

        if resp.status_code != 200:
            raise ScraperError(
                f"DHL search returned {resp.status_code}: {resp.text[:200]}",
                status_code=resp.status_code,
            )

        data = resp.json()
        sendungen = data.get("sendungen", [])
        if not sendungen:
            return None

        shipment = sendungen[0]

        # Not found
        not_found = shipment.get("sendungNichtGefunden", {})
        if not_found.get("keineDatenVerfuegbar"):
            return None

        details = shipment.get("sendungsdetails", {})
        status = _map_status(details)

        verlauf = details.get("sendungsverlauf", {})
        events: list[dict] = []
        for ev in verlauf.get("events", []):
            events.append({
                "date": f"{ev.get('datum', '')} {ev.get('uhrzeit', '')}".strip(),
                "status": "",
                "description": ev.get("status", ""),
                "location": ev.get("ort", ""),
            })

        # Current status description from last event
        description = events[0]["description"] if events else ""

        return ScraperResult(
            status=status,
            description=description,
            events=events,
            raw=data,
        )
