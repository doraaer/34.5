import json
from datetime import datetime
from pathlib import Path

import httpx
import pytest

from backend.core.calendar_adapter import (CalendarNotConnected, CalendarProviderError,
                                           FakeBusyTimeSource, source_from_env)
from backend.core.google_calendar import FREEBUSY_URL, GoogleFreeBusySource
from backend.core.scheduling import earliest_free_slot, parse_datetime

FIXTURE = Path(__file__).parent / "fixtures" / "fake_calendar_busy.json"
T0 = parse_datetime("2026-11-23T00:00:00+01:00")
T1 = parse_datetime("2026-11-25T00:00:00+01:00")
WINDOW = {"start": "2026-11-23T14:00:00+01:00", "end": "2026-11-23T17:00:00+01:00"}


def test_fake_from_fixture():
    src = FakeBusyTimeSource.from_fixture(FIXTURE)
    busy = src.busy_intervals(T0, T1)
    assert len(busy) == 3 and src.source == "fake_calendar"
    assert earliest_free_slot([WINDOW], busy).to_dict()["start"] == "2026-11-23T15:00:00+01:00"


def test_fake_filters_to_range():
    src = FakeBusyTimeSource.from_fixture(FIXTURE)
    assert len(src.busy_intervals(T0, parse_datetime("2026-11-24T00:00:00+01:00"))) == 2


def test_fake_bad_fixture(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{}")
    with pytest.raises(CalendarProviderError):
        FakeBusyTimeSource.from_fixture(bad)


def test_spoken_availability_becomes_busy_complement():
    # Tenant: "I'm free Monday 15:00 to 16:30."
    free = [{"start": "2026-11-23T15:00:00+01:00", "end": "2026-11-23T16:30:00+01:00"}]
    src = FakeBusyTimeSource.from_spoken_availability(free, T0, T1)
    assert src.source == "spoken_availability"
    slot = earliest_free_slot([WINDOW], src.busy_intervals(T0, T1))
    assert slot.to_dict() == {"start": "2026-11-23T15:00:00+01:00", "end": "2026-11-23T16:00:00+01:00"}


def test_spoken_availability_nothing_free():
    src = FakeBusyTimeSource.from_spoken_availability([], T0, T1)
    assert earliest_free_slot([WINDOW], src.busy_intervals(T0, T1)) is None


@pytest.mark.parametrize("env", [{}, {"DORA_CALENDAR_PROVIDER": "google"},
                                 {"DORA_CALENDAR_PROVIDER": "fake"}, {"DORA_CALENDAR_PROVIDER": "outlook"}])
def test_source_from_env_not_connected(monkeypatch, env):
    for key in ("DORA_CALENDAR_PROVIDER", "DORA_GOOGLE_CALENDAR_ACCESS_TOKEN", "DORA_FAKE_CALENDAR_FILE"):
        monkeypatch.delenv(key, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    with pytest.raises(CalendarNotConnected):
        source_from_env()


def test_source_from_env_selects(monkeypatch):
    monkeypatch.setenv("DORA_CALENDAR_PROVIDER", "fake")
    monkeypatch.setenv("DORA_FAKE_CALENDAR_FILE", str(FIXTURE))
    assert isinstance(source_from_env(), FakeBusyTimeSource)
    monkeypatch.setenv("DORA_CALENDAR_PROVIDER", "google")
    monkeypatch.setenv("DORA_GOOGLE_CALENDAR_ACCESS_TOKEN", "test-token-not-real")
    assert isinstance(source_from_env(), GoogleFreeBusySource)


# --- Google adapter against a mocked transport (no network) ---

def google(handler):
    return GoogleFreeBusySource("test-token-not-real", transport=httpx.MockTransport(handler))


def test_google_request_shape_and_parsing():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"kind": "calendar#freeBusy", "calendars": {"primary": {"busy": [
            {"start": "2026-11-23T13:00:00Z", "end": "2026-11-23T14:00:00Z"},
            {"start": "2026-11-23T13:30:00Z", "end": "2026-11-23T14:15:00Z"}]}}})

    busy = google(handler).busy_intervals(T0, T1)
    assert seen["url"] == FREEBUSY_URL
    assert seen["auth"] == "Bearer test-token-not-real"
    assert seen["body"]["items"] == [{"id": "primary"}]
    assert seen["body"]["timeZone"] == "Europe/Berlin"
    assert [b.to_dict() for b in busy] == [
        {"start": "2026-11-23T14:00:00+01:00", "end": "2026-11-23T15:15:00+01:00"}]


def test_google_401_means_not_connected():
    with pytest.raises(CalendarNotConnected):
        google(lambda r: httpx.Response(401, json={})).busy_intervals(T0, T1)


@pytest.mark.parametrize("resp", [
    httpx.Response(500, json={}),
    httpx.Response(200, json={"calendars": {}}),
    httpx.Response(200, text="not json"),
    httpx.Response(200, json={"calendars": {"primary": {"errors": [{"domain": "global", "reason": "notFound"}]}}}),
    httpx.Response(200, json={"calendars": {"primary": {"busy": [{"start": "2026-11-23T13:00:00", "end": "x"}]}}}),
])
def test_google_bad_responses(resp):
    with pytest.raises(CalendarProviderError):
        google(lambda r: resp).busy_intervals(T0, T1)


def test_google_network_error():
    def handler(request):
        raise httpx.ConnectError("boom", request=request)
    with pytest.raises(CalendarProviderError):
        google(handler).busy_intervals(T0, T1)
