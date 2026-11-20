"""Route tests on a standalone app: the calendar router is not registered in main.py yet."""
from datetime import datetime
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core import database as db, services
from backend.core.calendar_adapter import (CalendarNotConnected, CalendarProviderError,
                                           FakeBusyTimeSource)
from backend.core.models import CreateCase
from backend.routes import calendar as cal

FIXTURE = Path(__file__).parent / "fixtures" / "fake_calendar_busy.json"
BEFORE_WINDOWS = datetime.fromisoformat("2026-11-20T12:00:00+01:00")


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("DORA_DB_PATH", str(tmp_path / "cal.sqlite3"))
    db.initialize()
    a = FastAPI()
    a.include_router(cal.router)
    a.dependency_overrides[cal.get_now] = lambda: BEFORE_WINDOWS
    return a


@pytest.fixture
def case_id(app):
    tenant = db.fixture("tenants.json")[0]
    body = {"description": "Radiators not heating", "priority": "routine"}
    fields = CreateCase.model_fields
    if "tenant_id" in fields:
        body.update(tenant_id=tenant["tenant_id"], unit_id=tenant["unit_id"])
    return services.create_case(CreateCase(**body))["case_id"]


def use_source(app, factory):
    app.dependency_overrides[cal.get_source_factory] = lambda: factory


def test_proposals_from_fake_calendar(app, case_id):
    use_source(app, lambda: FakeBusyTimeSource.from_fixture(FIXTURE))
    r = TestClient(app).post(f"/api/cases/{case_id}/calendar-proposal", json={})
    assert r.status_code == 200
    assert r.json() == {"source": "fake_calendar", "proposals": [
        {"start": "2026-11-23T15:00:00+01:00", "end": "2026-11-23T16:00:00+01:00"},
        {"start": "2026-11-24T09:30:00+01:00", "end": "2026-11-24T10:30:00+01:00"},
        {"start": "2026-11-24T10:30:00+01:00", "end": "2026-11-24T11:30:00+01:00"}]}


def test_proposals_lie_inside_partner_windows(app, case_id):
    use_source(app, lambda: FakeBusyTimeSource([]))
    proposals = TestClient(app).post(f"/api/cases/{case_id}/calendar-proposal").json()["proposals"]
    windows = cal.partner_windows()
    assert len(proposals) == 3
    for p in proposals:
        s, e = datetime.fromisoformat(p["start"]), datetime.fromisoformat(p["end"])
        assert (e - s).total_seconds() == 3600
        assert any(w.start <= s and e <= w.end for w in windows)


def test_no_overlap_returns_empty_list(app, case_id):
    allday = [{"start": "2026-11-23T00:00:00+01:00", "end": "2026-11-25T00:00:00+01:00"}]
    use_source(app, lambda: FakeBusyTimeSource(allday))
    r = TestClient(app).post(f"/api/cases/{case_id}/calendar-proposal", json={})
    assert r.status_code == 200 and r.json()["proposals"] == []


def test_past_windows_are_not_proposed(app, case_id):
    app.dependency_overrides[cal.get_now] = lambda: datetime.fromisoformat("2026-11-30T00:00:00+01:00")
    use_source(app, lambda: FakeBusyTimeSource([]))
    assert TestClient(app).post(f"/api/cases/{case_id}/calendar-proposal").json()["proposals"] == []


def test_not_connected_is_409(app, case_id, monkeypatch):
    monkeypatch.delenv("DORA_CALENDAR_PROVIDER", raising=False)  # real env-based factory
    r = TestClient(app).post(f"/api/cases/{case_id}/calendar-proposal", json={})
    assert r.status_code == 409 and r.json() == {"detail": "calendar not connected"}


def test_unknown_case_is_404_even_without_calendar(app):
    r = TestClient(app).post("/api/cases/CASE-NOPE/calendar-proposal", json={})
    assert r.status_code == 404


def test_provider_failure_is_502(app, case_id):
    class Broken:
        source = "google_calendar"
        def busy_intervals(self, a, b):
            raise CalendarProviderError("down")
    use_source(app, lambda: Broken())
    assert TestClient(app).post(f"/api/cases/{case_id}/calendar-proposal").status_code == 502


def test_expired_token_during_call_is_409(app, case_id):
    class Expired:
        source = "google_calendar"
        def busy_intervals(self, a, b):
            raise CalendarNotConnected("calendar not connected")
    use_source(app, lambda: Expired())
    r = TestClient(app).post(f"/api/cases/{case_id}/calendar-proposal")
    assert r.status_code == 409 and r.json() == {"detail": "calendar not connected"}


def test_proposal_does_not_modify_case(app, case_id):
    use_source(app, lambda: FakeBusyTimeSource([]))
    before = services.require_case(case_id)
    TestClient(app).post(f"/api/cases/{case_id}/calendar-proposal")
    assert services.require_case(case_id) == before


def test_invalid_duration_is_422(app, case_id):
    use_source(app, lambda: FakeBusyTimeSource([]))
    r = TestClient(app).post(f"/api/cases/{case_id}/calendar-proposal", json={"duration_minutes": 5})
    assert r.status_code == 422
