import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { Card, ErrorNote, useRunWatcher } from "../../components/common";
import RunLog from "../../components/RunLog";
import type { PlanTask } from "../../types";
import { addDays, errMsg, isoDate, mondayOf, prettyDate, prettyTime, titleCase, useLoad } from "../../util";

/** The week to plan by default: this week on Mondays (shopping day), otherwise next week. */
export function defaultWeek(weeks: { value: string }[]) {
  return new Date().getDay() === 1 ? weeks[0].value : weeks[1].value;
}

export function weekOptions() {
  const thisMon = mondayOf(new Date());
  return [0, 1, 2, 3].map((i) => {
    const d = addDays(thisMon, i * 7);
    return { value: isoDate(d), label: `${i === 0 ? "This week" : i === 1 ? "Next week" : `In ${i} weeks`} · ${prettyDate(isoDate(d))}` };
  });
}

const KIND_ICON: Record<PlanTask["kind"], string> = {
  bake: "🥣",
  frosting: "🧈",
  filling: "🍋",
  assemble: "🎂",
  decorate: "🌸",
  deliver: "🚗",
  pickup: "🛍️",
  shop: "🧺",
  prep: "🔪",
};

export default function StaffPlan() {
  const weeks = weekOptions();
  const [week, setWeek] = useState(defaultWeek(weeks));
  const plan = useLoad(() => api.plan(week), [week]);
  const [error, setError] = useState<string | null>(null);
  const runner = useRunWatcher(() => void plan.reload());

  const byDay = useMemo(() => {
    const m = new Map<string, PlanTask[]>();
    for (const t of plan.data?.tasks ?? []) m.set(t.day, [...(m.get(t.day) ?? []), t]);
    for (const v of m.values()) v.sort((a, b) => a.start.localeCompare(b.start));
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [plan.data]);

  const start = async () => {
    setError(null);
    try {
      const r = await api.planWeek(week);
      void runner.watch(r.run_id);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <div>
      <header className="staff-head">
        <h1 className="display sm">Production plan</h1>
        <div className="row gap wrap">
          <select value={week} onChange={(e) => setWeek(e.target.value)} aria-label="Week">
            {weeks.map((w) => (
              <option key={w.value} value={w.value}>{w.label}</option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" onClick={() => void start()} disabled={runner.watching}>
            {runner.watching ? "The team is planning…" : "Plan my week"}
          </button>
        </div>
      </header>
      <p className="small muted">
        Boss → Recipe Collector → Inventory → Cash Manager → Task Planner. The math (recipe scaling, quantities, timing)
        is done in code; the agents choose, batch, explain and check.
      </p>
      <ErrorNote error={error || plan.error || runner.error} />

      {runner.run && (
        <Card title="This run">
          <RunLog run={runner.run} compact />
        </Card>
      )}

      {plan.loading && !plan.data && <p className="muted small">Loading…</p>}
      {!plan.loading && !plan.data && (
        <div className="card empty-card">
          <p>No plan for the week of {prettyDate(week)} yet.</p>
          <p className="small muted">Press <strong>Plan my week</strong> to have the team build one.</p>
        </div>
      )}
      {plan.data && (
        <>
          <div className="plan-head card">
            <div className="row-between wrap">
              <div>
                <p className="eyebrow">Week of {prettyDate(plan.data.week_start)} · {plan.data.status}</p>
                <p className="small prewrap">{plan.data.summary}</p>
              </div>
              <div className="savings">
                <span className="stat-value">{plan.data.batching_savings_minutes} min</span>
                <span className="tiny muted">saved by batching</span>
              </div>
            </div>
            {plan.data.warnings.length > 0 && (
              <ul className="flags">
                {plan.data.warnings.map((w, i) => (
                  <li key={i} className="flag flag-warn"><span className="flag-dot" />{w}</li>
                ))}
              </ul>
            )}
            <p className="tiny muted">
              Shopping list for this week: <Link to="/staff/shopping">open it →</Link>
              {plan.data.run_id ? <> · <Link to={`/staff/runs/${plan.data.run_id}`}>planning run</Link></> : null}
            </p>
          </div>
          <div className="plan-days">
            {byDay.map(([day, tasks]) => (
              <section key={day} className="plan-day">
                <h3>{prettyDate(day)}</h3>
                <ol className="plain">
                  {tasks.map((t) => (
                    <li key={t.id} className={`task task-${t.kind} ${t.batch ? "is-batch" : ""}`}>
                      <span className="task-time">
                        {prettyTime(t.start)}
                        <span className="tiny muted block">to {prettyTime(t.end)}</span>
                      </span>
                      <span className="task-body">
                        <span className="task-title">
                          <span aria-hidden="true">{KIND_ICON[t.kind] ?? "•"}</span> {t.title}
                          {t.batch && <span className="chip tiny batch">batch</span>}
                        </span>
                        {t.order_ids.length > 0 && (
                          <span className="tiny muted block">
                            Orders {t.order_ids.map((id, i) => (
                              <span key={id}>
                                {i ? ", " : ""}
                                <Link to={`/staff/orders/${id}`}>#{id}</Link>
                              </span>
                            ))}
                            {" · "}
                            {titleCase(t.kind)}
                          </span>
                        )}
                        {t.notes && <span className="small block">{t.notes}</span>}
                        {t.storage && <span className="tiny storage block">Storage: {t.storage}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
