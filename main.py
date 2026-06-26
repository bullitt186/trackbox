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

    model_config = {"populate_by_name": True}


@app.on_event("startup")
def startup():
    db.init_db()


@app.post("/ingest")
async def ingest_email(payload: EmailPayload):
    email = {"from": payload.from_, "subject": payload.subject, "body": payload.body, "html": payload.html, "product_name": payload.product_name, "message_id": payload.message_id}
    result = process_email(email)
    return result


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


@app.post("/shipments/{shipment_id}/delete")
async def delete_shipment(shipment_id: int):
    db.delete_shipment(shipment_id)
    return RedirectResponse("/", status_code=303)
