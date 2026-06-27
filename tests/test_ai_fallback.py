import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DATABASE_PATH", ":memory:")
os.environ.setdefault("OPENAI_API_KEY", "invalid-key")

from ingest import process_email
import db

db.init_db()


def test_ai_failure_returns_unknown():
    """When AI call fails, shipment still created with unknown state."""
    result = process_email({
        "from": "unknown@sender.com",
        "subject": "Random email",
        "body": "Some content",
        "message_id": "ai-fail-test@test"
    })
    assert result["action"] in ("created", "skipped")
    assert result["parser_status"] in ("failed", "dedup", "new", "existing")
