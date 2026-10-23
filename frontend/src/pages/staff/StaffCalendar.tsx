import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { ErrorNote } from "../../components/common";
import type { CalEvent } from "../../types";
import { addDays, isoDate, mondayOf, prettyTime, useLoad } from "../../util";

const KIND_LABEL: Record<CalEvent["kind"], string> = {
  pickup: "Pickup",
  delivery: "Delivery",
  prep: "Prep",
  shopping: "Shopping",
  hold: "Tentative hold",
};

export default function StaffCalendar() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const end = addDays(weekStart, 13);
  const { data, error, loading } = useLoad(() => api.calendar(isoDate(weekStart), isoDate(end)), [isoDate(weekStart)]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of data?.events ?? []) {
      const k = e.start.slice(0, 10);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    for (const v of m.values()) v.sort((a, b) => a.start.localeCompare(b.start));
    return m;
  }, [data]);

  const days = Array.from({ length: 14 }, (_, i) => addDays(weekStart, i));
  const today = isoDate(new Date());

  return (
    <div>
      <header className="staff-head">
        <h1 className="display sm">Calendar</h1>
        <div className="row gap wrap">
          <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart((w) => addDays(w, -7))}>‹ Earlier</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart(mondayOf(new Date()))}>This week</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart((w) => addDays(w, 7))}>Later ›</button>
          <a className="btn btn-primary btn-sm" href="/api/staff/calendar.ics" download>
            Download .ics
          </a>
        </div>
      </header>
      <p className="small muted">
        The studio calendar is the source of truth. Use <strong>Download .ics</strong> to import everything into Google Calendar,
        or the per-event links to add one at a time. Google sync is off by default, so no Google login is needed.
      </p>
      <div className="cal-legend tiny">
        {(Object.keys(KIND_LABEL) as CalEvent["kind"][]).map((k) => (
          <span key={k}><i className={`lg ev-k-${k}`} /> {KIND_LABEL[k]}</span>
        ))}
      </div>
      <ErrorNote error={error} />
      {loading && !data && <p className="muted small">Loading…</p>}
      <div className="cal-grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="cal-dow">{d}</div>
        ))}
        {days.map((d) => {
          const k = isoDate(d);
          const evs = byDay.get(k) ?? [];
          return (
            <div key={k} className={`cal-day ${k === today ? "today" : ""}`}>
              <div className="cal-date">{d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
              {evs.map((e) => (
                <div key={e.id} className={`cal-ev ev-k-${e.kind} ${e.status === "tentative" ? "tentative" : ""}`}>
                  <span className="tiny">{prettyTime(e.start)}–{prettyTime(e.end)}</span>
                  <span className="cal-ev-title">
                    {e.order_id ? <Link to={`/staff/orders/${e.order_id}`}>{e.title}</Link> : e.title}
                  </span>
                  {e.location && <span className="tiny muted">{e.location}</span>}
                  <a className="tiny" href={e.google_link} target="_blank" rel="noreferrer">+ Google</a>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
