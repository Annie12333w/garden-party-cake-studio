import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { useMenu } from "../menu";
import { ErrorNote, SpecSummary, StatusPill, StatusStepper } from "../components/common";
import type { Order } from "../types";
import { errMsg, money, prettyDate, prettyDateTime, prettyTime, useLoad } from "../util";

export default function AccountPage() {
  const { user } = useAuth();
  const { menu } = useMenu();
  const orders = useLoad(() => api.myOrders(), []);
  const ideas = useLoad(() => api.ideas(), []);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const replace = (o: Order) => orders.setData((cur) => (cur ?? []).map((x) => (x.id === o.id ? o : x)));
  const act = async (id: number, fn: () => Promise<Order>) => {
    setBusy(id);
    setError(null);
    try {
      replace(await fn());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const list = orders.data ?? [];
  const upcoming = list.filter((o) => !["completed", "declined", "cancelled", "expired"].includes(o.status));
  const past = list.filter((o) => ["completed", "declined", "cancelled", "expired"].includes(o.status));

  return (
    <div className="container section">
      <header className="page-head">
        <p className="eyebrow">Your account</p>
        <h1 className="display">Hello, {user?.name.split(" ")[0]}</h1>
        <p className="muted">Your cakes, their timing, and anything waiting on you.</p>
      </header>
      <ErrorNote error={orders.error || error} />

      <div className="account-grid">
        <div>
          <h2 className="display sm">Upcoming</h2>
          {orders.loading && !orders.data ? <p className="muted">Loading…</p> : null}
          {!orders.loading && upcoming.length === 0 && (
            <div className="card empty-card">
              <p>No cakes on the way yet.</p>
              <Link to="/order" className="btn btn-primary btn-sm">Start an order</Link>
            </div>
          )}
          {upcoming.map((o) => (
            <OrderCard key={o.id} o={o} menu={menu} busy={busy === o.id} act={act} />
          ))}
          {past.length > 0 && (
            <>
              <h2 className="display sm">Past cakes</h2>
              {past.map((o) => (
                <OrderCard key={o.id} o={o} menu={menu} busy={busy === o.id} act={act} compact />
              ))}
            </>
          )}
        </div>
        <aside>
          <div className="card ideas-card">
            <h3>Ideas for your next cake</h3>
            {ideas.loading && <p className="small muted">Gathering ideas from your past cakes…</p>}
            {ideas.error && <p className="small muted">Ideas aren't available right now.</p>}
            {ideas.data?.based_on?.length ? <p className="tiny muted">Based on: {ideas.data.based_on.join(" · ")}</p> : null}
            <ul className="plain idea-list">
              {(ideas.data?.ideas ?? []).map((i, k) => {
                const g = i.gallery_slug ? menu?.gallery.find((x) => x.slug === i.gallery_slug) : undefined;
                return (
                  <li key={k}>
                    <div className="idea-thumb">{g ? <img src={g.image} alt="" /> : <span aria-hidden="true">✿</span>}</div>
                    <div>
                      <strong>{i.title}</strong>
                      <p className="small">{i.description}</p>
                      <Link to={g ? `/order?inspo=${g.slug}` : "/order"} className="link-arrow tiny">Start from this →</Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function OrderCard({
  o,
  menu,
  busy,
  act,
  compact = false,
}: {
  o: Order;
  menu: ReturnType<typeof useMenu>["menu"];
  busy: boolean;
  act: (id: number, fn: () => Promise<Order>) => Promise<void>;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(!compact);
  const size = menu?.sizes.find((s) => s.code === o.spec.size_code);
  return (
    <article className="card order-card">
      <div className="row-between">
        <div>
          <p className="eyebrow">Order #{o.id}</p>
          <h3>
            {o.spec.occasion || "Celebration cake"} · {size?.label ?? o.spec.size_code}
          </h3>
          <p className="small muted">
            {o.spec.fulfillment === "delivery" ? "Delivery" : "Pickup"} {prettyDate(o.spec.pickup_date)}
            {o.spec.pickup_time ? ` at ${prettyTime(o.spec.pickup_time)}` : ""}
          </p>
        </div>
        <div className="right">
          <StatusPill status={o.status} />
          <p className="price">{money(o.final_price ?? o.quote.total, true)}</p>
          <p className="tiny muted">{o.final_price ? "final price" : "estimate"}</p>
        </div>
      </div>
      {!compact && <StatusStepper status={o.status} />}

      {o.invoices.length > 0 && (
        <div className="invoices">
          {o.invoices.map((inv) => (
            <div key={inv.id} className={`invoice inv-${inv.status}`}>
              <span>
                <strong>{inv.kind === "deposit" ? "Deposit" : "Balance"}</strong> {money(inv.amount, true)}
                {inv.due_date && inv.status === "issued" ? <span className="tiny muted"> · due {prettyDate(inv.due_date)}</span> : null}
              </span>
              {inv.status === "paid" ? (
                <span className="tiny ok-text">Paid {prettyDateTime(inv.paid_at)} (demo)</span>
              ) : inv.kind === "deposit" ? (
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void act(o.id, () => api.payInvoice(o.id, inv.id))}>
                  Pay deposit (demo)
                </button>
              ) : (
                <span className="tiny muted">Due at pickup</span>
              )}
            </div>
          ))}
          <p className="tiny muted">Demo payments only. No card is charged and no money moves.</p>
        </div>
      )}

      {o.status === "declined" && o.decline_reason && <p className="small warn-text">The studio couldn't take this one: {o.decline_reason}</p>}
      {o.owner_note && <p className="small note">Note from the studio: {o.owner_note}</p>}

      <div className="row gap wrap">
        <button className="link-btn small" onClick={() => setOpen((x) => !x)}>{open ? "Hide details" : "Show details"}</button>
        {o.calendar?.google_link && (
          <a className="link-btn small" href={o.calendar.google_link} target="_blank" rel="noreferrer">Add to Google Calendar</a>
        )}
        {o.status === "requested" && (
          <button
            className="link-btn small danger"
            disabled={busy}
            onClick={() => {
              if (confirm("Cancel this request and release the date?")) void act(o.id, () => api.cancelOrder(o.id));
            }}
          >
            Cancel request
          </button>
        )}
      </div>
      {open && (
        <div className="order-details">
          <SpecSummary spec={o.spec} menu={menu} />
          {o.timeline.length > 0 && (
            <ul className="timeline">
              {o.timeline.map((t, i) => (
                <li key={i}>
                  <span className="tiny muted">{prettyDateTime(t.ts)}</span> {t.note || t.status}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}
