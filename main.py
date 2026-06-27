import logging
import os
import time
import uuid

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Form, HTTPException, Query, Request, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.security.api_key import APIKeyHeader
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

load_dotenv()

import config as _config

_log = logging.getLogger("trackbox.api")

# ---------------------------------------------------------------------------
# API key authentication
# ---------------------------------------------------------------------------
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def _require_api_key(api_key: str | None = Security(_api_key_header)) -> None:
    """Dependency that enforces X-API-Key when TRACKBOX_API_KEY is configured."""
    configured = _config.API_KEY
    if not configured:
        # Auth disabled — trusted-network / reverse-proxy deployment.
        return
    if not api_key or api_key != configured:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


# ---------------------------------------------------------------------------
# Shared rate-limit state for write endpoints
# ---------------------------------------------------------------------------
_write_timestamps: list = []
_WRITE_RATE_LIMIT = 60  # max write ops per minute across all write endpoints

_START_TIME = time.time()

import config as _cfg
import db
import settings as app_settings
from imap_poller import IMAPPoller
from ingest import process_email
from ingest import set_notifier as ingest_set_notifier
from logging_config import setup_logging
from notifiers.mqtt import MQTTNotifier
from scheduler import ScraperScheduler, scrape_single
from scheduler import set_notifier as scheduler_set_notifier
from scrapers import list_scrapers

VALID_STATES = [
    "unknown", "preparing", "shipped", "in_transit",
    "out_for_delivery", "delivered", "delayed", "exception"
]

app = FastAPI(title="Trackbox")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cfg.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*", "X-API-Key"],
)
templates = Jinja2Templates(directory="templates")

# Serve React SPA from frontend/dist if available
_HAS_FRONTEND = os.path.isdir("frontend/dist")
if _HAS_FRONTEND:
    app.mount("/assets", StaticFiles(directory="frontend/dist/assets"), name="static-assets")


class EmailPayload(BaseModel):
    from_: str = Field(alias="from", min_length=1, max_length=500)
    subject: str = Field(max_length=1000)
    body: str = Field(max_length=100_000)
    html: str | None = Field(default=None, max_length=500_000)
    product_name: str | None = Field(default=None, max_length=200)
    message_id: str | None = Field(default=None, max_length=500)
    date: str | None = Field(default=None, max_length=50)

    model_config = {"populate_by_name": True}


mqtt_notifier = MQTTNotifier()
scheduler = ScraperScheduler(notifier=mqtt_notifier)
imap_poller = IMAPPoller()


@app.on_event("startup")
async def startup():
    from datetime import datetime, timezone  # noqa: PLC0415

    from scrapers import list_scrapers as _ls
    setup_logging()
    # Validate config and DB writability before touching anything else.
    # Raises RuntimeError on critical failure — uvicorn will exit and CI catches it.
    _cfg.validate_config()
    db.init_db()
    app_settings.init_settings()
    ingest_set_notifier(mqtt_notifier)
    scheduler_set_notifier(mqtt_notifier)
    scheduler.start()
    imap_poller.start()
    await mqtt_notifier.start()
    # Backfill: auto-archive any already-expired delivered shipments immediately
    scheduler._disable_retention_expired(datetime.now(timezone.utc), _ls())


@app.on_event("shutdown")
async def shutdown():
    scheduler.stop()
    imap_poller.stop()
    await mqtt_notifier.stop()


_ingest_timestamps: list = []


def _check_write_rate_limit() -> None:
    """Shared in-memory rate limit for all write endpoints (60 ops/min)."""
    now = time.time()
    _write_timestamps[:] = [t for t in _write_timestamps if now - t < 60]
    if len(_write_timestamps) >= _WRITE_RATE_LIMIT:
        raise HTTPException(429, detail="Rate limit exceeded")
    _write_timestamps.append(now)


@app.post("/ingest", dependencies=[Depends(_require_api_key)])
async def ingest_email(payload: EmailPayload):
    # ponytail: simple in-memory rate limit, 30 req/min
    now = time.time()
    _ingest_timestamps[:] = [t for t in _ingest_timestamps if now - t < 60]
    if len(_ingest_timestamps) >= 30:
        raise HTTPException(429, detail="Rate limit exceeded (30/min)")
    _ingest_timestamps.append(now)

    request_id = str(uuid.uuid4())[:8]
    email = {"from": payload.from_, "subject": payload.subject, "body": payload.body, "html": payload.html, "product_name": payload.product_name, "message_id": payload.message_id, "date": payload.date}
    try:
        result = process_email(email)
    except Exception:
        _log.exception("Ingest failed [%s]", request_id)
        return {"shipment_id": None, "state": None, "action": "error", "parser_status": "error", "error": "Internal processing error", "request_id": request_id}
    result["request_id"] = request_id
    status = 201 if result.get("action") == "created" else 200
    return JSONResponse(content=result, status_code=status)


@app.get("/health")
async def health():
    """Health check for monitoring."""
    conn = db.get_conn()
    conn.execute("SELECT 1").fetchone()
    conn.close()
    uptime = int(time.time() - _START_TIME)
    return {"status": "ok", "version": _config.TRACKBOX_VERSION, "build_time": _config.TRACKBOX_BUILD_TIME, "uptime_seconds": uptime}


@app.get("/api/stats", dependencies=[Depends(_require_api_key)])
async def api_stats():
    """System statistics."""
    conn = db.get_conn()
    shipments = conn.execute("SELECT current_state, COUNT(*) as cnt FROM shipments GROUP BY current_state").fetchall()
    parser_count = conn.execute("SELECT COUNT(*) FROM parsers").fetchone()[0]
    event_count = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    conn.close()
    return {
        "shipments_by_state": {r["current_state"]: r["cnt"] for r in shipments},
        "total_parsers": parser_count,
        "total_events": event_count,
    }


def _annotate_stalled(shipments: list[dict]) -> None:
    """Annotate shipments with stalled: True when no further updates are expected."""
    from datetime import datetime, timezone  # noqa: PLC0415

    from scrapers import list_scrapers as _ls
    scrapers_map = {s["carrier"]: s for s in _ls()}
    now = datetime.now(timezone.utc)
    for s in shipments:
        if s.get("current_state") == "delivered":
            s["stalled"] = False
            continue
        stalled = False
        stall_reason = None
        # Permanently disabled by scraper failures
        if s.get("scrape_enabled") == 0 and (s.get("scrape_fail_count") or 0) >= 3:
            stalled = True
            stall_reason = "scrape_failures"
        # Retention window exceeded (scraping would find nothing anyway)
        if not stalled and s.get("last_updated_at"):
            carrier = (s.get("carrier") or "").lower()
            max_ret = scrapers_map.get(carrier, {}).get("max_retention_days", app_settings.DEFAULT_RETENTION_DAYS)
            try:
                configured_ret = int(app_settings.get_setting(
                    f"scraper_{carrier}_retention_days",
                    str(app_settings.DEFAULT_RETENTION_DAYS),
                ))
            except ValueError:
                configured_ret = app_settings.DEFAULT_RETENTION_DAYS
            effective_ret = min(configured_ret, max_ret)
            try:
                last_updated = datetime.fromisoformat(s["last_updated_at"].replace("Z", "+00:00"))
                if last_updated.tzinfo is None:
                    last_updated = last_updated.replace(tzinfo=timezone.utc)
                if (now - last_updated).days > effective_ret:
                    stalled = True
                    stall_reason = "retention_expired"
            except (ValueError, AttributeError):
                pass
        s["stalled"] = stalled
        s["stall_reason"] = stall_reason


@app.get("/api/shipments", dependencies=[Depends(_require_api_key)])
async def api_shipments(state: str | None = None, archived: str | None = None):
    """JSON list of shipments. ?state=active|delivered|archived, ?archived=true."""
    # archived=true or state=archived → show archived shipments
    show_archived = archived == "true" or state == "archived"
    shipments = db.list_shipments(limit=200, archived=1 if show_archived else 0)
    if not show_archived:
        if state == "active":
            shipments = [s for s in shipments if s["current_state"] != "delivered"]
        elif state == "delivered":
            shipments = [s for s in shipments if s["current_state"] == "delivered"]
    # Sort by state urgency
    state_priority = {"out_for_delivery": 0, "delayed": 1, "exception": 1, "in_transit": 2, "shipped": 3, "preparing": 4, "unknown": 5, "delivered": 6}
    shipments.sort(key=lambda s: state_priority.get(s["current_state"], 5))
    # Add last_event summary and stalled annotation
    conn = db.get_conn()
    for s in shipments:
        row = conn.execute(
            "SELECT state, notes, occurred_at FROM events WHERE shipment_id = ? ORDER BY occurred_at DESC LIMIT 1",
            (s["id"],)
        ).fetchone()
        s["last_event"] = dict(row) if row else None
    conn.close()
    _annotate_stalled(shipments)
    return shipments


@app.get("/api/shipments/{shipment_id}", dependencies=[Depends(_require_api_key)])
async def api_shipment_detail(shipment_id: int):
    """JSON detail of a single shipment with events."""
    from datetime import datetime, timedelta, timezone  # noqa: PLC0415

    from scrapers import list_scrapers as _list_scrapers
    shipment = db.get_shipment(shipment_id)
    if not shipment:
        raise HTTPException(404)
    events = db.get_events(shipment_id)
    # Compute tracking_expires_at for delivered shipments
    tracking_expires_at = None
    if shipment.get("current_state") == "delivered" and shipment.get("last_updated_at"):
        carrier = (shipment.get("carrier") or "").lower()
        scrapers = {s["carrier"]: s for s in _list_scrapers()}
        max_ret = scrapers.get(carrier, {}).get("max_retention_days", app_settings.DEFAULT_RETENTION_DAYS)
        try:
            configured_ret = int(app_settings.get_setting(
                f"scraper_{carrier}_retention_days",
                str(app_settings.DEFAULT_RETENTION_DAYS),
            ))
        except ValueError:
            configured_ret = app_settings.DEFAULT_RETENTION_DAYS
        effective_ret = min(configured_ret, max_ret)
        try:
            last_updated = datetime.fromisoformat(shipment["last_updated_at"].replace("Z", "+00:00"))
            if last_updated.tzinfo is None:
                last_updated = last_updated.replace(tzinfo=timezone.utc)
            tracking_expires_at = (last_updated + timedelta(days=effective_ret)).isoformat()
        except (ValueError, AttributeError):
            pass
    _annotate_stalled([shipment])
    return {**shipment, "events": events, "tracking_expires_at": tracking_expires_at}


@app.put("/api/shipments/{shipment_id}", dependencies=[Depends(_require_api_key)])
async def api_update_shipment(shipment_id: int, request: Request):
    """Update shipment fields (title, state, carrier, etc)."""
    from ingest import should_update_state
    shipment = db.get_shipment(shipment_id)
    if not shipment:
        raise HTTPException(404)
    body = await request.json()
    allowed = {"title", "carrier", "tracking_number", "order_number", "tracking_link", "current_state", "archived"}
    updates = {k: v for k, v in body.items() if k in allowed and v is not None}
    if "current_state" in updates:
        new_state = updates["current_state"]
        if new_state == shipment["current_state"]:
            del updates["current_state"]
        elif not should_update_state(shipment["current_state"], new_state):
            if not body.get("force"):
                raise HTTPException(409, detail=f"Cannot transition from '{shipment['current_state']}' to '{new_state}'")
        if "current_state" in updates:
            db.add_event(shipment_id, updates["current_state"], body.get("notes", "Manual update"), "manual")
    if updates:
        db.update_shipment(shipment_id, updates)
    return db.get_shipment(shipment_id)


@app.delete("/api/shipments/{shipment_id}", dependencies=[Depends(_require_api_key)])
async def api_delete_shipment(shipment_id: int):
    """Delete a shipment and all its events."""
    shipment = db.get_shipment(shipment_id)
    if not shipment:
        raise HTTPException(404)
    db.delete_shipment(shipment_id)
    return {"deleted": shipment_id}


@app.delete("/api/parsers/{parser_id}", dependencies=[Depends(_require_api_key)])
async def delete_parser(parser_id: int):
    """Delete a stored parser."""
    conn = db.get_conn()
    conn.execute("DELETE FROM parsers WHERE id = ?", (parser_id,))
    conn.commit()
    conn.close()
    return {"deleted": parser_id}


@app.get("/api/parsers", dependencies=[Depends(_require_api_key)])
async def api_parsers():
    """JSON list of all stored parsers with use counts."""
    conn = db.get_conn()
    rows = conn.execute("SELECT * FROM parsers ORDER BY use_count DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


# --- Settings endpoints ---


@app.get("/api/settings", dependencies=[Depends(_require_api_key)])
async def api_get_settings():
    """Get all settings as JSON (secret values are redacted)."""
    return app_settings.get_public_settings()


@app.put("/api/settings", dependencies=[Depends(_require_api_key)])
async def api_update_settings(request: Request):
    """Update settings (JSON body with key-value pairs). Only known keys are accepted."""
    from scrapers import list_scrapers as _list_scrapers
    _check_write_rate_limit()
    body = await request.json()
    allowed_keys = app_settings.get_allowed_keys()
    scraper_max = {s["carrier"]: s["max_retention_days"] for s in _list_scrapers()}
    rejected: list[str] = []
    for key, value in body.items():
        if key not in allowed_keys:
            rejected.append(key)
            continue
        # Cap retention_days at the carrier's documented maximum
        if key.endswith("_retention_days"):
            carrier = key.replace("scraper_", "").replace("_retention_days", "")
            max_ret = scraper_max.get(carrier, 90)
            try:
                value = str(min(int(value), max_ret))
            except ValueError:
                pass
        app_settings.set_setting(key, str(value))
    if rejected:
        _log.warning("PUT /api/settings: rejected unknown keys: %s", rejected)
    return app_settings.get_public_settings()


# --- Scraper endpoints ---


@app.get("/api/scrape-log", dependencies=[Depends(_require_api_key)])
async def api_scrape_log(
    shipment_id: int | None = None,
    carrier: str | None = None,
    status: str | None = None,
    limit: int = Query(default=50, ge=1, le=1000),
):
    """Query the scrape log with optional filters. limit is capped at 1000."""
    return db.get_scrape_log(shipment_id=shipment_id, carrier=carrier, status=status, limit=limit)


@app.get("/api/scrapers", dependencies=[Depends(_require_api_key)])
async def api_list_scrapers():
    """List available scrapers with status."""
    scrapers = list_scrapers()
    for s in scrapers:
        carrier = s["carrier"]
        enabled = app_settings.get_setting(f"scraper_{carrier}_enabled", "true")
        s["enabled"] = enabled.lower() == "true"
        # Inject actual active scraper from settings (overrides registry default)
        s["active_scraper"] = app_settings.get_setting(
            f"scraper_{carrier}_active", s["available_scrapers"][0]["key"]
        )
        # DHL needs an API key only when using the API scraper
        if carrier == "dhl":
            s["configured"] = s["active_scraper"] != "dhl_api" or bool(
                app_settings.get_setting("scraper_dhl_api_key", "")
            )
        else:
            s["configured"] = True
        # Inject user-configured retention days (capped at max)
        try:
            configured_ret = int(app_settings.get_setting(
                f"scraper_{carrier}_retention_days",
                str(app_settings.DEFAULT_RETENTION_DAYS),
            ))
        except ValueError:
            configured_ret = app_settings.DEFAULT_RETENTION_DAYS
        s["retention_days"] = min(configured_ret, s["max_retention_days"])
    return {
        "scrapers": scrapers,
        "scheduler_running": scheduler.running,
        "last_cycle_at": scheduler.last_cycle_at,
    }


@app.get("/api/imap/status", dependencies=[Depends(_require_api_key)])
async def api_imap_status():
    """IMAP poller status."""
    return imap_poller.status()


@app.post("/api/shipments/{shipment_id}/scrape", dependencies=[Depends(_require_api_key)])
async def api_scrape_shipment(shipment_id: int):
    """Trigger immediate scrape for this shipment."""
    _check_write_rate_limit()
    shipment = db.get_shipment(shipment_id)
    if not shipment:
        raise HTTPException(404)
    result = await scrape_single(shipment_id)
    if "error" in result:
        return JSONResponse(content=result, status_code=422)
    return result


@app.put("/api/shipments/{shipment_id}/scrape", dependencies=[Depends(_require_api_key)])
async def api_toggle_scrape(shipment_id: int, request: Request):
    """Enable/disable scraping for a shipment."""
    shipment = db.get_shipment(shipment_id)
    if not shipment:
        raise HTTPException(404)
    body = await request.json()
    enabled = 1 if body.get("enabled", True) else 0
    conn = db.get_conn()
    conn.execute(
        "UPDATE shipments SET scrape_enabled = ? WHERE id = ?",
        (enabled, shipment_id),
    )
    # If re-enabling, reset fail count
    if enabled:
        conn.execute(
            "UPDATE shipments SET scrape_fail_count = 0 WHERE id = ?",
            (shipment_id,),
        )
    conn.commit()
    conn.close()
    return db.get_shipment(shipment_id)


if not _HAS_FRONTEND:
    @app.get("/", response_class=HTMLResponse)
    async def index(request: Request):
        shipments = db.list_shipments()
        return templates.TemplateResponse(request, "index.html", {"shipments": shipments})


if not _HAS_FRONTEND:
    @app.get("/stats", response_class=HTMLResponse)
    async def stats_page(request: Request):
        conn = db.get_conn()
        by_state = {}
        for row in conn.execute("SELECT current_state, COUNT(*) as cnt FROM shipments GROUP BY current_state").fetchall():
            by_state[row["current_state"]] = row["cnt"]
        by_carrier = {}
        for row in conn.execute("SELECT carrier, COUNT(*) as cnt FROM shipments WHERE carrier IS NOT NULL GROUP BY carrier ORDER BY cnt DESC").fetchall():
            by_carrier[row["carrier"]] = row["cnt"]
        total_shipments = conn.execute("SELECT COUNT(*) FROM shipments").fetchone()[0]
        total_parsers = conn.execute("SELECT COUNT(*) FROM parsers").fetchone()[0]
        total_events = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        total_uses = conn.execute("SELECT COALESCE(SUM(use_count), 0) FROM parsers").fetchone()[0]
        recent_events = [dict(r) for r in conn.execute("SELECT * FROM events ORDER BY occurred_at DESC LIMIT 10").fetchall()]
        conn.close()
        ai_calls_saved = int(total_uses / max(total_uses + total_parsers, 1) * 100)
        stats = {
            "total_shipments": total_shipments,
            "active": sum(v for k, v in by_state.items() if k != "delivered"),
            "delivered": by_state.get("delivered", 0),
            "total_parsers": total_parsers,
            "total_events": total_events,
            "ai_calls_saved": ai_calls_saved,
            "by_state": by_state,
            "by_carrier": by_carrier,
            "recent_events": recent_events,
        }
        state_labels = {s: s.replace("_", " ").title() for s in VALID_STATES}
        return templates.TemplateResponse(request, "stats.html", {"stats": stats, "state_labels": state_labels})

    @app.get("/parsers", response_class=HTMLResponse)
    async def parsers_page(request: Request):
        import json as json_mod
        conn = db.get_conn()
        rows = conn.execute("SELECT * FROM parsers ORDER BY use_count DESC").fetchall()
        conn.close()
        parsers = []
        for r in rows:
            p = dict(r)
            p["keywords"] = json_mod.loads(p["subject_keywords"]) if p["subject_keywords"] else []
            p["field_map"] = json_mod.loads(p["field_map"]) if p["field_map"] else {}
            parsers.append(p)
        return templates.TemplateResponse(request, "parsers.html", {"parsers": parsers})

    @app.get("/shipments/{shipment_id}", response_class=HTMLResponse)
    async def detail(request: Request, shipment_id: int, updated: str | None = None):
        shipment = db.get_shipment(shipment_id)
        if not shipment:
            raise HTTPException(404)
        events = db.get_events(shipment_id)
        return templates.TemplateResponse(request, "detail.html", {
            "shipment": shipment, "events": events, "states": VALID_STATES, "flash": updated
        })

    @app.post("/shipments/{shipment_id}/state")
    async def update_state(shipment_id: int, state: str = Form(...), notes: str = Form("")):
        shipment = db.get_shipment(shipment_id)
        if not shipment:
            raise HTTPException(404)
        db.update_shipment(shipment_id, {"current_state": state})
        db.add_event(shipment_id, state, notes or "Manual update", "manual")
        return RedirectResponse(f"/shipments/{shipment_id}?updated=State+updated", status_code=303)

    @app.post("/shipments/{shipment_id}/title")
    async def update_title(shipment_id: int, title: str = Form(...)):
        shipment = db.get_shipment(shipment_id)
        if not shipment:
            raise HTTPException(404)
        db.update_shipment(shipment_id, {"title": title})
        return RedirectResponse(f"/shipments/{shipment_id}", status_code=303)

    @app.post("/shipments/{shipment_id}/delete")
    async def delete_shipment(shipment_id: int):
        db.delete_shipment(shipment_id)
        return RedirectResponse("/", status_code=303)


# SPA catch-all: serve React frontend for client-side routing
if _HAS_FRONTEND:
    from fastapi.responses import FileResponse

    @app.get("/{path:path}", response_class=HTMLResponse)
    async def spa_catchall(path: str):
        """Serve React SPA for all non-API routes."""
        file_path = f"frontend/dist/{path}"
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse("frontend/dist/index.html")
