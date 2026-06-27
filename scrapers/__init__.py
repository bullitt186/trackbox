"""Scraper registry for carrier APIs."""

from __future__ import annotations

from scrapers.base import BaseScraper

_SCRAPERS: dict[str, type[BaseScraper]] = {}


def _register_builtins() -> None:
    from scrapers.dhl_api import DHLAPIScraper
    _SCRAPERS["dhl"] = DHLAPIScraper


def get_scraper(carrier: str) -> BaseScraper | None:
    """Get a scraper instance for the given carrier (case-insensitive)."""
    if not _SCRAPERS:
        _register_builtins()
    key = carrier.lower()
    cls = _SCRAPERS.get(key)
    if cls:
        return cls()
    return None


def list_scrapers() -> list[dict[str, str]]:
    """List all registered scrapers with their carrier names."""
    if not _SCRAPERS:
        _register_builtins()
    return [{"carrier": k, "name": v.name} for k, v in _SCRAPERS.items()]
