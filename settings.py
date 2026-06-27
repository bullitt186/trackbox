"""Key-value settings stored in the SQLite settings table."""

import db

# DHL API limits: 250 calls/day, min 5s between requests.
# With 10 active packages at 120min interval: 10 × 12 = 120 calls/day (48% utilization).
# Minimum 10min enforced to prevent exceeding daily quota even with 25 packages.
DHL_MIN_INTERVAL_MINUTES = 10
DHL_DEFAULT_INTERVAL_MINUTES = 120

_DEFAULTS: dict[str, str] = {
    "scraper_dhl_enabled": "true",
    "scraper_dhl_interval_minutes": str(DHL_DEFAULT_INTERVAL_MINUTES),
    "scraper_dhl_api_key": "",
}


def _seed_defaults() -> None:
    """Insert default settings if they don't exist yet."""
    conn = db.get_conn()
    for key, value in _DEFAULTS.items():
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )
    conn.commit()
    conn.close()


def get_setting(key: str, default: str = "") -> str:
    """Get a single setting value by key."""
    conn = db.get_conn()
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    conn.close()
    if row is None:
        return _DEFAULTS.get(key, default)
    return row["value"] or default


def set_setting(key: str, value: str) -> None:
    """Set a single setting value (upsert). Enforces minimums."""
    if key == "scraper_dhl_interval_minutes":
        value = str(max(int(value), DHL_MIN_INTERVAL_MINUTES))
    conn = db.get_conn()
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        (key, value),
    )
    conn.commit()
    conn.close()


def get_all_settings() -> dict[str, str]:
    """Return all settings as a dict, including defaults for missing keys."""
    result = dict(_DEFAULTS)
    conn = db.get_conn()
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    conn.close()
    for row in rows:
        result[row["key"]] = row["value"]
    return result


def init_settings() -> None:
    """Seed defaults on startup."""
    _seed_defaults()
