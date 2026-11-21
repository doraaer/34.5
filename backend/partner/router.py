from fastapi import APIRouter
from backend.core import database as db
from backend.partner import service
from backend.partner.models import CreatePartnerJob, AcceptJob, CompleteJob, RejectJob

router = APIRouter(prefix="/partner", tags=["Mock SHK Partner"])

@router.get("/services")
def services():
    return [{"service_type": "heating_repair", "name": "Heating repair",
             "eligible": True, "mock": True}]

@router.get("/availability")
def availability():
    return service.available_windows()

@router.get("/jobs")
def jobs():
    return db.all_rows("jobs")

@router.post("/jobs")
def create(body: CreatePartnerJob):
    return service.create_partner_job(
        body.case_id, body.service_type, body.description, body.location,
        [s.model_dump(mode="json") for s in body.available_slots],
        priority=body.priority,
    )

@router.post("/jobs/{job_id}/accept")
def accept(job_id: str, body: AcceptJob):
    return service.accept(job_id, body)

@router.post("/jobs/{job_id}/start")
def start(job_id: str):
    return service.start(job_id)

@router.post("/jobs/{job_id}/complete")
def complete(job_id: str, body: CompleteJob):
    return service.complete(job_id, body)

@router.post("/jobs/{job_id}/reject")
def reject(job_id: str, body: RejectJob):
    return service.reject(job_id, body.reason)
