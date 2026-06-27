import logging
import os

OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o")
DATABASE_PATH: str = os.getenv("DATABASE_PATH", "trackbox.db")
TRACKBOX_VERSION: str = os.getenv("TRACKBOX_VERSION", "dev")
TRACKBOX_BUILD_TIME: str = os.getenv("TRACKBOX_BUILD_TIME", "unknown")
RATE_LIMIT_PER_MINUTE: int = int(os.getenv("RATE_LIMIT_PER_MINUTE", "30"))
DHL_API_KEY: str = os.getenv("DHL_API_KEY", "")
DHL_API_SECRET: str = os.getenv("DHL_API_SECRET", "")

# CORS allowed origins, comma-separated.
# Set CORS_ORIGINS=* only in development; restrict to actual origins in production.
_cors_raw: str = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://192.168.0.50:8900")
CORS_ORIGINS: list[str] = [o.strip() for o in _cors_raw.split(",") if o.strip()]

IMAP_HOST: str = os.getenv("IMAP_HOST", "")
IMAP_PORT: int = int(os.getenv("IMAP_PORT", "993"))
IMAP_USER: str = os.getenv("IMAP_USER", "")
IMAP_PASSWORD: str = os.getenv("IMAP_PASSWORD", "")
IMAP_SSL: bool = os.getenv("IMAP_SSL", "true").lower() == "true"
IMAP_FOLDER: str = os.getenv("IMAP_FOLDER", "INBOX")
IMAP_DONE_FOLDER: str = os.getenv("IMAP_DONE_FOLDER", "Trackbox/Processed")
IMAP_INTERVAL: int = int(os.getenv("IMAP_INTERVAL", "300"))

MQTT_HOST: str = os.getenv("MQTT_HOST", "")
MQTT_PORT: int = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USER: str = os.getenv("MQTT_USER", "")
MQTT_PASSWORD: str = os.getenv("MQTT_PASSWORD", "")
MQTT_TOPIC_PREFIX: str = os.getenv("MQTT_TOPIC_PREFIX", "trackbox")


def validate_config() -> None:
    """Fail-fast startup validation.

    Raises RuntimeError if critical configuration is missing or the database
    parent directory is not writable.  Logs loud warnings for non-critical
    missing config so operators see them in container logs immediately.

    Call this before db.init_db() in the startup handler.
    """
    _log = logging.getLogger("trackbox.config")
    errors: list[str] = []

    # --- Required: DB directory must be writable ---
    db_parent = os.path.dirname(os.path.abspath(DATABASE_PATH)) or "."
    if not os.path.isdir(db_parent):
        errors.append(
            f"DATABASE_PATH parent directory does not exist: {db_parent!r}. "
            "Check your volume mount."
        )
    elif not os.access(db_parent, os.W_OK):
        errors.append(
            f"DATABASE_PATH parent directory is not writable: {db_parent!r}. "
            "Check your volume mount permissions."
        )

    if errors:
        for msg in errors:
            _log.critical("STARTUP ERROR: %s", msg)
        raise RuntimeError(
            "Critical configuration errors — refusing to start:\n"
            + "\n".join(f"  • {e}" for e in errors)
        )

    # --- Warnings: missing optional-but-important secrets ---
    if not OPENAI_API_KEY:
        _log.warning("OPENAI_API_KEY is not set — AI field extraction will fail")
    if IMAP_HOST and not IMAP_USER:
        _log.warning("IMAP_HOST is set but IMAP_USER is empty — IMAP polling will not authenticate")
    if IMAP_HOST and not IMAP_PASSWORD:
        _log.warning("IMAP_HOST is set but IMAP_PASSWORD is empty — IMAP polling will not authenticate")

    _log.info(
        "Config validated: DATABASE_PATH=%r VERSION=%s",
        DATABASE_PATH,
        TRACKBOX_VERSION,
    )
