"""Urgent cases keep their priority all the way to the partner job."""
from backend.core import services
from tests.integration.test_n8n_dispatch import FakeResponse

SLOT = {"start": "2026-11-23T14:00:00+01:00", "end": "2026-11-23T17:00:00+01:00"}


def dispatched_job(client, priority=None):
    body = {"description": "Whole flat cold, newborn at home"}
    if priority:
        body["priority"] = priority
    case = client.post("/api/cases", json=body).json()
    cid = case["case_id"]
    client.post(f"/api/cases/{cid}/availability", json={
        "available_slots": [SLOT], "booking_authorized": True, "data_sharing_consent": True})
    job_id = client.post(f"/api/cases/{cid}/dispatch").json()["partner_job_id"]
    job = next(j for j in client.get("/partner/jobs").json() if j["partner_job_id"] == job_id)
    return case, job


def test_urgent_case_reaches_partner_as_urgent(client):
    case, job = dispatched_job(client, "urgent")
    assert case["priority"] == "urgent"
    assert job["priority"] == "urgent"


def test_routine_is_the_default_everywhere(client):
    case, job = dispatched_job(client)
    assert case["priority"] == "routine"
    assert job["priority"] == "routine"


def test_partner_api_defaults_to_routine_for_old_clients(client):
    job = client.post("/partner/jobs", json={
        "case_id": "CASE-OLDCLIENT", "service_type": "heating_repair",
        "description": "Cold radiators", "location": "Musterstrasse 12, UNIT-102",
        "available_slots": [SLOT]}).json()
    assert job["priority"] == "routine"


def test_partner_api_rejects_unknown_priority(client):
    response = client.post("/partner/jobs", json={
        "case_id": "CASE-BADPRIO", "service_type": "heating_repair",
        "description": "Cold radiators", "location": "Musterstrasse 12, UNIT-102",
        "available_slots": [SLOT], "priority": "asap"})
    assert response.status_code == 422


def test_priority_is_sent_through_n8n(client, monkeypatch):
    monkeypatch.setenv("N8N_WEBHOOK_URL", "http://n8n.test/webhook/dora-dispatch")
    seen = {}

    def fake_post(url, json, headers, timeout):
        seen["body"] = json
        r = client.post("/partner/jobs", json={k: v for k, v in json.items() if k != "idempotency_key"})
        return FakeResponse(r.json())

    monkeypatch.setattr(services.httpx, "post", fake_post)
    _, job = dispatched_job(client, "urgent")
    assert seen["body"]["priority"] == "urgent"
    assert job["priority"] == "urgent"
