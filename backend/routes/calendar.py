"""POST /api/cases/{case_id}/calendar-proposal (agent/CALENDAR-CONTRACT-PROPOSAL.md).

Read-only: proposes up to 3 free one-hour slots inside the partner windows and the
tenant's free time. It does not change the case, authorize a booking or contact the
partner. The tenant approves a proposal, then DORA calls /availability as before.

Registered in backend/main.py. Contract: contracts/api-contract.md (Calendar proposal).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.core import database as db, services
from backend.core.calendar_adapter import (BusyTimeSource, CalendarNotConnected,
                                           CalendarProviderError, source_from_env)
from backend.core.scheduling import SchedulingError, find_free_slots, merge_intervals, to_interval

router = APIRouter(prefix="/api", tags=["Calendar (preparation)"])
MAX_PROPOSALS = 3


class ProposalRequest(BaseModel):
    duration_minutes: int = Field(60, ge=30, le=240)


def get_source_factory() -> Callable[[], BusyTimeSource]:
    return source_from_env


def get_now() -> datetime:
    return datetime.now(timezone.utc)


def partner_windows():
    return merge_intervals(to_interval(w) for w in db.fixture("partner.json")["availability"])


@router.post("/cases/{case_id}/calendar-proposal")
def calendar_proposal(case_id: str,
                      body: Optional[ProposalRequest] = Body(None),
                      source_factory: Callable[[], BusyTimeSource] = Depends(get_source_factory),
                      now: datetime = Depends(get_now)):
    services.require_case(case_id)  # 404 before touching any calendar
    duration = timedelta(minutes=(body or ProposalRequest()).duration_minutes)
    try:
        source = source_factory()
    except CalendarNotConnected:
        raise HTTPException(409, "calendar not connected")
    except CalendarProviderError:
        raise HTTPException(502, "calendar provider failed")

    windows = partner_windows()
    if not windows:
        return {"proposals": [], "source": source.source}
    try:
        busy = source.busy_intervals(windows[0].start, windows[-1].end)
        slots = find_free_slots(windows, busy, duration=duration, limit=MAX_PROPOSALS,
                                not_before=now)
    except CalendarNotConnected:
        raise HTTPException(409, "calendar not connected")
    except (CalendarProviderError, SchedulingError):
        raise HTTPException(502, "calendar provider failed")
    return {"proposals": [s.to_dict() for s in slots], "source": source.source}
