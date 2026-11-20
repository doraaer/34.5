from fastapi import APIRouter
from backend.core import database as db, services
from backend.core.models import CreateCase, AvailabilityConsent

router = APIRouter(prefix="/api", tags=["Mock Centrix"])
@router.get("/context")
@router.get("/tenant/context")
def context():
    return {"tenant": db.fixture("tenants.json")[0],
            "building": db.fixture("building.json"),
            "partner": db.fixture("partner.json")}

@router.get("/cases")
def cases():
    return services.list_cases()

@router.post("/cases")
def create(body: CreateCase):
    return services.create_case(body)

@router.get("/cases/{case_id}")
def get(case_id: str):
    return services.require_case(case_id)

@router.post("/cases/{case_id}/availability")
def availability(case_id: str, body: AvailabilityConsent):
    return services.save_availability(case_id, body)

@router.post("/cases/{case_id}/dispatch")
def dispatch(case_id: str):
    return services.dispatch_case(case_id)
