from uuid import uuid4
from fastapi import HTTPException
from backend.core import database as db
from backend.core.event_handler import emit_partner_event
from backend.partner.models import AcceptJob, CompleteJob

def require_job(job_id):
    job = db.get("jobs", "partner_job_id", job_id)
    if not job:
        raise HTTPException(404, "partner job not found")
    return job

def create_partner_job(case_id, service_type, description, location, available_slots):
    for job in db.all_rows("jobs"):
        if job["case_id"] == case_id:
            return job
    job = {
        "partner_job_id": "JOB-" + uuid4().hex[:8].upper(),
        "case_id": case_id,
        "service_type": service_type,
        "description": description,
        "location": location,
        "available_slots": available_slots,
        "status": "received",
        "slot": None,
        "service_report": None,
        "invoice": None
    }
    db.save("jobs", "partner_job_id", job["partner_job_id"], job)
    return job

def accept(job_id, body: AcceptJob):
    job = require_job(job_id)
    if job["status"] != "received":
        raise HTTPException(409, "job not awaiting acceptance")
    slot = body.slot.model_dump(mode="json")
    emit_partner_event(job["case_id"], job_id, "partner.accepted", {"slot": slot})
    job["slot"] = slot
    job["status"] = "accepted"
    db.save("jobs", "partner_job_id", job_id, job)
    return job

def start(job_id):
    job = require_job(job_id)
    if job["status"] != "accepted":
        raise HTTPException(409, "job not accepted")
    emit_partner_event(job["case_id"], job_id, "partner.started", {})
    job["status"] = "in_progress"
    db.save("jobs", "partner_job_id", job_id, job)
    return job

def complete(job_id, body: CompleteJob):
    job = require_job(job_id)
    if job["status"] == "completed":
        return job
    if job["status"] != "in_progress":
        raise HTTPException(409, "job not started")
    report = body.service_report.model_dump()
    invoice = body.invoice.model_dump()
    emit_partner_event(job["case_id"], job_id, "partner.completed",
                       {"service_report": report, "invoice": invoice})
    job.update(status="completed", service_report=report, invoice=invoice)
    db.save("jobs", "partner_job_id", job_id, job)
    return job

def reject(job_id, reason):
    job = require_job(job_id)
    if job["status"] != "received":
        raise HTTPException(409, "job cannot be rejected now")
    emit_partner_event(job["case_id"], job_id, "partner.rejected", {"reason": reason})
    job["status"] = "rejected"
    db.save("jobs", "partner_job_id", job_id, job)
    return job
