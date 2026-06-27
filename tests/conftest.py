import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DATABASE_PATH", ":memory:")
os.environ.setdefault("OPENAI_API_KEY", "test-key-not-real")

import db  # noqa: E402
db.init_db()
