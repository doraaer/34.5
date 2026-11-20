def test_partner_services_and_empty_jobs(client):
    assert client.get("/partner/services").json()[0]["service_type"]=="heating_repair"
    assert client.get("/partner/jobs").json()==[]
