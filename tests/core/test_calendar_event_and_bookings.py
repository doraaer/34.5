"""Calendar fixes: proposals skip already-booked provider time; confirmed appointments
can be written to the simulated calendar (POST /calendar-event)."""
from datetime import datetime
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core import database as db, services
from backend.core.calendar_adapter import CalendarNotConnected, FakeBusyTimeSource
from backend.core.models import CreateCase
from backend.partner import service as partner
from backend.partner.models import AcceptJob
from backend.core.models import Slot
from backend.routes import calendar as cal

FIXTURE = Path(__file__).parent / "fixtures" / "fake_calendar_busy.json"
BEFORE_WINDOWS = datetime.fromisoformat("2026-11-20T12:00:00+01:00")
MON_15 = {"start": "2026-11-23T15:00:00+01:00", "end": "2026-11-23T16:00:00+01:00"}


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("DORA_DB_PATH", str(tmp_path / "cal.sqlite3"))
    db.initialize()
    a = FastAPI()
    a.include_router(cal.router)
    a.dependency_overrides[cal.get_now] = lambda: BEFORE_WINDOWS
    a.dependency_overrides[cal.get_source_factory] = lambda: (lambda: FakeBusyTimeSource.from_fixture(FIXTURE))
    return a


def new_case():
    tenant = db.fixture("tenants.json")[0]
    return services.create_case(CreateCase(description="Radiators cold", tenant_id=tenant["tenant_id"],
                                           unit_id=tenant["unit_id"]))["case_id"]


def book(case_id, slot):
    """Authorize, dispatch and let the partner accept `slot` for this case."""
    services.save_availability(case_id, services.AvailabilityConsent(
        available_slots=[Slot(**slot)], booking_authorized=True, data_sharing_consent=True))
    job_id = services.dispatch_case(case_id)["partner_job_id"]
    partner.accept(job_id, AcceptJob(slot=Slot(**slot)))


def test_proposals_skip_time_already_booked_by_another_tenant(app):
    book(new_case(), MON_15)  # someone else now has Monday 15:00-16:00
    proposals = TestClient(app).post(f"/api/cases/{new_case()}/calendar-proposal", json={}).json()["proposals"]
    assert MON_15 not in proposals
    assert proposals and all(p["start"] != MON_15["start"] for p in proposals)


def test_calendar_event_for_confirmed_appointment(app):
    cid = new_case()
    book(cid, MON_15)
    client = TestClient(app)
    first = client.post(f"/api/cases/{cid}/calendar-event")
    assert first.status_code == 200
    event = first.json()
    assert event["provider"] == "fake_calendar" and event["simulated"] is True
    assert event["start"] == MON_15["start"] and event["end"] == MON_15["end"]
    assert client.post(f"/api/cases/{cid}/calendar-event").json() == event  # idempotent
    assert services.require_case(cid)["calendar_event"] == event


def test_calendar_event_refuses_unconfirmed_appointment(app):
    assert TestClient(app).post(f"/api/cases/{new_case()}/calendar-event").status_code == 409


def test_calendar_event_without_calendar_is_409(app):
    cid = new_case()
    book(cid, MON_15)

    def not_connected():
        raise CalendarNotConnected("calendar not connected")

    app.dependency_overrides[cal.get_source_factory] = lambda: not_connected
    assert TestClient(app).post(f"/api/cases/{cid}/calendar-event").status_code == 409


def test_calendar_event_unknown_case_is_404(app):
    assert TestClient(app).post("/api/cases/CASE-NOPE/calendar-event").status_code == 404
