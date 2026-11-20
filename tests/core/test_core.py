def test_health_and_context(client):
    assert client.get("/health").json()["status"]=="ok"
    c=client.get("/api/tenant/context").json()
    assert c["building"]["heating_type"]=="gas central heating"
    assert c["tenant"]["unit_id"]=="UNIT-102"

def test_consent_required(client):
    c=client.post("/api/cases",json={"description":"Heating not working"}).json()
    r=client.post("/api/cases/"+c["case_id"]+"/dispatch")
    assert r.status_code==409

from backend.core.event_handler import emit_partner_event

SLOT = {"start": "2026-11-23T14:00:00+01:00", "end": "2026-11-23T17:00:00+01:00"}

def _dispatched(client):
    c = client.post("/api/cases", json={"description": "Heating not working"}).json()
    cid = c["case_id"]
    client.post(f"/api/cases/{cid}/availability", json={"available_slots": [SLOT], "booking_authorized": True, "data_sharing_consent": True})
    return cid, client.post(f"/api/cases/{cid}/dispatch").json()["partner_job_id"]

def test_replayed_event_is_ignored(client):
    cid, jid = _dispatched(client)
    first = emit_partner_event(cid, jid, "partner.accepted", {"slot": SLOT}, event_id="EV-1")
    again = emit_partner_event(cid, jid, "partner.accepted", {"slot": SLOT}, event_id="EV-1")
    assert first["status"] == again["status"] == "scheduled"

def test_failed_event_is_not_recorded(client):
    import pytest
    from fastapi import HTTPException
    cid, jid = _dispatched(client)
    bad = {"start": "2026-11-30T10:00:00+01:00", "end": "2026-11-30T11:00:00+01:00"}
    with pytest.raises(HTTPException):
        emit_partner_event(cid, jid, "partner.accepted", {"slot": bad}, event_id="EV-2")
    assert emit_partner_event(cid, jid, "partner.accepted", {"slot": SLOT}, event_id="EV-2")["status"] == "scheduled"
