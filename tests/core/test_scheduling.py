from datetime import datetime, timedelta, timezone

import pytest

from backend.core.scheduling import (Interval, SchedulingError, earliest_free_slot,
                                     find_free_slots, merge_intervals, to_interval)

D = "2026-11-23T"


def iv(start, end, day=D, off="+01:00"):
    return {"start": f"{day}{start}:00{off}", "end": f"{day}{end}:00{off}"}


def hm(slot):
    return slot.start.strftime("%H:%M"), slot.end.strftime("%H:%M")


def test_booking_rule_example():
    slot = earliest_free_slot([iv("14:00", "17:00")], [iv("14:00", "15:00")])
    assert hm(slot) == ("15:00", "16:00")
    assert slot.to_dict() == {"start": "2026-11-23T15:00:00+01:00", "end": "2026-11-23T16:00:00+01:00"}


def test_no_busy_returns_window_start():
    assert hm(earliest_free_slot([iv("14:00", "17:00")], [])) == ("14:00", "15:00")


def test_back_to_back_busy_blocks():
    busy = [iv("14:00", "15:00"), iv("15:00", "16:00")]
    assert hm(earliest_free_slot([iv("14:00", "17:00")], busy)) == ("16:00", "17:00")


def test_window_shorter_than_an_hour_is_skipped():
    windows = [iv("14:00", "14:45"), iv("16:00", "18:00")]
    assert hm(earliest_free_slot(windows, [])) == ("16:00", "17:00")
    assert earliest_free_slot([iv("14:00", "14:59")], []) is None


def test_overlapping_busy_blocks():
    busy = [iv("14:00", "15:30"), iv("15:00", "15:45"), iv("14:30", "15:10")]
    assert hm(earliest_free_slot([iv("14:00", "17:00")], busy)) == ("16:00", "17:00")


def test_busy_spanning_window_start():
    busy = [iv("12:00", "14:30")]
    assert hm(earliest_free_slot([iv("14:00", "17:00")], busy)) == ("15:00", "16:00")


def test_busy_spanning_window_end_leaves_too_little_time():
    busy = [iv("14:45", "18:00")]
    assert earliest_free_slot([iv("14:00", "16:00")], busy) is None
    busy = [iv("15:30", "18:00")]
    assert hm(earliest_free_slot([iv("14:00", "16:00")], busy)) == ("14:00", "15:00")


def test_gap_shorter_than_an_hour_is_not_used():
    busy = [iv("14:30", "15:00"), iv("15:45", "17:00")]
    assert earliest_free_slot([iv("14:00", "17:00")], busy) is None


def test_fully_busy_returns_none():
    assert earliest_free_slot([iv("14:00", "17:00")], [iv("08:00", "20:00")]) is None


def test_odd_busy_end_rounds_up_to_full_hour():
    assert hm(earliest_free_slot([iv("14:00", "17:00")], [iv("14:00", "14:07")])) == ("15:00", "16:00")


def test_window_not_on_the_hour_starts_at_next_full_hour():
    assert hm(earliest_free_slot([iv("14:30", "16:00")], [])) == ("15:00", "16:00")
    assert earliest_free_slot([iv("14:30", "15:45")], []) is None


def test_custom_step_still_possible():
    slot = find_free_slots([iv("14:00", "17:00")], [iv("14:00", "14:07")], step_minutes=15)[0]
    assert hm(slot) == ("14:15", "15:15")


def test_up_to_three_non_overlapping_slots_earliest_first():
    windows = [iv("09:00", "12:00", day="2026-11-24T"), iv("14:00", "17:00")]
    slots = find_free_slots(windows, [iv("14:00", "15:00")])
    assert [s.to_dict()["start"] for s in slots] == [
        "2026-11-23T15:00:00+01:00", "2026-11-23T16:00:00+01:00", "2026-11-24T09:00:00+01:00"]
    assert all(s.end - s.start == timedelta(hours=1) for s in slots)


def test_other_offsets_are_converted_to_berlin():
    # 13:00Z == 14:00 Berlin (CET, +01:00)
    busy = [{"start": "2026-11-23T13:00:00Z", "end": "2026-11-23T14:00:00Z"}]
    slot = earliest_free_slot([iv("14:00", "17:00")], busy)
    assert slot.to_dict()["start"] == "2026-11-23T15:00:00+01:00"


def test_not_before_skips_past_time():
    now = datetime(2026, 11, 23, 14, 20, tzinfo=timezone(timedelta(hours=1)))
    assert hm(earliest_free_slot([iv("14:00", "17:00")], [], not_before=now)) == ("15:00", "16:00")


def test_dst_change_day_keeps_berlin_offsets():
    # 2026-10-25: clocks go back at 03:00 CEST -> 02:00 CET
    window = {"start": "2026-10-25T09:00:00+01:00", "end": "2026-10-25T11:00:00+01:00"}
    assert earliest_free_slot([window], []).to_dict()["start"] == "2026-10-25T09:00:00+01:00"
    summer = {"start": "2026-10-24T09:00:00+02:00", "end": "2026-10-24T11:00:00+02:00"}
    assert earliest_free_slot([summer], []).to_dict()["start"] == "2026-10-24T09:00:00+02:00"


@pytest.mark.parametrize("bad", [
    {"start": "2026-11-23T14:00:00", "end": "2026-11-23T15:00:00+01:00"},
    {"start": "2026-11-23T15:00:00+01:00", "end": "2026-11-23T14:00:00+01:00"},
    {"start": "not a date", "end": "2026-11-23T15:00:00+01:00"},
    {"start": "2026-11-23T14:00:00+01:00"},
])
def test_invalid_input_rejected(bad):
    with pytest.raises(SchedulingError):
        earliest_free_slot([bad], [])
    with pytest.raises(SchedulingError):
        earliest_free_slot([iv("14:00", "17:00")], [bad])


def test_merge_intervals():
    merged = merge_intervals([to_interval(iv("15:00", "16:00")), to_interval(iv("14:00", "15:00")),
                              to_interval(iv("17:00", "18:00"))])
    assert [hm(m) for m in merged] == [("14:00", "16:00"), ("17:00", "18:00")]


def test_naive_interval_object_rejected():
    with pytest.raises(SchedulingError):
        Interval(datetime(2026, 11, 23, 14), datetime(2026, 11, 23, 15))
