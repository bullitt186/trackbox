"""GLS public tracking scraper (parses RSC payload from SSR page)."""

from __future__ import annotations

import json
import re

import httpx

from scrapers.base import BaseScraper, ScraperError, ScraperResult

GLS_TRACKING_URL = "https://track-and-trace.glsnxt.com/reach-sendungsverfolgung"


def _map_gls_status(delivery_status: str) -> str:
    s = delivery_status.upper()
    if s.startswith("DELIVERED"):
        return "delivered"
    if "OUT_FOR_DELIVERY" in s:
        return "out_for_delivery"
    if s == "PREADVICE":
        return "preparing"
    return "in_transit"


# ponytail: regex to extract tracking JSON from Next.js RSC payload in HTML
# The RSC payload double-escapes quotes as \\" in the script tag
_TRACKING_RE = re.compile(
    r'trackingDetailsWithoutCustomerId\\":\{.*?deliveryEvents\\":\[.*?\].*?\}',
    re.DOTALL,
)


class GLSScraper(BaseScraper):
    """Scraper using GLS public tracking page (SSR JSON extraction)."""

    name = "GLS"
    key = "gls"
    carrier = "gls"
    default_interval_minutes = 60
    min_request_spacing = 3.0

    async def scrape(self, tracking_number: str) -> ScraperResult | None:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(
                GLS_TRACKING_URL,
                params={"trackingNumber": tracking_number, "lang": "de"},
            )

        if resp.status_code != 200:
            raise ScraperError(
                f"GLS returned {resp.status_code}",
                status_code=resp.status_code,
            )

        html = resp.text
        match = _TRACKING_RE.search(html)
        if not match:
            return None

        try:
            raw_json = '{"' + match.group(0) + "}"
            # The RSC payload double-escapes quotes
            raw_json = raw_json.replace('\\"', '"')
            data = json.loads(raw_json)
        except (json.JSONDecodeError, ValueError):
            return None

        details = data.get("trackingDetailsWithoutCustomerId", {})
        if not details:
            return None

        # Extract status from sibling trackingStatus if present in HTML
        status_match = re.search(
            r'deliveryStatus\\\\":\\\\"([^\\]+)', html
        )
        if status_match:
            status = _map_gls_status(status_match.group(1))
        else:
            # Fallback: check deliveredAt
            status = "delivered" if details.get("deliveredAt") else "in_transit"

        description = details.get("latestStatusText", "")

        events: list[dict] = []
        for ev in details.get("deliveryEvents", []):
            events.append({
                "date": ev.get("occurrenceDateTime", ""),
                "status": "",
                "description": ev.get("description", ""),
                "location": ev.get("locationDetails") or "",
            })

        return ScraperResult(
            status=status,
            description=description,
            events=events,
            raw=details,
        )
