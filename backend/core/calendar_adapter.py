"""Tenant busy-time adapters.

`BusyTimeSource` is the only thing the proposal logic depends on. Two implementations:
- `FakeBusyTimeSource`: busy intervals from a JSON fixture or from spoken availability.
  This is the demo fallback and uses only made-up data.
- `GoogleFreeBusySource` (backend/core/google_calendar.py): Google Calendar FreeBusy.

Selection (`source_from_env`), read at request time:
- DORA_CALENDAR_PROVIDER=google -> Google FreeBusy, needs DORA_GOOGLE_CALENDAR_ACCESS_TOKEN
- DORA_CALENDAR_PROVIDER=fake   -> fixture from DORA_FAKE_CALENDAR_FILE
- unset / anything else        -> CalendarNotConnected (route answers 409)
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Iterable, Protocol

from backend.core.scheduling import Interval, merge_intervals, to_interval


class CalendarNotConnected(Exception):
    """No calendar is configured for the tenant."""


class CalendarProviderError(Exception):
    """The calendar provider failed or returned something unusable."""


class BusyTimeSource(Protocol):
    source: str

    def busy_intervals(self, time_min: datetime, time_max: datetime) -> list[Interval]:
        """Busy intervals overlapping [time_min, time_max). Never titles or attendees."""
        ...


class FakeBusyTimeSource:
    def __init__(self, busy: Iterable, source: str = "fake_calendar"):
        self._busy = merge_intervals(to_interval(b) for b in busy)
        self.source = source

    def busy_intervals(self, time_min: datetime, time_max: datetime) -> list[Interval]:
        return [b for b in self._busy if b.start < time_max and b.end > time_min]

    @classmethod
    def from_fixture(cls, path) -> "FakeBusyTimeSource":
        """JSON file: {"busy": [{"start": "...+01:00", "end": "...+01:00"}, ...]}."""
        try:
            data = json.loads(Path(path).read_text(encoding="utf8"))
            return cls(data["busy"], source="fake_calendar")
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise CalendarProviderError(f"cannot read fake calendar fixture: {exc}") from exc

    @classmethod
    def from_spoken_availability(cls, free_windows: Iterable, time_min: datetime,
                                 time_max: datetime) -> "FakeBusyTimeSource":
        """Tenant said when they are free ("Monday 15 to 17"); everything else in
        [time_min, time_max) counts as busy."""
        free = merge_intervals(to_interval(f) for f in free_windows)
        busy, cursor = [], time_min
        for f in free:
            if f.start > cursor:
                busy.append(Interval(cursor, min(f.start, time_max)))
            cursor = max(cursor, f.end)
            if cursor >= time_max:
                break
        if cursor < time_max:
            busy.append(Interval(cursor, time_max))
        return cls(busy, source="spoken_availability")


def source_from_env() -> BusyTimeSource:
    provider = os.environ.get("DORA_CALENDAR_PROVIDER", "").strip().lower()
    if provider == "google":
        from backend.core.google_calendar import GoogleFreeBusySource
        token = os.environ.get("DORA_GOOGLE_CALENDAR_ACCESS_TOKEN", "").strip()
        if not token:
            raise CalendarNotConnected("calendar not connected")
        return GoogleFreeBusySource(token, os.environ.get("DORA_GOOGLE_CALENDAR_ID", "primary"))
    if provider == "fake":
        path = os.environ.get("DORA_FAKE_CALENDAR_FILE", "").strip()
        if not path:
            raise CalendarNotConnected("calendar not connected")
        return FakeBusyTimeSource.from_fixture(path)
    raise CalendarNotConnected("calendar not connected")
