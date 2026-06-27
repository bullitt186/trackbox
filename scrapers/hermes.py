"""Hermes public tracking API scraper."""

from __future__ import annotations

import httpx

from scrapers.base import BaseScraper, ScraperError, ScraperResult

HERMES_API = "https://api.my-deliveries.de/tnt/v2/shipments/search"


def _map_hermes_status(parcel_status: str) -> str:
    s = parcel_status.upper()
    if s.startswith("DELIVERED"):
        return "delivered"
    if s == "DELIVERY_TOUR_STARTED":
        return "out_for_delivery"
    if s == "PARCEL_ANNOUNCED":
        return "preparing"
    return "in_transit"


class HermesScraper(BaseScraper):
    """Scraper using Hermes public tracking API (no auth required)."""

    name = "Hermes"
    key = "hermes"
    carrier = "hermes"
    default_interval_minutes = 60
    max_retention_days = 30
    min_request_spacing = 3.0

    async def scrape(self, tracking_number: str) -> ScraperResult | None:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(f"{HERMES_API}/{tracking_number}")

        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            raise ScraperError(
                f"Hermes API returned {resp.status_code}: {resp.text[:200]}",
                status_code=resp.status_code,
            )

        data = resp.json()
        if not data:
            return None

        shipment = data[0]
        progress = shipment.get("parcelProgress", [])
        if not progress:
            return None

        latest = progress[0]
        status = _map_hermes_status(latest.get("parcelStatus", ""))
        description = latest.get("historyText", latest.get("headlineText", ""))

        events: list[dict] = []
        for ev in progress:
            events.append({
                "date": ev.get("timestamp", ""),
                "status": _map_hermes_status(ev.get("parcelStatus", "")),
                "description": ev.get("historyText", ""),
                "location": "",
            })

        return ScraperResult(
            status=status,
            description=description,
            events=events,
            raw=shipment,
        )
