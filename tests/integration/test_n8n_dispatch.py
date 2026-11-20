import httpx
from backend.core import services

SLOT = {"start": "2026-11-23T14:00:00+01:00", "end": "2026-11-23T17:00:00+01:00"}

def ready_case(client):
    cid = client.post("/api/cases", json={"description": "Radiators cold"}).json()["case_id"]
    client.post(f"/api/cases/{cid}/availability", json={"available_slots": [SLOT], "booking_authorized": True, "data_sharing_consent": True})
    return cid

class FakeResponse:
    def __init__(self, body=None, status=200):
        self.body, self.status = body, status
    def raise_for_status(self):
        if self.status >= 400:
            raise httpx.HTTPStatusError("bad", request=None, response=None)
    def json(self):
        if self.body is None:
            raise ValueError("not json")
        return self.body

def test_dispatch_goes_through_n8n_with_token(client, monkeypatch):
    monkeypatch.setenv("N8N_WEBHOOK_URL", "http://n8n.test/webhook/dora-dispatch")
    monkeypatch.setenv("DORA_INTERNAL_TOKEN", "tok")
    seen = {}
    def fake_post(url, json, headers, timeout):
        seen.update(url=url, body=json, headers=headers)
        # stand in for n8n: create the job at the partner like the workflow would
        r = client.post("/partner/jobs", json={k: v for k, v in json.items() if k != "idempotency_key"})
        return FakeResponse(r.json())
    monkeypatch.setattr(services.httpx, "post", fake_post)
    cid = ready_case(client)
    case = client.post(f"/api/cases/{cid}/dispatch").json()
    assert case["status"] == "awaiting_partner" and case["partner_job_id"]
    assert seen["url"].endswith("/webhook/dora-dispatch") and seen["headers"]["X-DORA-Token"] == "tok"
    assert seen["body"]["idempotency_key"] == f"{cid}:dispatch:v1"
    assert client.post(f"/api/cases/{cid}/dispatch").json()["partner_job_id"] == case["partner_job_id"]

def test_n8n_failure_is_502_and_case_stays_retryable(client, monkeypatch):
    monkeypatch.setenv("N8N_WEBHOOK_URL", "http://n8n.test/webhook/dora-dispatch")
    monkeypatch.setattr(services.httpx, "post", lambda *a, **k: FakeResponse({"error": "x"}, 502))
    cid = ready_case(client)
    assert client.post(f"/api/cases/{cid}/dispatch").status_code == 502
    case = client.get(f"/api/cases/{cid}").json()
    assert case["status"] == "reported" and case["partner_job_id"] is None
    assert client.get("/partner/jobs").json() == []

def test_n8n_unreachable_or_bad_reply_is_502(client, monkeypatch):
    monkeypatch.setenv("N8N_WEBHOOK_URL", "http://n8n.test/webhook/dora-dispatch")
    cid = ready_case(client)
    def down(*a, **k):
        raise httpx.ConnectError("down")
    monkeypatch.setattr(services.httpx, "post", down)
    assert client.post(f"/api/cases/{cid}/dispatch").status_code == 502
    monkeypatch.setattr(services.httpx, "post", lambda *a, **k: FakeResponse({"partner_job_id": "JOB-X", "case_id": "OTHER"}))
    assert client.post(f"/api/cases/{cid}/dispatch").status_code == 502
    assert client.get(f"/api/cases/{cid}").json()["status"] == "reported"
