"""
Shared pytest fixtures for all Trackbox tests.

Key design decisions:
- `fresh_db` is function-scoped: every test gets an isolated in-memory SQLite DB,
  eliminating state leakage between tests.
- `db_path` patches db.DB_PATH so that all db.*() helpers use the per-test DB.
- `test_app` provides a FastAPI TestClient wired to the same fresh DB.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Set env vars before any app module is imported
os.environ.setdefault("DATABASE_PATH", ":memory:")
os.environ.setdefault("OPENAI_API_KEY", "test-key-not-real")

import sqlite3
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import db


# ---------------------------------------------------------------------------
# DB isolation fixture
# ---------------------------------------------------------------------------

@pytest.fixture()
def fresh_db(tmp_path, monkeypatch):
    """
    Provide a fresh, isolated SQLite DB for each test.

    Uses a tmp_path file (not :memory:) so the same connection-per-call
    pattern in db.py works correctly. Patches db.DB_PATH and rebuilds
    the schema before the test, then returns the path for assertions.
    """
    db_file = str(tmp_path / "test.db")
    monkeypatch.setattr(db, "DB_PATH", db_file)
    db.init_db()
    yield db_file


# ---------------------------------------------------------------------------
# FastAPI TestClient fixture
# ---------------------------------------------------------------------------

@pytest.fixture()
def test_app(fresh_db, monkeypatch):
    """
    Return a FastAPI TestClient backed by the fresh_db fixture.

    Startup/shutdown events are suppressed (the DB is already initialised
    by fresh_db and we don't want real MQTT/IMAP connections).
    """
    # Patch the scheduler and IMAP poller so startup doesn't spin up real
    # background tasks or try to connect to external services.
    from unittest.mock import AsyncMock, patch

    with patch("main.ScraperScheduler") as mock_sched_cls, \
         patch("main.IMAPPoller") as mock_imap_cls, \
         patch("main.MQTTNotifier") as mock_mqtt_cls:

        # Make scheduler.start/stop/last_cycle_at/running work as no-ops
        mock_sched = MagicMock()
        mock_sched.running = False
        mock_sched.last_cycle_at = None
        mock_sched.start = MagicMock()
        mock_sched.stop = MagicMock()
        mock_sched._disable_retention_expired = MagicMock()
        mock_sched_cls.return_value = mock_sched

        mock_imap = MagicMock()
        mock_imap.start = MagicMock()
        mock_imap.stop = MagicMock()
        mock_imap.status = MagicMock(return_value={"connected": False})
        mock_imap_cls.return_value = mock_imap

        mock_mqtt = MagicMock()
        mock_mqtt.start = AsyncMock()
        mock_mqtt.stop = AsyncMock()
        mock_mqtt.publish = AsyncMock()
        mock_mqtt_cls.return_value = mock_mqtt

        from main import app
        with TestClient(app, raise_server_exceptions=True) as client:
            yield client
