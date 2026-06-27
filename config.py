import os

OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o")
DATABASE_PATH: str = os.getenv("DATABASE_PATH", "trackbox.db")
TRACKBOX_VERSION: str = os.getenv("TRACKBOX_VERSION", "dev")
TRACKBOX_BUILD_TIME: str = os.getenv("TRACKBOX_BUILD_TIME", "unknown")
RATE_LIMIT_PER_MINUTE: int = int(os.getenv("RATE_LIMIT_PER_MINUTE", "30"))
