# Mock centrix data (fictional)

There is no reltix dataset or API, so these files stand in for centrix. They follow the shape of the
property snapshot in the reltix brief (property, unit, owner, tenant, contracts). All names, numbers
and addresses are made up.

| File | Holds |
|---|---|
| `building.json` | Property: address, building year, heating system, energy certificate, units (floor, size, rooms, meters, access notes), owner (Thomas Weber, fictional), contracted heating partner |
| `tenants.json` | Tenant: name, unit, contact details, move-in date, lease |
| `partner.json` | The contracted SHK (heating) partner and its working windows |

## What we assumed
- **One building, one contracted heating partner.** The property manager has a framework contract with
  one SHK company for the building, so no partner selection or price comparison is needed for a standard repair.
- **Central gas heating** serves all six units; the boiler is in the basement. A "cold radiators" report
  in one flat is handled as a repair visit to that flat; the technician diagnoses on site.
- **Standard repair is pre-authorized** by the property manager. Larger work or costs would escalate to the
  manager/owner in a real setup (out of scope for the demo).
- **What the property manager realistically knows:** address, unit position, size, meters, tenant contact,
  move-in date, lease terms, heating system and its service partner. Tenant availability is NOT known in
  advance; it comes from the conversation or the tenant's (simulated) calendar.
- **Data shared with the partner (minimum needed):** address + unit, issue description, priority and the
  tenant-authorized time windows. Not shared: phone/email (unless needed and consented), lease, rent, owner
  data, other tenants' data. Consent is recorded on the case (`data_sharing_consent`, `booking_authorized`).
- **Invoices go to the property owner**, linked to the case; no payment processing.
