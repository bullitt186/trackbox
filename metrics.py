"""Simple request counter for observability."""
from collections import defaultdict

_counters: dict = defaultdict(int)


def increment(name: str):
    _counters[name] += 1


def get_metrics() -> dict:
    return dict(_counters)
