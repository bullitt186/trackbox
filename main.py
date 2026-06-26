from fastapi import FastAPI, Request, Form, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()

import db
from ingest import process_email

VALID_STATES = [
    "unknown", "preparing", "shipped", "in_transit",
    "out_for_delivery", "delivered", "delayed", "exception"
]

app = FastAPI(title="Trackbox")
templates = Jinja2Templates(directory="templates")


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
    return {"status": "ok"}


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


@app.get("/shipments/{shipment_id}", response_class=HTMLResponse)
async def detail(request: Request, shipment_id: int):
    shipment = db.get_shipment(shipment_id)
    if not shipment:
        raise HTTPException(404)
    events = db.get_events(shipment_id)
    return templates.TemplateResponse(request, "detail.html", {
        "shipment": shipment, "events": events, "states": VALID_STATES
    })


@app.post("/shipments/{shipment_id}/state")
async def update_state(shipment_id: int, state: str = Form(...), notes: str = Form("")):
    shipment = db.get_shipment(shipment_id)
    if not shipment:
        raise HTTPException(404)
    db.update_shipment(shipment_id, {"current_state": state})
    db.add_event(shipment_id, state, notes or "Manual update", "manual")
    return RedirectResponse(f"/shipments/{shipment_id}", status_code=303)


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
