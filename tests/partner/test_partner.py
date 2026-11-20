def test_partner_services_and_empty_jobs(client):
    assert client.get("/partner/services").json()[0]["service_type"]=="heating_repair"
    assert client.get("/partner/jobs").json()==[]


OFFERED = {"start": "2026-11-23T14:00:00+01:00", "end": "2026-11-23T17:00:00+01:00"}
OUTSIDE_OFFER = {"start": "2026-11-23T17:00:00+01:00", "end": "2026-11-23T18:00:00+01:00"}
COMPLETION = {
    "service_report": {"summary": "Heating restored", "work_done": "Repaired radiator valve"},
    "invoice": {
        "invoice_id": "INV-001",
        "amount_eur": 125.0,
        "currency": "EUR",
        "recipient": "property_owner",
    },
}


def dispatch_job(client, window=OFFERED):
    response = client.post("/api/cases", json={"description": "Cold radiators"})
    assert response.status_code == 200
    case_id = response.json()["case_id"]
    case_url = f"/api/cases/{case_id}"
    response = client.post(
        f"{case_url}/availability",
        json={
            "available_slots": [window],
            "booking_authorized": True,
            "data_sharing_consent": True,
        },
    )
    assert response.status_code == 200
    response = client.post(f"{case_url}/dispatch")
    assert response.status_code == 200
    return case_url, f"/partner/jobs/{response.json()['partner_job_id']}"


def test_acceptance_rejects_tenant_authorized_slot_outside_provider_windows(client):
    case_url, job_url = dispatch_job(client, OUTSIDE_OFFER)
    response = client.post(f"{job_url}/accept", json={"slot": OUTSIDE_OFFER})
    assert response.status_code == 409
    assert response.json()["detail"] == "slot outside provider availability"
    assert client.get("/partner/jobs").json()[0]["status"] == "received"
    assert client.get(case_url).json()["status"] == "awaiting_partner"


def test_invalid_partner_transitions_return_conflict(client):
    _, job_url = dispatch_job(client)
    assert client.post(f"{job_url}/start").status_code == 409
    assert client.post(f"{job_url}/complete", json=COMPLETION).status_code == 409
    slot = {"start": "2026-11-23T15:00:00+01:00", "end": "2026-11-23T16:00:00+01:00"}
    assert client.post(f"{job_url}/accept", json={"slot": slot}).status_code == 200
    assert client.post(f"{job_url}/accept", json={"slot": slot}).status_code == 409
    assert client.post(f"{job_url}/complete", json=COMPLETION).status_code == 409


def test_create_job_retry_returns_original_job(client):
    payload = {
        "case_id": "CASE-001",
        "service_type": "heating_repair",
        "description": "Cold radiators",
        "location": "Musterstrasse 12, Unit 102",
        "available_slots": [OFFERED],
    }
    original = client.post("/partner/jobs", json=payload)
    repeated = client.post("/partner/jobs", json=payload)
    assert original.status_code == repeated.status_code == 200
    assert repeated.json() == original.json()
    assert client.get("/partner/jobs").json() == [original.json()]


def test_completion_retry_preserves_original_invoice(client):
    case_url, job_url = dispatch_job(client)
    assert client.post(f"{job_url}/accept", json={"slot": OFFERED}).status_code == 200
    assert client.post(f"{job_url}/start").status_code == 200
    original = client.post(f"{job_url}/complete", json=COMPLETION)
    assert original.status_code == 200
    retry = {**COMPLETION, "invoice": {**COMPLETION["invoice"], "invoice_id": "INV-002"}}
    repeated = client.post(f"{job_url}/complete", json=retry)
    assert repeated.status_code == 200
    assert repeated.json() == original.json()
    assert client.get("/partner/jobs").json() == [original.json()]
    case = client.get(case_url).json()
    assert case["status"] == "completed"
    assert case["invoice"] == COMPLETION["invoice"]


def test_rejection_requires_reason_and_preserves_it_on_job(client):
    case_url, job_url = dispatch_job(client)
    reject_url = f"{job_url}/reject"
    assert client.post(reject_url, json={"reason": "  "}).status_code == 422
    assert client.get(case_url).json()["status"] == "awaiting_partner"

    reason = "Technician unavailable"
    response = client.post(reject_url, json={"reason": reason})
    assert response.status_code == 200
    job, = client.get("/partner/jobs").json()
    assert job["status"] == "rejected"
    assert job["rejection_reason"] == reason
    case = client.get(case_url).json()
    assert case["status"] == "needs_attention"
    assert case["appointment"] is None
    assert client.post(f"{job_url}/accept", json={"slot": OFFERED}).status_code == 409


def test_single_technician_reserves_only_the_accepted_interval(client):
    initial_windows = client.get("/partner/availability").json()
    _, first_job = dispatch_job(client)
    second_case, second_job = dispatch_job(client)
    booked = {"start": "2026-11-23T15:00:00+01:00", "end": "2026-11-23T16:00:00+01:00"}
    before = {"start": OFFERED["start"], "end": booked["start"]}
    after = {"start": booked["end"], "end": OFFERED["end"]}
    assert client.get("/partner/availability").json() == initial_windows
    assert client.post(f"{first_job}/accept", json={"slot": booked}).status_code == 200
    overlap = {"start": "2026-11-23T15:30:00+01:00", "end": OFFERED["end"]}
    assert client.post(f"{second_job}/accept", json={"slot": overlap}).status_code == 409
    assert client.get(second_case).json()["status"] == "awaiting_partner"
    assert client.get("/partner/availability").json() == [before, after, *initial_windows[1:]]
    assert client.post(f"{second_job}/accept", json={"slot": after}).status_code == 200
    assert client.get("/partner/availability").json() == [before, *initial_windows[1:]]
