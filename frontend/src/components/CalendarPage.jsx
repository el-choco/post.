import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  Plus,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  Link,
  Lock,
  Trash2,
  Download,
  Upload,
  X,
  MapPin,
  Clock,
  Repeat,
  Check,
} from "lucide-react";
import WorkspacePage from "./WorkspacePage";
import CalendarOAuthSetup from "./CalendarOAuthSetup";
import { api, post } from "../api";
import { useStore } from "../store";
import {
  dayKey,
  addDays,
  inputTime,
  fromInput,
  calendarRange,
  eventOnDay,
  startOfDay,
} from "../lib/calendar";

const demoKey = "post.demo.calendar";
function demoData() {
  try {
    const value = JSON.parse(localStorage.getItem(demoKey));
    if (value?.calendars?.length) return value;
  } catch {}
  const today = dayKey(new Date());
  return {
    calendars: [
      {
        id: 1,
        name: "Persönlich",
        kind: "local",
        color: "#3477d4",
        isDefault: true,
      },
    ],
    connections: [],
    events: [
      {
        id: "demo-welcome",
        calendarId: 1,
        title: "Zeit für neue Ideen",
        start: today + "T09:00:00Z",
        end: today + "T10:00:00Z",
        location: "Studio",
        description: "Ein kleiner Termin für einen großen Plan.",
        allDay: false,
        revision: "1",
      },
    ],
  };
}
export default function CalendarPage({ settings, onBack }) {
  const { user } = useStore(),
    { t } = useTranslation();
  const zone = settings.timezone || "Europe/Berlin",
    locale = settings.language === "en" ? "en-GB" : "de-DE";
  const [anchor, setAnchor] = useState(() => dayKey(new Date(), zone)),
    [view, setView] = useState("month");
  const [calendars, setCalendars] = useState([]),
    [connections, setConnections] = useState([]),
    [visible, setVisible] = useState(new Set());
  const [events, setEvents] = useState([]),
    [providerErrors, setProviderErrors] = useState([]),
    [config, setConfig] = useState({});
  const [editor, setEditor] = useState(null),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirm, setConfirm] = useState(null),
    [sync, setSync] = useState(0),
    [syncedAt, setSyncedAt] = useState(null);
  const initialized = useRef(false),
    known = useRef(new Set()),
    loadSequence = useRef(0);
  const demo = useRef(user.demo ? demoData() : null),
    visibleKey = "calendarVisible:" + user.email;
  const range = useMemo(() => calendarRange(anchor, view), [anchor, view]);
  const writable = calendars.filter((c) => !c.readOnly),
    local = calendars.filter((c) => c.kind === "local");
  const selected = calendars.find((c) => c.id === Number(editor?.calendarId));
  const showError = (e) => setError(e.message || "calendar.errors.remote");
  const readCalendars = useCallback(async () => {
    const data = user.demo ? demo.current : await api("/calendar/calendars");
    setCalendars(data.calendars);
    setConnections(data.connections);
    setVisible((previous) => {
      let next = new Set(previous);
      if (!initialized.current) {
        let stored;
        try {
          stored = JSON.parse(localStorage.getItem(visibleKey));
        } catch {}
        next = new Set(
          Array.isArray(stored) ? stored : data.calendars.map((c) => c.id),
        );
        initialized.current = true;
      } else
        for (const c of data.calendars)
          if (!known.current.has(c.id)) next.add(c.id);
      known.current = new Set(data.calendars.map((c) => c.id));
      next = new Set([...next].filter((id) => known.current.has(id)));
      return next;
    });
  }, [user.demo, visibleKey]);
  useEffect(() => {
    let cancelled = false;
    readCalendars().catch((e) => {
      if (!cancelled) showError(e);
    });
    if (!user.demo)
      api("/calendar/config")
        .then((data) => {
          if (!cancelled) setConfig(data);
        })
        .catch((e) => {
          if (!cancelled) showError(e);
        });
    const params = new URLSearchParams(location.search);
    if (params.has("calendarConnected")) setNotice("calendar.connected");
    if (params.has("calendarError"))
      setError(
        params.get("calendarError") === "denied"
          ? "calendar.errors.denied"
          : "calendar.errors.connect",
      );
    return () => {
      cancelled = true;
    };
  }, [readCalendars, user.demo]);
  useEffect(() => {
    if (initialized.current)
      localStorage.setItem(visibleKey, JSON.stringify([...visible]));
  }, [visible, visibleKey]);
  const ids = [...visible].sort((a, b) => a - b).join(",");
  useEffect(() => {
    const controller = new AbortController(),
      sequence = ++loadSequence.current;
    setLoading(true);
    const params = new URLSearchParams({
      start: startOfDay(range.start, zone),
      end: startOfDay(range.end, zone),
      calendars: ids,
    });
    const pending = user.demo
      ? Promise.resolve({
          events: demo.current.events.filter((e) => visible.has(e.calendarId)),
          errors: [],
          syncedAt: Date.now(),
        })
      : api("/calendar/events?" + params, { signal: controller.signal });
    pending
      .then((result) => {
        if (sequence === loadSequence.current) {
          setEvents(result.events);
          setProviderErrors(result.errors);
          setSyncedAt(result.syncedAt);
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") showError(e);
      })
      .finally(() => {
        if (sequence === loadSequence.current) setLoading(false);
      });
    return () => controller.abort();
  }, [ids, range.start, range.end, zone, user.demo, sync]);
  useEffect(() => {
    if (loading) return;
    const timer = setInterval(() => setSync((v) => v + 1), 60000);
    return () => clearInterval(timer);
  }, [loading]);
  async function action(fn, message) {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (user.demo)
        localStorage.setItem(demoKey, JSON.stringify(demo.current));
      await readCalendars();
      setSync((v) => v + 1);
      if (message) setNotice(message);
      return true;
    } catch (e) {
      showError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function newEvent(day = anchor) {
    const calendar = writable.find((c) => visible.has(c.id)) || writable[0];
    if (!calendar) {
      setError("calendar.errors.readOnly");
      return;
    }
    setError("");
    setConfirm(null);
    setEditor({
      mode: "event",
      calendarId: calendar.id,
      title: "",
      description: "",
      location: "",
      start: day + "T09:00",
      end: day + "T10:00",
      allDay: false,
      recurrence: "",
    });
  }
  function openEvent(event) {
    const data = event.series || event;
    setError("");
    setConfirm(null);
    setEditor({
      ...event,
      ...data,
      id: event.id,
      revision: event.revision,
      calendarId: event.calendarId,
      mode: "event",
      start: data.allDay ? data.start : inputTime(data.start, zone),
      end: data.allDay ? addDays(data.end, -1) : inputTime(data.end, zone),
    });
  }
  function update(key, value) {
    setEditor((current) => ({ ...current, [key]: value }));
  }
  async function saveEvent(e) {
    e.preventDefault();
    let data;
    try {
      data = {
        title: editor.title,
        description: editor.description,
        location: editor.location,
        allDay: editor.allDay,
        start: editor.allDay ? editor.start : fromInput(editor.start, zone),
        end: editor.allDay
          ? addDays(editor.end, 1)
          : fromInput(editor.end, zone),
        recurrence: editor.recurrence || "",
        timezone: editor.timezone || zone,
      };
    } catch (err) {
      showError(err);
      return;
    }
    const success = await action(async () => {
      if (user.demo) {
        if (data.end <= data.start || !data.title.trim())
          throw new Error("calendar.errors.dates");
        if (data.recurrence) throw new Error("calendar.errors.demo");
        const event = {
          ...data,
          id: editor.id || crypto.randomUUID(),
          calendarId: Number(editor.calendarId),
          revision: String(Number(editor.revision || 0) + 1),
        };
        demo.current.events = [
          ...demo.current.events.filter((x) => x.id !== event.id),
          event,
        ];
      } else
        await post("/calendar/events", {
          calendarId: Number(editor.calendarId),
          id: editor.id,
          revision: editor.revision,
          event: data,
        });
    }, "calendar.saved");
    if (success) setEditor(null);
  }
  async function saveCalendar(e) {
    e.preventDefault();
    const success = await action(async () => {
      if (user.demo) {
        if (editor.id)
          demo.current.calendars = demo.current.calendars.map((c) =>
            c.id === editor.id
              ? { ...c, name: editor.name, color: editor.color }
              : c,
          );
        else
          demo.current.calendars.push({
            id: Math.max(...demo.current.calendars.map((c) => c.id)) + 1,
            name: editor.name,
            color: editor.color,
            kind: "local",
          });
      } else if (editor.id)
        await post(
          "/calendar/calendars/" + editor.id,
          { name: editor.name, color: editor.color },
          "PATCH",
        );
      else
        await post("/calendar/calendars", {
          name: editor.name,
          color: editor.color,
        });
    }, "calendar.saved");
    if (success) setEditor(null);
  }
  async function connect(e) {
    e.preventDefault();
    if (["google", "microsoft"].includes(editor.kind)) {
      setError("");
      setEditor((current) => ({ ...current, mode: "oauth" }));
      return;
    }
    const success = await action(async () => {
      if (user.demo) throw new Error("calendar.errors.demo");
      await post("/calendar/connections", editor);
    }, "calendar.connected");
    if (success) setEditor(null);
  }
  async function remove() {
    const success = await action(async () => {
      if (confirm === "event") {
        if (user.demo)
          demo.current.events = demo.current.events.filter(
            (e) => e.id !== editor.id,
          );
        else
          await post("/calendar/events/delete", {
            calendarId: editor.calendarId,
            id: editor.id,
            revision: editor.revision,
            confirm: true,
          });
      } else if (confirm === "connection")
        await post(
          "/calendar/connections/" + editor.connectionId,
          { confirm: true },
          "DELETE",
        );
      else {
        if (user.demo) {
          demo.current.calendars = demo.current.calendars.filter(
            (c) => c.id !== editor.id,
          );
          demo.current.events = demo.current.events.filter(
            (e) => e.calendarId !== editor.id,
          );
        } else
          await post(
            "/calendar/calendars/" + editor.id,
            { confirm: true },
            "DELETE",
          );
      }
    }, "calendar.removed");
    if (success) {
      setConfirm(null);
      setEditor(null);
    }
  }
  async function importFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("calendar.errors.tooLarge");
      return;
    }
    await action(async () => {
      if (user.demo) throw new Error("calendar.errors.demo");
      const result = await post(
        "/calendar/calendars/" + editor.calendarId + "/import",
        { ics: await file.text() },
      );
      setNotice(t("calendar.imported", result));
    });
  }
  async function exportFile() {
    await action(async () => {
      if (user.demo) throw new Error("calendar.errors.demo");
      const result = await fetch(
        "/api/calendar/calendars/" + editor.calendarId + "/export",
        { headers: { Authorization: "Bearer " + user.token } },
      );
      if (!result.ok) throw new Error((await result.json()).error);
      const url = URL.createObjectURL(await result.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = "post-calendar.ics";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  function navigate(direction) {
    if (view === "month") {
      const date = new Date(anchor + "T12:00:00Z");
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + direction);
      setAnchor(date.toISOString().slice(0, 10));
    } else setAnchor(addDays(anchor, direction * (view === "week" ? 7 : 30)));
  }
  const filtered = events.filter((e) =>
    [e.title, e.description, e.location]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const formatDay = (day, options) =>
    new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options }).format(
      new Date(day + "T12:00:00Z"),
    );
  const today = dayKey(new Date(), zone);
  const timeLabel = (e) =>
    e.allDay
      ? t("calendar.allDay")
      : new Intl.DateTimeFormat(locale, {
          timeZone: zone,
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(e.start));
  const dayEvents = (day) =>
    filtered
      .filter((e) => eventOnDay(e, day, zone))
      .sort(
        (a, b) =>
          Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start),
      );
  const calendarHeading =
    view === "month"
      ? formatDay(anchor, { month: "long", year: "numeric" })
      : formatDay(range.start, { day: "numeric", month: "short" }) +
        " – " +
        formatDay(addDays(range.end, -1), {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
  const eventButton = (event) => (
    <button
      key={event.calendarId + "/" + String(event.id || event.uid) + event.start}
      className="calendar-event"
      style={{
        "--calendar-color":
          event.color ||
          calendars.find((c) => c.id === event.calendarId)?.color,
      }}
      onClick={() => openEvent(event)}
      title={event.title}
    >
      <span>{timeLabel(event)}</span>
      <strong>{event.title}</strong>
      {(event.series || event.recurring) && <Repeat size={12} />}
    </button>
  );
  return (
    <WorkspacePage
      title={t("calendar.title")}
      onBack={onBack}
      headerActions={
        <div className="calendar-toolbar">
          <div className="calendar-navigation">
            <button
              className="icon-button"
              aria-label={t("calendar.previous")}
              onClick={() => navigate(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button className="secondary" onClick={() => setAnchor(today)}>
              {t("calendar.today")}
            </button>
            <button
              className="icon-button"
              aria-label={t("calendar.next")}
              onClick={() => navigate(1)}
            >
              <ChevronRight size={18} />
            </button>
            <h2>{calendarHeading}</h2>
          </div>
          <div className="calendar-view-switch">
            {["month", "week", "agenda"].map((v) => (
              <button
                key={v}
                aria-pressed={view === v}
                className={view === v ? "active" : ""}
                onClick={() => setView(v)}
              >
                {t("calendar." + v)}
              </button>
            ))}
          </div>
          <button
            className="icon-button"
            title={t("refresh")}
            aria-label={t("refresh")}
            disabled={busy || loading}
            onClick={() => {
              setSync((v) => v + 1);
              readCalendars().catch(showError);
            }}
          >
            <RefreshCw size={18} className={loading ? "spinner" : ""} />
          </button>
          <button
            className="primary"
            disabled={busy || !writable.length}
            onClick={() => newEvent()}
          >
            <Plus size={17} />
            {t("calendar.newEvent")}
          </button>
        </div>
      }
    >
      {error && (
        <div className="notice error" role="alert">
          {t(error)}
          <button
            className="icon-button"
            aria-label={t("close")}
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <Check size={16} />
          {t(notice)}
          <button
            className="icon-button"
            aria-label={t("close")}
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="calendar-body">
        <aside className="calendar-sidebar">
          <span className="eyebrow">{t("calendar.myCalendars")}</span>
          <div className="calendar-list">
            {calendars.map((c) => (
              <div className="calendar-list-row" key={c.id}>
                <label>
                  <input
                    type="checkbox"
                    style={{ accentColor: c.color }}
                    checked={visible.has(c.id)}
                    onChange={(e) =>
                      setVisible((old) => {
                        const next = new Set(old);
                        if (e.target.checked) next.add(c.id);
                        else next.delete(c.id);
                        return next;
                      })
                    }
                  />
                  <span>
                    {c.isDefault && c.name === "Persönlich"
                      ? t("calendar.personal")
                      : c.name}
                    <small>
                      {c.kind === "local"
                        ? t("calendar.local")
                        : c.kind === "ics"
                          ? "ICS"
                          : c.kind === "caldav"
                            ? "CalDAV"
                            : c.kind === "google"
                              ? "Google"
                              : "Microsoft"}
                    </small>
                  </span>
                  {c.readOnly && <Lock size={12} />}
                </label>
                <button
                  className="icon-button"
                  aria-label={t("calendar.manage", { name: c.name })}
                  onClick={() => {
                    setConfirm(null);
                    setEditor({ ...c, mode: "calendar" });
                  }}
                >
                  <CalendarDays size={15} />
                </button>
              </div>
            ))}
          </div>
          <button
            className="text-button"
            onClick={() => {
              setConfirm(null);
              setEditor({
                mode: "connect",
                kind: "local",
                name: "",
                color: "#3477d4",
                url: "",
                username: "",
                password: "",
              });
            }}
          >
            <Plus size={17} />
            {t("calendar.addCalendar")}
          </button>
          <button
            className="text-button"
            disabled={!local.length}
            onClick={() => {
              setConfirm(null);
              setEditor({ mode: "transfer", calendarId: local[0].id });
            }}
          >
            <Upload size={16} />
            {t("calendar.importExport")}
          </button>
          <div className="calendar-sidebar-note">
            <Clock size={14} />
            <span>
              {zone}
              <small>
                {syncedAt
                  ? t("calendar.lastSync") +
                    " " +
                    new Intl.DateTimeFormat(locale, {
                      timeZone: zone,
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(syncedAt)
                  : t("calendar.independent")}
              </small>
            </span>
          </div>
        </aside>
        <section className="calendar-main" aria-busy={loading}>
          <div className="calendar-search">
            <Search size={16} />
            <input
              aria-label={t("calendar.search")}
              placeholder={t("calendar.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {loading && <span role="status">{t("calendar.syncing")}</span>}
          </div>
          {providerErrors.map((e) => (
            <div className="notice error" role="alert" key={e.calendarId}>
              {calendars.find((c) => c.id === e.calendarId)?.name}: {t(e.error)}
            </div>
          ))}
          {view !== "agenda" ? (
            <div
              className={
                "calendar-grid " + (view === "week" ? "calendar-week" : "")
              }
            >
              {range.days.slice(0, 7).map((day) => (
                <div className="calendar-weekday" key={day}>
                  {formatDay(day, { weekday: "short" })}
                </div>
              ))}
              {range.days.map((day) => (
                <div
                  key={day}
                  className={`calendar-day ${day === today ? "is-today" : ""} ${view === "month" && day.slice(0, 7) !== anchor.slice(0, 7) ? "outside-month" : ""}`}
                >
                  <button
                    className="calendar-day-number"
                    aria-label={t("calendar.newOn", {
                      day: formatDay(day, { dateStyle: "full" }),
                    })}
                    onClick={() => newEvent(day)}
                  >
                    {Number(day.slice(-2))}
                    {view === "week" && (
                      <small>{formatDay(day, { month: "short" })}</small>
                    )}
                  </button>
                  <div className="calendar-day-events">
                    {dayEvents(day)
                      .slice(0, view === "week" ? Infinity : 3)
                      .map(eventButton)}
                    {view === "month" && dayEvents(day).length > 3 && (
                      <button
                        className="calendar-more"
                        onClick={() => {
                          setAnchor(day);
                          setView("agenda");
                        }}
                      >
                        {t("calendar.more", {
                          count: dayEvents(day).length - 3,
                        })}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="calendar-agenda">
              {range.days
                .filter((day) => dayEvents(day).length)
                .map((day) => (
                  <section key={day}>
                    <h3>
                      {formatDay(day, {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })}
                    </h3>
                    {dayEvents(day).map((e) => (
                      <div
                        className="calendar-agenda-event"
                        key={
                          e.calendarId + "/" + String(e.id || e.uid) + e.start
                        }
                      >
                        {eventButton(e)}
                        {e.location && (
                          <span>
                            <MapPin size={14} />
                            {e.location}
                          </span>
                        )}
                      </div>
                    ))}
                  </section>
                ))}
              {!range.days.some((day) => dayEvents(day).length) && (
                <div className="empty-state">
                  <CalendarDays size={40} />
                  <h3>{t("calendar.empty")}</h3>
                </div>
              )}
            </div>
          )}
        </section>
        {editor && (
          <aside className="calendar-editor">
            <header>
              <h2>
                {t(
                  editor.mode === "event"
                    ? editor.id
                      ? "calendar.editEvent"
                      : "calendar.newEvent"
                    : editor.mode === "transfer"
                      ? "calendar.importExport"
                      : editor.mode === "oauth"
                        ? "calendar.oauthTitle"
                        : editor.mode === "calendar"
                          ? "calendar.manageCalendar"
                          : "calendar.addCalendar",
                )}
              </h2>
              <button
                className="icon-button"
                aria-label={t("close")}
                onClick={() => {
                  setEditor(null);
                  setConfirm(null);
                }}
              >
                <X size={18} />
              </button>
            </header>
            {editor.mode === "oauth" && (
              <CalendarOAuthSetup
                key={editor.kind}
                provider={editor.kind}
                setup={config.oauthSetup?.[editor.kind]}
                demo={user.demo}
                onSaved={setConfig}
                onBack={() => update("mode", "connect")}
              />
            )}
            {editor.mode === "event" && (
              <form onSubmit={saveEvent}>
                {(editor.series || editor.recurring) && (
                  <p className="calendar-hint">
                    <Repeat size={15} />
                    {t(
                      editor.series
                        ? "calendar.seriesHint"
                        : "calendar.instanceHint",
                    )}
                  </p>
                )}
                {editor.hasParticipants && (
                  <p className="calendar-hint">
                    {t("calendar.participantHint")}
                  </p>
                )}
                <fieldset disabled={busy || selected?.readOnly}>
                  <label>
                    {t("calendar.eventTitle")}
                    <input
                      autoFocus
                      required
                      maxLength={500}
                      value={editor.title}
                      onChange={(e) => update("title", e.target.value)}
                    />
                  </label>
                  <label>
                    {t("calendar.target")}
                    <select
                      disabled={!!editor.id}
                      value={editor.calendarId}
                      onChange={(e) =>
                        update("calendarId", Number(e.target.value))
                      }
                    >
                      {(editor.id ? calendars : writable).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.isDefault && c.name === "Persönlich"
                            ? t("calendar.personal")
                            : c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="calendar-check">
                    <input
                      type="checkbox"
                      checked={editor.allDay}
                      onChange={(e) => {
                        const allDay = e.target.checked;
                        setEditor((old) => ({
                          ...old,
                          allDay,
                          start: allDay
                            ? old.start.slice(0, 10)
                            : old.start + "T09:00",
                          end: allDay
                            ? old.end.slice(0, 10)
                            : old.end + "T10:00",
                        }));
                      }}
                    />
                    {t("calendar.allDay")}
                  </label>
                  <div className="calendar-dates">
                    <label>
                      {t("calendar.start")}
                      <input
                        required
                        type={editor.allDay ? "date" : "datetime-local"}
                        value={editor.start}
                        onChange={(e) => update("start", e.target.value)}
                      />
                    </label>
                    <label>
                      {t("calendar.end")}
                      <input
                        required
                        type={editor.allDay ? "date" : "datetime-local"}
                        value={editor.end}
                        onChange={(e) => update("end", e.target.value)}
                      />
                    </label>
                  </div>
                  <p className="muted">{zone}</p>
                  <label>
                    {t("calendar.location")}
                    <input
                      maxLength={1000}
                      value={editor.location}
                      onChange={(e) => update("location", e.target.value)}
                    />
                  </label>
                  <label>
                    {t("calendar.description")}
                    <textarea
                      rows={5}
                      maxLength={20000}
                      value={editor.description}
                      onChange={(e) => update("description", e.target.value)}
                    />
                  </label>
                  {selected?.kind === "local" && (
                    <label>
                      {t("calendar.repeat")}
                      <select
                        value={editor.recurrence || ""}
                        onChange={(e) => update("recurrence", e.target.value)}
                      >
                        <option value="">{t("calendar.noRepeat")}</option>
                        {["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].map(
                          (freq) => (
                            <option key={freq} value={"FREQ=" + freq}>
                              {t("calendar." + freq)}
                            </option>
                          ),
                        )}
                        {editor.recurrence &&
                          ![
                            "FREQ=DAILY",
                            "FREQ=WEEKLY",
                            "FREQ=MONTHLY",
                            "FREQ=YEARLY",
                          ].includes(editor.recurrence) && (
                            <option value={editor.recurrence}>
                              {editor.recurrence}
                            </option>
                          )}
                      </select>
                    </label>
                  )}
                </fieldset>
                {selected?.readOnly ? (
                  <p className="calendar-hint">
                    <Lock size={15} />
                    {t("calendar.readOnly")}
                  </p>
                ) : (
                  <div className="calendar-form-actions">
                    <button className="primary" disabled={busy}>
                      {t("save")}
                    </button>
                    {editor.id && (
                      <button
                        type="button"
                        className="text-button danger"
                        disabled={busy}
                        onClick={() => setConfirm("event")}
                      >
                        <Trash2 size={15} />
                        {t("delete")}
                      </button>
                    )}
                  </div>
                )}
              </form>
            )}
            {editor.mode === "connect" && (
              <form onSubmit={editor.kind === "local" ? saveCalendar : connect}>
                <label>
                  {t("calendar.provider")}
                  <select
                    value={editor.kind}
                    onChange={(e) => update("kind", e.target.value)}
                  >
                    {["local", "caldav", "google", "microsoft", "ics"].map(
                      (p) => (
                        <option key={p} value={p}>
                          {t("calendar.provider_" + p)}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                {["local", "caldav", "ics"].includes(editor.kind) && (
                  <label>
                    {t("calendar.name")}
                    <input
                      required
                      maxLength={150}
                      value={editor.name}
                      onChange={(e) => update("name", e.target.value)}
                    />
                  </label>
                )}
                {editor.kind === "local" && (
                  <label>
                    {t("calendar.color")}
                    <input
                      type="color"
                      value={editor.color}
                      onChange={(e) => update("color", e.target.value)}
                    />
                  </label>
                )}
                {["caldav", "ics"].includes(editor.kind) && (
                  <label>
                    {t("calendar.url")}
                    <input
                      required
                      type="url"
                      value={editor.url}
                      placeholder="https://…"
                      onChange={(e) => update("url", e.target.value)}
                    />
                  </label>
                )}
                {editor.kind === "caldav" && (
                  <>
                    <label>
                      {t("calendar.username")}
                      <input
                        required
                        autoComplete="off"
                        value={editor.username}
                        onChange={(e) => update("username", e.target.value)}
                      />
                    </label>
                    <label>
                      {t("calendar.password")}
                      <input
                        required
                        type="password"
                        autoComplete="new-password"
                        value={editor.password}
                        onChange={(e) => update("password", e.target.value)}
                      />
                    </label>
                    <p className="calendar-hint">{t("calendar.caldavHint")}</p>
                  </>
                )}
                {editor.kind === "ics" && (
                  <p className="calendar-hint">{t("calendar.icsHint")}</p>
                )}
                {["google", "microsoft"].includes(editor.kind) && (
                  <p className="calendar-hint">
                    {t(
                      config[editor.kind]
                        ? "calendar.oauthHint"
                        : "calendar.oauthSetup",
                    )}
                  </p>
                )}
                <button className="primary" disabled={busy}>
                  <Link size={16} />
                  {t(
                    editor.kind === "local"
                      ? "calendar.create"
                      : "calendar.connect",
                  )}
                </button>
              </form>
            )}
            {editor.mode === "calendar" && (
              <form onSubmit={saveCalendar}>
                <label>
                  {t("calendar.name")}
                  <input
                    required
                    maxLength={150}
                    value={editor.name}
                    onChange={(e) => update("name", e.target.value)}
                  />
                </label>
                <label>
                  {t("calendar.color")}
                  <input
                    type="color"
                    value={editor.color}
                    onChange={(e) => update("color", e.target.value)}
                  />
                </label>
                <p className="calendar-hint">
                  {t(
                    editor.readOnly
                      ? "calendar.readOnly"
                      : "calendar.renameHint",
                  )}
                </p>
                <button className="primary" disabled={busy}>
                  {t("save")}
                </button>
                {!editor.isDefault && !editor.connectionId && (
                  <button
                    className="text-button danger"
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirm("calendar")}
                  >
                    <Trash2 size={16} />
                    {t("calendar.deleteCalendar")}
                  </button>
                )}
                {!!editor.connectionId && (
                  <>
                    <p className="calendar-hint">
                      {
                        connections.find((c) => c.id === editor.connectionId)
                          ?.name
                      }
                    </p>
                    <button
                      className="text-button danger"
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirm("connection")}
                    >
                      <Link size={16} />
                      {t("calendar.disconnect")}
                    </button>
                  </>
                )}
              </form>
            )}
            {editor.mode === "transfer" && (
              <div className="calendar-transfer">
                <p>{t("calendar.transferHint")}</p>
                <label>
                  {t("calendar.target")}
                  <select
                    value={editor.calendarId}
                    onChange={(e) =>
                      update("calendarId", Number(e.target.value))
                    }
                  >
                    {local.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.isDefault && c.name === "Persönlich"
                          ? t("calendar.personal")
                          : c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  className={
                    "secondary csv-file-button " + (busy ? "disabled" : "")
                  }
                >
                  <Upload size={16} />
                  {t("calendar.importIcs")}
                  <input
                    type="file"
                    disabled={busy}
                    accept=".ics,text/calendar"
                    onChange={importFile}
                  />
                </label>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={exportFile}
                >
                  <Download size={16} />
                  {t("calendar.exportIcs")}
                </button>
              </div>
            )}
            {confirm && (
              <div className="calendar-confirm" role="alert">
                <p>
                  {t(
                    confirm === "event"
                      ? editor.series
                        ? "calendar.confirmSeries"
                        : "calendar.confirmEvent"
                      : confirm === "connection"
                        ? "calendar.confirmDisconnect"
                        : "calendar.confirmCalendar",
                  )}
                </p>
                <button className="primary" disabled={busy} onClick={remove}>
                  {t("calendar.confirm")}
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => setConfirm(null)}
                >
                  {t("cancel")}
                </button>
              </div>
            )}
          </aside>
        )}
      </div>
    </WorkspacePage>
  );
}
