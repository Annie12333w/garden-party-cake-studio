import { Link } from "react-router-dom";
import { api } from "../../api";
import { Bar, Card, ErrorNote, Stat } from "../../components/common";
import { money, prettyDate, prettyDateTime, prettyTime, usd4, useLoad } from "../../util";

export default function StaffDashboard() {
  const { data: d, error, loading } = useLoad(() => api.dashboard(), []);
  return (
    <div>
      <header className="staff-head">
        <div>
          <p className="eyebrow">{d ? prettyDate(d.today, { year: "numeric" }) : "Today"}</p>
          <h1 className="display sm">Good afternoon</h1>
        </div>
        <div className="row gap">
          <Link to="/staff/orders?status=requested" className="btn btn-primary btn-sm">Review requests</Link>
          <Link to="/staff/plan" className="btn btn-ghost btn-sm">Plan my week</Link>
        </div>
      </header>
      <ErrorNote error={error} />
      {loading && !d && <p className="muted">Loading…</p>}
      {d && (
        <>
          <div className="stat-row">
            <Stat label="Cash on hand" value={money(d.cash_balance, true)} sub="includes demo deposits" />
            <Stat label="Requests to review" value={d.pending_requests} tone={d.pending_requests ? "warn" : undefined} />
            <Stat label="Awaiting deposit" value={d.awaiting_deposit} />
            <Stat
              label="This week's studio hours"
              value={`${d.week_hours.committed} / ${d.week_hours.capacity} h`}
              sub={<Bar value={d.week_hours.committed} max={d.week_hours.capacity} />}
              tone={d.week_hours.committed > d.week_hours.capacity ? "bad" : undefined}
            />
            <Stat
              label="AI spend"
              value={usd4(d.spend.total_usd)}
              sub={
                <>
                  <Bar value={d.spend.total_usd} max={d.spend.limit_usd} />
                  <span className="tiny muted">limit {money(d.spend.limit_usd, true)} · today {usd4(d.spend.today_usd)}</span>
                </>
              }
            />
          </div>

          <div className="dash-grid">
            <Card title="Coming up this week" actions={<Link to="/staff/calendar" className="small">Calendar →</Link>}>
              {d.this_week.length === 0 ? (
                <p className="muted small">Nothing scheduled this week.</p>
              ) : (
                <ul className="plain agenda">
                  {d.this_week.map((e, i) => (
                    <li key={i}>
                      <span className="agenda-date">
                        {prettyDate(e.date)}
                        <span className="tiny muted block">{prettyTime(e.time)}</span>
                      </span>
                      <span>
                        <Link to={`/staff/orders/${e.order_id}`}>
                          <strong>{e.title}</strong>
                        </Link>
                        <span className="tiny muted block">
                          {e.customer} · {e.fulfillment}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Running low" actions={<Link to="/staff/inventory" className="small">Inventory →</Link>}>
              {d.low_stock.length === 0 ? (
                <p className="muted small">Everything is above its par level.</p>
              ) : (
                <ul className="plain low-list">
                  {d.low_stock.map((l, i) => (
                    <li key={i} className="row-between">
                      <span>{l.item}</span>
                      <span className="small warn-text">
                        {l.qty_on_hand} / {l.par_level} {l.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Recent safety catches" actions={<Link to="/staff/safety" className="small">All →</Link>}>
              {d.recent_safety.length === 0 ? (
                <p className="muted small">No guardrail events yet.</p>
              ) : (
                <ul className="plain">
                  {d.recent_safety.slice(0, 5).map((s, i) => (
                    <li key={i} className={`safety-li sev-${s.severity}`}>
                      <span className="tiny muted">{prettyDateTime(s.ts)} · {s.where}</span>
                      <span className="small block">{s.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
