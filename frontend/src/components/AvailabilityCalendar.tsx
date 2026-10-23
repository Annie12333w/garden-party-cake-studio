import { useEffect, useMemo, useState } from "react";
import type { Availability, DayStatus } from "../types";
import { isoDate, parseDate } from "../util";

const STATUS_TEXT: Record<DayStatus, string> = {
  available: "Open",
  limited: "A little room left",
  full: "Fully booked",
  too_soon: "Inside 7-day notice",
  closed: "No pickups",
  past: "Past",
};

export default function AvailabilityCalendar({
  availability,
  selected,
  onSelect,
  loading,
}: {
  availability: Availability | null;
  selected: string | null | undefined;
  onSelect: (date: string) => void;
  loading?: boolean;
}) {
  const byDate = useMemo(() => {
    const m = new Map<string, Availability["days"][number]>();
    availability?.days.forEach((d) => m.set(d.date, d));
    return m;
  }, [availability]);

  const firstDay = availability?.days[0]?.date;
  const start = firstDay ? parseDate(firstDay) : new Date();
  const lastDay = availability?.days[availability.days.length - 1]?.date;
  const end = lastDay ? parseDate(lastDay) : new Date();
  const [offset, setOffset] = useState(0);

  // When a date is chosen elsewhere (e.g. by the Order Taker chat), show that month.
  useEffect(() => {
    if (!selected) return;
    const d = parseDate(selected);
    const o = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
    if (o >= 0 && o <= maxOffset) setOffset(o);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, firstDay]);

  const monthStart = new Date(start.getFullYear(), start.getMonth() + offset, 1);
  const maxOffset = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const lead = (monthStart.getDay() + 6) % 7; // Mon-first grid
  const cells: (Date | null)[] = [...Array(lead).fill(null)];
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), d));
  while (cells.length % 7) cells.push(null);

  return (
    <div className={`avail-cal ${loading ? "is-loading" : ""}`}>
      <div className="avail-head">
        <button type="button" className="icon-btn" disabled={offset <= 0} onClick={() => setOffset((o) => o - 1)} aria-label="Previous month">
          ‹
        </button>
        <strong>{monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</strong>
        <button type="button" className="icon-btn" disabled={offset >= maxOffset} onClick={() => setOffset((o) => o + 1)} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="avail-grid" role="grid">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div key={i} className="avail-dow" aria-hidden="true">{d}</div>
        ))}
        {cells.map((c, i) => {
          if (!c) return <div key={i} className="avail-cell blank" />;
          const iso = isoDate(c);
          const info = byDate.get(iso);
          const status: DayStatus = info?.status ?? "past";
          const pickable = status === "available" || status === "limited";
          return (
            <button
              key={i}
              type="button"
              className={`avail-cell st-${status} ${selected === iso ? "selected" : ""}`}
              disabled={!pickable}
              onClick={() => pickable && onSelect(iso)}
              title={`${c.toDateString()}: ${STATUS_TEXT[status]}${info?.note ? ` (${info.note})` : ""}`}
              aria-label={`${c.toDateString()}: ${STATUS_TEXT[status]}`}
              aria-pressed={selected === iso}
            >
              {c.getDate()}
            </button>
          );
        })}
      </div>
      <div className="avail-legend tiny">
        <span><i className="lg st-available" /> Open</span>
        <span><i className="lg st-limited" /> Limited</span>
        <span><i className="lg st-full" /> Booked</span>
        <span><i className="lg st-too_soon" /> Too soon</span>
        <span><i className="lg st-closed" /> Closed</span>
      </div>
      {availability && (
        <p className="tiny muted">
          This cake needs about <strong>{availability.labor_hours} hrs</strong> of studio time. Dates only open up when the
          studio's baking hours before pickup can fit it.
        </p>
      )}
    </div>
  );
}
