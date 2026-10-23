import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { useMenu } from "../../menu";
import { Card, ErrorNote, Flags, QuoteBox, SpecSummary, StatusPill, StatusStepper, useRunWatcher } from "../../components/common";
import RunLog from "../../components/RunLog";
import type { Order, OrderStatus } from "../../types";
import { STATUS_LABEL, errMsg, money, prettyDate, prettyDateTime, prettyTime, useLoad } from "../../util";

// The one-click next step shown on an order card in the list.
type QuickStep = { to: "in_production" | "ready" | "completed"; label: string };
function quickNext(o: Order): QuickStep | undefined {
  if (o.status === "confirmed") return { to: "in_production", label: "Mark in kitchen" };
  if (o.status === "in_production") return { to: "ready", label: "Mark ready" };
  if (o.status === "ready")
    return { to: "completed", label: o.spec.fulfillment === "delivery" ? "Mark delivered" : "Mark picked up" };
  return undefined;
}

const FILTERS: { key: string; label: string }[] = [
  { key: "requested", label: "To review" },
  { key: "accepted", label: "Deposit due" },
  { key: "confirmed", label: "Confirmed" },
  { key: "in_production", label: "In kitchen" },
  { key: "ready", label: "Ready" },
  { key: "", label: "All" },
];

export default function StaffOrders() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? (id ? "" : "requested");
  const orders = useLoad(() => api.staffOrders(status || undefined), [status]);
  const nav = useNavigate();
  const selectedId = id ? Number(id) : null;
  const [detailVersion, setDetailVersion] = useState(0);
  const [quickBusy, setQuickBusy] = useState<number | null>(null);
  const [quickError, setQuickError] = useState<string | null>(null);

  // One-click status move from the list (e.g. Confirmed -> In kitchen) without opening the order.
  const quickMove = async (o: Order, to: QuickStep["to"]) => {
    const orderId = o.id;
    setQuickBusy(orderId);
    setQuickError(null);
    try {
      if (to === "completed") {
        // Handing the cake over closes the order: record the balance (demo payment) if it's still open.
        const balance = o.invoices.find((i) => i.kind === "balance");
        if (balance && balance.status !== "paid") await api.balancePaid(orderId);
        else await api.setStatus(orderId, "completed");
      } else {
        await api.setStatus(orderId, to);
      }
      await orders.reload();
      setDetailVersion((v) => v + 1); // refresh the open order if it's this one
    } catch (e) {
      setQuickError(errMsg(e));
    } finally {
      setQuickBusy(null);
    }
  };

  return (
    <div>
      <header className="staff-head">
        <h1 className="display sm">Orders</h1>
      </header>
      <div className="filter-tabs" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={status === f.key}
            className={status === f.key ? "active" : ""}
            onClick={() => setParams(f.key ? { status: f.key } : { status: "" })}
          >
            {f.label}
          </button>
        ))}
      </div>
      <ErrorNote error={orders.error} />
      <div className="orders-split">
        <div className="order-list">
          {orders.loading && !orders.data && <p className="muted small">Loading…</p>}
          {orders.data?.length === 0 && <p className="muted small">No orders here.</p>}
          {(orders.data ?? []).map((o) => {
            const quick = quickNext(o);
            const open = () => nav(`/staff/orders/${o.id}?status=${status}`);
            return (
              <div
                key={o.id}
                role="button"
                tabIndex={0}
                className={`order-li ${selectedId === o.id ? "on" : ""}`}
                onClick={open}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
              >
                <div className="row-between">
                  <strong>#{o.id} · {o.customer.name}</strong>
                  <StatusPill status={o.status} />
                </div>
                <span className="small">{o.spec.occasion} · {o.spec.size_code}</span>
                <div className="order-li-foot">
                  <span className="tiny muted">
                    {prettyDate(o.spec.pickup_date)} {prettyTime(o.spec.pickup_time)} · {money(o.final_price ?? o.quote.total)}
                    {o.flags.some((f) => f.severity !== "info") ? " · ⚠ flags" : ""}
                  </span>
                  {quick && (
                    <button
                      className="btn btn-sm btn-primary order-li-quick"
                      disabled={quickBusy === o.id}
                      onClick={(e) => {
                        e.stopPropagation(); // don't also open the order
                        void quickMove(o, quick.to);
                      }}
                    >
                      {quickBusy === o.id ? "Saving…" : quick.label}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {quickError && <p className="tiny danger">{quickError}</p>}
        </div>
        <div className="order-detail">
          {selectedId ? (
            <OrderDetail key={`${selectedId}-${detailVersion}`} id={selectedId} onChanged={() => void orders.reload()} />
          ) : (
            <div className="card empty-card">
              <p className="muted">Pick an order to review it.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OrderDetail({ id, onChanged }: { id: number; onChanged: () => void }) {
  const { menu } = useMenu();
  const { data: o, setData, error, loading, reload } = useLoad(() => api.order(id), [id]);
  const [price, setPrice] = useState<string>("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const runner = useRunWatcher(() => {
    void reload();
  });

  useEffect(() => {
    if (o) setPrice(String(o.final_price ?? o.quote.total));
    setReason("");
    setNote(o?.owner_note ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o?.id]);

  const act = async (fn: () => Promise<Order>) => {
    setBusy(true);
    setActError(null);
    try {
      setData(await fn());
      onChanged();
    } catch (e) {
      setActError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const startReview = async () => {
    setActError(null);
    try {
      const r = await api.reviewOrder(id);
      void runner.watch(r.run_id);
    } catch (e) {
      setActError(errMsg(e));
    }
  };

  if (loading && !o) return <p className="muted">Loading…</p>;
  if (error) return <ErrorNote error={error} />;
  if (!o) return null;

  const next: Partial<Record<OrderStatus, "in_production" | "ready" | "completed">> = {
    confirmed: "in_production",
    in_production: "ready",
    ready: "completed",
  };
  const balance = o.invoices.find((i) => i.kind === "balance");

  return (
    <div className="detail-stack">
      <Card
        title={
          <>
            #{o.id} · {o.spec.occasion} <StatusPill status={o.status} />
          </>
        }
        actions={<span className="tiny muted">received {prettyDateTime(o.created_at)}</span>}
      >
        <StatusStepper status={o.status} />
        <div className="grid-2 top">
          <div>
            <p className="small">
              <strong>{o.customer.name}</strong> · <a href={`mailto:${o.customer.email}`}>{o.customer.email}</a>
              {o.customer.phone ? ` · ${o.customer.phone}` : ""}
            </p>
            <SpecSummary spec={o.spec} menu={menu} />
            {o.status === "requested" && o.hold_expires_at && (
              <p className="tiny muted">Date held until {prettyDateTime(o.hold_expires_at)}</p>
            )}
          </div>
          <div>
            <QuoteBox quote={o.quote} title="Calculated quote" />
          </div>
        </div>
        <Flags flags={o.flags} />
      </Card>

      {o.inspiration && (
        <Card title="Inspiration photo">
          <div className="analysis">
            <img src={o.inspiration.image_url} alt="Customer inspiration" />
            {o.inspiration.analysis && (
              <div>
                <p className="small">{o.inspiration.analysis.summary}</p>
                <p className="tiny">Style fit: <span className={`fit fit-${o.inspiration.analysis.natural_style_fit}`}>{o.inspiration.analysis.natural_style_fit}</span></p>
                <p className="tiny muted">Elements: {o.inspiration.analysis.elements.join(", ") || "–"}</p>
                <p className="tiny muted">Colors: {o.inspiration.analysis.colors.join(", ") || "–"}</p>
                {o.inspiration.analysis.concerns.length > 0 && (
                  <p className="tiny warn-text">Concerns: {o.inspiration.analysis.concerns.join("; ")}</p>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      <Card
        title="AI team review"
        actions={
          <button className="btn btn-sm btn-ghost" onClick={() => void startReview()} disabled={runner.watching}>
            {runner.watching ? "Team is reviewing…" : o.ai_review ? "Run again" : "Run AI review"}
          </button>
        }
      >
        {o.ai_review ? (
          <div className="ai-review">
            <p className="small"><strong>Recommendation:</strong> {o.ai_review.recommendation}</p>
            <p className="small prewrap">{o.ai_review.summary}</p>
            {o.ai_review.risks && o.ai_review.risks.length > 0 && (
              <>
                <p className="small"><strong>Risks the team flagged:</strong></p>
                <ul className="small">
                  {o.ai_review.risks.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </>
            )}
            <p className="tiny muted">
              {prettyDateTime(o.ai_review.created_at)} · <Link to={`/staff/runs/${o.ai_review.run_id}`}>see the full run</Link>
            </p>
          </div>
        ) : (
          !runner.run && <p className="small muted">The Boss checks capacity, recipes, supplies, cash and risks, then recommends accept, adjust or decline. You make the call.</p>
        )}
        {o.recipes && (
          <p className="tiny muted">
            Recipes: {[o.recipes.cake, o.recipes.filling, o.recipes.frosting].filter(Boolean).map((r) => r!.name).join(" · ")}
          </p>
        )}
        <ErrorNote error={runner.error} />
        {runner.run && <RunLog run={runner.run} compact />}
      </Card>

      <Card title="Your decision">
        <ErrorNote error={actError} />
        {o.status === "requested" && (
          <div className="decision">
            <label>
              Final price
              <span className="money-input">
                $<input type="number" min={0} step="1" value={price} onChange={(e) => setPrice(e.target.value)} />
              </span>
              <span className="tiny muted">Quote was {money(o.quote.total, true)}. Deposit will be {Math.round(((o.quote.deposit / (o.quote.total || 1)) || 0.5) * 100)}%.</span>
            </label>
            <label>
              Note to customer <span className="muted">(optional)</span>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="row gap">
              <button
                className="btn btn-primary"
                disabled={busy || !(Number(price) > 0)}
                onClick={() => void act(() => api.accept(o.id, Number(price), note || undefined))}
              >
                Accept &amp; send deposit invoice
              </button>
            </div>
            <div className="decline-row">
              <input placeholder="Reason for declining (shared with the customer)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="btn btn-ghost danger" disabled={busy || !reason.trim()} onClick={() => void act(() => api.decline(o.id, reason.trim()))}>
                Decline
              </button>
            </div>
          </div>
        )}
        {o.status !== "requested" && (
          <div className="decision">
            <p className="small">
              Final price <strong>{money(o.final_price, true)}</strong> · deposit {money(o.deposit_amount, true)} · balance {money(o.balance_amount, true)}
            </p>
            <div className="invoices">
              {o.invoices.map((inv) => (
                <div key={inv.id} className={`invoice inv-${inv.status}`}>
                  <span>{inv.kind === "deposit" ? "Deposit" : "Balance"} {money(inv.amount, true)}</span>
                  <span className="tiny">{inv.status === "paid" ? `paid ${prettyDateTime(inv.paid_at)} (demo)` : "issued"}</span>
                </div>
              ))}
            </div>
            <div className="row gap wrap">
              {next[o.status] && (
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act(() => api.setStatus(o.id, next[o.status]!))}>
                  Mark {STATUS_LABEL[next[o.status]!].toLowerCase()}
                </button>
              )}
              {["confirmed", "in_production", "ready", "completed"].includes(o.status) && (!balance || balance.status !== "paid") && (
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void act(() => api.balancePaid(o.id))}>
                  Record balance paid (demo)
                </button>
              )}
              {o.calendar?.google_link && (
                <a className="btn btn-ghost btn-sm" href={o.calendar.google_link} target="_blank" rel="noreferrer">Google Calendar</a>
              )}
            </div>
            {o.decline_reason && <p className="small warn-text">Declined: {o.decline_reason}</p>}
          </div>
        )}
      </Card>

      {o.timeline.length > 0 && (
        <Card title="Timeline">
          <ul className="timeline">
            {o.timeline.map((t, i) => (
              <li key={i}>
                <span className="tiny muted">{prettyDateTime(t.ts)} · {t.actor}</span> {t.note || t.status}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
