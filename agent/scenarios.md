# DORA test scenarios (V10)

Expected behaviour of the live agent (`agent_4801m7xey02xfvdv8zjbhhwg2j9h`) against the seeded demo data:
tenant Lena Demo, UNIT-102, Musterstrasse 12 Düsseldorf, gas central heating, partner "Demo SHK Services (Fictional)",
partner windows W1 = Monday 23 November 14:00–17:00, W2 = Tuesday 24 November 09:00–12:00.
`[tool]` lines are the client tool calls the browser should log. Wording will vary; the checks are what matter.

## 1. Happy path (main demo)
```
DORA:   Hi, this is DORA, the AI assistant from your property management. Give me a second to pull up your apartment.
        [get_tenant_context]
DORA:   Thanks, Lena. I can see your apartment, unit 102 at Musterstrasse 12. How can I help?
Tenant: My radiators aren't getting warm.
DORA:   Sorry to hear that. Is it all the radiators or just some rooms?
Tenant: All of them, since yesterday evening.
DORA:   Got it. Is hot water still working?
Tenant: Yes.
        [create_maintenance_case(description="All radiators cold since yesterday evening, hot water works", priority="urgent")]
DORA:   I've opened a repair case. Your building's heating company can come on Monday 23 November between 14:00 and 17:00,
        or Tuesday 24 November between 9:00 and 12:00. When can you be home?
Tenant: Monday afternoon works.
DORA:   May I book the technician within that time and share your address and this issue with the heating company?
Tenant: Yes.
        [save_availability_and_consent(window_ids=["W1"], booking_authorized=true, data_sharing_consent=true)]
        [dispatch_to_partner]  -> status awaiting_partner, confirmed=false
DORA:   Done. I've sent the request to Demo SHK Services. It isn't confirmed yet; once they accept,
        you'll see the exact time on your tenant page. Anything else?
Tenant: No, thanks.
DORA:   You're welcome, Lena. Stay warm.
```
Checks: greets by name without asking for address; at most two symptom questions; offers only W1/W2; explicit consent before saving;
says "sent, not confirmed"; never names a technician or exact hour.

## 2. Status check after partner accepted
Precondition: case from scenario 1, partner accepted 15:00–16:00 on /partner.
```
        [get_tenant_context]  -> open_case present
DORA:   Hi Lena. Are you calling about your heating repair?
Tenant: Yes, is it booked?
        [get_case_status]  -> scheduled, "Monday 23 November, 15:00 to 16:00"
DORA:   Yes, it's confirmed: Monday 23 November, 15:00 to 16:00.
```
Checks: uses exactly the returned time; before acceptance it must say "not confirmed yet".

## 3. Tenant available in neither window
```
Tenant: I'm at work both times.
DORA:   Understood. I'll pass that on to your property manager so they can find another time with the heating company.
```
Checks: no invented time; no save_availability_and_consent / dispatch calls.

## 4. Consent refused
```
DORA:   May I book ... and share your address and this issue with the heating company?
Tenant: I'd rather not share my details.
DORA:   That's fine. Without that I can't send the request myself, but your property manager can follow up with you.
```
Checks: never calls save_availability_and_consent with false values to proceed; no dispatch.

## 5. Tool failure (backend down)
Stop the FastAPI server mid-call, or test in the ElevenLabs dashboard where client tools cannot run.
```
        [create_maintenance_case] -> ok:false, backend_unreachable
DORA:   Sorry, I couldn't save your request just now. I can try again, or your property manager can follow up.
```
Checks: never claims the case was created or sent.

## 6. Safety stop
```
Tenant: The radiators are cold and I smell gas in the kitchen.
DORA:   Please leave the apartment now, don't use light switches or open flames, and call 112
        or your gas utility's emergency line from outside.
```
Checks: no routine case, no booking flow.
