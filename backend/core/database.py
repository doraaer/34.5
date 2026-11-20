import os
import sqlite3
import json
from pathlib import Path
from threading import RLock

LOCK = RLock()
VALID_TABLES = {"cases": "case_id", "jobs": "partner_job_id"}

def connection():
    path = os.environ.get("DORA_DB_PATH", "dora.sqlite3")
    db = sqlite3.connect(path, check_same_thread=False)
    db.row_factory = sqlite3.Row
    return db

def initialize():
    with LOCK, connection() as db:
        db.execute("CREATE TABLE IF NOT EXISTS cases (case_id TEXT PRIMARY KEY, body TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS jobs (partner_job_id TEXT PRIMARY KEY, case_id TEXT UNIQUE NOT NULL, body TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS processed_events (event_id TEXT PRIMARY KEY)")

def get(table, key_col, key):
    if VALID_TABLES.get(table) != key_col:
        raise ValueError("unknown table/key")
    with LOCK, connection() as db:
        row = db.execute(f"SELECT body FROM {table} WHERE {key_col}=?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

def all_rows(table):
    if table not in VALID_TABLES:
        raise ValueError("unknown table")
    with LOCK, connection() as db:
        return [json.loads(row[0]) for row in db.execute(f"SELECT body FROM {table} ORDER BY rowid DESC")]

def save(table, key_col, key, obj):
    if VALID_TABLES.get(table) != key_col:
        raise ValueError("unknown table/key")
    with LOCK, connection() as db:
        if table == "jobs":
            db.execute("INSERT INTO jobs (partner_job_id,case_id,body) VALUES (?,?,?) ON CONFLICT(partner_job_id) DO UPDATE SET body=excluded.body",
                       (key, obj["case_id"], json.dumps(obj)))
        else:
            db.execute(f"INSERT INTO {table} ({key_col},body) VALUES (?,?) ON CONFLICT({key_col}) DO UPDATE SET body=excluded.body",
                       (key, json.dumps(obj)))

def event_processed(event_id):
    with LOCK, connection() as db:
        return db.execute("SELECT 1 FROM processed_events WHERE event_id=?", (event_id,)).fetchone() is not None

def record_event(event_id):
    with LOCK, connection() as db:
        db.execute("INSERT OR IGNORE INTO processed_events(event_id) VALUES (?)", (event_id,))

FIXTURES = Path(__file__).resolve().parents[2] / "data" / "fixtures"
def fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf8"))
