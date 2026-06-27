"""Key-value settings stored in the SQLite settings table."""

import db

MIN_INTERVAL_MINUTES = 10
DEFAULT_RETENTION_DAYS = 30

_DEFAULTS: dict[str, str] = {}

# Module-level settings cache. None means "not loaded yet".
# Invalidated on every set_setting() call so reads always see fresh values.
# This eliminates 30+ extra DB connection open/close cycles per scheduler minute
# for settings that rarely change at runtime.
_settings_cache: dict[str, str] | None = None


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
        _DEFAULTS[f"scraper_{carrier}_retention_days"] = str(DEFAULT_RETENTION_DAYS)
    # DHL-specific: API key
    _DEFAULTS["scraper_dhl_api_key"] = ""
    # Notifications
    _DEFAULTS["mqtt_enabled"] = "false"
    _DEFAULTS["mqtt_topic_prefix"] = "trackbox"
    _DEFAULTS["trackbox_url"] = "http://192.168.0.50:8900"


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


def _load_cache() -> dict[str, str]:
    """Load all settings from DB into the module-level cache and return it."""
    global _settings_cache
    result = dict(_get_defaults())
    conn = db.get_conn()
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    conn.close()
    for row in rows:
        result[row["key"]] = row["value"]
    _settings_cache = result
    return _settings_cache


def get_setting(key: str, default: str = "") -> str:
    """Get a single setting value by key (cache-backed, one DB round-trip per write)."""
    cache = _settings_cache if _settings_cache is not None else _load_cache()
    value = cache.get(key)
    if value is None:
        return _get_defaults().get(key, default)
    return value or default


def set_setting(key: str, value: str) -> None:
    """Set a single setting value (upsert). Enforces minimums. Invalidates cache."""
    global _settings_cache
    if key.endswith("_interval_minutes"):
        value = str(max(int(value), MIN_INTERVAL_MINUTES))
    elif key.endswith("_retention_days"):
        value = str(max(int(value), 1))
    conn = db.get_conn()
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        (key, value),
    )
    conn.commit()
    conn.close()
    # Invalidate cache so next read reloads from DB
    _settings_cache = None


def get_all_settings() -> dict[str, str]:
    """Return all settings as a dict, including defaults for missing keys."""
    return dict(_load_cache())


def compute_effective_retention(carrier: str, scrapers_map: dict) -> int:
    """Return the effective retention window (days) for a carrier.

    Applies: min(configured_retention, scraper_max_retention).
    Single source of truth used by scheduler, shipment detail, and stalled
    annotation — replaces three independent inline calculations.

    Args:
        carrier: lowercase carrier name (e.g. "dhl").
        scrapers_map: dict keyed by carrier with at least "max_retention_days".
    """
    max_ret = scrapers_map.get(carrier, {}).get("max_retention_days", DEFAULT_RETENTION_DAYS)
    try:
        configured_ret = int(get_setting(
            f"scraper_{carrier}_retention_days",
            str(DEFAULT_RETENTION_DAYS),
        ))
    except ValueError:
        configured_ret = DEFAULT_RETENTION_DAYS
    return min(configured_ret, max_ret)


def init_settings() -> None:
    """Seed defaults on startup."""
    global _settings_cache
    _seed_defaults()
    # Warm the cache immediately after seeding
    _settings_cache = None
    _load_cache()
