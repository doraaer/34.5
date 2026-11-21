from typing import Annotated, Literal
from pydantic import BaseModel, StringConstraints
from backend.core.models import Slot, ServiceReport, Invoice

class CreatePartnerJob(BaseModel):
    case_id: str
    service_type: Literal["heating_repair"]
    description: str
    location: str
    available_slots: list[Slot]
    priority: Literal["routine", "urgent"] = "routine"

class AcceptJob(BaseModel):
    slot: Slot

class CompleteJob(BaseModel):
    service_report: ServiceReport
    invoice: Invoice

class RejectJob(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
