# ADR 003: Parsers Stored in SQLite Rather Than Shipped as Static Files

**Status:** Accepted  
**Date:** 2026-01-01  
**Deciders:** bullitt

## Context

The parser library — the collection of `(sender_domain, subject_keywords, field_map)` tuples — needs to be persisted somewhere. Options considered:

1. **Static files committed to the repository:** Parser definitions live as YAML/JSON files in `parsers/`. New parsers require a code change and re-deploy.
2. **SQLite table:** Parsers are stored in the same database as shipments. New parsers are created at runtime by the AI extraction stage without any deployment.
3. **Separate database:** Like SQLite but a separate file or schema. Adds complexity without benefit at this scale.

## Decision

Store parsers in the SQLite `parsers` table alongside shipments and events.

The schema is:
```sql
CREATE TABLE parsers (
    id INTEGER PRIMARY KEY,
    sender_domain TEXT,
    subject_keywords TEXT,  -- JSON array, sorted
    field_map TEXT,          -- JSON object of extraction strategies
    created_at TEXT,
    use_count INTEGER DEFAULT 0
);
```

Parsers are keyed on `(sender_domain, subject_keywords)` and looked up at ingest time. New parsers are inserted by the AI extraction stage; existing parsers are updated (field_map replaced, use_count reset) by the self-healing mechanism.

## Consequences

**Positive:**
- Zero-friction parser learning: new email formats are handled automatically without a deployment cycle.
- Parser metadata (`use_count`, `created_at`) is available for operational visibility via `GET /api/parsers`.
- Parsers can be deleted individually via the API to force re-learning.
- SQLite's WAL mode ensures parsers are durable even on unclean shutdowns.

**Negative:**
- Parsers are not portable across Trackbox instances without a database export.
- There is no review step before a new parser is committed; a malformed AI-generated parser is used immediately.
- Parsers cannot be pre-seeded from a shared community library (though this could be added as a future migration).

**Accepted trade-off:** For a single-operator homelab deployment, the zero-friction dynamic learning is more valuable than the portability of static files. A future version could export parsers to a JSON file for sharing, but that is not a current requirement.
