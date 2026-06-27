import json
import logging
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

import config

DB_PATH = config.DATABASE_PATH

_log = logging.getLogger("trackbox.db")
log = _log  # alias for architect-branch compatibility


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def get_db():
    """Context manager that auto-closes the connection."""
    conn = get_conn()
    try:
        yield conn
    finally:
        conn.close()


def _migration_applied(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM _migrations WHERE name = ?", (name,)
    ).fetchone()
    return row is not None


def _run_migration(conn: sqlite3.Connection, name: str, sql: str) -> None:
    """Run a single DDL migration and record it in _migrations.

    Skips silently if already applied.  Raises on any error — the caller
    (init_db) should let the exception propagate so a bad deploy crashes fast
    rather than leaving the schema in an indeterminate state.
    """
    if _migration_applied(conn, name):
        return
    _log.info("Applying migration: %s", name)
    try:
        conn.execute(sql)
        conn.execute(
            "INSERT INTO _migrations (name, applied_at) VALUES (?, ?)",
            (name, _now()),
        )
        conn.commit()
        _log.info("Migration applied: %s", name)
    except Exception:
        conn.rollback()
        _log.exception("Migration FAILED: %s — rolling back", name)
        raise


def init_db() -> None:
    conn = get_conn()

    # Bootstrap: create the _migrations tracking table and all base tables.
    # This block is idempotent (CREATE TABLE IF NOT EXISTS).
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            applied_at TEXT
        );
        CREATE TABLE IF NOT EXISTS shipments (
            id INTEGER PRIMARY KEY,
            title TEXT,
            tracking_number TEXT,
            order_number TEXT,
            carrier TEXT,
            tracking_link TEXT,
            current_state TEXT DEFAULT 'unknown',
            first_seen_at TEXT,
            last_updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY,
            shipment_id INTEGER REFERENCES shipments(id) ON DELETE CASCADE,
            state TEXT,
            notes TEXT,
            source TEXT,
            occurred_at TEXT
        );
        CREATE TABLE IF NOT EXISTS parsers (
            id INTEGER PRIMARY KEY,
            sender_domain TEXT,
            subject_keywords TEXT,
            field_map TEXT,
            created_at TEXT,
            use_count INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS scrape_log (
            id INTEGER PRIMARY KEY,
            shipment_id INTEGER REFERENCES shipments(id) ON DELETE CASCADE,
            carrier TEXT,
            tracking_number TEXT,
            status TEXT,
            state_before TEXT,
            state_after TEXT,
            message TEXT,
            duration_ms INTEGER,
            occurred_at TEXT
        );
    """)

    # Seed baseline row for the very first migration that pre-dated the runner.
    conn.execute(
        """
        INSERT OR IGNORE INTO _migrations (name, applied_at)
        VALUES ('add_message_id', ?)
        """,
        (_now(),),
    )

    # Indexes on hot query paths (idempotent)
    conn.executescript("""
        CREATE INDEX IF NOT EXISTS idx_events_message_id
            ON events(message_id);
        CREATE INDEX IF NOT EXISTS idx_shipments_tracking_number
            ON shipments(tracking_number);
        CREATE INDEX IF NOT EXISTS idx_shipments_order_number
            ON shipments(order_number);
        CREATE INDEX IF NOT EXISTS idx_shipments_scrape_queue
            ON shipments(scrape_enabled, scrape_fail_count, current_state, last_scraped_at);
        CREATE INDEX IF NOT EXISTS idx_scrape_log_occurred_at
            ON scrape_log(occurred_at);
    """)
    conn.commit()

    # --- Versioned, append-only migration list ---
    # To add a new migration: append a _run_migration() call below.
    # Never modify or reorder existing entries.

    _run_migration(conn, "add_message_id", "ALTER TABLE events ADD COLUMN message_id TEXT")
    _run_migration(conn, "add_scrape_enabled", "ALTER TABLE shipments ADD COLUMN scrape_enabled INTEGER DEFAULT 1")
    _run_migration(conn, "add_scrape_fail_count", "ALTER TABLE shipments ADD COLUMN scrape_fail_count INTEGER DEFAULT 0")
    _run_migration(conn, "add_last_scraped_at", "ALTER TABLE shipments ADD COLUMN last_scraped_at TEXT")
    _run_migration(conn, "add_archived", "ALTER TABLE shipments ADD COLUMN archived INTEGER DEFAULT 0")
    _run_migration(conn, "add_estimated_delivery", "ALTER TABLE shipments ADD COLUMN estimated_delivery TEXT")

    # Data-fix migration: ensure current_state = 'delivered' whenever the most
    # recent event says delivered but the shipment row hasn't been updated yet.
    if not _migration_applied(conn, "fix_delivered_state"):
        _log.info("Applying migration: fix_delivered_state")
        rows = conn.execute("""
            SELECT s.id,
                   (SELECT e.state FROM events e
                    WHERE e.shipment_id = s.id
                    ORDER BY e.occurred_at DESC LIMIT 1) AS last_event_state
            FROM shipments s
            WHERE s.current_state != 'delivered'
        """).fetchall()
        for row in rows:
            if row["last_event_state"] == "delivered":
                conn.execute(
                    "UPDATE shipments SET current_state = 'delivered' WHERE id = ?",
                    (row["id"],),
                )
        conn.execute(
            "INSERT INTO _migrations (name, applied_at) VALUES ('fix_delivered_state', ?)",
            (_now(),),
        )
        conn.commit()
        _log.info("Migration applied: fix_delivered_state")

    conn.close()


def purge_old_scrape_log(retention_days: int) -> int:
    """Delete scrape_log rows older than retention_days. Returns rows deleted."""
    conn = get_conn()
    cur = conn.execute(
        "DELETE FROM scrape_log WHERE occurred_at < datetime('now', ?)",
        (f"-{retention_days} days",),
    )
    deleted = cur.rowcount
    conn.commit()
    conn.close()
    if deleted:
        log.info("scrape_log retention: deleted %d rows older than %d days", deleted, retention_days)
    return deleted


def _now():
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row):
    return dict(row) if row else None


# --- Shipments ---

def list_shipments(limit=50, offset=0, archived: int = 0):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM shipments WHERE archived = ? ORDER BY last_updated_at DESC LIMIT ? OFFSET ?",
        (archived, limit, offset)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_shipment(shipment_id: int):
    conn = get_conn()
    row = conn.execute("SELECT * FROM shipments WHERE id = ?", (shipment_id,)).fetchone()
    conn.close()
    return _row_to_dict(row)


def find_shipment(tracking_number: str | None, order_number: str | None):
    conn = get_conn()
    if tracking_number:
        row = conn.execute(
            "SELECT * FROM shipments WHERE tracking_number = ?", (tracking_number,)
        ).fetchone()
        if row:
            conn.close()
            return _row_to_dict(row)
    if order_number:
        row = conn.execute(
            "SELECT * FROM shipments WHERE order_number = ?", (order_number,)
        ).fetchone()
        if row:
            conn.close()
            return _row_to_dict(row)
    conn.close()
    return None


def create_shipment(fields: dict) -> int:
    now = _now()
    email_date = fields.get("_first_seen_at") or now
    conn = get_conn()
    cur = conn.execute(
        """INSERT INTO shipments (title, tracking_number, order_number, carrier,
           tracking_link, current_state, first_seen_at, last_updated_at, estimated_delivery)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            fields.get("title"),
            fields.get("tracking_number"),
            fields.get("order_number"),
            fields.get("carrier"),
            fields.get("tracking_link"),
            fields.get("status", "unknown"),
            email_date, email_date,
            fields.get("estimated_delivery"),
        )
    )
    conn.commit()
    shipment_id = cur.lastrowid
    conn.close()
    assert shipment_id is not None, "INSERT did not return a row ID"
    return shipment_id


def update_shipment(shipment_id: int, fields: dict, occurred_at: str | None = None):
    sets = []
    vals = []
    for key in ("title", "tracking_number", "order_number", "carrier", "tracking_link", "current_state", "archived", "estimated_delivery"):
        if key in fields and fields[key] is not None:
            sets.append(f"{key} = ?")
            vals.append(fields[key])
    if not sets:
        return
    sets.append("last_updated_at = ?")
    vals.append(occurred_at or _now())
    vals.append(shipment_id)
    conn = get_conn()
    conn.execute(f"UPDATE shipments SET {', '.join(sets)} WHERE id = ?", vals)
    conn.commit()
    conn.close()


def delete_shipment(shipment_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM shipments WHERE id = ?", (shipment_id,))
    conn.commit()
    conn.close()


# --- Events ---

def add_event(shipment_id: int, state: str, notes: str, source: str, message_id: str | None = None, occurred_at: str | None = None) -> int:
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO events (shipment_id, state, notes, source, occurred_at, message_id) VALUES (?, ?, ?, ?, ?, ?)",
        (shipment_id, state, notes, source, occurred_at or _now(), message_id)
    )
    conn.commit()
    event_id = cur.lastrowid
    conn.close()
    assert event_id is not None, "INSERT did not return a row ID"
    return event_id


def event_exists_for_message_id(message_id: str) -> bool:
    conn = get_conn()
    row = conn.execute("SELECT 1 FROM events WHERE message_id = ?", (message_id,)).fetchone()
    conn.close()
    return row is not None


def get_events(shipment_id: int):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM events WHERE shipment_id = ? ORDER BY occurred_at DESC",
        (shipment_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# --- Parsers ---

def find_parser(sender_domain: str, subject_keywords: list[str]):
    kw_json = json.dumps(sorted(subject_keywords))
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM parsers WHERE sender_domain = ? AND subject_keywords = ?",
        (sender_domain, kw_json)
    ).fetchone()
    conn.close()
    return _row_to_dict(row)


def create_parser(sender_domain: str, subject_keywords: list[str], field_map: dict) -> int:
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO parsers (sender_domain, subject_keywords, field_map, created_at) VALUES (?, ?, ?, ?)",
        (sender_domain, json.dumps(sorted(subject_keywords)), json.dumps(field_map), _now())
    )
    conn.commit()
    parser_id = cur.lastrowid
    conn.close()
    assert parser_id is not None, "INSERT did not return a row ID"
    return parser_id


def update_parser_field_map(parser_id: int, field_map: dict):
    conn = get_conn()
    conn.execute(
        "UPDATE parsers SET field_map = ?, use_count = 0 WHERE id = ?",
        (json.dumps(field_map), parser_id)
    )
    conn.commit()
    conn.close()


def increment_parser_use(parser_id: int):
    conn = get_conn()
    conn.execute("UPDATE parsers SET use_count = use_count + 1 WHERE id = ?", (parser_id,))
    conn.commit()
    conn.close()


# --- Scrape Log ---

def add_scrape_log(
    shipment_id: int,
    carrier: str | None,
    tracking_number: str | None,
    status: str,
    state_before: str | None,
    state_after: str | None,
    message: str | None,
    duration_ms: int | None,
) -> int:
    conn = get_conn()
    cur = conn.execute(
        """INSERT INTO scrape_log
           (shipment_id, carrier, tracking_number, status, state_before, state_after, message, duration_ms, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (shipment_id, carrier, tracking_number, status, state_before, state_after, message, duration_ms, _now()),
    )
    conn.commit()
    log_id = cur.lastrowid
    conn.close()
    assert log_id is not None, "INSERT did not return a row ID"
    return log_id


def get_scrape_log(
    shipment_id: int | None = None,
    carrier: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> list[dict]:
    conditions = []
    params: list = []
    if shipment_id is not None:
        conditions.append("shipment_id = ?")
        params.append(shipment_id)
    if carrier is not None:
        conditions.append("carrier = ?")
        params.append(carrier)
    if status is not None:
        conditions.append("status = ?")
        params.append(status)
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    conn = get_conn()
    rows = conn.execute(
        f"SELECT * FROM scrape_log {where} ORDER BY occurred_at DESC LIMIT ?",
        params + [limit],
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
