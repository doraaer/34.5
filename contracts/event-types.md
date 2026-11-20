# Case and partner event types

Events: `case.created`, `booking.authorized`, `partner.requested`, `partner.accepted`, `appointment.confirmed`, `partner.started`, `partner.completed`, `partner.rejected`, `case.closed`, `case.needs_attention`.

Core status: `reported` → `awaiting_partner` → `scheduled` → `in_progress` → `completed`. Exceptional: `needs_attention`.

Partner events use the stable ID `<partner_job_id>:<event_type>`, for example `JOB-AB12CD34:partner.completed`. The local publisher derives this ID. The planned HTTP callback envelope should include `event_id`, `occurred_at`, `case_id`, `partner_job_id` (if relevant), `type`, `payload`. Use event_id to deduplicate. Partner receipt is NOT partner acceptance; only explicit accepted appointment is confirmed.
