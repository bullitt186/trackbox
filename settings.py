"""Key-value settings stored in the SQLite settings table."""

import db

_DEFAULTS: dict[str, str] = {
    "scraper_dhl_enabled": "true",
    "scraper_dhl_interval_minutes": "60",
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
    """Set a single setting value (upsert)."""
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
