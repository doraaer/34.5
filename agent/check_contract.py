"""Replay the browser tool HTTP contract against a temporary mock Centrix database."""

import os
import json
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


EXPECTED_TOOLS = {
    "get_tenant_context": set(),
    "create_maintenance_case": {"description", "priority"},
    "save_availability_and_consent": {
        "window_ids", "booking_authorized", "data_sharing_consent",
    },
    "propose_times_from_calendar": set(),
    "dispatch_to_partner": set(),
    "get_case_status": set(),
}
JSON_HEADERS = {"Content-Type": "application/json"}


def check_tool_definitions():
    contract = json.loads(Path(__file__).with_name("tools.json").read_text(encoding="utf-8"))
    tools = contract["tools"]
    assert len(tools) == len(EXPECTED_TOOLS)
    assert {tool["name"] for tool in tools} == EXPECTED_TOOLS.keys()
    for tool in tools:
        name = tool["name"]
        params = tool["parameters"]
        assert tool["type"] == "client" and tool["expects_response"] is True, name
        assert set(params["properties"]) == EXPECTED_TOOLS[name], name
        assert sorted(params["required"]) == sorted(EXPECTED_TOOLS[name]), name


def request(client, method, path, *, expected=200, **kwargs):
    response = client.request(method, path, headers=JSON_HEADERS, **kwargs)
    assert response.status_code == expected, (
        f"{method} {path}: expected {expected}, got {response.status_code}: {response.text}"
    )
    return response.json()


def create_case(client):
    case = request(client, "POST", "/api/cases", json={
        "description": "Living room radiators have been cold since yesterday.",
        "priority": "routine",
    })
    assert case["status"] == "reported" and case["case_id"]
    return f'/api/cases/{case["case_id"]}'


def availability_payload(booking_authorized, data_sharing_consent, windows):
    """Mirror the browser guard: send no request unless both flags are exactly true."""
    if booking_authorized is not True or data_sharing_consent is not True:
        return None
    return {
        "available_slots": windows,
        "booking_authorized": True,
        "data_sharing_consent": True,
    }


def prepare_dispatch(client):
    context = request(client, "GET", "/api/context")
    assert context["tenant"]["unit_id"] and context["tenant"]["name"]
    assert context["building"]["address"] and context["building"]["heating_type"]
    assert context["partner"]["name"]
    offered = context["partner"]["availability"][0]
    window = {key: offered[key] for key in ("start", "end")}
    path = create_case(client)
    case = request(client, "POST", path + "/availability", json=availability_payload(True, True, [window]))
    assert case["status"] == "reported"
    assert case["booking_authorized"] is True and case["data_sharing_consent"] is True
    for key in ("start", "end"):
        assert datetime.fromisoformat(case["available_slots"][0][key]) == datetime.fromisoformat(window[key])
    return path, window


def dispatch(client, path):
    case = request(client, "POST", path + "/dispatch")
    assert case["status"] == "awaiting_partner" and case["partner_job_id"]
    assert not case["appointment"]
    return case["partner_job_id"]


def happy_path(client):
    path, window = prepare_dispatch(client)
    job_id = dispatch(client, path)
    pending = request(client, "GET", path)
    assert pending["status"] == "awaiting_partner" and pending["appointment"] is None
    start = datetime.fromisoformat(window["start"]) + timedelta(hours=1)
    end = start + timedelta(hours=1)
    assert end <= datetime.fromisoformat(window["end"]), "Fixture W1 must fit the demo slot"
    slot = {"start": start.isoformat(), "end": end.isoformat()}
    request(client, "POST", f"/partner/jobs/{job_id}/accept", json={"slot": slot})
    scheduled = request(client, "GET", path)
    assert scheduled["case_id"] == pending["case_id"]
    assert scheduled["status"] == "scheduled"
    assert datetime.fromisoformat(scheduled["appointment"]["start"]) == start
    assert datetime.fromisoformat(scheduled["appointment"]["end"]) == end


def consent_missing(client):
    path = create_case(client)
    # Exercise the guard independently of HTTP, including non-boolean inputs.
    for booking, sharing in [(False, True), (True, False), (None, True), (True, 1)]:
        assert availability_payload(booking, sharing, []) is None
    request(client, "POST", path + "/availability", expected=422,
            json=availability_payload(True, True, []))
    case = request(client, "GET", path)
    assert case["available_slots"] == []
    assert case["booking_authorized"] is False and case["data_sharing_consent"] is False


def partner_rejects(client):
    path, _ = prepare_dispatch(client)
    job_id = dispatch(client, path)
    request(client, "POST", f"/partner/jobs/{job_id}/reject", json={"reason": "No technician available"})
    case = request(client, "GET", path)
    assert case["status"] == "needs_attention" and case["appointment"] is None


def duplicate_dispatch(client):
    path, _ = prepare_dispatch(client)
    first = dispatch(client, path)
    second = dispatch(client, path)
    assert second == first
    case = request(client, "GET", path)
    assert case["partner_job_id"] == first
    jobs = request(client, "GET", "/partner/jobs")
    assert [job["partner_job_id"] for job in jobs if job["case_id"] == case["case_id"]] == [first]


def calendar_proposal(client):
    """Valid before and after Person 3 ships the endpoint (agent/CALENDAR-CONTRACT-PROPOSAL.md)."""
    path = create_case(client)
    response = client.post(path + "/calendar-proposal", headers=JSON_HEADERS, json={})
    if response.status_code in (404, 405, 409):
        print("     (calendar endpoint not available: voice falls back to partner windows)")
        return
    assert response.status_code == 200, f"unexpected {response.status_code}: {response.text}"
    proposals = response.json()["proposals"]
    windows = request(client, "GET", "/api/context")["partner"]["availability"]
    parse = datetime.fromisoformat
    for slot in proposals:
        assert parse(slot["start"]).tzinfo and parse(slot["end"]) > parse(slot["start"]), slot
        assert any(parse(w["start"]) <= parse(slot["start"]) and parse(slot["end"]) <= parse(w["end"])
                   for w in windows), f"proposal outside partner windows: {slot}"


def run_check(name, check, *args):
    try:
        check(*args)
    except Exception as error:
        print(f"FAIL {name}: {error or type(error).__name__}")
        return False
    print(f"PASS {name}")
    return True


def main():
    results = [run_check("Frozen tool definitions", check_tool_definitions)]
    try:
        # ignore_cleanup_errors: on Windows the SQLite file can still be locked at exit.
        with TemporaryDirectory(prefix="dora-contract-", ignore_cleanup_errors=True) as directory:
            with patch.dict(os.environ, {"DORA_DB_PATH": str(Path(directory) / "contract.sqlite3")}):
                from fastapi.testclient import TestClient
                from backend.main import app

                with TestClient(app) as client:
                    for name, check in [
                        ("Happy path", happy_path),
                        ("Consent missing and empty availability", consent_missing),
                        ("Partner rejects", partner_rejects),
                        ("Duplicate dispatch", duplicate_dispatch),
                        ("Calendar proposal contract", calendar_proposal),
                    ]:
                        results.append(run_check(name, check, client))
    except Exception as error:
        print(f"FAIL TestClient setup or cleanup: {error}")
        return 1
    return int(not all(results))


if __name__ == "__main__":
    raise SystemExit(main())
