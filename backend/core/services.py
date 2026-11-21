import os
from uuid import uuid4
from datetime import datetime
import httpx
from fastapi import HTTPException
from backend.core import database as db
from backend.core.models import CreateCase, AvailabilityConsent

def list_cases():
    return db.all_rows("cases")

def require_case(case_id):
    case = db.get("cases", "case_id", case_id)
    if not case:
        raise HTTPException(404, "case not found")
    return case

def create_case(body: CreateCase):
    tenant = db.fixture("tenants.json")[0]
    building = db.fixture("building.json")
    if body.tenant_id != tenant["tenant_id"] or body.unit_id != tenant["unit_id"]:
        raise HTTPException(400, "unknown demo tenant/unit combination")
    case = {
        "case_id": "CASE-" + uuid4().hex[:8].upper(),
        "tenant_id": body.tenant_id,
        "unit_id": body.unit_id,
        "building_id": building["building_id"],
        "description": body.description,
        "priority": body.priority,
        "service_type": "heating_repair",
        "status": "reported",
        "available_slots": [],
        "booking_authorized": False,
        "data_sharing_consent": False,
        "partner_id": building["service_partner_id"],
        "partner_job_id": None,
        "appointment": None,
        "service_report": None,
        "invoice": None
    }
    db.save("cases", "case_id", case["case_id"], case)
    return case

def save_availability(case_id, body: AvailabilityConsent):
    case = require_case(case_id)
    if case["status"] != "reported":
        raise HTTPException(409, "availability allowed before dispatch only")
    case.update(
        available_slots=[s.model_dump(mode="json") for s in body.available_slots],
        booking_authorized=body.booking_authorized,
        data_sharing_consent=body.data_sharing_consent
    )
    db.save("cases", "case_id", case_id, case)
    return case

def send_locally(request):
    """Direct in-process mock partner; used only when N8N_WEBHOOK_URL is unset."""
    from backend.partner.service import create_partner_job
    return create_partner_job(
        case_id=request["case_id"], service_type=request["service_type"],
        description=request["description"], location=request["location"],
        available_slots=request["available_slots"],
        priority=request.get("priority", "routine"))

def send_via_n8n(request):
    """POST the work order to the n8n dispatch webhook. Never fakes a job: any
    failure is a 502 and the case stays `reported` so dispatch can be retried."""
    headers = {"X-DORA-Token": os.environ.get("DORA_INTERNAL_TOKEN", "")}
    try:
        response = httpx.post(os.environ["N8N_WEBHOOK_URL"], json=request, headers=headers, timeout=15)
        response.raise_for_status()
        job = response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "dispatch to partner via n8n failed")
    if not isinstance(job, dict) or job.get("case_id") != request["case_id"] or not job.get("partner_job_id"):
        raise HTTPException(502, "n8n returned an invalid partner job")
    return job

def dispatch_case(case_id):
    case = require_case(case_id)
    if case["partner_job_id"]:
        return case
    if not case["booking_authorized"] or not case["data_sharing_consent"] or not case["available_slots"]:
        raise HTTPException(409, "booking authorization, consent and windows required")
    building = db.fixture("building.json")
    request = {
        "idempotency_key": f"{case_id}:dispatch:v1",
        "case_id": case_id,
        "service_type": case["service_type"],
        "description": case["description"],
        "location": building["address"] + ", " + case["unit_id"],
        "available_slots": case["available_slots"],
        "priority": case.get("priority", "routine"),
    }
    job = send_via_n8n(request) if os.environ.get("N8N_WEBHOOK_URL") else send_locally(request)
    case["partner_job_id"] = job["partner_job_id"]
    case["status"] = "awaiting_partner"
    db.save("cases", "case_id", case_id, case)
    return case

def event_update(case_id, partner_job_id, event_type, payload):
    case = require_case(case_id)
    if case["partner_job_id"] != partner_job_id:
        raise HTTPException(409, "partner job mismatch")
    status = case["status"]
    if event_type == "partner.accepted" and status == "awaiting_partner":
        slot = payload.get("slot")
        dt = datetime.fromisoformat
        try:
            start, end = dt(slot["start"]), dt(slot["end"])
            slot_ok = bool(start.tzinfo and end.tzinfo and start < end)
        except (KeyError, TypeError, ValueError):
            slot_ok = False
        if not slot_ok:
            raise HTTPException(400, "accepted event requires slot with valid start and end")
        if not any(dt(w["start"]) <= dt(slot["start"]) and dt(slot["end"]) <= dt(w["end"]) for w in case["available_slots"]):
            raise HTTPException(409, "partner slot outside authorized availability")
        case["appointment"] = slot
        case["status"] = "scheduled"
    elif event_type == "partner.started" and status == "scheduled":
        case["status"] = "in_progress"
    elif event_type == "partner.completed" and status == "in_progress":
        report, invoice = payload.get("service_report"), payload.get("invoice")
        if not report or not invoice:
            raise HTTPException(400, "completion requires report and invoice")
        case["service_report"] = report
        case["invoice"] = invoice
        case["status"] = "completed"
    elif event_type == "partner.rejected" and status == "awaiting_partner":
        case["status"] = "needs_attention"
    else:
        raise HTTPException(409, f"invalid transition {status} / {event_type}")
    db.save("cases", "case_id", case_id, case)
    return case
