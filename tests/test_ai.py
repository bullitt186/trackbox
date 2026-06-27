"""
Unit tests for ai.py: extract_and_generate_parser.

All OpenAI calls are mocked via unittest.mock.patch so no API key or
network access is required.
"""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import ai


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_openai_response(content: dict) -> MagicMock:
    """Build a mock openai.ChatCompletion response."""
    msg = SimpleNamespace(content=json.dumps(content))
    choice = SimpleNamespace(message=msg)
    return SimpleNamespace(choices=[choice])


def _sample_email(**overrides) -> dict:
    base = {
        "from": "noreply@dhl.de",
        "subject": "Ihre voelkner Sendung ist unterwegs",
        "body": "Sendungsnummer 00340161386676443882\nStatus: In Zustellung",
        "html": "",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------

def test_extraction_success_returns_extracted_and_field_map():
    """Successful API call returns (extracted, field_map) tuple."""
    payload = {
        "extracted": {
            "order_number": None,
            "tracking_number": "00340161386676443882",
            "carrier": "DHL",
            "tracking_link": None,
            "title": "voelkner",
            "status": "in_transit",
        },
        "field_map": {
            "order_number": {"strategy": "none"},
            "tracking_number": {"strategy": "after_label", "label": "Sendungsnummer"},
            "carrier": {"strategy": "literal", "value": "DHL"},
            "tracking_link": {"strategy": "none"},
            "title": {"strategy": "literal", "value": "voelkner"},
            "status": {"strategy": "literal", "value": "in_transit"},
        },
    }

    with patch("ai.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _make_openai_response(payload)
        mock_openai_cls.return_value = mock_client

        extracted, field_map = ai.extract_and_generate_parser(_sample_email())

    assert extracted is not None
    assert field_map is not None
    assert extracted["tracking_number"] == "00340161386676443882"
    assert extracted["status"] == "in_transit"
    assert field_map["tracking_number"]["strategy"] == "after_label"


def test_extraction_passes_email_content_to_api():
    """The email subject/from/body are included in the prompt sent to OpenAI."""
    payload = {
        "extracted": {"status": "shipped", "tracking_number": "T1", "carrier": "DHL", "order_number": None, "tracking_link": None, "title": "X"},
        "field_map": {"status": {"strategy": "literal", "value": "shipped"}},
    }
    email = _sample_email()

    with patch("ai.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _make_openai_response(payload)
        mock_openai_cls.return_value = mock_client

        ai.extract_and_generate_parser(email)

        call_args = mock_client.chat.completions.create.call_args
        messages = call_args.kwargs["messages"] if call_args.kwargs else call_args[1]["messages"]
        user_msg = next(m for m in messages if m["role"] == "user")
        assert email["from"] in user_msg["content"]
        assert email["subject"] in user_msg["content"]
        assert email["body"] in user_msg["content"]


def test_html_hint_included_when_body_is_short():
    """When body < 100 chars and html is present, first 2000 chars of HTML are appended."""
    payload = {
        "extracted": {"status": "shipped", "tracking_number": None, "carrier": None, "order_number": None, "tracking_link": None, "title": None},
        "field_map": {},
    }
    email = _sample_email(body="short", html="<html>" + "x" * 3000 + "</html>")

    with patch("ai.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _make_openai_response(payload)
        mock_openai_cls.return_value = mock_client

        ai.extract_and_generate_parser(email)

        call_args = mock_client.chat.completions.create.call_args
        messages = call_args.kwargs["messages"] if call_args.kwargs else call_args[1]["messages"]
        user_msg = next(m for m in messages if m["role"] == "user")
        # HTML hint should be present (first 2000 chars of the HTML)
        assert "HTML (raw, first 2000 chars)" in user_msg["content"]


# ---------------------------------------------------------------------------
# Status validation
# ---------------------------------------------------------------------------

def test_invalid_status_normalised_to_unknown():
    """If the API returns a status not in VALID_STATES, it is reset to 'unknown'."""
    payload = {
        "extracted": {
            "status": "flying_through_the_air",  # not a valid state
            "tracking_number": "T2",
            "carrier": "DHL",
            "order_number": None,
            "tracking_link": None,
            "title": "X",
        },
        "field_map": {"status": {"strategy": "literal", "value": "flying_through_the_air"}},
    }

    with patch("ai.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _make_openai_response(payload)
        mock_openai_cls.return_value = mock_client

        extracted, _ = ai.extract_and_generate_parser(_sample_email())

    assert extracted["status"] == "unknown"


def test_all_valid_states_accepted():
    """Every state in VALID_STATES should pass through unchanged."""
    for state in ai.VALID_STATES:
        payload = {
            "extracted": {"status": state, "tracking_number": "T", "carrier": "DHL", "order_number": None, "tracking_link": None, "title": "X"},
            "field_map": {},
        }
        with patch("ai.OpenAI") as mock_openai_cls:
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = _make_openai_response(payload)
            mock_openai_cls.return_value = mock_client

            extracted, _ = ai.extract_and_generate_parser(_sample_email())

        assert extracted["status"] == state, f"Status '{state}' should pass through unchanged"


# ---------------------------------------------------------------------------
# field_map strategy validation
# ---------------------------------------------------------------------------

def test_invalid_field_map_strategy_replaced_with_none():
    """Unknown strategies in field_map are replaced with {strategy: 'none'}."""
    payload = {
        "extracted": {"status": "shipped", "tracking_number": "T3", "carrier": "DHL", "order_number": None, "tracking_link": None, "title": "X"},
        "field_map": {
            "tracking_number": {"strategy": "magic_regex_finder"},  # invalid
            "status": {"strategy": "literal", "value": "shipped"},
        },
    }

    with patch("ai.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _make_openai_response(payload)
        mock_openai_cls.return_value = mock_client

        _, field_map = ai.extract_and_generate_parser(_sample_email())

    assert field_map["tracking_number"] == {"strategy": "none"}


def test_non_dict_field_map_entry_replaced_with_none():
    """A field_map entry that isn't a dict is replaced with {strategy: 'none'}."""
    payload = {
        "extracted": {"status": "shipped", "tracking_number": "T4", "carrier": "DHL", "order_number": None, "tracking_link": None, "title": "X"},
        "field_map": {
            "tracking_number": "just a string",  # not a dict
        },
    }

    with patch("ai.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _make_openai_response(payload)
        mock_openai_cls.return_value = mock_client

        _, field_map = ai.extract_and_generate_parser(_sample_email())

    assert field_map["tracking_number"] == {"strategy": "none"}


def test_all_valid_strategies_preserved():
    """All four valid strategies should pass through unchanged."""
    strategies = [
        {"strategy": "after_label", "label": "Order:"},
        {"strategy": "link_containing", "contains": "dhl.de"},
        {"strategy": "literal", "value": "DHL"},
        {"strategy": "none"},
    ]
    for strat in strategies:
        payload = {
            "extracted": {"status": "shipped", "tracking_number": "T5", "carrier": None, "order_number": None, "tracking_link": None, "title": None},
            "field_map": {"tracking_number": strat},
        }
        with patch("ai.OpenAI") as mock_openai_cls:
            mock_client = MagicMock()
            mock_client.chat.completions.create.return_value = _make_openai_response(payload)
            mock_openai_cls.return_value = mock_client

            _, field_map = ai.extract_and_generate_parser(_sample_email())

        assert field_map["tracking_number"] == strat, f"Strategy {strat} should be unchanged"


# ---------------------------------------------------------------------------
# Failure path
# ---------------------------------------------------------------------------

def test_api_exception_returns_none_none():
    """If the OpenAI API call throws, return (None, None)."""
    with patch("ai.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = Exception("Network error")
        mock_openai_cls.return_value = mock_client

        result = ai.extract_and_generate_parser(_sample_email())

    assert result == (None, None)


def test_malformed_json_response_returns_none_none():
    """If the API returns non-JSON, return (None, None)."""
    bad_response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="not valid json {{{"))]
    )
    with patch("ai.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = bad_response
        mock_openai_cls.return_value = mock_client

        result = ai.extract_and_generate_parser(_sample_email())

    assert result == (None, None)


def test_missing_extracted_key_returns_empty_dict():
    """Response with no 'extracted' key → extracted is empty dict (status → unknown)."""
    payload = {
        "field_map": {"status": {"strategy": "literal", "value": "shipped"}},
    }

    with patch("ai.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _make_openai_response(payload)
        mock_openai_cls.return_value = mock_client

        extracted, field_map = ai.extract_and_generate_parser(_sample_email())

    # extracted should be {} → status defaults to unknown after validation
    assert extracted is not None
    assert extracted.get("status") == "unknown"


def test_uses_model_from_config():
    """The model passed to the API should come from config.OPENAI_MODEL."""
    import config
    payload = {
        "extracted": {"status": "shipped", "tracking_number": "T6", "carrier": "DHL", "order_number": None, "tracking_link": None, "title": "X"},
        "field_map": {},
    }

    with patch("ai.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _make_openai_response(payload)
        mock_openai_cls.return_value = mock_client

        ai.extract_and_generate_parser(_sample_email())

        call_args = mock_client.chat.completions.create.call_args
        model_used = call_args.kwargs.get("model") or call_args[1].get("model")
        assert model_used == config.OPENAI_MODEL
