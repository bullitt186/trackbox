"""Key-value settings stored in the SQLite settings table."""

import db

MIN_INTERVAL_MINUTES = 10

_DEFAULTS: dict[str, str] = {}


def _build_defaults() -> None:
    """Generate defaults from registered scrapers."""
    global _DEFAULTS
    from scrapers import list_scrapers
    _DEFAULTS = {}
    for s in list_scrapers():
        carrier = s["carrier"]
        _DEFAULTS[f"scraper_{carrier}_enabled"] = "true"
        _DEFAULTS[f"scraper_{carrier}_interval_minutes"] = str(s["default_interval_minutes"])
        _DEFAULTS[f"scraper_{carrier}_active"] = s["available_scrapers"][0]["key"]
    # DHL-specific: API key
    _DEFAULTS["scraper_dhl_api_key"] = ""


def _get_defaults() -> dict[str, str]:
    if not _DEFAULTS:
        _build_defaults()
    return _DEFAULTS


def _seed_defaults() -> None:
    """Insert default settings if they don't exist yet."""
    defaults = _get_defaults()
    conn = db.get_conn()
    for key, value in defaults.items():
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
        return _get_defaults().get(key, default)
    return row["value"] or default


def set_setting(key: str, value: str) -> None:
    """Set a single setting value (upsert). Enforces minimums."""
    if key.endswith("_interval_minutes"):
        value = str(max(int(value), MIN_INTERVAL_MINUTES))
    conn = db.get_conn()
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        (key, value),
    )
    conn.commit()
    conn.close()


def get_all_settings() -> dict[str, str]:
    """Return all settings as a dict, including defaults for missing keys."""
    result = dict(_get_defaults())
    conn = db.get_conn()
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    conn.close()
    for row in rows:
        result[row["key"]] = row["value"]
    return result


def init_settings() -> None:
    """Seed defaults on startup."""
    _seed_defaults()
