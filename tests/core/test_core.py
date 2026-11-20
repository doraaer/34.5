def test_health_and_context(client):
    assert client.get("/health").json()["status"]=="ok"
    c=client.get("/api/tenant/context").json()
    assert c["building"]["heating_type"]=="gas central heating"
    assert c["tenant"]["unit_id"]=="UNIT-102"

def test_consent_required(client):
    c=client.post("/api/cases",json={"description":"Heating not working"}).json()
    r=client.post("/api/cases/"+c["case_id"]+"/dispatch")
    assert r.status_code==409
