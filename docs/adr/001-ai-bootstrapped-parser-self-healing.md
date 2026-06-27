# ADR 001: AI-Bootstrapped Deterministic Parsers with Self-Healing

**Status:** Accepted  
**Date:** 2026-01-01  
**Deciders:** bullitt

## Context

Trackbox needs to extract structured fields (tracking number, carrier, state, title, tracking link) from shipping notification emails. The email landscape is diverse: each carrier and merchant sends emails in a unique format that can change without notice. There are two obvious approaches:

1. **Pure AI extraction:** Call OpenAI for every email. Accurate but expensive ($0.01–0.05/email at GPT-4o prices) and adds latency.
2. **Hand-written rules:** Maintain a library of regular expressions per sender domain. Accurate but requires ongoing maintenance as email formats change; does not scale to long-tail senders.

## Decision

Use a two-stage hybrid:

1. **First encounter:** Call OpenAI once to extract fields AND generate a `field_map` — a JSON descriptor of how to extract each field from similar future emails using deterministic strategies (`after_label`, `link_containing`, `literal`, `none`).
2. **Subsequent encounters:** Apply the stored `field_map` directly, with no AI call.
3. **Self-healing:** If the stored `field_map` produces all-null results (email format changed), automatically fall back to AI and regenerate the `field_map`.

Parsers are stored in SQLite per `(sender_domain, subject_keywords)` fingerprint, not per carrier. This allows learning different parsers for different email types from the same sender (e.g. "shipped" vs. "delivered" emails from DHL that have different structures).

## Consequences

**Positive:**
- After the first email from each sender, subsequent emails are free (no AI cost) and fast (no network call).
- The system learns new email formats automatically without code changes.
- Self-healing regeneration handles email format changes without manual intervention.
- Parser use counts provide visibility into which parsers are active and stable.

**Negative:**
- The first email from each new sender requires an AI call and is slower.
- Parser quality depends on AI model quality and prompt. If the AI generates a bad `field_map`, it will be used repeatedly until self-healing detects all-null output.
- Parsers can become stale silently: if a format change produces *some* extracted fields but the wrong ones, self-healing does not trigger.
- OpenAI API downtime affects first-encounter emails.

**Mitigations:**
- `parser_status` in the ingest response lets callers detect when AI was used.
- Individual parsers can be deleted via `DELETE /api/parsers/{id}` to force regeneration.
- `use_count` tracks which parsers are actively used; zero-count parsers can be cleaned up.
