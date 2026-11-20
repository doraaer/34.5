"""Google Calendar FreeBusy adapter (read-only, busy blocks only).

Calls POST https://www.googleapis.com/calendar/v3/freeBusy with an OAuth access token.
Required OAuth scope: https://www.googleapis.com/auth/calendar.freebusy (nothing broader).
Obtaining/refreshing the token is out of scope here; see the PR description.
The response only contains busy start/end pairs, never event titles or attendees.
"""
from __future__ import annotations

from datetime import datetime

import httpx

from backend.core.calendar_adapter import CalendarNotConnected, CalendarProviderError
from backend.core.scheduling import BERLIN, Interval, SchedulingError, merge_intervals, to_interval

FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy"
SCOPE = "https://www.googleapis.com/auth/calendar.freebusy"


class GoogleFreeBusySource:
    source = "google_calendar"

    def __init__(self, access_token: str, calendar_id: str = "primary", *,
                 transport: httpx.BaseTransport | None = None, timeout: float = 10.0):
        self._token = access_token
        self._calendar_id = calendar_id
        self._transport = transport
        self._timeout = timeout

    def busy_intervals(self, time_min: datetime, time_max: datetime) -> list[Interval]:
        body = {"timeMin": time_min.isoformat(), "timeMax": time_max.isoformat(),
                "timeZone": "Europe/Berlin", "items": [{"id": self._calendar_id}]}
        try:
            with httpx.Client(transport=self._transport, timeout=self._timeout) as client:
                resp = client.post(FREEBUSY_URL, json=body,
                                   headers={"Authorization": f"Bearer {self._token}"})
        except httpx.HTTPError as exc:
            raise CalendarProviderError(f"freeBusy request failed: {type(exc).__name__}") from exc
        if resp.status_code == 401:
            # Expired or revoked token: treat as "not connected" so DORA falls back.
            raise CalendarNotConnected("calendar not connected")
        if resp.status_code != 200:
            raise CalendarProviderError(f"freeBusy returned HTTP {resp.status_code}")
        try:
            cal = resp.json()["calendars"][self._calendar_id]
        except (ValueError, KeyError, TypeError) as exc:
            raise CalendarProviderError("freeBusy response missing calendar") from exc
        if cal.get("errors"):
            reasons = ",".join(str(e.get("reason")) for e in cal["errors"])
            raise CalendarProviderError(f"freeBusy calendar error: {reasons}")
        try:
            busy = [to_interval(b) for b in cal.get("busy", [])]
        except SchedulingError as exc:
            raise CalendarProviderError(f"freeBusy returned bad interval: {exc}") from exc
        return [Interval(b.start.astimezone(BERLIN), b.end.astimezone(BERLIN))
                for b in merge_intervals(busy)]
