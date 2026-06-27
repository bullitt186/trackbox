"""Background scheduler for carrier scraping."""

from __future__ import annotations

import asyncio
import logging
import random
import time as time_mod
from datetime import datetime, timedelta, timezone

import httpx

import db
import settings
from ingest import should_update_state
from scrapers import get_scraper
from scrapers.base import ScraperError, ScraperResult

log = logging.getLogger("trackbox.scheduler")


class ScraperScheduler:
    """Runs scraping cycles in the background inside the FastAPI event loop."""

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._running = False
        self._last_cycle_at: str | None = None

    @property
    def last_cycle_at(self) -> str | None:
        return self._last_cycle_at

    @property
    def running(self) -> bool:
        return self._running

    def start(self) -> None:
        self._running = True
        self._task = asyncio.create_task(self._loop())
        log.info("Scraper scheduler started")

    def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
        log.info("Scraper scheduler stopped")

    async def _loop(self) -> None:
        # Small initial delay to let the app fully start
        await asyncio.sleep(5)
        while self._running:
            try:
                await self._run_cycle()
            except Exception:
                log.exception("Scraper cycle failed unexpectedly")
            await asyncio.sleep(60)  # Check every minute

    async def _run_cycle(self) -> None:
        """Find shipments due for scraping and process them."""
        # Check if DHL scraper is enabled
        dhl_enabled = settings.get_setting("scraper_dhl_enabled", "true")
        if dhl_enabled.lower() != "true":
            return

        interval_str = settings.get_setting("scraper_dhl_interval_minutes", "60")
        try:
            interval_minutes = int(interval_str)
        except ValueError:
            interval_minutes = 60

        now = datetime.now(timezone.utc)
        cutoff = (now - timedelta(minutes=interval_minutes)).isoformat()

        # Find shipments due for scraping
        conn = db.get_conn()
        # ponytail: delivered filter disabled for testing
        rows = conn.execute(
            """SELECT * FROM shipments
               WHERE scrape_enabled = 1
                 AND scrape_fail_count < 3
                 AND (last_scraped_at IS NULL OR last_scraped_at < ?)
            """,
            (cutoff,),
        ).fetchall()
        conn.close()

        shipments_due = [dict(r) for r in rows]
        if not shipments_due:
            return

        self._last_cycle_at = now.isoformat()
        log.info("Scraper cycle: %d shipment(s) due", len(shipments_due))

        # Add random jitter: spread across available time
        # If 5 packages in 60min interval, scrape one every ~12min
        if len(shipments_due) > 1:
            spacing = (interval_minutes * 60) / len(shipments_due)
            random.shuffle(shipments_due)
        else:
            spacing = 0

        for i, shipment in enumerate(shipments_due):
            if not self._running:
                break
            # DHL rate limit: min 5s between requests. Add jitter on top.
            if i > 0:
                min_delay = 6  # 5s DHL minimum + 1s safety
                jitter = random.uniform(min_delay, max(min_delay, spacing * 0.5))
                await asyncio.sleep(jitter)

            await self._scrape_shipment(shipment)

    async def _scrape_shipment(self, shipment: dict) -> None:
        """Scrape a single shipment and handle results."""
        carrier = (shipment.get("carrier") or "").lower()
        tracking_number = shipment.get("tracking_number")

        if not tracking_number:
            return

        # Determine which scraper to use
        scraper = get_scraper(carrier)
        if scraper is None:
            # Try DHL as default for German parcels
            if "dhl" in carrier or not carrier:
                scraper = get_scraper("dhl")
            if scraper is None:
                return

        shipment_id = shipment["id"]
        current_state = shipment["current_state"]
        start_time = time_mod.time()

        try:
            result = await scraper.scrape(tracking_number)
        except httpx.TimeoutException:
            duration_ms = int((time_mod.time() - start_time) * 1000)
            log.warning(
                "Scrape timeout for shipment %d (%s)", shipment_id, tracking_number
            )
            db.add_scrape_log(
                shipment_id, carrier, tracking_number,
                status="timeout", state_before=current_state, state_after=None,
                message="Request timed out", duration_ms=duration_ms,
            )
            return
        except ScraperError as e:
            duration_ms = int((time_mod.time() - start_time) * 1000)
            log.warning(
                "Scrape error for shipment %d: %s", shipment_id, e
            )
            db.add_scrape_log(
                shipment_id, carrier, tracking_number,
                status="error", state_before=current_state, state_after=None,
                message=str(e), duration_ms=duration_ms,
            )
            self._handle_failure(shipment_id, shipment["scrape_fail_count"], str(e))
            return
        except Exception as e:
            duration_ms = int((time_mod.time() - start_time) * 1000)
            log.exception(
                "Unexpected scrape error for shipment %d", shipment_id
            )
            db.add_scrape_log(
                shipment_id, carrier, tracking_number,
                status="error", state_before=current_state, state_after=None,
                message=str(e), duration_ms=duration_ms,
            )
            self._handle_failure(shipment_id, shipment["scrape_fail_count"], str(e))
            return

        duration_ms = int((time_mod.time() - start_time) * 1000)

        if result is None:
            # Tracking number not found - count as failure
            db.add_scrape_log(
                shipment_id, carrier, tracking_number,
                status="error", state_before=current_state, state_after=None,
                message="Tracking number not found", duration_ms=duration_ms,
            )
            self._handle_failure(
                shipment_id, shipment["scrape_fail_count"], "Tracking number not found"
            )
            return

        # Success: update shipment
        self._apply_result(shipment, result, duration_ms)

    def _apply_result(self, shipment: dict, result: ScraperResult, duration_ms: int) -> None:
        """Apply a successful scraper result to the shipment."""
        shipment_id = shipment["id"]
        carrier = (shipment.get("carrier") or "").lower()
        tracking_number = shipment.get("tracking_number")
        now = datetime.now(timezone.utc).isoformat()

        # Reset fail count and update last_scraped_at
        conn = db.get_conn()
        conn.execute(
            "UPDATE shipments SET scrape_fail_count = 0, last_scraped_at = ? WHERE id = ?",
            (now, shipment_id),
        )
        conn.commit()
        conn.close()

        # Check if state should be updated
        current_state = shipment["current_state"]
        new_state = result.status

        if new_state and new_state != current_state and should_update_state(current_state, new_state):
            db.update_shipment(shipment_id, {"current_state": new_state})
            db.add_event(
                shipment_id,
                new_state,
                result.description or f"Status updated to {new_state}",
                "scraper",
            )
            db.add_scrape_log(
                shipment_id, carrier, tracking_number,
                status="success", state_before=current_state, state_after=new_state,
                message=result.description, duration_ms=duration_ms,
            )
            log.info(
                "Shipment %d: %s -> %s (scraper)",
                shipment_id, current_state, new_state,
            )
        else:
            db.add_scrape_log(
                shipment_id, carrier, tracking_number,
                status="no_change", state_before=current_state, state_after=current_state,
                message="No state change", duration_ms=duration_ms,
            )
            log.debug("Shipment %d: state unchanged (%s)", shipment_id, current_state)

    def _handle_failure(self, shipment_id: int, current_fail_count: int, error_msg: str) -> None:
        """Handle a scraping failure: increment counter, possibly disable."""
        new_fail_count = current_fail_count + 1
        conn = db.get_conn()

        if new_fail_count >= 3:
            # Disable scraping after 3 failures
            conn.execute(
                "UPDATE shipments SET scrape_fail_count = ?, scrape_enabled = 0 WHERE id = ?",
                (new_fail_count, shipment_id),
            )
            conn.commit()
            conn.close()
            shipment = db.get_shipment(shipment_id)
            carrier = (shipment.get("carrier") or "").lower() if shipment else ""  # type: ignore[union-attr]
            tracking_number = shipment.get("tracking_number") if shipment else None  # type: ignore[union-attr]
            current_state = shipment["current_state"] if shipment else None  # type: ignore[index]
            db.add_scrape_log(
                shipment_id, carrier, tracking_number,
                status="disabled", state_before=current_state, state_after=None,
                message="Scraping disabled after 3 failures", duration_ms=None,
            )
            log.warning("Shipment %d: scraping disabled after 3 failures", shipment_id)
        else:
            conn.execute(
                "UPDATE shipments SET scrape_fail_count = ? WHERE id = ?",
                (new_fail_count, shipment_id),
            )
            conn.commit()
            conn.close()


_last_manual_scrape: float = 0
_MANUAL_SCRAPE_COOLDOWN = 6  # seconds, matches DHL 5s rate limit + safety


async def scrape_single(shipment_id: int) -> dict:
    """Trigger an immediate scrape for a single shipment. Returns result info."""
    global _last_manual_scrape

    elapsed = time_mod.time() - _last_manual_scrape
    if elapsed < _MANUAL_SCRAPE_COOLDOWN:
        wait = int(_MANUAL_SCRAPE_COOLDOWN - elapsed) + 1
        return {"error": f"Rate limited. Try again in {wait}s (min {_MANUAL_SCRAPE_COOLDOWN}s between manual scrapes)"}
    _last_manual_scrape = time_mod.time()

    shipment = db.get_shipment(shipment_id)
    if not shipment:
        return {"error": "Shipment not found"}

    # ponytail: delivered check disabled for testing
    # if shipment["current_state"] == "delivered":
    #     return {"error": "Shipment already delivered, skipping scrape"}

    carrier = (shipment.get("carrier") or "").lower()
    tracking_number = shipment.get("tracking_number")

    if not tracking_number:
        return {"error": "No tracking number"}

    scraper = get_scraper(carrier)
    if scraper is None:
        scraper = get_scraper("dhl")
    if scraper is None:
        return {"error": f"No scraper available for carrier: {carrier}"}

    current_state = shipment["current_state"]
    start_time = time_mod.time()

    try:
        result = await scraper.scrape(tracking_number)
    except httpx.TimeoutException:
        duration_ms = int((time_mod.time() - start_time) * 1000)
        db.add_scrape_log(
            shipment_id, carrier, tracking_number,
            status="timeout", state_before=current_state, state_after=None,
            message="Request timed out", duration_ms=duration_ms,
        )
        return {"error": "Request timed out"}
    except ScraperError as e:
        duration_ms = int((time_mod.time() - start_time) * 1000)
        db.add_scrape_log(
            shipment_id, carrier, tracking_number,
            status="error", state_before=current_state, state_after=None,
            message=str(e), duration_ms=duration_ms,
        )
        return {"error": str(e)}

    duration_ms = int((time_mod.time() - start_time) * 1000)

    if result is None:
        db.add_scrape_log(
            shipment_id, carrier, tracking_number,
            status="error", state_before=current_state, state_after=None,
            message="Tracking number not found by carrier API", duration_ms=duration_ms,
        )
        return {"error": "Tracking number not found by carrier API"}

    # Apply result
    now = datetime.now(timezone.utc).isoformat()
    conn = db.get_conn()
    conn.execute(
        "UPDATE shipments SET scrape_fail_count = 0, last_scraped_at = ? WHERE id = ?",
        (now, shipment_id),
    )
    conn.commit()
    conn.close()

    new_state = result.status
    state_changed = False

    if new_state and new_state != current_state and should_update_state(current_state, new_state):
        db.update_shipment(shipment_id, {"current_state": new_state})
        db.add_event(
            shipment_id,
            new_state,
            result.description or f"Status updated to {new_state}",
            "scraper",
        )
        db.add_scrape_log(
            shipment_id, carrier, tracking_number,
            status="success", state_before=current_state, state_after=new_state,
            message=result.description, duration_ms=duration_ms,
        )
        state_changed = True
    else:
        db.add_scrape_log(
            shipment_id, carrier, tracking_number,
            status="no_change", state_before=current_state, state_after=current_state,
            message="No state change", duration_ms=duration_ms,
        )

    return {
        "success": True,
        "status": result.status,
        "description": result.description,
        "state_changed": state_changed,
        "events_count": len(result.events),
    }
