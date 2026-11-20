# DORA — Four-person execution plan

## Outcome and priority
**P0 (must):** one working corrective heating repair, voice-driven intake (or text fallback), prefilled property context, consent, partner request, genuine mock partner acceptance, appointment status, provider completion, report, invoice and Centrix closure.
**P1 (after P0):** alternative booking slot, polished timeline, post-call notification, developer-safe failure/retry.
**P2 (only if time):** preventive maintenance due-date trigger, actual telephone integration, SMS/email adapters, live calendar OAuth, multi-provider support.

## Contract freeze (before parallel work)
Agree on one tenant, building, SHK partner, available appointment slots, case/job states, request schemas and API endpoints. Freeze contracts/*. Never independently rename fields. Work in feature branches.

## PERSON 1 — FRONTEND & UX
**Branch:** `feature/frontend`. **Own:** `frontend/**`.
- [ ] F01 Design consistent desktop-first visual identity for DORA; use real HTML/CSS/vanilla JS.
- [ ] F02 Build tenant home with DORA voice section and central-heating property summary.
- [ ] F03 Embed ElevenLabs widget/config provided by PERSON 2; handle unavailable widget gracefully.
- [ ] F04 Show clear status timeline: reported → awaiting_partner → scheduled → in_progress → completed.
- [ ] F05 Provide fallback text intake so demo still works without a microphone/provider outage.
- [ ] F06 Show confirmed time **only** when backend returns scheduled state.
- [ ] F07 Add partner work-order page: job card, accept, start, complete controls; call partner API.
- [ ] F08 Add Centrix case detail: identity, unit, partner, status, completed report/invoice.
- [ ] F09 All pages fetch shared backend instead of mutating local demo states.
- [ ] F10 Add loading/empty/error states, clear feedback on rejected actions, friendly UX copy.
- [ ] F11 Make three-tab jury demonstration understandable in under two minutes.
- [ ] F12 Smoke-test tenant → partner → Centrix page updates and write evidence in PR.
**Acceptance:** real buttons call API; status corresponds to backend; three pages render; no hardcoded fictitious confirmation.

## PERSON 2 — ELEVENLABS / OPENAI DORA VOICE
**Branch:** `feature/voice-agent`. **Own:** `agent/**`.
- [ ] V01 Set up one ElevenLabs conversational agent; document ID (non-secret), configuration, required env vars.
- [ ] V02 Write concise English prompt: empathetic, quick, context-aware; avoid unnecessary data reentry.
- [ ] V03 Define tools to fetch existing tenant context, create case, save availability/consent, dispatch, check status.
- [ ] V04 Match all tool request/response schemas to contracts/api-contract.md, not invented endpoints.
- [ ] V05 Collect affected rooms/radiators and basic urgency; don't diagnose central boiler components.
- [ ] V06 Read **only** information present in seeded centrix context; never hallucinate tenant or owner.
- [ ] V07 Ask consent for calendar or stated availability and preauthorized booking windows.
- [ ] V08 Explicitly distinguish 'request sent' vs 'partner confirmed'. Tell tenant we will update later.
- [ ] V09 Voice tool failures return user-friendly fallback; not a fake success.
- [ ] V10 Test 3 scripted scenarios: happy path, unknown availability, partner not accepted.
- [ ] V11 Integrate voice widget with frontend via shared instructions; PERSON 1 edits UI.
- [ ] V12 Record one natural demo conversation and document tool events.
**Acceptance:** DORA genuinely calls backend tools and does not claim unconfirmed appointment.

## PERSON 3 — BACKEND, SQLITE, n8n, INTEGRATION
**Branch:** `feature/backend-n8n`. **Own:** `backend/core/**`, `backend/routes/**`, `workflows/n8n/**`, `tests/core/**`, `tests/integration/**`.
- [ ] B01 Define Pydantic case, appointment, service report, invoice models against frozen contract.
- [ ] B02 Use single persistent SQLite database; initialize schema and seed mock centrix records.
- [ ] B03 Implement resident context lookup, case create/read, availability and booking authorization.
- [ ] B04 Protect state transition rules: cannot schedule without provider acceptance, cannot complete without report/invoice.
- [ ] B05 Implement dispatch: case → outbound partner work-order contract; prevent duplicate dispatch.
- [ ] B06 Implement n8n workflow for outbound partner request and response path; export tested JSON.
- [ ] B07 Build provider callback / event ingestion with idempotency and status validation.
- [ ] B08 Match tenant calendar windows against provider slots; preserve timezone (`Europe/Berlin`).
- [ ] B09 Implement optional escalation on timeout/rejection, without invented confirmations.
- [ ] B10 Secure agent tool routes, partner callbacks and secrets before any public deployment.
- [ ] B11 Keep invoice as record attached to a completed Centrix case; no payment gateway.
- [ ] B12 Integrate Person 4 APIRouter and Person 1 HTML routes in shared app registration.
- [ ] B13 Write and run happy-path and invalid-transition tests.
- [ ] B14 End-to-end manual test with all three tabs and ElevenLabs tools.
**Acceptance:** persisted `case_id` goes to completed after provider event and invoice/report appears in Centrix. n8n must be genuinely active to claim integration.

## PERSON 4 — MOCK SHK PARTNER & CONNECTOR SPEC
**Branch:** `feature/partner-connector`. **Own:** `backend/partner/**`, `data/fixtures/**`, `docs/connector/**`, `tests/partner/**`.
- [ ] P01 Seed one German building with central gas heating, six units, tenant, owner, contracted SHK partner.
- [ ] P02 Define mock partner service catalogue and plausible available time windows.
- [ ] P03 Implement partner job creation and listing as isolated FastAPI APIRouter.
- [ ] P04 Model partner-owned job status, linked by `case_id`; do not rewrite core case model.
- [ ] P05 Accept/reject job; accepted slot must exist within approved availability.
- [ ] P06 Start work and complete work with realistic short technical report and invoice.
- [ ] P07 Emit signed/verified status events to core endpoint for acceptance/completion (direct method in local fallback permitted).
- [ ] P08 Make callbacks safe to retry; prevent duplicated job/invoice if replayed.
- [ ] P09 Document connector service catalogue, eligibility, availability, create job, accept/update, completion, status/callback, errors.
- [ ] P10 Include example JSON requests/responses and privacy & auth notes.
- [ ] P11 Explicitly label mock SHK and fake data; no invented real partner API claims.
- [ ] P12 Test create → accept → complete and invalid/duplicate transitions.
- [ ] P13 Finish connector spec for hackathon submission, consistent with actual implemented functions.
**Acceptance:** partner can receive and change a job, produce report/invoice, and return event to core; connector specification is standalone.

## Parallelization
- **First 30 min:** freeze schema, fixtures IDs, owner paths; one person commits common scaffold.
- **Hour 1–5:** PERSON 1 designs screens using stub API; PERSON 2 configures agent and tests mocked tools; PERSON 3 builds core state/n8n; PERSON 4 builds mock partner/API. No cross-owner edits.
- **Hour 5–9:** partner + backend connect; frontend shows actual case; voice tools call real routes.
- **Hour 9–15:** end-to-end case closed demo; fix issues and verify state persistence.
- **Hour 15–20:** harden happy path, polish UX and finish connector spec.
- **Final period:** record pitch, freeze code, perform submission checklist; don't build extra systems.

## Merge protocol
1. Main contains frozen scaffold. Person branches start from same base.
2. Only edit owned paths. If an integration fix touches shared files, PERSON 3 coordinates a small separate PR.
3. PR description: task IDs, files, tests, screenshots, API assumptions, known bugs.
4. Run `python -m pytest -q`; review and merge small PRs quickly.
5. No force pushes to main; no secrets committed; rebase/pull main before PR when needed.

## Judge demo check
- [ ] Resident actually contacts DORA through voice.
- [ ] The system saves a heating maintenance case and correct property context.
- [ ] The partner receives job request with appropriate consent-minimized data.
- [ ] Partner approves a concrete tenant-authorized appointment.
- [ ] Tenant sees a confirmed time only after acceptance.
- [ ] Partner marks actual service completed.
- [ ] Centrix case has report, invoice and completed state.
- [ ] Generic partner connector spec delivered.
- [ ] Realistic assumptions and mock limitations explained.
