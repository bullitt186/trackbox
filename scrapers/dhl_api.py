"""DHL Shipment Tracking - Unified API scraper."""

from __future__ import annotations

import httpx

import settings
from scrapers.base import BaseScraper, ScraperError, ScraperResult

DHL_API_BASE = "https://api-eu.dhl.com/track/shipments"

# Map DHL status codes to trackbox states
_DHL_STATUS_MAP: dict[str, str] = {
    "pre-transit": "preparing",
    "transit": "in_transit",
    "delivered": "delivered",
    "failure": "exception",
    "unknown": "unknown",
}


def _map_dhl_status(dhl_status: str) -> str:
    """Map a DHL status string to a trackbox state."""
    lower = dhl_status.lower().strip()
    if lower in _DHL_STATUS_MAP:
        return _DHL_STATUS_MAP[lower]
    # Handle additional DHL-specific values
    if "delivery" in lower or "out-for-delivery" in lower:
        return "out_for_delivery"
    if "transit" in lower:
        return "in_transit"
    if "customs" in lower or "held" in lower:
        return "delayed"
    return "in_transit"


class DHLAPIScraper(BaseScraper):
    """Scraper using DHL's Shipment Tracking - Unified API."""

    name = "DHL Unified API"
    key = "dhl_api"
    carrier = "dhl"
    default_interval_minutes = 120
    min_request_spacing = 6.0  # DHL API: 250 calls/day, min 5s between

    async def scrape(self, tracking_number: str) -> ScraperResult | None:
        """Query DHL API for shipment status."""
        api_key = settings.get_setting("scraper_dhl_api_key")
        if not api_key:
            raise ScraperError("DHL API key not configured")

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                DHL_API_BASE,
                params={"trackingNumber": tracking_number},
                headers={"DHL-API-Key": api_key},
            )

        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            raise ScraperError(
                f"DHL API returned {resp.status_code}: {resp.text[:200]}",
                status_code=resp.status_code,
            )

        data = resp.json()
        shipments = data.get("shipments", [])
        if not shipments:
            return None

        shipment = shipments[0]
        dhl_status = shipment.get("status", {})
        status_code = dhl_status.get("statusCode", "unknown")
        description = dhl_status.get("description", dhl_status.get("status", ""))

        # Extract estimated delivery date (DHL API provides estimatedTimeOfDelivery)
        estimated_delivery: str | None = None
        eta_raw = shipment.get("estimatedTimeOfDelivery") or shipment.get("estimatedDeliveryTime")
        if eta_raw:
            # Trim to YYYY-MM-DD
            estimated_delivery = str(eta_raw)[:10]

        # Parse events
        events: list[dict] = []
        for ev in shipment.get("events", []):
            ev_status = ev.get("statusCode", ev.get("status", ""))
            events.append({
                "date": ev.get("timestamp", ""),
                "status": _map_dhl_status(ev_status),
                "description": ev.get("description", ev.get("status", "")),
                "location": _format_location(ev.get("location", {})),
            })

        return ScraperResult(
            status=_map_dhl_status(status_code),
            description=description,
            events=events,
            raw=data,
            estimated_delivery=estimated_delivery,
        )


def _format_location(location: dict) -> str:
    """Format a DHL location dict into a readable string."""
    if not location:
        return ""
    address = location.get("address", {})
    parts = []
    if address.get("addressLocality"):
        parts.append(address["addressLocality"])
    if address.get("countryCode"):
        parts.append(address["countryCode"])
    return ", ".join(parts)
