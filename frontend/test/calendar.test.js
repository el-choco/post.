import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarRange,
  fromInput,
  inputTime,
  eventOnDay,
  addDays,
  startOfDay,
} from "../src/lib/calendar.js";
test("month/week ranges start on Monday and remain stable across year boundaries", () => {
  assert.equal(calendarRange("2026-11-15", "month").start, "2026-10-26");
  assert.equal(calendarRange("2026-11-15", "month").days.length, 42);
  assert.equal(calendarRange("2026-01-01", "week").start, "2025-12-29");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
test("timezone conversion preserves local time and rejects nonexistent DST times", () => {
  assert.equal(
    fromInput("2026-10-18T09:00", "Europe/Berlin"),
    "2026-10-18T07:00:00.000Z",
  );
  assert.equal(
    fromInput("2026-11-01T09:00", "Europe/Berlin"),
    "2026-11-01T08:00:00.000Z",
  );
  assert.equal(
    inputTime("2026-11-01T08:00:00Z", "Europe/Berlin"),
    "2026-11-01T09:00",
  );
  assert.throws(() => fromInput("2026-03-29T02:30", "Europe/Berlin"));
});
test("calendar range boundaries handle midnight daylight-saving gaps", () => {
  assert.equal(
    inputTime(startOfDay("2026-09-06", "America/Santiago"), "America/Santiago"),
    "2026-09-06T01:00",
  );
});
test("all-day exclusive ends and timed midnight ends do not spill into the next day", () => {
  assert.equal(
    eventOnDay(
      { allDay: true, start: "2026-10-11", end: "2026-10-12" },
      "2026-10-12",
      "UTC",
    ),
    false,
  );
  assert.equal(
    eventOnDay(
      {
        allDay: false,
        start: "2026-10-11T23:00:00Z",
        end: "2026-10-12T00:00:00Z",
      },
      "2026-10-12",
      "UTC",
    ),
    false,
  );
});
