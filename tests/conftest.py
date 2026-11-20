import pytest
from fastapi.testclient import TestClient
from backend.main import app

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setenv("DORA_DB_PATH",str(tmp_path/"test.sqlite3"))
    with TestClient(app) as c:
        yield c
