from uuid import uuid4
from datetime import datetime
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

def dispatch_case(case_id):
    case = require_case(case_id)
    if case["partner_job_id"]:
        return case
    if not case["booking_authorized"] or not case["data_sharing_consent"] or not case["available_slots"]:
        raise HTTPException(409, "booking authorization, consent and windows required")
    # Working local-mode demonstration. Person 3 must implement actual n8n dispatch
    # before claiming n8n is connected.
    from backend.partner.service import create_partner_job
    building = db.fixture("building.json")
    job = create_partner_job(
        case_id=case_id,
        service_type=case["service_type"],
        description=case["description"],
        location=building["address"] + ", " + case["unit_id"],
        available_slots=case["available_slots"]
    )
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
        slot = payload["slot"]
        dt = datetime.fromisoformat
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
