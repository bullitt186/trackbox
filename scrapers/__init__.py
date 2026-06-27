"""Scraper registry for carrier APIs."""

from __future__ import annotations

import settings as _settings
from scrapers.base import BaseScraper

# dict[carrier, list[scraper_class]] — first entry is the default
_SCRAPERS: dict[str, list[type[BaseScraper]]] = {}


def _register_builtins() -> None:
    from scrapers.dhl_api import DHLAPIScraper
    from scrapers.dhl_web import DHLWebScraper
    from scrapers.dpd import DPDScraper
    from scrapers.gls import GLSScraper
    from scrapers.hermes import HermesScraper
    _SCRAPERS["dhl"] = [DHLWebScraper, DHLAPIScraper]  # web first (works without API key)
    _SCRAPERS["hermes"] = [HermesScraper]
    _SCRAPERS["gls"] = [GLSScraper]
    _SCRAPERS["dpd"] = [DPDScraper]


def _ensure_loaded() -> None:
    if not _SCRAPERS:
        _register_builtins()


def get_scraper(carrier: str) -> BaseScraper | None:
    """Get a scraper instance for the given carrier, respecting the active selection."""
    _ensure_loaded()
    classes = _SCRAPERS.get(carrier.lower(), [])
    if not classes:
        return None
    active_key = _settings.get_setting(f"scraper_{carrier.lower()}_active", "")
    if active_key:
        for cls in classes:
            if cls.key == active_key:
                return cls()
    return classes[0]()


def list_scrapers() -> list[dict]:
    """List carriers with their scraper options and active selection."""
    _ensure_loaded()
    result = []
    for carrier, classes in _SCRAPERS.items():
        active_key = _settings.get_setting(f"scraper_{carrier}_active", "") or classes[0].key
        # Use the active scraper's metadata for the card display
        active_cls = next((c for c in classes if c.key == active_key), classes[0])
        result.append({
            "carrier": carrier,
            "name": active_cls.name,
            "default_interval_minutes": active_cls.default_interval_minutes,
            "available_scrapers": [{"key": c.key, "name": c.name} for c in classes],
            "active_scraper": active_key,
        })
    return result
