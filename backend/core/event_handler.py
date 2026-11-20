from uuid import uuid4
from backend.core import database as db
from backend.core.services import event_update

def emit_partner_event(case_id, partner_job_id, event_type, payload, event_id=None):
    # Local in-process bridge ONLY; Person 3 should replace with authenticated
    # idempotent callback handling when connecting a deployed partner or n8n.
    eid = event_id or str(uuid4())
    result = event_update(case_id, partner_job_id, event_type, payload)
    db.event_seen(eid)
    return result
