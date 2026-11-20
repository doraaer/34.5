from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, model_validator

class Slot(BaseModel):
    start: datetime
    end: datetime

    @model_validator(mode="after")
    def validate_slot(self):
        if not self.start.tzinfo or not self.end.tzinfo or self.end <= self.start:
            raise ValueError("slots must have timezone offsets and start before end")
        return self

class CreateCase(BaseModel):
    tenant_id: str = "TENANT-001"
    unit_id: str = "UNIT-102"
    description: str = Field(min_length=3)
    priority: Literal["routine", "urgent"] = "routine"

class AvailabilityConsent(BaseModel):
    available_slots: list[Slot] = Field(min_length=1)
    booking_authorized: bool
    data_sharing_consent: bool

class ServiceReport(BaseModel):
    summary: str = Field(min_length=3)
    work_done: str = Field(min_length=3)

class Invoice(BaseModel):
    invoice_id: str
    amount_eur: float = Field(ge=0)
    currency: Literal["EUR"] = "EUR"
    recipient: Literal["property_owner"] = "property_owner"
