export function dayKey(value, zone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function addDays(value, count) {
  const date = new Date(value + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function inputTime(value, zone) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function fromInput(value, zone) {
  const guess = new Date(value + "Z").getTime();
  let time = guess;
  if (!Number.isFinite(time)) throw new Error("calendar.errors.dates");
  for (let i = 0; i < 3; i++) {
    const actual = new Date(inputTime(time, zone) + "Z").getTime();
    time += guess - actual;
  }
  if (inputTime(time, zone) !== value) throw new Error("calendar.errors.dates");
  return new Date(time).toISOString();
}
export function calendarRange(anchor, view) {
  let start = anchor,
    count = 30;
  if (view === "month") {
    start = anchor.slice(0, 7) + "-01";
    count = 42;
  }
  if (view === "week" || view === "month") {
    const weekday = new Date(start + "T12:00:00Z").getUTCDay();
    start = addDays(start, -((weekday + 6) % 7));
    if (view === "week") count = 7;
  }
  return {
    start,
    end: addDays(start, count),
    days: Array.from({ length: count }, (_, i) => addDays(start, i)),
  };
}
export function eventOnDay(event, day, zone) {
  const start = event.allDay ? event.start : dayKey(event.start, zone),
    end = event.allDay
      ? addDays(event.end, -1)
      : dayKey(new Date(new Date(event.end).getTime() - 1), zone);
  return start <= day && end >= day;
}
export function startOfDay(day, zone) {
  for (let hour = 0; hour < 4; hour++) {
    try {
      return fromInput(day + "T" + String(hour).padStart(2, "0") + ":00", zone);
    } catch {}
  }
  throw new Error("calendar.errors.dates");
}
