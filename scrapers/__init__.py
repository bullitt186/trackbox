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
    """List carriers with their scraper options.

    Returns static registry data only — no settings DB access to avoid
    circular import (settings._build_defaults calls list_scrapers).
    The active_scraper field is populated from settings only at the API layer.
    """
    _ensure_loaded()
    return [
        {
            "carrier": carrier,
            "name": classes[0].name,
            "default_interval_minutes": classes[0].default_interval_minutes,
            "available_scrapers": [{"key": c.key, "name": c.name} for c in classes],
            "active_scraper": classes[0].key,  # default; overridden by settings at API layer
        }
        for carrier, classes in _SCRAPERS.items()
    ]
