"""Base class and result type for all scrapers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class ScraperResult:
    """Result from a scraper run."""

    status: str  # one of the trackbox states
    description: str  # human-readable status text
    events: list[dict] = field(default_factory=list)  # [{date, status, description, location}]
    raw: dict = field(default_factory=dict)  # raw API response for debugging


class BaseScraper(ABC):
    """Abstract base for carrier scrapers."""

    name: str = "unknown"
    carrier: str = ""
    default_interval_minutes: int = 60
    min_request_spacing: float = 5.0

    @abstractmethod
    async def scrape(self, tracking_number: str) -> ScraperResult | None:
        """Scrape tracking info for the given tracking number.

        Returns ScraperResult on success, None if tracking number not found.
        Raises httpx.TimeoutException on network timeout.
        Raises ScraperError on API errors.
        """
        ...


class ScraperError(Exception):
    """Raised when a scraper encounters a non-timeout API error."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code
