"""Authenticated partner event receiver (contract: POST /internal/partner-events).

Used by the deployed partner / n8n. Fails closed: if DORA_INTERNAL_TOKEN is not
configured, every request is refused.
"""
import hmac
import os
from typing import Literal
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from backend.core.event_handler import emit_partner_event

router = APIRouter(prefix="/internal", tags=["Internal"])

class PartnerEvent(BaseModel):
    event_id: str | None = None
    type: Literal["partner.accepted", "partner.started", "partner.completed", "partner.rejected"]
    case_id: str
    partner_job_id: str
    payload: dict = {}

def verify_token(token):
    expected = os.environ.get("DORA_INTERNAL_TOKEN", "")
    if not expected or not token or not hmac.compare_digest(token, expected):
        raise HTTPException(403, "invalid or missing internal token")

@router.post("/partner-events")
def partner_event(body: PartnerEvent, x_dora_token: str | None = Header(default=None)):
    verify_token(x_dora_token)
    return emit_partner_event(body.case_id, body.partner_job_id, body.type, body.payload, body.event_id)
