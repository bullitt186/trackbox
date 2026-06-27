"""
API integration tests for all FastAPI REST endpoints.

Uses FastAPI's TestClient (backed by httpx) against an in-memory SQLite DB
so the full stack is exercised without any live network calls.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

def test_health_returns_ok(test_app):
    resp = test_app.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "uptime_seconds" in data
    assert "version" in data


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

def test_stats_empty_db(test_app):
    resp = test_app.get("/api/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "shipments_by_state" in data
    assert "total_parsers" in data
    assert "total_events" in data
    assert data["total_parsers"] == 0
    assert data["total_events"] == 0


def test_stats_counts_shipment(test_app):
    import db
    db.create_shipment({
        "title": "Test pkg",
        "tracking_number": "TRACK001",
        "status": "in_transit",
        "carrier": "DHL",
    })
    resp = test_app.get("/api/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data["shipments_by_state"].get("in_transit", 0) >= 1


# ---------------------------------------------------------------------------
# Shipments list
# ---------------------------------------------------------------------------

def test_get_shipments_empty(test_app):
    resp = test_app.get("/api/shipments")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_shipments_returns_list(test_app):
    import db
    db.create_shipment({"title": "Pkg A", "tracking_number": "T001", "status": "shipped", "carrier": "DHL"})
    db.create_shipment({"title": "Pkg B", "tracking_number": "T002", "status": "delivered", "carrier": "DPD"})
    resp = test_app.get("/api/shipments")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    # Each shipment has required fields
    for s in data:
        assert "id" in s
        assert "current_state" in s
        assert "tracking_number" in s


def test_get_shipments_state_filter_active(test_app):
    import db
    db.create_shipment({"title": "Active", "tracking_number": "A1", "status": "in_transit"})
    db.create_shipment({"title": "Done", "tracking_number": "D1", "status": "delivered"})
    resp = test_app.get("/api/shipments?state=active")
    assert resp.status_code == 200
    data = resp.json()
    assert all(s["current_state"] != "delivered" for s in data)


def test_get_shipments_state_filter_delivered(test_app):
    import db
    db.create_shipment({"title": "Active", "tracking_number": "A1", "status": "in_transit"})
    db.create_shipment({"title": "Done", "tracking_number": "D1", "status": "delivered"})
    resp = test_app.get("/api/shipments?state=delivered")
    assert resp.status_code == 200
    data = resp.json()
    assert all(s["current_state"] == "delivered" for s in data)


def test_get_shipments_archived_filter(test_app):
    import db
    sid = db.create_shipment({"title": "Archived", "tracking_number": "AR1", "status": "delivered"})
    db.update_shipment(sid, {"archived": 1})
    # Default call should not include archived
    resp = test_app.get("/api/shipments")
    assert resp.status_code == 200
    ids = [s["id"] for s in resp.json()]
    assert sid not in ids
    # Explicit archived=true
    resp2 = test_app.get("/api/shipments?archived=true")
    assert resp2.status_code == 200
    ids2 = [s["id"] for s in resp2.json()]
    assert sid in ids2


def test_get_shipments_includes_last_event(test_app):
    import db
    sid = db.create_shipment({"title": "P", "tracking_number": "LET1", "status": "shipped"})
    db.add_event(sid, "in_transit", "Left warehouse", "email")
    resp = test_app.get("/api/shipments")
    assert resp.status_code == 200
    shipment = next(s for s in resp.json() if s["id"] == sid)
    assert shipment["last_event"] is not None
    assert shipment["last_event"]["state"] == "in_transit"


# ---------------------------------------------------------------------------
# Shipment detail
# ---------------------------------------------------------------------------

def test_get_shipment_detail_not_found(test_app):
    resp = test_app.get("/api/shipments/999999")
    assert resp.status_code == 404


def test_get_shipment_detail_found(test_app):
    import db
    sid = db.create_shipment({"title": "Detail", "tracking_number": "DT1", "status": "in_transit", "carrier": "DHL"})
    db.add_event(sid, "in_transit", "On the way", "email")
    resp = test_app.get(f"/api/shipments/{sid}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == sid
    assert "events" in data
    assert isinstance(data["events"], list)
    assert len(data["events"]) >= 1


# ---------------------------------------------------------------------------
# Shipment update (PUT)
# ---------------------------------------------------------------------------

def test_update_shipment_not_found(test_app):
    resp = test_app.put("/api/shipments/999999", json={"title": "X"})
    assert resp.status_code == 404


def test_update_shipment_title(test_app):
    import db
    sid = db.create_shipment({"title": "Old", "tracking_number": "UPD1", "status": "shipped"})
    resp = test_app.put(f"/api/shipments/{sid}", json={"title": "New Title"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "New Title"


def test_update_shipment_state_valid_transition(test_app):
    import db
    sid = db.create_shipment({"title": "T", "tracking_number": "ST1", "status": "shipped"})
    resp = test_app.put(f"/api/shipments/{sid}", json={"current_state": "in_transit"})
    assert resp.status_code == 200
    assert resp.json()["current_state"] == "in_transit"


def test_update_shipment_state_blocked_from_delivered(test_app):
    import db
    sid = db.create_shipment({"title": "T", "tracking_number": "BLK1", "status": "delivered"})
    resp = test_app.put(f"/api/shipments/{sid}", json={"current_state": "in_transit"})
    assert resp.status_code == 409


def test_update_shipment_state_force_override(test_app):
    import db
    sid = db.create_shipment({"title": "T", "tracking_number": "FRC1", "status": "delivered"})
    resp = test_app.put(f"/api/shipments/{sid}", json={"current_state": "in_transit", "force": True})
    assert resp.status_code == 200
    assert resp.json()["current_state"] == "in_transit"


# ---------------------------------------------------------------------------
# Shipment delete (DELETE)
# ---------------------------------------------------------------------------

def test_delete_shipment_not_found(test_app):
    resp = test_app.delete("/api/shipments/999999")
    assert resp.status_code == 404


def test_delete_shipment_ok(test_app):
    import db
    sid = db.create_shipment({"title": "Del", "tracking_number": "DEL1", "status": "shipped"})
    resp = test_app.delete(f"/api/shipments/{sid}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] == sid
    # Shipment should be gone
    assert db.get_shipment(sid) is None


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------

def test_get_parsers_empty(test_app):
    resp = test_app.get("/api/parsers")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_parsers_returns_list(test_app):
    import db
    db.create_parser("dhl.de", ["sendung", "unterwegs"], {"status": {"strategy": "literal", "value": "in_transit"}})
    resp = test_app.get("/api/parsers")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["sender_domain"] == "dhl.de"
    assert "use_count" in data[0]


def test_delete_parser_ok(test_app):
    import db
    pid = db.create_parser("hermes.de", ["paket"], {"status": {"strategy": "literal", "value": "shipped"}})
    resp = test_app.delete(f"/api/parsers/{pid}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] == pid


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

def test_get_settings_returns_dict(test_app):
    resp = test_app.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, dict)
    # At least the DHL scraper settings should be present
    assert "scraper_dhl_enabled" in data


def test_update_settings(test_app):
    resp = test_app.put("/api/settings", json={"scraper_dhl_interval_minutes": "120"})
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("scraper_dhl_interval_minutes") == "120"


# ---------------------------------------------------------------------------
# Scrape log
# ---------------------------------------------------------------------------

def test_scrape_log_empty(test_app):
    resp = test_app.get("/api/scrape-log")
    assert resp.status_code == 200
    assert resp.json() == []


def test_scrape_log_returns_entries(test_app):
    import db
    sid = db.create_shipment({"title": "SL", "tracking_number": "SL1", "status": "in_transit", "carrier": "dhl"})
    db.add_scrape_log(sid, "dhl", "SL1", "success", "in_transit", "delivered", "Delivered!", 250)
    resp = test_app.get("/api/scrape-log")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    entry = data[0]
    assert entry["shipment_id"] == sid
    assert entry["status"] == "success"
    assert entry["carrier"] == "dhl"


def test_scrape_log_filter_by_shipment_id(test_app):
    import db
    sid1 = db.create_shipment({"title": "S1", "tracking_number": "SLF1", "status": "in_transit"})
    sid2 = db.create_shipment({"title": "S2", "tracking_number": "SLF2", "status": "in_transit"})
    db.add_scrape_log(sid1, "dhl", "SLF1", "success", "in_transit", "delivered", None, 100)
    db.add_scrape_log(sid2, "dpd", "SLF2", "error", "in_transit", None, "timeout", 200)
    resp = test_app.get(f"/api/scrape-log?shipment_id={sid1}")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["shipment_id"] == sid1


# ---------------------------------------------------------------------------
# Ingest endpoint
# ---------------------------------------------------------------------------

def test_ingest_rejects_empty_body(test_app):
    """Missing required 'from' field → 422 validation error."""
    resp = test_app.post("/ingest", json={"subject": "hello", "body": "hi"})
    assert resp.status_code == 422


def test_ingest_non_tracking_email_returns_rejected(test_app):
    resp = test_app.post("/ingest", json={
        "from": "friend@example.com",
        "subject": "Hey there",
        "body": "Just saying hello, nothing to track here",
        "message_id": "ingest-test-reject@test",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["action"] == "rejected"
    assert data["shipment_id"] is None


def test_ingest_tracking_email_creates_shipment(test_app):
    """Email with carrier domain creates a shipment."""
    with patch("ingest.ai.extract_and_generate_parser") as mock_ai:
        mock_ai.return_value = (
            {
                "tracking_number": "00340161386676443882",
                "carrier": "DHL",
                "status": "in_transit",
                "title": "voelkner Sendung",
                "order_number": None,
                "tracking_link": None,
            },
            {"status": {"strategy": "literal", "value": "in_transit"}},
        )
        resp = test_app.post("/ingest", json={
            "from": "noreply@dhl.de",
            "subject": "Ihre voelkner Sendung ist unterwegs",
            "body": "Sendungsnummer 00340161386676443882",
            "message_id": "ingest-create-test@test",
        })
    assert resp.status_code == 201
    data = resp.json()
    assert data["action"] == "created"
    assert data["shipment_id"] is not None
    assert data["tracking_number"] == "00340161386676443882"


def test_ingest_dedup_skips_duplicate_message_id(test_app):
    """Same message_id processed twice → second call is skipped."""
    with patch("ingest.ai.extract_and_generate_parser") as mock_ai:
        mock_ai.return_value = (
            {"tracking_number": "T999", "carrier": "DHL", "status": "shipped", "title": "Test", "order_number": None, "tracking_link": None},
            {"status": {"strategy": "literal", "value": "shipped"}},
        )
        test_app.post("/ingest", json={
            "from": "noreply@dhl.de",
            "subject": "Sendung",
            "body": "T999",
            "message_id": "dedup-test@test",
        })
        resp2 = test_app.post("/ingest", json={
            "from": "noreply@dhl.de",
            "subject": "Sendung",
            "body": "T999",
            "message_id": "dedup-test@test",
        })
    assert resp2.status_code == 200
    assert resp2.json()["action"] == "skipped"


def test_ingest_rate_limit(test_app, monkeypatch):
    """After 30 requests the rate limiter kicks in."""
    import main
    # Fill up timestamps so next call is over the limit
    import time
    now = time.time()
    monkeypatch.setattr(main, "_ingest_timestamps", [now] * 30)
    resp = test_app.post("/ingest", json={
        "from": "x@example.com",
        "subject": "Test",
        "body": "test",
    })
    assert resp.status_code == 429


# ---------------------------------------------------------------------------
# Scrapers list
# ---------------------------------------------------------------------------

def test_get_scrapers_list(test_app):
    resp = test_app.get("/api/scrapers")
    assert resp.status_code == 200
    data = resp.json()
    assert "scrapers" in data
    assert "scheduler_running" in data
    carriers = [s["carrier"] for s in data["scrapers"]]
    assert "dhl" in carriers


# ---------------------------------------------------------------------------
# Scrape toggle (PUT /api/shipments/{id}/scrape)
# ---------------------------------------------------------------------------

def test_toggle_scrape_enable_disable(test_app):
    import db
    sid = db.create_shipment({"title": "Scrape", "tracking_number": "SC1", "status": "in_transit", "carrier": "dhl"})
    resp = test_app.put(f"/api/shipments/{sid}/scrape", json={"enabled": False})
    assert resp.status_code == 200
    assert resp.json()["scrape_enabled"] == 0
    # Re-enable
    resp2 = test_app.put(f"/api/shipments/{sid}/scrape", json={"enabled": True})
    assert resp2.status_code == 200
    assert resp2.json()["scrape_enabled"] == 1
    # Re-enable also resets fail count
    assert resp2.json()["scrape_fail_count"] == 0


def test_toggle_scrape_not_found(test_app):
    resp = test_app.put("/api/shipments/999999/scrape", json={"enabled": True})
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# IMAP status
# ---------------------------------------------------------------------------

def test_imap_status_endpoint(test_app):
    resp = test_app.get("/api/imap/status")
    assert resp.status_code == 200
    data = resp.json()
    # The IMAP status endpoint returns a dict (shape varies by poller state)
    assert isinstance(data, dict)


# ---------------------------------------------------------------------------
# OpenAPI / schema contract
# ---------------------------------------------------------------------------

def test_openapi_shipment_required_fields(test_app):
    """The /api/shipments response shape matches the TypeScript Shipment interface."""
    import db
    db.create_shipment({"title": "Schema check", "tracking_number": "SCH1", "status": "shipped", "carrier": "dhl"})
    resp = test_app.get("/api/shipments")
    assert resp.status_code == 200
    shipments = resp.json()
    assert len(shipments) >= 1
    s = shipments[0]
    # Fields from frontend/src/lib/api.ts Shipment interface
    required_fields = {
        "id", "title", "tracking_number", "order_number",
        "carrier", "tracking_link", "current_state",
        "first_seen_at", "last_updated_at",
    }
    for field in required_fields:
        assert field in s, f"Missing field '{field}' in shipment response"


def test_openapi_scrape_log_required_fields(test_app):
    """The /api/scrape-log response shape matches the ScrapeLogEntry interface."""
    import db
    sid = db.create_shipment({"title": "SL schema", "tracking_number": "SLS1", "status": "in_transit"})
    db.add_scrape_log(sid, "dhl", "SLS1", "success", "in_transit", "delivered", "OK", 100)
    resp = test_app.get("/api/scrape-log")
    assert resp.status_code == 200
    entries = resp.json()
    assert len(entries) == 1
    entry = entries[0]
    required_fields = {
        "id", "shipment_id", "carrier", "tracking_number",
        "status", "state_before", "state_after", "message",
        "duration_ms", "occurred_at",
    }
    for field in required_fields:
        assert field in entry, f"Missing field '{field}' in scrape-log response"


def test_openapi_parser_required_fields(test_app):
    """The /api/parsers response shape matches the Parser interface."""
    import db
    db.create_parser("dhl.de", ["test"], {"status": {"strategy": "literal", "value": "shipped"}})
    resp = test_app.get("/api/parsers")
    assert resp.status_code == 200
    parsers = resp.json()
    assert len(parsers) == 1
    p = parsers[0]
    required_fields = {"id", "sender_domain", "subject_keywords", "field_map", "created_at", "use_count"}
    for field in required_fields:
        assert field in p, f"Missing field '{field}' in parser response"


def test_openapi_health_required_fields(test_app):
    """Health endpoint matches the TypeScript fetchHealth interface."""
    resp = test_app.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    for field in ("status", "version", "build_time", "uptime_seconds"):
        assert field in data, f"Missing field '{field}' in health response"
