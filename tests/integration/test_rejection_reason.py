"""When the provider rejects, the case keeps the reason so tenant page, Centrix and DORA can explain it."""

SLOT = {"start": "2026-11-23T14:00:00+01:00", "end": "2026-11-23T17:00:00+01:00"}


def test_rejection_reason_is_stored_on_the_case(client):
    cid = client.post("/api/cases", json={"description": "Bedroom radiator cold"}).json()["case_id"]
    client.post(f"/api/cases/{cid}/availability", json={
        "available_slots": [SLOT], "booking_authorized": True, "data_sharing_consent": True})
    job_id = client.post(f"/api/cases/{cid}/dispatch").json()["partner_job_id"]
    client.post(f"/partner/jobs/{job_id}/reject", json={"reason": "No technician available that morning"})
    case = client.get(f"/api/cases/{cid}").json()
    assert case["status"] == "needs_attention"
    assert case["rejection_reason"] == "No technician available that morning"
