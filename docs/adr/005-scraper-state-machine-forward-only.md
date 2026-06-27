# ADR 005: Forward-Only State Machine with Exception Carve-outs

**Status:** Accepted  
**Date:** 2026-01-01  
**Deciders:** bullitt

## Context

Carrier APIs and email parsers can return stale or out-of-order state values. For example:
- A scraper might briefly return `in_transit` for a shipment already marked `out_for_delivery`.
- A retry email from DHL might contain an older status than a scraper update already applied.
- The AI parser might extract `preparing` from a later "we're sorry for the delay" email.

Without guardrails, state would jump backwards, creating confusing event histories.

Additionally, `delayed` and `exception` are lateral states that represent problems occurring at any point in the journey (a shipment can be `in_transit` → `delayed` → `in_transit` → `delivered`). They cannot be modeled as purely forward-progressing.

## Decision

Encode state precedence in a `STATE_ORDER` dict and implement `should_update_state(current, new)` as:

```python
STATE_ORDER = {
    "unknown": 0, "preparing": 1, "shipped": 2, "in_transit": 3,
    "out_for_delivery": 4, "delivered": 5, "delayed": 3, "exception": 3
}

def should_update_state(current, new):
    if current == "delivered":
        return False                          # terminal state
    if new in ("delayed", "exception"):
        return True                           # always allow lateral states
    return STATE_ORDER.get(new, 0) > STATE_ORDER.get(current, 0)  # forward only
```

`delivered` is a terminal state: no state can transition out of it. Manual overrides via the API with `"force": true` bypass this check entirely.

## Consequences

**Positive:**
- Idempotent scraping: the same status returned repeatedly does not create duplicate events.
- Out-of-order email delivery does not corrupt the state history.
- `delayed` and `exception` work at any point in the journey without special-casing.

**Negative:**
- A genuinely re-shipped item (returned and re-sent) cannot be handled automatically; it requires a forced manual state change or deleting and re-creating the shipment.
- `delayed` and `exception` share `STATE_ORDER = 3` with `in_transit`, which means transitioning from `delayed` to `in_transit` is rejected (ORDER is not greater). This is acceptable behavior: `in_transit` after `delayed` is handled by the scraper returning the actual state on the next cycle.

**Accepted trade-off:** Re-shipped items are rare enough in a personal package tracker that the complexity of handling them automatically is not justified. The force-override escape hatch is sufficient.
