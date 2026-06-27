"""Scraper registry for carrier APIs."""

from __future__ import annotations

from scrapers.base import BaseScraper

_SCRAPERS: dict[str, type[BaseScraper]] = {}


def _register_builtins() -> None:
    from scrapers.dhl_api import DHLAPIScraper
    from scrapers.dpd import DPDScraper
    from scrapers.gls import GLSScraper
    from scrapers.hermes import HermesScraper
    _SCRAPERS["dhl"] = DHLAPIScraper
    _SCRAPERS["hermes"] = HermesScraper
    _SCRAPERS["gls"] = GLSScraper
    _SCRAPERS["dpd"] = DPDScraper


def get_scraper(carrier: str) -> BaseScraper | None:
    """Get a scraper instance for the given carrier (case-insensitive)."""
    if not _SCRAPERS:
        _register_builtins()
    key = carrier.lower()
    cls = _SCRAPERS.get(key)
    if cls:
        return cls()
    return None


def list_scrapers() -> list[dict]:
    """List all registered scrapers with their carrier names and metadata."""
    if not _SCRAPERS:
        _register_builtins()
    return [
        {
            "carrier": k,
            "name": v.name,
            "default_interval_minutes": v.default_interval_minutes,
        }
        for k, v in _SCRAPERS.items()
    ]
