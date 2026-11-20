SLOT = {"start": "2026-11-23T14:00:00+01:00", "end": "2026-11-23T17:00:00+01:00"}
H = {"X-DORA-Token": "test-token"}

def dispatched(client):
    cid = client.post("/api/cases", json={"description": "Radiators cold"}).json()["case_id"]
    client.post(f"/api/cases/{cid}/availability", json={"available_slots": [SLOT], "booking_authorized": True, "data_sharing_consent": True})
    return cid, client.post(f"/api/cases/{cid}/dispatch").json()["partner_job_id"]

def event(cid, jid, **kw):
    return {"type": "partner.accepted", "case_id": cid, "partner_job_id": jid, "payload": {"slot": SLOT}, **kw}

def test_missing_or_wrong_token_is_403(client, monkeypatch):
    monkeypatch.setenv("DORA_INTERNAL_TOKEN", "test-token")
    cid, jid = dispatched(client)
    assert client.post("/internal/partner-events", json=event(cid, jid)).status_code == 403
    assert client.post("/internal/partner-events", json=event(cid, jid), headers={"X-DORA-Token": "nope"}).status_code == 403
    assert client.get(f"/api/cases/{cid}").json()["status"] == "awaiting_partner"

def test_unconfigured_token_fails_closed(client, monkeypatch):
    monkeypatch.delenv("DORA_INTERNAL_TOKEN", raising=False)
    cid, jid = dispatched(client)
    assert client.post("/internal/partner-events", json=event(cid, jid), headers=H).status_code == 403

def test_accept_and_replay_are_idempotent(client, monkeypatch):
    monkeypatch.setenv("DORA_INTERNAL_TOKEN", "test-token")
    cid, jid = dispatched(client)
    for _ in range(2):
        r = client.post("/internal/partner-events", json=event(cid, jid, event_id="EV-A"), headers=H)
        assert r.status_code == 200 and r.json()["status"] == "scheduled"

def test_invalid_transition_is_409_and_unknown_case_404(client, monkeypatch):
    monkeypatch.setenv("DORA_INTERNAL_TOKEN", "test-token")
    cid, jid = dispatched(client)
    started = {"type": "partner.started", "case_id": cid, "partner_job_id": jid}
    assert client.post("/internal/partner-events", json=started, headers=H).status_code == 409
    assert client.post("/internal/partner-events", json=event("CASE-NOPE", jid), headers=H).status_code == 404

def test_malformed_payload_is_400_not_500(client, monkeypatch):
    monkeypatch.setenv("DORA_INTERNAL_TOKEN", "test-token")
    cid, jid = dispatched(client)
    base = {"type": "partner.accepted", "case_id": cid, "partner_job_id": jid}
    assert client.post("/internal/partner-events", json={**base, "payload": {}}, headers=H).status_code == 400
    assert client.post("/internal/partner-events", json={**base, "payload": {"slot": {"start": "x"}}}, headers=H).status_code == 400
    assert client.get(f"/api/cases/{cid}").json()["status"] == "awaiting_partner"

def test_slot_without_timezone_is_400(client, monkeypatch):
    monkeypatch.setenv("DORA_INTERNAL_TOKEN", "test-token")
    cid, jid = dispatched(client)
    body = {"type": "partner.accepted", "case_id": cid, "partner_job_id": jid,
            "payload": {"slot": {"start": "2026-11-23T15:00:00", "end": "2026-11-23T16:00:00"}}}
    assert client.post("/internal/partner-events", json=body, headers=H).status_code == 400
