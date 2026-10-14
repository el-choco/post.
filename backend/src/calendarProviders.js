const { XMLParser } = require("fast-xml-parser");
const network = require("./calendarNetwork");
const ics = require("./calendarIcs");
const { encrypt, decrypt } = require("./crypto");
const db = require("./db");
const crypto = require("node:crypto");
const oauth = require("./calendarOAuth");

const xml = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: false,
  processEntities: true,
});
const esc = (s) =>
  String(s).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
function responses(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw network.fail("calendar.errors.remote", 502);
  const root = xml.parse(text);
  return arr(root.multistatus?.response).map((r) => ({
    href: r.href,
    prop: Object.assign(
      {},
      ...arr(r.propstat)
        .filter((p) => /\s200\s/.test(p.status))
        .map((p) => p.prop),
    ),
  }));
}
function sameOrigin(value, base, child = false) {
  const url = new URL(value, base),
    origin = new URL(base);
  if (
    url.origin !== origin.origin ||
    (child &&
      !url.pathname.startsWith(
        origin.pathname.endsWith("/") ? origin.pathname : origin.pathname + "/",
      ))
  )
    throw network.fail("calendar.errors.redirect");
  return url.href;
}
const config = oauth.config;
function availability(accountId) {
  return oauth.settings(accountId);
}
function authorize(provider, state, verifier, profile) {
  const c = config(provider, profile),
    url = new URL(c.authorize);
  const params = {
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: "code",
    scope: c.scope,
    state,
    code_challenge: crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url"),
    code_challenge_method: "S256",
  };
  if (provider === "google")
    Object.assign(params, { access_type: "offline", prompt: "consent" });
  else params.response_mode = "query";
  url.search = new URLSearchParams(params);
  return url.href;
}
async function exchange(provider, params, profile) {
  const c = config(provider, profile);
  const result = network.check(
    await network.request(c.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: c.clientId,
        client_secret: c.clientSecret,
        redirect_uri: c.redirectUri,
        ...params,
      }).toString(),
    }),
  );
  let data;
  try {
    data = JSON.parse(result.text);
  } catch {
    throw network.fail("calendar.errors.remote", 502);
  }
  if (!data.access_token) throw network.fail("calendar.errors.remoteAuth", 502);
  return {
    ...data,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
}
const refreshing = new Map();
async function credentials(connection) {
  if (!["google", "microsoft"].includes(connection.kind))
    return JSON.parse(decrypt(connection.credentials_enc));
  const latest = await db.get("SELECT * FROM calendar_connections WHERE id=?", [
    connection.id,
  ]);
  if (!latest) throw network.fail("calendar.errors.notFound", 404);
  let data = JSON.parse(decrypt(latest.credentials_enc));
  if (data.expiresAt > Date.now() + 60000) return data;
  if (!refreshing.has(connection.id))
    refreshing.set(
      connection.id,
      (async () => {
        if (!data.refresh_token)
          throw network.fail("calendar.errors.reconnect");
        const updated = await exchange(
          connection.kind,
          {
            grant_type: "refresh_token",
            refresh_token: data.refresh_token,
          },
          data.oauth,
        );
        data = {
          ...data,
          ...updated,
          refresh_token: updated.refresh_token || data.refresh_token,
        };
        await db.run(
          "UPDATE calendar_connections SET credentials_enc=? WHERE id=?",
          [encrypt(JSON.stringify(data)), connection.id],
        );
        return data;
      })().finally(() => refreshing.delete(connection.id)),
    );
  return refreshing.get(connection.id);
}
async function headers(connection) {
  const data = await credentials(connection);
  return connection.kind === "caldav"
    ? {
        Authorization:
          "Basic " +
          Buffer.from(data.username + ":" + data.password).toString("base64"),
      }
    : { Authorization: "Bearer " + data.access_token };
}
async function dav(connection, url, method, body, extra = {}) {
  const result = await network.request(sameOrigin(url, connection.url), {
    method,
    headers: {
      ...(await headers(connection)),
      "Content-Type": "application/xml; charset=utf-8",
      ...extra,
    },
    body,
  });
  return network.check(result);
}
const propBody =
  '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:displayname/><d:resourcetype/><d:current-user-principal/><c:calendar-home-set/><d:current-user-privilege-set/><a:calendar-color/><c:supported-calendar-component-set/></d:prop></d:propfind>';
async function discover(connection) {
  if (connection.kind === "ics") {
    const data = await credentials(connection);
    ics.parse(network.check(await network.request(data.url)).text);
    return [
      { remoteId: "subscription", name: connection.name, readOnly: true },
    ];
  }
  if (connection.kind === "caldav") {
    let rows = responses(
      (
        await dav(connection, connection.url, "PROPFIND", propBody, {
          Depth: "1",
        })
      ).text,
    );
    if (!rows.some((r) => r.prop?.resourcetype?.calendar !== undefined)) {
      let home = rows.find((r) => r.prop?.["calendar-home-set"]?.href)?.prop[
        "calendar-home-set"
      ].href;
      if (!home) {
        const principal = rows.find(
          (r) => r.prop?.["current-user-principal"]?.href,
        )?.prop["current-user-principal"].href;
        if (principal) {
          rows = responses(
            (
              await dav(connection, principal, "PROPFIND", propBody, {
                Depth: "0",
              })
            ).text,
          );
          home = rows.find((r) => r.prop?.["calendar-home-set"]?.href)?.prop[
            "calendar-home-set"
          ].href;
        }
      }
      if (home)
        rows = responses(
          (await dav(connection, home, "PROPFIND", propBody, { Depth: "1" }))
            .text,
        );
    }
    const calendars = rows
      .filter((r) => r.prop?.resourcetype?.calendar !== undefined)
      .filter((r) => {
        const components = arr(
          r.prop["supported-calendar-component-set"]?.comp,
        );
        return (
          !components.length || components.some((c) => c["@_name"] === "VEVENT")
        );
      })
      .map((r) => {
        const privileges = arr(r.prop["current-user-privilege-set"]?.privilege);
        return {
          remoteId: sameOrigin(r.href, connection.url),
          name: r.prop.displayname || connection.name,
          color: String(r.prop["calendar-color"] || "#3477d4").slice(0, 7),
          readOnly:
            privileges.length > 0 &&
            !privileges.some(
              (p) =>
                p.write !== undefined ||
                p["write-content"] !== undefined ||
                p.all !== undefined,
            ),
        };
      });
    if (!calendars.length) throw network.fail("calendar.errors.noCalendars");
    return calendars;
  }
  if (connection.kind === "google") {
    const list = await pages(
      connection,
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250",
      "items",
    );
    return list
      .filter((c) => !c.deleted)
      .map((c) => ({
        remoteId: c.id,
        name: c.summaryOverride || c.summary,
        readOnly: !["owner", "writer"].includes(c.accessRole),
        color: c.backgroundColor,
        timezone: c.timeZone,
      }));
  }
  const list = await pages(
    connection,
    "https://graph.microsoft.com/v1.0/me/calendars?$top=100",
    "value",
  );
  return list.map((c) => ({
    remoteId: c.id,
    name: c.name,
    readOnly: !c.canEdit,
  }));
}
async function json(connection, url, options = {}) {
  const result = network.check(
    await network.request(url, {
      ...options,
      headers: {
        ...(await headers(connection)),
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: 'outlook.timezone="UTC"',
        ...options.headers,
      },
    }),
  );
  if (result.status === 204) return null;
  try {
    return JSON.parse(result.text);
  } catch {
    throw network.fail("calendar.errors.remote", 502);
  }
}
async function pages(connection, url, key) {
  const list = [],
    origin = new URL(url).origin;
  let page = 0;
  while (url) {
    if (++page > 30 || list.length > 10000)
      throw network.fail("calendar.errors.tooLarge");
    if (new URL(url).origin !== origin)
      throw network.fail("calendar.errors.redirect");
    const result = await json(connection, url);
    list.push(...(result[key] || []));
    if (connection.kind === "google" && result.nextPageToken) {
      const next = new URL(url);
      next.searchParams.set("pageToken", result.nextPageToken);
      url = next.href;
    } else url = result["@odata.nextLink"] || null;
  }
  return list;
}
function providerEvent(item, kind) {
  if (kind === "google")
    return {
      id: item.id,
      title: item.summary || "",
      description: item.description || "",
      location: item.location || "",
      start: item.start.date || item.start.dateTime,
      end: item.end.date || item.end.dateTime,
      allDay: !!item.start.date,
      revision: item.etag,
      recurring: !!item.recurringEventId || !!item.recurrence,
      hasParticipants: !!item.attendees?.length,
    };
  const convert = (t) =>
    t.dateTime.endsWith("Z") ? t.dateTime : t.dateTime + "Z";
  return {
    id: item.id,
    title: item.subject || "",
    description:
      item.body?.contentType === "text"
        ? item.body.content
        : item.bodyPreview || "",
    location: item.location?.displayName || "",
    start: item.isAllDay
      ? item.start.dateTime.slice(0, 10)
      : convert(item.start),
    end: item.isAllDay ? item.end.dateTime.slice(0, 10) : convert(item.end),
    allDay: item.isAllDay,
    revision: item["@odata.etag"],
    recurring: item.type !== "singleInstance",
    hasParticipants: !!item.attendees?.length,
  };
}
async function listEvents(calendar, connection, start, end) {
  if (connection.kind === "ics") {
    const data = await credentials(connection);
    return ics.expand(
      network.check(await network.request(data.url)).text,
      start,
      end,
      { readOnly: true },
    );
  }
  if (connection.kind === "caldav") {
    const stamp = (d) =>
      new Date(d)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
    const body = `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${stamp(start)}" end="${stamp(end)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    const rows = responses(
      (
        await dav(connection, calendar.remote_id, "REPORT", body, {
          Depth: "1",
        })
      ).text,
    );
    return rows.flatMap((r) =>
      r.prop["calendar-data"]
        ? ics.expand(r.prop["calendar-data"], start, end, {
            id: sameOrigin(r.href, calendar.remote_id, true),
            revision: r.prop.getetag,
          })
        : [],
    );
  }
  const base =
    connection.kind === "google"
      ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.remote_id)}/events`
      : `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendar.remote_id)}/calendarView`;
  const query =
    connection.kind === "google"
      ? {
          timeMin: start,
          timeMax: end,
          singleEvents: "true",
          maxResults: "2500",
        }
      : { startDateTime: start, endDateTime: end, $top: "500" };
  const list = await pages(
    connection,
    base + "?" + new URLSearchParams(query),
    connection.kind === "google" ? "items" : "value",
  );
  if (connection.kind === "microsoft")
    for (let index = 0; index < list.length; index++) {
      const item = list[index];
                                                                                          
      if (
        item.isAllDay &&
        item.start.dateTime.slice(11, 16) !== "00:00" &&
        item.originalStartTimeZone
      ) {
        const url = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendar.remote_id)}/events/${encodeURIComponent(item.id)}`;
        list[index] = await json(connection, url, {
          headers: {
            Prefer: `outlook.timezone="${String(item.originalStartTimeZone).replace(/["\r\n]/g, "")}"`,
          },
        });
      }
    }
  return list
    .filter((e) => e.status !== "cancelled")
    .map((e) => providerEvent(e, connection.kind));
}
async function writeEvent(
  calendar,
  connection,
  id,
  data,
  revision,
  remove = false,
) {
  if (connection.kind === "caldav") {
    const url = id
      ? sameOrigin(id, calendar.remote_id, true)
      : new URL(
          crypto.randomUUID() + ".ics",
          calendar.remote_id.endsWith("/")
            ? calendar.remote_id
            : calendar.remote_id + "/",
        ).href;
    let previous;
    if (id) {
      const old = await dav(connection, url, "GET", undefined, {
        "Content-Type": "text/calendar",
      });
      previous = old.text;
      if (!revision || revision !== old.headers.etag)
        throw network.fail("calendar.errors.conflict", 409);
    }
                                                                                            
    await dav(
      connection,
      url,
      remove ? "DELETE" : "PUT",
      remove ? undefined : ics.build(data, previous),
      {
        "Content-Type": "text/calendar; charset=utf-8",
        ...(id ? { "If-Match": revision } : { "If-None-Match": "*" }),
      },
    );
    return;
  }
  if (!["google", "microsoft"].includes(connection.kind))
    throw network.fail("calendar.errors.readOnly", 403);
  const base =
    connection.kind === "google"
      ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.remote_id)}/events`
      : `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendar.remote_id)}/events`;
  const url = id ? base + "/" + encodeURIComponent(id) : base;
  if (id && !revision) throw network.fail("calendar.errors.conflict", 409);
  let body;
  if (!remove) {
    if (connection.kind === "google")
      body = {
        summary: data.title,
        description: data.description,
        location: data.location,
        start: { [data.allDay ? "date" : "dateTime"]: data.start },
        end: { [data.allDay ? "date" : "dateTime"]: data.end },
      };
    else
      body = {
        subject: data.title,
        body: { contentType: "text", content: data.description },
        location: { displayName: data.location },
        isAllDay: data.allDay,
        start: {
          dateTime: data.allDay
            ? data.start + "T00:00:00"
            : data.start.replace(/Z$/, ""),
          timeZone: "UTC",
        },
        end: {
          dateTime: data.allDay
            ? data.end + "T00:00:00"
            : data.end.replace(/Z$/, ""),
          timeZone: "UTC",
        },
      };
  }
  await json(connection, url, {
    method: remove ? "DELETE" : id ? "PATCH" : "POST",
    headers: id ? { "If-Match": revision } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}
module.exports = {
  config,
  availability,
  authorize,
  exchange,
  discover,
  listEvents,
  writeEvent,
  responses,
  sameOrigin,
};
