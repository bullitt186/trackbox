import os

OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o")
DATABASE_PATH: str = os.getenv("DATABASE_PATH", "trackbox.db")
TRACKBOX_VERSION: str = os.getenv("TRACKBOX_VERSION", "dev")
TRACKBOX_BUILD_TIME: str = os.getenv("TRACKBOX_BUILD_TIME", "unknown")
RATE_LIMIT_PER_MINUTE: int = int(os.getenv("RATE_LIMIT_PER_MINUTE", "30"))
DHL_API_KEY: str = os.getenv("DHL_API_KEY", "")
DHL_API_SECRET: str = os.getenv("DHL_API_SECRET", "")

IMAP_HOST: str = os.getenv("IMAP_HOST", "")
IMAP_PORT: int = int(os.getenv("IMAP_PORT", "993"))
IMAP_USER: str = os.getenv("IMAP_USER", "")
IMAP_PASSWORD: str = os.getenv("IMAP_PASSWORD", "")
IMAP_SSL: bool = os.getenv("IMAP_SSL", "true").lower() == "true"
IMAP_FOLDER: str = os.getenv("IMAP_FOLDER", "INBOX")
IMAP_DONE_FOLDER: str = os.getenv("IMAP_DONE_FOLDER", "Trackbox/Processed")
IMAP_INTERVAL: int = int(os.getenv("IMAP_INTERVAL", "300"))
