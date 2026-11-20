from backend.core import database as db
from backend.core.services import event_update, require_case

def emit_partner_event(case_id, partner_job_id, event_type, payload, event_id=None):
    """Apply a partner event to the case exactly once.

    Local in-process bridge; the same function should back the authenticated
    HTTP callback. The event is recorded only AFTER it applied successfully, so
    a rejected event (409/400) can be retried, while a replay of an applied
    event returns the current case without changing anything.
    """
    eid = event_id or f"{partner_job_id}:{event_type}"
    with db.LOCK:
        if db.event_processed(eid):
            return require_case(case_id)
        result = event_update(case_id, partner_job_id, event_type, payload)
        db.record_event(eid)
        return result
