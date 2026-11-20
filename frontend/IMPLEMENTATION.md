# Person 1 frontend — functional foundation

Based on main dd10963, implemented on feature/frontend. Provider HTML/JS, existing style.css/common.js, backend and contracts remain unchanged.

## Implemented
- F02/F05: resident context, validated text intake and priority, real case creation.
- F04/F06/F09: backend-driven progress, provider-confirmed appointment only, persistent case selection and saved-request recovery.
- F08: selected Centrix case with resident/property/provider, report and invoice.
- F10: pending controls, separate booking/data-sharing consent, API errors, retained last-known information, retry and empty states.
- F01 foundation: responsive accessible layout with scoped, separate experience.css.
- F11/F12: same case across resident/provider/Centrix; real-browser smoke coverage.

The provider's offered windows are fetched from GET /partner/availability. Selecting a window authorizes availability, not a confirmed appointment or an algorithmic one-hour proposal. No calendar permission or matching is simulated. Voice is explicitly unavailable, with a working text form and the existing ElevenLabs mount point retained.

## Files
Modified: templates/tenant.html, templates/centrix.html, static/js/tenant.js, static/js/centrix.js.
Added: static/css/experience.css, static/js/experience.js, tests/smoke.cjs, this document.

experience.js owns presentation, fetch timeout/error handling, date formatting and polling only. Backend remains authoritative. No local case state transitions or fake success responses. Provider continues using its existing shared assets.

## Validation
- Python 3.11, installed repository requirements: python -m pytest -q → 15 passed.
- node --check for all three changed/new JS modules.
- Real Chrome/Playwright against FastAPI: create → consent → dispatch → provider dashboard accept → start → complete → Centrix report/invoice.
- Reload recovery, awaiting-partner confirmation guard, provider rejection, network failure preserving the record, recovery, 390px mobile width, JavaScript errors.
- Desktop/mobile screenshots inspected.

Run backend with python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000.
Run node frontend/tests/smoke.cjs with Playwright installed. Optional environment variables: DORA_PLAYWRIGHT_PATH (existing package path), DORA_CHROME_PATH (Chrome executable), DORA_BASE_URL, DORA_SCREENSHOT_DIR. Tests create fictional records in the chosen demo database. Use a separate DORA_DB_PATH for repeatable QA.

## Remaining team integration
Person 2: agent ID/configuration, widget versus SDK, connection/transcript events and conversation-to-case mapping. F03 is not complete.
Person 3: calendar connection and proposal/approval contract, one-hour matching, proposal expiry/conflict behavior, case rejection reason, voice-created-case selection. Existing schema describes strings where runtime uses objects (availability, appointment, report); context has no separate unit object.
Person 4: provider dashboard ownership confirmation in shared docs; actual one-hour slot selection and shared design coordination. F07 is not implemented by Person 1.
Current local provider flow is real code with fictional data; external Centrix, Google Calendar, ElevenLabs and n8n are not claimed connected.

## Known limits
No text-chat agent: text fallback is a case form. No transcript exists without a live voice session. No PDF invoice download without a file URL. Mock backend serves a seeded resident and has no production tenant authentication. Current provider dashboard accepts the full selected window; frontend does not relabel it as a one-hour booking. Final visual identity remains open for the user's direction.
