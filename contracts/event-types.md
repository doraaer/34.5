# Case and partner event types

Events: `case.created`, `booking.authorized`, `partner.requested`, `partner.accepted`, `appointment.confirmed`, `job.started`, `job.completed`, `case.closed`, `case.needs_attention`.

Core status: `reported` → `awaiting_partner` → `scheduled` → `in_progress` → `completed`. Exceptional: `needs_attention`.

Each event should include `event_id`, `occurred_at`, `case_id`, `partner_job_id` (if relevant), `type`, `payload`. Use event_id to deduplicate. Partner receipt is NOT partner acceptance; only explicit accepted appointment is confirmed.
