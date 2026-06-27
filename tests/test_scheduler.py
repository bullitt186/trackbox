"""
Unit tests for scheduler.py: ScraperScheduler state machine.

Tests:
  - 3-strike failure → scrape_enabled set to 0 (disabled)
  - Failure counter increments before 3
  - Retention expiry auto-archives delivered shipments
  - _apply_result: state update when scraper returns new state
  - _apply_result: no state update when state is unchanged
  - _apply_result: no state update when state is terminal (delivered)
  - _apply_result: resets fail count on success
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import db
from scheduler import ScraperScheduler
from scrapers.base import ScraperResult

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_scheduler() -> ScraperScheduler:
    return ScraperScheduler(notifier=None)


def _create_shipment(state: str = "in_transit", carrier: str = "dhl", tracking_number: str = "SCHED-001") -> dict:
    sid = db.create_shipment({
        "title": "Sched test",
        "tracking_number": tracking_number,
        "carrier": carrier,
        "status": state,
    })
    return db.get_shipment(sid)


def _scraper_info():
    """Minimal scrapers info for retention tests."""
    return [
        {"carrier": "dhl", "max_retention_days": 30},
        {"carrier": "hermes", "max_retention_days": 30},
        {"carrier": "dpd", "max_retention_days": 30},
        {"carrier": "gls", "max_retention_days": 30},
    ]


# ===========================================================================
# _handle_failure: 3-strike disable logic
# ===========================================================================

def test_first_failure_increments_counter(fresh_db):
    scheduler = _make_scheduler()
    shipment = _create_shipment()
    sid = shipment["id"]

    scheduler._handle_failure(sid, current_fail_count=0, error_msg="timeout")

    updated = db.get_shipment(sid)
    assert updated["scrape_fail_count"] == 1
    assert updated["scrape_enabled"] == 1  # still enabled


def test_second_failure_increments_to_two(fresh_db):
    scheduler = _make_scheduler()
    shipment = _create_shipment()
    sid = shipment["id"]

    scheduler._handle_failure(sid, current_fail_count=1, error_msg="timeout")

    updated = db.get_shipment(sid)
    assert updated["scrape_fail_count"] == 2
    assert updated["scrape_enabled"] == 1  # still enabled


def test_third_failure_disables_scraping(fresh_db):
    """Reaching 3 failures must set scrape_enabled = 0."""
    scheduler = _make_scheduler()
    shipment = _create_shipment()
    sid = shipment["id"]

    scheduler._handle_failure(sid, current_fail_count=2, error_msg="third failure")

    updated = db.get_shipment(sid)
    assert updated["scrape_fail_count"] == 3
    assert updated["scrape_enabled"] == 0  # disabled


def test_third_failure_logs_to_scrape_log(fresh_db):
    """A 'disabled' scrape_log entry is written when scraping is disabled."""
    scheduler = _make_scheduler()
    shipment = _create_shipment()
    sid = shipment["id"]

    scheduler._handle_failure(sid, current_fail_count=2, error_msg="error")

    log = db.get_scrape_log(shipment_id=sid, status="disabled")
    assert len(log) == 1
    assert "disabled after 3 failures" in log[0]["message"].lower()


def test_failure_above_three_stays_disabled(fresh_db):
    """Already-at-3 shipment stays disabled even if handle_failure is called again."""
    scheduler = _make_scheduler()
    shipment = _create_shipment()
    sid = shipment["id"]

    # Disable via third failure
    scheduler._handle_failure(sid, current_fail_count=2, error_msg="error")
    # Call again (simulating a race / reprocessed event)
    scheduler._handle_failure(sid, current_fail_count=3, error_msg="error")

    updated = db.get_shipment(sid)
    assert updated["scrape_enabled"] == 0


# ===========================================================================
# _apply_result: state updates
# ===========================================================================

def test_apply_result_advances_state(fresh_db):
    """ScraperResult with a new state should update the shipment."""
    scheduler = _make_scheduler()
    shipment = _create_shipment(state="in_transit")
    sid = shipment["id"]

    result = ScraperResult(status="out_for_delivery", description="On the way", events=[])
    scheduler._apply_result(shipment, result, duration_ms=100)

    updated = db.get_shipment(sid)
    assert updated["current_state"] == "out_for_delivery"


def test_apply_result_same_state_no_update(fresh_db):
    """ScraperResult with same state as current → no state update."""
    scheduler = _make_scheduler()
    shipment = _create_shipment(state="in_transit")
    sid = shipment["id"]

    result = ScraperResult(status="in_transit", description="Still in transit", events=[])
    scheduler._apply_result(shipment, result, duration_ms=100)

    updated = db.get_shipment(sid)
    assert updated["current_state"] == "in_transit"
    # Log should show no_change
    log = db.get_scrape_log(shipment_id=sid, status="no_change")
    assert len(log) == 1


def test_apply_result_delivered_cannot_regress(fresh_db):
    """Terminal state 'delivered' cannot be reverted by scraper."""
    scheduler = _make_scheduler()
    shipment = _create_shipment(state="delivered")
    sid = shipment["id"]

    result = ScraperResult(status="in_transit", description="Oops regression", events=[])
    scheduler._apply_result(shipment, result, duration_ms=100)

    updated = db.get_shipment(sid)
    assert updated["current_state"] == "delivered"


def test_apply_result_resets_fail_count(fresh_db):
    """A successful scrape resets scrape_fail_count to 0."""
    scheduler = _make_scheduler()
    shipment = _create_shipment(state="in_transit")
    sid = shipment["id"]
    # Manually set fail count to 2
    conn = db.get_conn()
    conn.execute("UPDATE shipments SET scrape_fail_count = 2 WHERE id = ?", (sid,))
    conn.commit()
    conn.close()

    result = ScraperResult(status="in_transit", description="OK", events=[])
    scheduler._apply_result(shipment, result, duration_ms=50)

    updated = db.get_shipment(sid)
    assert updated["scrape_fail_count"] == 0


def test_apply_result_adds_scrape_log_success(fresh_db):
    """A state-changing result adds a 'success' scrape_log entry."""
    scheduler = _make_scheduler()
    shipment = _create_shipment(state="shipped")
    sid = shipment["id"]

    result = ScraperResult(status="in_transit", description="Moving", events=[])
    scheduler._apply_result(shipment, result, duration_ms=200)

    log = db.get_scrape_log(shipment_id=sid, status="success")
    assert len(log) == 1
    assert log[0]["state_before"] == "shipped"
    assert log[0]["state_after"] == "in_transit"


def test_apply_result_adds_event_on_state_change(fresh_db):
    """A state change via scraper adds an event with source='scraper'."""
    scheduler = _make_scheduler()
    shipment = _create_shipment(state="shipped")
    sid = shipment["id"]

    result = ScraperResult(status="delivered", description="Delivered!", events=[])
    scheduler._apply_result(shipment, result, duration_ms=100)

    events = db.get_events(sid)
    scraper_events = [e for e in events if e["source"] == "scraper"]
    assert len(scraper_events) == 1
    assert scraper_events[0]["state"] == "delivered"


def test_apply_result_notifier_called_on_state_change(fresh_db):
    """Notifier.publish is called when state changes."""
    mock_notifier = MagicMock()
    mock_notifier.publish = AsyncMock()
    scheduler = ScraperScheduler(notifier=mock_notifier)

    shipment = _create_shipment(state="shipped")

    with patch("scheduler.asyncio.create_task") as mock_create_task:
        result = ScraperResult(status="in_transit", description="Moving", events=[])
        scheduler._apply_result(shipment, result, duration_ms=100)
        # create_task should have been called to schedule the notification
        mock_create_task.assert_called_once()


# ===========================================================================
# _disable_retention_expired
# ===========================================================================

def test_retention_expired_delivered_shipment_archived(fresh_db, monkeypatch):
    """Delivered shipment older than retention window is archived."""
    import settings
    monkeypatch.setattr(settings, "get_setting", lambda key, default="": "30" if "retention_days" in key else default)
    monkeypatch.setattr(settings, "DEFAULT_RETENTION_DAYS", 30)

    scheduler = _make_scheduler()

    # Create a delivered shipment with last_updated_at 60 days ago
    sid = db.create_shipment({
        "title": "Old delivered",
        "tracking_number": "OLD-001",
        "carrier": "dhl",
        "status": "delivered",
    })
    old_date = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
    conn = db.get_conn()
    conn.execute(
        "UPDATE shipments SET last_updated_at = ?, current_state = 'delivered' WHERE id = ?",
        (old_date, sid),
    )
    conn.commit()
    conn.close()

    now = datetime.now(timezone.utc)
    scheduler._disable_retention_expired(now, _scraper_info())

    updated = db.get_shipment(sid)
    assert updated["archived"] == 1
    assert updated["scrape_enabled"] == 0


def test_retention_not_expired_stays_active(fresh_db, monkeypatch):
    """Delivered shipment within retention window is not archived."""
    import settings
    monkeypatch.setattr(settings, "get_setting", lambda key, default="": "30" if "retention_days" in key else default)
    monkeypatch.setattr(settings, "DEFAULT_RETENTION_DAYS", 30)

    scheduler = _make_scheduler()

    sid = db.create_shipment({
        "title": "Recent delivered",
        "tracking_number": "RECENT-001",
        "carrier": "dhl",
        "status": "delivered",
    })
    recent_date = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
    conn = db.get_conn()
    conn.execute(
        "UPDATE shipments SET last_updated_at = ?, current_state = 'delivered' WHERE id = ?",
        (recent_date, sid),
    )
    conn.commit()
    conn.close()

    now = datetime.now(timezone.utc)
    scheduler._disable_retention_expired(now, _scraper_info())

    updated = db.get_shipment(sid)
    assert updated["archived"] == 0


def test_retention_active_shipment_never_archived(fresh_db, monkeypatch):
    """Active (non-delivered) shipments are never archived by retention logic."""
    import settings
    monkeypatch.setattr(settings, "get_setting", lambda key, default="": "1" if "retention_days" in key else default)
    monkeypatch.setattr(settings, "DEFAULT_RETENTION_DAYS", 1)

    scheduler = _make_scheduler()

    sid = db.create_shipment({
        "title": "Old active",
        "tracking_number": "OLDACT-001",
        "carrier": "dhl",
        "status": "in_transit",
    })
    old_date = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
    conn = db.get_conn()
    conn.execute(
        "UPDATE shipments SET last_updated_at = ?, current_state = 'in_transit' WHERE id = ?",
        (old_date, sid),
    )
    conn.commit()
    conn.close()

    now = datetime.now(timezone.utc)
    scheduler._disable_retention_expired(now, _scraper_info())

    updated = db.get_shipment(sid)
    assert updated["archived"] == 0  # active shipments never archived by retention
