"""
Scraper unit tests — all HTTP calls are mocked via respx.

Each test replays a realistic (but anonymised) carrier response to verify
the parsing logic without hitting live carrier endpoints.
"""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from scrapers.base import ScraperError
from scrapers.dhl_api import DHLAPIScraper
from scrapers.dhl_web import DHLWebScraper
from scrapers.dpd import DPDScraper
from scrapers.gls import GLSScraper
from scrapers.hermes import HermesScraper


# ===========================================================================
# DHL Web scraper
# ===========================================================================

DHL_CONFIG_URL = "https://www.dhl.de/int-verfolgen/data/config"
DHL_SEARCH_URL = "https://www.dhl.de/int-verfolgen/data/search"


def _dhl_web_response(fortschritt: int = 2, ist_zugestellt: bool = False) -> dict:
    """Build a minimal DHL Web JSON response."""
    return {
        "sendungen": [
            {
                "sendungsdetails": {
                    "istZugestellt": ist_zugestellt,
                    "sendungsverlauf": {
                        "fortschritt": fortschritt,
                        "events": [
                            {"datum": "2024-02-14", "uhrzeit": "09:00", "status": "In Zustellung", "ort": "Berlin"},
                            {"datum": "2024-02-13", "uhrzeit": "18:00", "status": "Im Paketzentrum", "ort": "Frankfurt"},
                        ],
                    },
                }
            }
        ]
    }


@pytest.mark.asyncio
async def test_dhl_web_in_transit():
    scraper = DHLWebScraper()
    config_resp = {"verfolgenCsrfToken": "test-csrf-token"}

    with respx.mock:
        respx.get(DHL_CONFIG_URL).mock(return_value=httpx.Response(200, json=config_resp))
        respx.get(DHL_SEARCH_URL).mock(return_value=httpx.Response(200, json=_dhl_web_response(fortschritt=2)))

        result = await scraper.scrape("00340161386676443882")

    assert result is not None
    assert result.status == "in_transit"
    assert len(result.events) == 2
    assert result.events[0]["location"] == "Berlin"


@pytest.mark.asyncio
async def test_dhl_web_delivered():
    scraper = DHLWebScraper()
    config_resp = {"verfolgenCsrfToken": "csrf-abc"}

    with respx.mock:
        respx.get(DHL_CONFIG_URL).mock(return_value=httpx.Response(200, json=config_resp))
        respx.get(DHL_SEARCH_URL).mock(return_value=httpx.Response(200, json=_dhl_web_response(ist_zugestellt=True)))

        result = await scraper.scrape("00340161386676443882")

    assert result is not None
    assert result.status == "delivered"


@pytest.mark.asyncio
async def test_dhl_web_out_for_delivery():
    scraper = DHLWebScraper()
    config_resp = {"verfolgenCsrfToken": "csrf-xyz"}

    with respx.mock:
        respx.get(DHL_CONFIG_URL).mock(return_value=httpx.Response(200, json=config_resp))
        respx.get(DHL_SEARCH_URL).mock(return_value=httpx.Response(200, json=_dhl_web_response(fortschritt=4)))

        result = await scraper.scrape("00340161386676443882")

    assert result is not None
    assert result.status == "out_for_delivery"


@pytest.mark.asyncio
async def test_dhl_web_preparing():
    scraper = DHLWebScraper()
    config_resp = {"verfolgenCsrfToken": "csrf-prep"}

    with respx.mock:
        respx.get(DHL_CONFIG_URL).mock(return_value=httpx.Response(200, json=config_resp))
        respx.get(DHL_SEARCH_URL).mock(return_value=httpx.Response(200, json=_dhl_web_response(fortschritt=1)))

        result = await scraper.scrape("00340161386676443882")

    assert result is not None
    assert result.status == "preparing"


@pytest.mark.asyncio
async def test_dhl_web_not_found_returns_none():
    scraper = DHLWebScraper()
    not_found_resp = {
        "sendungen": [
            {"sendungNichtGefunden": {"keineDatenVerfuegbar": True}}
        ]
    }

    with respx.mock:
        respx.get(DHL_CONFIG_URL).mock(return_value=httpx.Response(200, json={"verfolgenCsrfToken": "x"}))
        respx.get(DHL_SEARCH_URL).mock(return_value=httpx.Response(200, json=not_found_resp))

        result = await scraper.scrape("NOTEXIST")

    assert result is None


@pytest.mark.asyncio
async def test_dhl_web_empty_sendungen_returns_none():
    scraper = DHLWebScraper()

    with respx.mock:
        respx.get(DHL_CONFIG_URL).mock(return_value=httpx.Response(200, json={"verfolgenCsrfToken": "x"}))
        respx.get(DHL_SEARCH_URL).mock(return_value=httpx.Response(200, json={"sendungen": []}))

        result = await scraper.scrape("EMPTY")

    assert result is None


@pytest.mark.asyncio
async def test_dhl_web_config_error_raises():
    scraper = DHLWebScraper()

    with respx.mock:
        respx.get(DHL_CONFIG_URL).mock(return_value=httpx.Response(503))

        with pytest.raises(ScraperError) as exc_info:
            await scraper.scrape("00340161386676443882")

    assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_dhl_web_search_error_raises():
    scraper = DHLWebScraper()

    with respx.mock:
        respx.get(DHL_CONFIG_URL).mock(return_value=httpx.Response(200, json={"verfolgenCsrfToken": "x"}))
        respx.get(DHL_SEARCH_URL).mock(return_value=httpx.Response(500, text="Internal error"))

        with pytest.raises(ScraperError) as exc_info:
            await scraper.scrape("00340161386676443882")

    assert exc_info.value.status_code == 500


@pytest.mark.asyncio
async def test_dhl_web_csrf_token_sent_in_header():
    """The CSRF token from the config response is forwarded in the search request."""
    scraper = DHLWebScraper()
    captured_headers: dict = {}

    def capture_request(request: httpx.Request) -> httpx.Response:
        captured_headers.update(dict(request.headers))
        return httpx.Response(200, json=_dhl_web_response())

    with respx.mock:
        respx.get(DHL_CONFIG_URL).mock(return_value=httpx.Response(200, json={"verfolgenCsrfToken": "MY-CSRF-TOKEN"}))
        respx.get(DHL_SEARCH_URL).mock(side_effect=capture_request)

        await scraper.scrape("00340161386676443882")

    assert captured_headers.get("x-csrf-token") == "MY-CSRF-TOKEN"


# ===========================================================================
# DHL API scraper
# ===========================================================================

DHL_API_BASE = "https://api-eu.dhl.com/track/shipments"


def _dhl_api_response(status_code: str = "transit") -> dict:
    return {
        "shipments": [
            {
                "status": {
                    "statusCode": status_code,
                    "description": "Package is in transit",
                    "status": "In Transit",
                },
                "events": [
                    {
                        "timestamp": "2024-02-14T09:00:00Z",
                        "statusCode": "transit",
                        "description": "Arrived at facility",
                        "location": {"address": {"addressLocality": "Berlin", "countryCode": "DE"}},
                    }
                ],
            }
        ]
    }


@pytest.mark.asyncio
async def test_dhl_api_in_transit(monkeypatch):
    import settings
    monkeypatch.setattr(settings, "get_setting", lambda key, default="": "test-api-key" if "api_key" in key else default)

    scraper = DHLAPIScraper()

    with respx.mock:
        respx.get(DHL_API_BASE).mock(return_value=httpx.Response(200, json=_dhl_api_response("transit")))
        result = await scraper.scrape("00340161386676443882")

    assert result is not None
    assert result.status == "in_transit"
    assert len(result.events) == 1
    assert "Berlin" in result.events[0]["location"]


@pytest.mark.asyncio
async def test_dhl_api_delivered(monkeypatch):
    import settings
    monkeypatch.setattr(settings, "get_setting", lambda key, default="": "test-api-key" if "api_key" in key else default)

    scraper = DHLAPIScraper()

    with respx.mock:
        respx.get(DHL_API_BASE).mock(return_value=httpx.Response(200, json=_dhl_api_response("delivered")))
        result = await scraper.scrape("00340161386676443882")

    assert result is not None
    assert result.status == "delivered"


@pytest.mark.asyncio
async def test_dhl_api_404_returns_none(monkeypatch):
    import settings
    monkeypatch.setattr(settings, "get_setting", lambda key, default="": "test-api-key" if "api_key" in key else default)

    scraper = DHLAPIScraper()

    with respx.mock:
        respx.get(DHL_API_BASE).mock(return_value=httpx.Response(404))
        result = await scraper.scrape("NOTEXIST")

    assert result is None


@pytest.mark.asyncio
async def test_dhl_api_error_raises(monkeypatch):
    import settings
    monkeypatch.setattr(settings, "get_setting", lambda key, default="": "test-api-key" if "api_key" in key else default)

    scraper = DHLAPIScraper()

    with respx.mock:
        respx.get(DHL_API_BASE).mock(return_value=httpx.Response(429, text="Too many requests"))

        with pytest.raises(ScraperError) as exc_info:
            await scraper.scrape("00340161386676443882")

    assert exc_info.value.status_code == 429


@pytest.mark.asyncio
async def test_dhl_api_no_api_key_raises(monkeypatch):
    import settings
    monkeypatch.setattr(settings, "get_setting", lambda key, default="": "")  # no API key

    scraper = DHLAPIScraper()

    with pytest.raises(ScraperError) as exc_info:
        await scraper.scrape("00340161386676443882")

    assert "not configured" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_dhl_api_pre_transit_maps_to_preparing(monkeypatch):
    import settings
    monkeypatch.setattr(settings, "get_setting", lambda key, default="": "test-api-key" if "api_key" in key else default)

    scraper = DHLAPIScraper()

    with respx.mock:
        respx.get(DHL_API_BASE).mock(return_value=httpx.Response(200, json=_dhl_api_response("pre-transit")))
        result = await scraper.scrape("T1")

    assert result is not None
    assert result.status == "preparing"


@pytest.mark.asyncio
async def test_dhl_api_failure_maps_to_exception(monkeypatch):
    import settings
    monkeypatch.setattr(settings, "get_setting", lambda key, default="": "test-api-key" if "api_key" in key else default)

    scraper = DHLAPIScraper()

    with respx.mock:
        respx.get(DHL_API_BASE).mock(return_value=httpx.Response(200, json=_dhl_api_response("failure")))
        result = await scraper.scrape("T2")

    assert result is not None
    assert result.status == "exception"


# ===========================================================================
# DPD scraper
# ===========================================================================

DPD_URL = "https://tracking.dpd.de/parcelstatus"


def _dpd_html(status_img: str = "4", delivery_text: str = "In Zustellung") -> str:
    return f"""
<html>
<body>
<img src="/images/status_{status_img}.svg" />
<span id="ContentPlaceHolder1_repParcelList_labDeliveryStatus_0">{delivery_text}</span>
<span id="ContentPlaceHolder1_labStatusStart">Versandauftrag erteilt</span>
<span id="ContentPlaceHolder1_labStatusStartDate">10.02.2024</span>
<span id="ContentPlaceHolder1_labStatusOnTheRoad">Im Paketverteilzentrum</span>
<span id="ContentPlaceHolder1_labStatusOnTheRoadDate">12.02.2024</span>
</body>
</html>
"""


@pytest.mark.asyncio
async def test_dpd_in_transit():
    scraper = DPDScraper()

    with respx.mock:
        respx.get(DPD_URL).mock(return_value=httpx.Response(200, text=_dpd_html("4", "In Transit")))
        result = await scraper.scrape("012345678901234567")

    assert result is not None
    assert result.status == "in_transit"
    assert len(result.events) >= 1


@pytest.mark.asyncio
async def test_dpd_delivered():
    scraper = DPDScraper()

    with respx.mock:
        respx.get(DPD_URL).mock(return_value=httpx.Response(200, text=_dpd_html("6", "Paket zugestellt - 14.02.2024")))
        result = await scraper.scrape("012345678901234567")

    assert result is not None
    assert result.status == "delivered"
    assert "zugestellt" in result.description.lower()


@pytest.mark.asyncio
async def test_dpd_out_for_delivery():
    scraper = DPDScraper()

    with respx.mock:
        respx.get(DPD_URL).mock(return_value=httpx.Response(200, text=_dpd_html("5", "Zur Zustellung unterwegs")))
        result = await scraper.scrape("012345678901234567")

    assert result is not None
    assert result.status == "out_for_delivery"


@pytest.mark.asyncio
async def test_dpd_not_found_returns_none():
    scraper = DPDScraper()
    error_html = "<html><body>konnte nicht geladen werden</body></html>"

    with respx.mock:
        respx.get(DPD_URL).mock(return_value=httpx.Response(200, text=error_html))
        result = await scraper.scrape("NOTEXIST")

    assert result is None


@pytest.mark.asyncio
async def test_dpd_http_error_raises():
    scraper = DPDScraper()

    with respx.mock:
        respx.get(DPD_URL).mock(return_value=httpx.Response(503))

        with pytest.raises(ScraperError) as exc_info:
            await scraper.scrape("012345678901234567")

    assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_dpd_preparing():
    scraper = DPDScraper()

    with respx.mock:
        respx.get(DPD_URL).mock(return_value=httpx.Response(200, text=_dpd_html("2", "Versandauftrag erteilt")))
        result = await scraper.scrape("012345678901234567")

    assert result is not None
    assert result.status == "preparing"


# ===========================================================================
# Hermes scraper
# ===========================================================================

HERMES_API = "https://api.my-deliveries.de/tnt/v2/shipments/search"


def _hermes_response(parcel_status: str = "INTRANSIT") -> list:
    return [
        {
            "parcelProgress": [
                {
                    "parcelStatus": parcel_status,
                    "headlineText": "Paket ist unterwegs",
                    "historyText": "Im Sortierzentrum",
                    "timestamp": "2024-02-14T09:00:00Z",
                },
                {
                    "parcelStatus": "PARCEL_ANNOUNCED",
                    "headlineText": "Versandauftrag",
                    "historyText": "Versandauftrag erteilt",
                    "timestamp": "2024-02-13T10:00:00Z",
                },
            ]
        }
    ]


@pytest.mark.asyncio
async def test_hermes_in_transit():
    scraper = HermesScraper()
    tracking = "H1018660616235701042"

    with respx.mock:
        respx.get(f"{HERMES_API}/{tracking}").mock(
            return_value=httpx.Response(200, json=_hermes_response("INTRANSIT"))
        )
        result = await scraper.scrape(tracking)

    assert result is not None
    assert result.status == "in_transit"
    assert len(result.events) == 2


@pytest.mark.asyncio
async def test_hermes_delivered():
    scraper = HermesScraper()
    tracking = "H1018660616235701042"

    with respx.mock:
        respx.get(f"{HERMES_API}/{tracking}").mock(
            return_value=httpx.Response(200, json=_hermes_response("DELIVERED"))
        )
        result = await scraper.scrape(tracking)

    assert result is not None
    assert result.status == "delivered"


@pytest.mark.asyncio
async def test_hermes_out_for_delivery():
    scraper = HermesScraper()
    tracking = "H1018660616235701042"

    with respx.mock:
        respx.get(f"{HERMES_API}/{tracking}").mock(
            return_value=httpx.Response(200, json=_hermes_response("DELIVERY_TOUR_STARTED"))
        )
        result = await scraper.scrape(tracking)

    assert result is not None
    assert result.status == "out_for_delivery"


@pytest.mark.asyncio
async def test_hermes_preparing():
    scraper = HermesScraper()
    tracking = "H1018660616235701042"

    with respx.mock:
        respx.get(f"{HERMES_API}/{tracking}").mock(
            return_value=httpx.Response(200, json=_hermes_response("PARCEL_ANNOUNCED"))
        )
        result = await scraper.scrape(tracking)

    assert result is not None
    assert result.status == "preparing"


@pytest.mark.asyncio
async def test_hermes_404_returns_none():
    scraper = HermesScraper()
    tracking = "NOTEXIST"

    with respx.mock:
        respx.get(f"{HERMES_API}/{tracking}").mock(return_value=httpx.Response(404))
        result = await scraper.scrape(tracking)

    assert result is None


@pytest.mark.asyncio
async def test_hermes_error_raises():
    scraper = HermesScraper()
    tracking = "H1018660616235701042"

    with respx.mock:
        respx.get(f"{HERMES_API}/{tracking}").mock(return_value=httpx.Response(500, text="Server error"))

        with pytest.raises(ScraperError) as exc_info:
            await scraper.scrape(tracking)

    assert exc_info.value.status_code == 500


@pytest.mark.asyncio
async def test_hermes_empty_response_returns_none():
    scraper = HermesScraper()
    tracking = "H1018660616235701042"

    with respx.mock:
        respx.get(f"{HERMES_API}/{tracking}").mock(return_value=httpx.Response(200, json=[]))
        result = await scraper.scrape(tracking)

    assert result is None


@pytest.mark.asyncio
async def test_hermes_no_progress_returns_none():
    scraper = HermesScraper()
    tracking = "H1018660616235701042"

    with respx.mock:
        respx.get(f"{HERMES_API}/{tracking}").mock(return_value=httpx.Response(200, json=[{"parcelProgress": []}]))
        result = await scraper.scrape(tracking)

    assert result is None


# ===========================================================================
# GLS scraper
# ===========================================================================

GLS_URL = "https://track-and-trace.glsnxt.com/reach-sendungsverfolgung"


def _gls_html(delivery_status: str = "INTRANSIT") -> str:
    """
    Build a minimal GLS Next.js RSC HTML payload that matches the scraper's regex.

    The GLS scraper's _TRACKING_RE looks for the double-escaped JSON pattern:
      trackingDetailsWithoutCustomerId\\":{...deliveryEvents\\":[...]...}

    The status_match regex looks for:
      deliveryStatus\\\\":\\\\"STATUS\\"

    Both patterns were verified against the actual scraper regexes.
    """
    # RSC content matching _TRACKING_RE
    rsc_payload = (
        'trackingDetailsWithoutCustomerId\\":{'
        '"latestStatusText\\":\\"Paket ist unterwegs\\",'
        '"deliveredAt\\":null,'
        '"deliveryEvents\\":[{'
        '"occurrenceDateTime\\":\\"2024-02-14T09:00:00Z\\",'
        '"description\\":\\"Paket im Depot\\",'
        '"locationDetails\\":\\"Berlin\\"'
        '}]'
        '}'
    )
    # Status segment matching the status_match regex
    status_segment = f'deliveryStatus\\\\":\\\\"{ delivery_status }\\\\"'
    return (
        f'<html><body><script id="__NEXT_DATA__">'
        f'{rsc_payload},{status_segment}'
        f'</script></body></html>'
    )


@pytest.mark.asyncio
async def test_gls_in_transit():
    scraper = GLSScraper()

    html = _gls_html("INTRANSIT")
    with respx.mock:
        respx.get(GLS_URL).mock(return_value=httpx.Response(200, text=html))
        result = await scraper.scrape("123456789")

    assert result is not None
    assert result.status == "in_transit"


@pytest.mark.asyncio
async def test_gls_no_tracking_data_returns_none():
    """HTML with no RSC payload returns None (no match)."""
    scraper = GLSScraper()

    with respx.mock:
        respx.get(GLS_URL).mock(return_value=httpx.Response(200, text="<html><body>No data</body></html>"))
        result = await scraper.scrape("NOTEXIST")

    assert result is None


@pytest.mark.asyncio
async def test_gls_http_error_raises():
    scraper = GLSScraper()

    with respx.mock:
        respx.get(GLS_URL).mock(return_value=httpx.Response(503))

        with pytest.raises(ScraperError) as exc_info:
            await scraper.scrape("123456789")

    assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_gls_out_for_delivery():
    scraper = GLSScraper()
    html = _gls_html("OUT_FOR_DELIVERY")

    with respx.mock:
        respx.get(GLS_URL).mock(return_value=httpx.Response(200, text=html))
        result = await scraper.scrape("123456789")

    assert result is not None
    assert result.status == "out_for_delivery"
