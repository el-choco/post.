const ICAL = require("ical.js");
const crypto = require("node:crypto");
const { tzlib_get_ical_block } = require("timezones-ical-library");
const { fail } = require("./calendarNetwork");

function parse(text) {
  if (typeof text !== "string" || text.length > 5 * 1024 * 1024)
    throw fail("calendar.errors.tooLarge");
  try {
                                                                              
    ICAL.TimezoneService.reset();
    const root = new ICAL.Component(ICAL.parse(text));
    if (root.name !== "vcalendar") throw new Error();
    for (const zone of root.getAllSubcomponents("vtimezone")) {
      const id = zone.getFirstPropertyValue("tzid");
      if (id)
        ICAL.TimezoneService.register(
          id,
          new ICAL.Timezone({ component: zone }),
        );
    }
    for (const event of root.getAllSubcomponents("vevent"))
      for (const property of event.getAllProperties()) {
        const id = property.getParameter("tzid");
        if (id && !ICAL.TimezoneService.has(id)) {
          const block = tzlib_get_ical_block(id)?.[0];
          if (!block) throw new Error("Unknown timezone");
          const component = new ICAL.Component(ICAL.parse(block));
          ICAL.TimezoneService.register(id, new ICAL.Timezone({ component }));
        }
      }
    return root;
  } catch {
    throw fail("calendar.errors.ics");
  }
}
function master(root) {
  return root
    .getAllSubcomponents("vevent")
    .find((e) => !e.hasProperty("recurrence-id"));
}
function iso(time) {
  return time.isDate
    ? time.toString().slice(0, 10)
    : time.toJSDate().toISOString();
}
function eventData(component) {
  const e = new ICAL.Event(component);
  return {
    title: e.summary || "",
    description: e.description || "",
    location: e.location || "",
    start: iso(e.startDate),
    end: iso(e.endDate),
    allDay: e.startDate.isDate,
    recurrence: component.getFirstPropertyValue("rrule")?.toString() || "",
    uid: e.uid,
    timezone:
      component.getFirstProperty("dtstart")?.getParameter("tzid") || "UTC",
    hasParticipants:
      component.hasProperty("attendee") || component.hasProperty("organizer"),
  };
}
function validate(input) {
  const data = {
    title: String(input.title || "").trim(),
    description: String(input.description || ""),
    location: String(input.location || ""),
    allDay: input.allDay === true,
    start: String(input.start || ""),
    end: String(input.end || ""),
    recurrence: String(input.recurrence || ""),
    timezone: String(input.timezone || "UTC"),
  };
  try {
    new Intl.DateTimeFormat("en", { timeZone: data.timezone });
  } catch {
    throw fail("calendar.errors.dates");
  }
  if (
    !data.title ||
    data.title.length > 500 ||
    data.description.length > 20000 ||
    data.location.length > 1000
  )
    throw fail("calendar.errors.input");
  if (data.allDay) {
    for (const key of ["start", "end"])
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(data[key]) ||
        !Number.isFinite(new Date(data[key]).getTime()) ||
        new Date(data[key]).toISOString().slice(0, 10) !== data[key]
      )
        throw fail("calendar.errors.dates");
  } else {
    for (const key of ["start", "end"]) {
      const date = new Date(data[key]);
      if (
        !Number.isFinite(date.getTime()) ||
        !/(Z|[+-]\d{2}:\d{2})$/.test(data[key])
      )
        throw fail("calendar.errors.dates");
      data[key] = date.toISOString();
    }
  }
  if (data.end <= data.start) throw fail("calendar.errors.dates");
  if (data.recurrence) {
    try {
      const rule = ICAL.Recur.fromString(data.recurrence);
      if (
        !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(rule.freq) ||
        (rule.interval || 1) < 1
      )
        throw new Error();
    } catch {
      throw fail("calendar.errors.recurrence");
    }
  }
  return data;
}
function time(value, dateOnly) {
  return dateOnly
    ? ICAL.Time.fromDateString(value)
    : ICAL.Time.fromJSDate(new Date(value), true);
}
function build(data, previous) {
  const root = previous
    ? parse(previous)
    : new ICAL.Component(["vcalendar", [], []]);
  root.updatePropertyWithValue("version", "2.0");
  root.updatePropertyWithValue("prodid", "-//post.//Calendar//DE");
  let component = master(root);
  if (!component) {
    component = new ICAL.Component("vevent");
    root.addSubcomponent(component);
  }
  const event = new ICAL.Event(component);
  if (!event.uid) event.uid = crypto.randomUUID() + "@post.webmail";
  event.summary = data.title;
  event.description = data.description;
  event.location = data.location;
  const timezone =
    data.timezone ||
    component.getFirstProperty("dtstart")?.getParameter("tzid") ||
    "UTC";
  if (!data.allDay && timezone !== "UTC") {
    const block = tzlib_get_ical_block(timezone)?.[0];
    if (!block) throw fail("calendar.errors.dates");
    let zone = root
      .getAllSubcomponents("vtimezone")
      .find((c) => c.getFirstPropertyValue("tzid") === timezone);
    if (!zone) {
      zone = new ICAL.Component(ICAL.parse(block));
      root.addSubcomponent(zone);
    }
    const tz = new ICAL.Timezone({ component: zone });
    ICAL.TimezoneService.register(timezone, tz);
    const convert = (value) => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(value));
      const fields = Object.fromEntries(parts.map((p) => [p.type, p.value]));
      const t = ICAL.Time.fromString(
        `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}:${fields.second}`,
      );
      t.zone = tz;
      return t;
    };
    event.startDate = convert(data.start);
    event.endDate = convert(data.end);
  } else {
    event.startDate = time(data.start, data.allDay);
    event.endDate = time(data.end, data.allDay);
  }
  event.sequence = (event.sequence || 0) + 1;
  component.updatePropertyWithValue(
    "dtstamp",
    ICAL.Time.fromJSDate(new Date(), true),
  );
  if (data.recurrence)
    component.updatePropertyWithValue(
      "rrule",
      ICAL.Recur.fromString(data.recurrence),
    );
  else component.removeAllProperties("rrule");
  return root.toString();
}
function expand(text, start, end, metadata = {}) {
  const root = parse(text),
    components = root.getAllSubcomponents("vevent"),
    output = [];
  if (components.length > 2000) throw fail("calendar.errors.tooLarge");
  for (const c of components.filter((c) => !c.hasProperty("recurrence-id"))) {
    const e = new ICAL.Event(c, {
      exceptions: components.filter(
        (x) =>
          x.hasProperty("recurrence-id") &&
          x.getFirstPropertyValue("uid") === c.getFirstPropertyValue("uid"),
      ),
    });
    if (!e.startDate) continue;
    const series = eventData(c);
    const add = (item, from, to) => {
      if (item.component.getFirstPropertyValue("status") === "CANCELLED")
        return;
      const a = iso(from),
        b = iso(to);
      if (new Date(b) > new Date(start) && new Date(a) < new Date(end))
        output.push({
          ...metadata,
          ...eventData(item.component),
          start: a,
          end: b,
          series: e.isRecurring() ? series : null,
          occurrenceId: a,
        });
    };
    if (!e.isRecurring()) add(e, e.startDate, e.endDate);
    else {
                                                                                         
      const iterator = e.iterator();
      let next,
        count = 0;
      while ((next = iterator.next())) {
        if (++count > 50000 || output.length > 5000)
          throw fail("calendar.errors.tooLarge");
        if (next.toJSDate() >= new Date(end)) break;
        const occurrence = e.getOccurrenceDetails(next);
        add(occurrence.item, occurrence.startDate, occurrence.endDate);
      }
      for (const exception of Object.values(e.exceptions)) {
        if (
          !output.some(
            (row) =>
              row.uid === exception.uid &&
              row.start === iso(exception.startDate),
          )
        )
          add(exception, exception.startDate, exception.endDate);
      }
    }
  }
  return output;
}
function split(text) {
  const root = parse(text),
    items = root.getAllSubcomponents("vevent");
  if (!items.length || items.length > 2000) throw fail("calendar.errors.ics");
  const ids = [
    ...new Set(
      items.map((e) => e.getFirstPropertyValue("uid")).filter(Boolean),
    ),
  ];
  if (!ids.length) throw fail("calendar.errors.ics");
  return ids.map((uid) => {
    const copy = new ICAL.Component(ICAL.parse(root.toString()));
    for (const item of copy.getAllSubcomponents("vevent"))
      if (item.getFirstPropertyValue("uid") !== uid)
        copy.removeSubcomponent(item);
    if (!master(copy)) throw fail("calendar.errors.ics");
    eventData(master(copy));
    return { uid, ics: copy.toString() };
  });
}
function merge(texts) {
  const root = new ICAL.Component(["vcalendar", [], []]);
  root.updatePropertyWithValue("version", "2.0");
  root.updatePropertyWithValue("prodid", "-//post.//Calendar//DE");
  const zones = new Set();
  for (const text of texts)
    for (const c of parse(text).getAllSubcomponents()) {
      if (c.name === "vtimezone") {
        const id = c.getFirstPropertyValue("tzid");
        if (zones.has(id)) continue;
        zones.add(id);
      }
      root.addSubcomponent(c);
    }
  return root.toString();
}
module.exports = {
  parse,
  master,
  eventData,
  validate,
  build,
  expand,
  split,
  merge,
};
