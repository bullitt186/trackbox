import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ingest import (
    compute_fingerprint, apply_field_map, apply_strategy,
    extract_tracking_from_url, normalize_tracking_link,
    extract_merchant_from_subject, is_variable_token, strip_html,
    get_effective_body
)


def test_fingerprint_strips_dhl_merchant():
    _, kw1 = compute_fingerprint("noreply@dhl.de", "Ihre voelkner .. Sendung ist unterwegs")
    _, kw2 = compute_fingerprint("noreply@dhl.de", "Ihre Amazon Sendung ist unterwegs")
    assert kw1 == kw2


def test_fingerprint_strips_hermes_merchant():
    _, kw1 = compute_fingerprint("noreply@paketankuendigung.myhermes.de", "Deine Hermes Sendung von AliExpress ist auf dem Weg")
    _, kw2 = compute_fingerprint("noreply@paketankuendigung.myhermes.de", "Deine Hermes Sendung von eBay ist auf dem Weg")
    assert kw1 == kw2


def test_fingerprint_strips_quoted():
    _, kw1 = compute_fingerprint("shipment-tracking@amazon.de", 'In Zustellung: „PEBA Kabelverbinder...“')
    _, kw2 = compute_fingerprint("shipment-tracking@amazon.de", 'In Zustellung: „Einhell Akku-Sense...“')
    assert kw1 == kw2


def test_apply_strategy_literal():
    assert apply_strategy({"strategy": "literal", "value": "shipped"}, "") == "shipped"


def test_apply_strategy_after_label():
    body = "Order Number: 12345\nStatus: shipped"
    assert apply_strategy({"strategy": "after_label", "label": "Order Number:"}, body) == "12345"


def test_apply_strategy_link_containing():
    body = "Track at https://dhl.de/verfolgen?piececode=123 here"
    assert "dhl.de" in apply_strategy({"strategy": "link_containing", "contains": "dhl.de"}, body)


def test_apply_strategy_link_from_html():
    body = "no links here"
    html = '<a href="https://dhl.de/track?piececode=ABC">Track</a>'
    result = apply_strategy({"strategy": "link_containing", "contains": "dhl.de"}, body, html)
    assert result and "dhl.de" in result


def test_apply_strategy_none():
    assert apply_strategy({"strategy": "none"}, "anything") is None


def test_extract_tracking_dhl_piececode():
    url = "https://dhl.de/verfolgen?piececode=00340161386676443882"
    assert extract_tracking_from_url(url) == "00340161386676443882"


def test_extract_tracking_hermes_fragment():
    url = "https://myhermes.de/sendungsverfolgung/#H1018660616235701042"
    assert extract_tracking_from_url(url) == "H1018660616235701042"


def test_normalize_dhl():
    result = normalize_tracking_link(None, "00340161386676443882", "DHL")
    assert "dhl.de" in result and "piececode=00340161386676443882" in result


def test_normalize_hermes():
    result = normalize_tracking_link(None, "H123", "Hermes")
    assert "myhermes.de" in result and "#H123" in result


def test_normalize_dpd():
    result = normalize_tracking_link(None, "123", "DPD")
    assert "tracking.dpd.de" in result


def test_extract_merchant_dhl():
    result = extract_merchant_from_subject("Ihre voelkner .. Sendung ist unterwegs")
    assert result and "voelkner" in result


def test_extract_merchant_hermes():
    assert extract_merchant_from_subject("Deine Hermes Sendung von AliExpress ist auf dem Weg") == "AliExpress"


def test_strip_html_preserves_hrefs():
    html = '<a href="https://example.com/track">Click here</a>'
    result = strip_html(html)
    assert "https://example.com/track" in result


def test_get_effective_body_prefers_text():
    email = {"body": "plain text", "html": "<b>html</b>"}
    assert get_effective_body(email) == "plain text"


def test_get_effective_body_falls_back_to_html():
    email = {"body": "", "html": "<p>hello</p>"}
    result = get_effective_body(email)
    assert "hello" in result


def test_is_variable_token():
    assert is_variable_token("12345") is True
    assert is_variable_token("abc123") is True
    assert is_variable_token("shipped") is False
