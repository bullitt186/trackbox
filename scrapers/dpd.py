"""DPD public tracking scraper (HTML parsing)."""

from __future__ import annotations

import re

import httpx

from scrapers.base import BaseScraper, ScraperError, ScraperResult

DPD_TRACKING_URL = "https://tracking.dpd.de/parcelstatus"

# Status image number → trackbox state
_DPD_STATUS_MAP: dict[str, str] = {
    "6": "delivered",
    "5": "out_for_delivery",
    "4": "in_transit",
    "3": "in_transit",
    "2": "preparing",
    "1": "preparing",
}

# Timeline label IDs in order
_TIMELINE_LABELS = [
    ("labStatusStart", "preparing"),
    ("labStatusOnTheRoad", "in_transit"),
    ("labStatusDeliveryDepot", "in_transit"),
    ("labStatusCarLoad", "out_for_delivery"),
    ("labStatusDelivered", "delivered"),
]


def _extract_text(html: str, element_id: str) -> str | None:
    """Extract text content from a span with the given ID."""
    pattern = rf'id="{element_id}"[^>]*>([^<]*)<'
    m = re.search(pattern, html)
    return m.group(1).strip() if m else None


class DPDScraper(BaseScraper):
    """Scraper using DPD public tracking page (HTML scraping)."""

    name = "DPD"
    key = "dpd"
    carrier = "dpd"
    default_interval_minutes = 60
    min_request_spacing = 5.0

    async def scrape(self, tracking_number: str) -> ScraperResult | None:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(
                DPD_TRACKING_URL,
                params={"query": tracking_number, "locale": "de_DE", "type": "1"},
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                },
            )

        if resp.status_code != 200:
            raise ScraperError(
                f"DPD returned {resp.status_code}",
                status_code=resp.status_code,
            )

        html = resp.text

        # Check for error page
        if "konnte nicht geladen" in html and "parcelNo" not in html:
            return None

        # Determine status from the status image
        status_img_match = re.search(r'status_(\d+)\.svg', html)
        if status_img_match:
            status = _DPD_STATUS_MAP.get(status_img_match.group(1), "unknown")
        else:
            status = "unknown"

        # Get delivery status text (e.g. "Paket zugestellt - 14.02.2026")
        delivery_status_text = _extract_text(html, "ContentPlaceHolder1_repParcelList_labDeliveryStatus_0") or ""
        description = delivery_status_text

        # Extract timeline events
        events: list[dict] = []
        for label_id, event_status in _TIMELINE_LABELS:
            text = _extract_text(html, f"ContentPlaceHolder1_{label_id}")
            date = _extract_text(html, f"ContentPlaceHolder1_{label_id}Date")
            if text:
                events.append({
                    "date": date or "",
                    "status": event_status,
                    "description": text,
                    "location": "",
                })

        if not events and status == "unknown":
            return None

        return ScraperResult(
            status=status,
            description=description,
            events=events,
            raw={},
        )
