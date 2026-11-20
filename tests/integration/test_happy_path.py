SLOT={"start":"2026-11-23T14:00:00+01:00","end":"2026-11-23T17:00:00+01:00"}
def prepare(client):
    case=client.post("/api/cases",json={"description":"My radiators are cold"}).json()
    case_id=case["case_id"]
    a=client.post("/api/cases/"+case_id+"/availability",json={"available_slots":[SLOT],"booking_authorized":True,"data_sharing_consent":True})
    assert a.status_code==200
    d=client.post("/api/cases/"+case_id+"/dispatch").json()
    assert d["status"]=="awaiting_partner"
    assert client.post("/api/cases/"+case_id+"/dispatch").json()["partner_job_id"]==d["partner_job_id"]
    return case_id,d["partner_job_id"]

def test_complete_end_to_end(client):
    case_id,job_id=prepare(client)
    response=client.post("/partner/jobs/"+job_id+"/accept",json={"slot":SLOT})
    assert response.status_code==200,response.text
    assert client.get("/api/cases/"+case_id).json()["status"]=="scheduled"
    assert client.post("/partner/jobs/"+job_id+"/start").status_code==200
    body={"service_report":{"summary":"Heating restored","work_done":"SHK technician fixed heating issue"},"invoice":{"invoice_id":"INV-001","amount_eur":180.0,"currency":"EUR","recipient":"property_owner"}}
    assert client.post("/partner/jobs/"+job_id+"/complete",json=body).status_code==200
    assert client.post("/partner/jobs/"+job_id+"/complete",json=body).status_code==200
    case=client.get("/api/cases/"+case_id).json()
    assert case["status"]=="completed" and case["invoice"]["invoice_id"]=="INV-001"
    assert case["unit_id"]=="UNIT-102" and case["service_report"]["summary"]=="Heating restored"

def test_wrong_slot_is_rejected(client):
    case_id,job_id=prepare(client)
    invalid={"start":"2026-11-26T14:00:00+01:00","end":"2026-11-26T16:00:00+01:00"}
    assert client.post("/partner/jobs/"+job_id+"/accept",json={"slot":invalid}).status_code==409
    assert client.get("/api/cases/"+case_id).json()["status"]=="awaiting_partner"
