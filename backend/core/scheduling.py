"""Pure slot matching: provider windows x tenant busy time -> free appointment slots.

No I/O, no database, no calendar calls. Every datetime must carry a UTC offset;
results are returned in Europe/Berlin.

Booking rule: the partner offers e.g. 14:00-17:00, the tenant is busy 14:00-15:00,
so DORA proposes 15:00-16:00. The tenant approves that exact hour; the partner may
accept it or decline. Nothing here confirms anything.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable, Mapping
from zoneinfo import ZoneInfo

BERLIN = ZoneInfo("Europe/Berlin")
DEFAULT_DURATION = timedelta(hours=1)
DEFAULT_STEP_MINUTES = 15


class SchedulingError(ValueError):
    """Invalid scheduling input (naive datetime, end before start, bad format)."""


@dataclass(frozen=True, order=True)
class Interval:
    start: datetime
    end: datetime

    def __post_init__(self):
        for value in (self.start, self.end):
            if value.tzinfo is None or value.utcoffset() is None:
                raise SchedulingError("datetimes must include a timezone offset")
        if self.end <= self.start:
            raise SchedulingError("interval end must be after start")

    def to_dict(self) -> dict:
        return {"start": self.start.astimezone(BERLIN).isoformat(),
                "end": self.end.astimezone(BERLIN).isoformat()}


def parse_datetime(value) -> datetime:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise SchedulingError(f"invalid ISO datetime: {value!r}") from exc
    else:
        raise SchedulingError(f"expected ISO datetime string, got {type(value).__name__}")
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise SchedulingError(f"datetime needs a timezone offset: {value!r}")
    return dt


def to_interval(item) -> Interval:
    if isinstance(item, Interval):
        return item
    if isinstance(item, Mapping):
        try:
            return Interval(parse_datetime(item["start"]), parse_datetime(item["end"]))
        except KeyError as exc:
            raise SchedulingError("interval needs 'start' and 'end'") from exc
    raise SchedulingError(f"cannot read interval from {type(item).__name__}")


def merge_intervals(intervals: Iterable[Interval]) -> list[Interval]:
    """Sort and merge overlapping or back-to-back intervals."""
    merged: list[Interval] = []
    for iv in sorted(intervals):
        if merged and iv.start <= merged[-1].end:
            if iv.end > merged[-1].end:
                merged[-1] = Interval(merged[-1].start, iv.end)
        else:
            merged.append(iv)
    return merged


def _round_up(dt: datetime, step_minutes: int) -> datetime:
    """Round up to the next step boundary on the Berlin wall clock (15:07 -> 15:15)."""
    local = dt.astimezone(BERLIN)
    floor = local.replace(minute=(local.minute // step_minutes) * step_minutes, second=0, microsecond=0)
    return floor if floor == local else floor + timedelta(minutes=step_minutes)


def find_free_slots(provider_windows, tenant_busy, *, duration: timedelta = DEFAULT_DURATION,
                    limit: int = 3, not_before: datetime | None = None,
                    step_minutes: int = DEFAULT_STEP_MINUTES) -> list[Interval]:
    """Earliest-first, non-overlapping slots of `duration` that lie fully inside a
    provider window and do not touch any tenant busy interval.

    Slot starts are rounded up to `step_minutes` on the Berlin clock so times are
    easy to say out loud. `not_before` drops anything starting earlier (e.g. now).
    """
    if duration <= timedelta(0):
        raise SchedulingError("duration must be positive")
    if limit <= 0:
        return []
    if not_before is not None:
        not_before = parse_datetime(not_before)
    windows = merge_intervals(to_interval(w) for w in provider_windows)
    busy = merge_intervals(to_interval(b) for b in tenant_busy)

    slots: list[Interval] = []
    for window in windows:
        cursor = window.start if not_before is None else max(window.start, not_before)
        while True:
            cursor = _round_up(cursor, step_minutes)
            end = cursor + duration
            if end > window.end:
                break
            blocker = next((b for b in busy if b.start < end and b.end > cursor), None)
            if blocker is not None:
                cursor = blocker.end
                continue
            slots.append(Interval(cursor.astimezone(BERLIN), end.astimezone(BERLIN)))
            if len(slots) >= limit:
                return slots
            cursor = end
    return slots


def earliest_free_slot(provider_windows, tenant_busy, *, duration: timedelta = DEFAULT_DURATION,
                       not_before: datetime | None = None) -> Interval | None:
    """The earliest free slot, or None if the tenant is busy in every window."""
    found = find_free_slots(provider_windows, tenant_busy, duration=duration, limit=1,
                            not_before=not_before)
    return found[0] if found else None
