import json
import logging
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

import config

DB_PATH = config.DATABASE_PATH

log = logging.getLogger("trackbox.db")


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


def _apply_column_migration(conn: sqlite3.Connection, table: str, col: str, col_type: str, default: str) -> None:
    """Add a column to a table if it doesn't exist yet. Logs failures clearly."""
    try:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_type} DEFAULT {default}")
        conn.commit()
        log.debug("Migration: added column %s.%s", table, col)
    except sqlite3.OperationalError as e:
        msg = str(e).lower()
        if "duplicate column name" in msg or "already exists" in msg:
            pass  # Column already present — expected on re-runs
        else:
            log.error("Migration failed adding %s.%s: %s", table, col, e)
            raise


def init_db():
    conn = get_conn()

    # Step 1: Create all base tables (idempotent)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE);

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
            occurred_at TEXT,
            message_id TEXT
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

    # Step 2: Column migrations (tables guaranteed to exist above)

    # Migration: add message_id to events
    try:
        conn.execute("ALTER TABLE events ADD COLUMN message_id TEXT")
        conn.execute("INSERT OR IGNORE INTO _migrations (name) VALUES ('add_message_id')")
        conn.commit()
        log.debug("Migration: added events.message_id")
    except sqlite3.OperationalError as e:
        msg = str(e).lower()
        if "duplicate column name" not in msg and "already exists" not in msg:
            log.error("Migration add_message_id failed: %s", e)
            raise

    # Migration: add scraping and archive columns to shipments
    for col, col_type, default in [
        ("scrape_enabled", "INTEGER", "1"),
        ("scrape_fail_count", "INTEGER", "0"),
        ("last_scraped_at", "TEXT", "NULL"),
        ("archived", "INTEGER", "0"),
    ]:
        _apply_column_migration(conn, "shipments", col, col_type, default)

    # Step 3: Indexes on hot query paths (idempotent)
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

    # Step 4: Data migration — fix state inconsistencies (delivered in events but not in current_state)
    rows = conn.execute("""
        SELECT s.id, s.current_state,
               (SELECT e.state FROM events e WHERE e.shipment_id = s.id ORDER BY e.occurred_at DESC LIMIT 1) as last_event_state
        FROM shipments s
        WHERE s.current_state != 'delivered'
    """).fetchall()
    for row in rows:
        if row["last_event_state"] == "delivered":
            conn.execute("UPDATE shipments SET current_state = 'delivered' WHERE id = ?", (row["id"],))
    conn.commit()
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
           tracking_link, current_state, first_seen_at, last_updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            fields.get("title"),
            fields.get("tracking_number"),
            fields.get("order_number"),
            fields.get("carrier"),
            fields.get("tracking_link"),
            fields.get("status", "unknown"),
            email_date, email_date
        )
    )
    conn.commit()
    shipment_id = cur.lastrowid
    conn.close()
    return shipment_id


def update_shipment(shipment_id: int, fields: dict, occurred_at: str | None = None):
    sets = []
    vals = []
    for key in ("title", "tracking_number", "order_number", "carrier", "tracking_link", "current_state", "archived"):
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
