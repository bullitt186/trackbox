import os
import time

from dotenv import load_dotenv
from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

load_dotenv()

_START_TIME = time.time()

import db
from ingest import process_email

VALID_STATES = [
    "unknown", "preparing", "shipped", "in_transit",
    "out_for_delivery", "delivered", "delayed", "exception"
]

app = FastAPI(title="Trackbox")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
templates = Jinja2Templates(directory="templates")

# Serve frontend build output if it exists
if os.path.isdir("frontend/dist"):
    app.mount("/app", StaticFiles(directory="frontend/dist", html=True), name="frontend")


class EmailPayload(BaseModel):
    from_: str = Field(alias="from")
    subject: str
    body: str
    html: str | None = None
    product_name: str | None = None
    message_id: str | None = None
    date: str | None = None

    model_config = {"populate_by_name": True}


@app.on_event("startup")
def startup():
    db.init_db()


@app.post("/ingest")
async def ingest_email(payload: EmailPayload):
    email = {"from": payload.from_, "subject": payload.subject, "body": payload.body, "html": payload.html, "product_name": payload.product_name, "message_id": payload.message_id, "date": payload.date}
    result = process_email(email)
    return result


@app.get("/health")
async def health():
    """Health check for monitoring."""
    conn = db.get_conn()
    conn.execute("SELECT 1").fetchone()
    conn.close()
    uptime = int(time.time() - _START_TIME)
    return {"status": "ok", "version": os.getenv("TRACKBOX_VERSION", "dev"), "build_time": os.getenv("TRACKBOX_BUILD_TIME", "unknown"), "uptime_seconds": uptime}


@app.get("/api/stats")
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


@app.get("/api/shipments")
async def api_shipments(state: str | None = None):
    """JSON list of shipments. Optional ?state=active or ?state=delivered."""
    shipments = db.list_shipments(limit=200)
    if state == "active":
        shipments = [s for s in shipments if s["current_state"] != "delivered"]
    elif state == "delivered":
        shipments = [s for s in shipments if s["current_state"] == "delivered"]
    # Sort active by state urgency (out_for_delivery first, then in_transit, etc)
    state_priority = {"out_for_delivery": 0, "delayed": 1, "exception": 1, "in_transit": 2, "shipped": 3, "preparing": 4, "unknown": 5, "delivered": 6}
    shipments.sort(key=lambda s: state_priority.get(s["current_state"], 5))
    # Add last_event summary
    conn = db.get_conn()
    for s in shipments:
        row = conn.execute(
            "SELECT state, notes, occurred_at FROM events WHERE shipment_id = ? ORDER BY occurred_at DESC LIMIT 1",
            (s["id"],)
        ).fetchone()
        s["last_event"] = dict(row) if row else None
    conn.close()
    return shipments


@app.get("/api/shipments/{shipment_id}")
async def api_shipment_detail(shipment_id: int):
    """JSON detail of a single shipment with events."""
    shipment = db.get_shipment(shipment_id)
    if not shipment:
        raise HTTPException(404)
    events = db.get_events(shipment_id)
    return {**shipment, "events": events}


@app.put("/api/shipments/{shipment_id}")
async def api_update_shipment(shipment_id: int, request: Request):
    """Update shipment fields (title, state, carrier, etc)."""
    shipment = db.get_shipment(shipment_id)
    if not shipment:
        raise HTTPException(404)
    body = await request.json()
    allowed = {"title", "carrier", "tracking_number", "order_number", "tracking_link", "current_state"}
    updates = {k: v for k, v in body.items() if k in allowed and v is not None}
    if "current_state" in updates:
        db.add_event(shipment_id, updates["current_state"], body.get("notes", "API update"), "manual")
    if updates:
        db.update_shipment(shipment_id, updates)
    return db.get_shipment(shipment_id)


@app.delete("/api/shipments/{shipment_id}")
async def api_delete_shipment(shipment_id: int):
    """Delete a shipment and all its events."""
    shipment = db.get_shipment(shipment_id)
    if not shipment:
        raise HTTPException(404)
    db.delete_shipment(shipment_id)
    return {"deleted": shipment_id}


@app.delete("/api/parsers/{parser_id}")
async def delete_parser(parser_id: int):
    """Delete a stored parser."""
    conn = db.get_conn()
    conn.execute("DELETE FROM parsers WHERE id = ?", (parser_id,))
    conn.commit()
    conn.close()
    return {"deleted": parser_id}


@app.get("/api/parsers")
async def api_parsers():
    """JSON list of all stored parsers with use counts."""
    conn = db.get_conn()
    rows = conn.execute("SELECT * FROM parsers ORDER BY use_count DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    shipments = db.list_shipments()
    return templates.TemplateResponse(request, "index.html", {"shipments": shipments})


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
