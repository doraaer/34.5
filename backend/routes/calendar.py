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
from backend.core.scheduling import BERLIN, SchedulingError, find_free_slots, merge_intervals, to_interval

router = APIRouter(prefix="/api", tags=["Calendar (preparation)"])
MAX_PROPOSALS = 3


class ProposalRequest(BaseModel):
    duration_minutes: int = Field(60, ge=30, le=240)


def get_source_factory() -> Callable[[], BusyTimeSource]:
    return source_from_env


def get_now() -> datetime:
    return datetime.now(timezone.utc)


def partner_shift_windows():
    """The provider's working windows from the fixture (used for the calendar view's date range)."""
    return merge_intervals(to_interval(w) for w in db.fixture("partner.json")["availability"])


def partner_windows():
    """Windows the provider can still take: working windows minus appointments already booked.
    Proposals must use these, otherwise DORA offers a time another tenant already has."""
    from backend.partner.service import available_windows
    return merge_intervals(to_interval(s.model_dump(mode="json")) for s in available_windows())


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


SIMULATED_SOURCES = {"fake_calendar", "spoken_availability"}


@router.get("/calendar/busy")
def calendar_busy(source_factory: Callable[[], BusyTimeSource] = Depends(get_source_factory)):
    """Busy blocks of the SIMULATED tenant calendar, for the tenant page's demo panel.

    Only start/end, never titles. Covers the whole Berlin days of the partner windows.
    Real calendars (Google) are not exposed here: 409, like "not connected".
    """
    try:
        source = source_factory()
    except CalendarNotConnected:
        raise HTTPException(409, "calendar not connected")
    except CalendarProviderError:
        raise HTTPException(502, "calendar provider failed")
    if source.source not in SIMULATED_SOURCES:
        raise HTTPException(409, "calendar view is only available for the simulated calendar")
    windows = partner_shift_windows()
    if not windows:
        return {"source": source.source, "simulated": True, "busy": []}
    first = windows[0].start.astimezone(BERLIN).replace(hour=0, minute=0, second=0, microsecond=0)
    last = windows[-1].end.astimezone(BERLIN).replace(hour=0, minute=0, second=0, microsecond=0)
    time_min, time_max = first, last + timedelta(days=1)
    try:
        busy = source.busy_intervals(time_min, time_max)
    except (CalendarProviderError, SchedulingError):
        raise HTTPException(502, "calendar provider failed")
    return {"source": source.source, "simulated": True,
            "busy": [b.to_dict() for b in sorted(busy)]}


@router.post("/cases/{case_id}/calendar-event")
def calendar_event(case_id: str,
                   source_factory: Callable[[], BusyTimeSource] = Depends(get_source_factory)):
    """Put the CONFIRMED appointment into the tenant's calendar (agent/CALENDAR-CONTRACT-PROPOSAL.md).

    Simulated calendar: the event is recorded on the case; the tenant page's calendar panel shows it.
    Real calendars (Google) are not written yet: 409, so DORA falls back to an .ics file.
    Idempotent: calling twice returns the same event.
    """
    case = services.require_case(case_id)
    if case.get("status") not in ("scheduled", "in_progress", "completed") or not case.get("appointment"):
        raise HTTPException(409, "appointment not confirmed")
    try:
        source = source_factory()
    except CalendarNotConnected:
        raise HTTPException(409, "calendar not connected")
    except CalendarProviderError:
        raise HTTPException(502, "calendar provider failed")
    if source.source not in SIMULATED_SOURCES:
        raise HTTPException(409, "writing to this calendar is not supported yet")
    existing = case.get("calendar_event")
    if existing and existing.get("start") == case["appointment"]["start"]:
        return existing
    event = {"event_id": "SIM-" + case_id, "provider": source.source, "simulated": True,
             "start": case["appointment"]["start"], "end": case["appointment"]["end"],
             "title": "Heating repair"}
    case["calendar_event"] = event
    db.save("cases", "case_id", case_id, case)
    return event
