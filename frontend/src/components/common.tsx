import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import type { Flag, Menu, OrderSpec, OrderStatus, Quote, RunDetail } from "../types";
import { STATUS_FLOW, STATUS_LABEL, money, prettyDate, prettyTime, sleep, titleCase } from "../util";

export function Flags({ flags }: { flags: Flag[] | undefined | null }) {
  if (!flags || flags.length === 0) return null;
  return (
    <ul className="flags" aria-label="Notes and warnings">
      {flags.map((f, i) => (
        <li key={`${f.code}-${i}`} className={`flag flag-${f.severity}`}>
          <span className="flag-dot" aria-hidden="true" />
          <span>{f.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function QuoteBox({ quote, title = "Your estimate", note }: { quote: Quote | null; title?: string; note?: ReactNode }) {
  if (!quote)
    return (
      <div className="quote-box empty">
        <h3>{title}</h3>
        <p className="muted small">Choose a size to see a price. Pricing is calculated by the studio's price table, not by the AI.</p>
      </div>
    );
  return (
    <div className="quote-box">
      <h3>{title}</h3>
      <table className="quote-table">
        <tbody>
          {quote.lines.map((l, i) => (
            <tr key={`${l.code}-${i}`}>
              <td>{l.label}</td>
              <td className="num">{money(l.amount, true)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="total">
            <td>Estimated total</td>
            <td className="num">{money(quote.total, true)}</td>
          </tr>
          <tr>
            <td className="muted">Deposit to hold the date (non-refundable)</td>
            <td className="num muted">{money(quote.deposit, true)}</td>
          </tr>
          <tr>
            <td className="muted">Balance at pickup</td>
            <td className="num muted">{money(quote.balance, true)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="tiny muted rule">
        {quote.rule} · serves about {quote.servings} · about {quote.labor_hours} hrs of studio time
      </p>
      {note}
      <Flags flags={quote.flags} />
    </div>
  );
}

export function StatusStepper({ status }: { status: OrderStatus }) {
  const off = ["declined", "cancelled", "expired"].includes(status);
  const idx = STATUS_FLOW.indexOf(status);
  if (off) return <div className={`status-pill status-${status}`}>{STATUS_LABEL[status]}</div>;
  return (
    <ol className="stepper" aria-label={`Order status: ${STATUS_LABEL[status]}`}>
      {STATUS_FLOW.map((s, i) => (
        <li key={s} className={i < idx ? "done" : i === idx ? "current" : ""}>
          <span className="step-dot" aria-hidden="true" />
          <span className="step-label">{STATUS_LABEL[s]}</span>
        </li>
      ))}
    </ol>
  );
}

export function StatusPill({ status }: { status: OrderStatus }) {
  return <span className={`status-pill status-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function lookupName(menu: Menu | null, kind: "cake" | "filling" | "frosting", code: string | undefined | null) {
  if (!code) return "–";
  return menu?.flavors[kind].find((f) => f.code === code)?.name ?? titleCase(code);
}

export function SpecSummary({ spec, menu }: { spec: Partial<OrderSpec>; menu: Menu | null }) {
  const size = menu?.sizes.find((s) => s.code === spec.size_code);
  const addonName = (c: string) => menu?.addons.find((a) => a.code === c)?.name ?? titleCase(c);
  return (
    <dl className="spec">
      <dt>Occasion</dt>
      <dd>{spec.occasion || "–"}{spec.recipient_name ? ` · for ${spec.recipient_name}` : ""}{spec.guest_count ? ` · ${spec.guest_count} guests` : ""}</dd>
      <dt>Size</dt>
      <dd>{size ? `${size.label} (serves about ${size.servings})` : spec.size_code || "–"}</dd>
      <dt>Flavors</dt>
      <dd>
        {lookupName(menu, "cake", spec.cake_flavor)} cake · {lookupName(menu, "filling", spec.filling)} filling ·{" "}
        {lookupName(menu, "frosting", spec.frosting)}
      </dd>
      <dt>Decoration</dt>
      <dd>
        {spec.addons && spec.addons.length
          ? spec.addons.map((a) => `${addonName(a.code)}${a.qty > 1 ? ` ×${a.qty}` : ""}`).join(", ")
          : "Studio's choice"}
      </dd>
      {spec.design_notes ? (
        <>
          <dt>Design notes</dt>
          <dd className="prewrap">{spec.design_notes}</dd>
        </>
      ) : null}
      {spec.message_on_cake ? (
        <>
          <dt>Message</dt>
          <dd>“{spec.message_on_cake}”</dd>
        </>
      ) : null}
      <dt>Allergies</dt>
      <dd>{spec.allergies || "None given"}{spec.dietary ? ` · ${spec.dietary}` : ""}</dd>
      <dt>{spec.fulfillment === "delivery" ? "Delivery" : "Pickup"}</dt>
      <dd>
        {prettyDate(spec.pickup_date)} {spec.pickup_time ? `at ${prettyTime(spec.pickup_time)}` : ""}
        {spec.fulfillment === "delivery" && spec.delivery_address ? ` · ${spec.delivery_address}` : ""}
      </dd>
    </dl>
  );
}

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title ? <h3>{title}</h3> : <span />}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <div className="error-note" role="alert">{error}</div>;
}

export function Bar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="bar" title={label}>
      <div className="bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Start/poll an agent run. Calls onDone when it stops running. */
export function useRunWatcher(onDone?: (run: RunDetail) => void) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [watching, setWatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const watch = async (runId: string) => {
    setWatching(true);
    setError(null);
    try {
      for (;;) {
        const r = await api.run(runId);
        if (!alive.current) return;
        setRun(r);
        if (r.status !== "running") {
          doneRef.current?.(r);
          break;
        }
        await sleep(1500);
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setWatching(false);
    }
  };
  return { run, watching, error, watch, setRun };
}

export const AGENT_META: Record<string, { label: string; emoji: string; color: string; role: string }> = {
  boss: { label: "Boss", emoji: "🌿", color: "#4d5b3a", role: "Directs the team and makes the final call" },
  order_taker: { label: "Order Taker", emoji: "💌", color: "#b8475a", role: "Takes orders, offers dates, schedules pickups" },
  recipe: { label: "Recipe Collector", emoji: "📖", color: "#c98a5a", role: "Picks well-reviewed recipes that fit the order" },
  recipe_collector: { label: "Recipe Collector", emoji: "📖", color: "#c98a5a", role: "Picks well-reviewed recipes that fit the order" },
  inventory: { label: "Inventory", emoji: "🧺", color: "#6f7f5a", role: "Tracks supplies and builds the Monday list" },
  cash: { label: "Cash Manager", emoji: "🪙", color: "#9a7b3f", role: "Watches cash in and out" },
  cash_manager: { label: "Cash Manager", emoji: "🪙", color: "#9a7b3f", role: "Watches cash in and out" },
  task: { label: "Task Planner", emoji: "⏱️", color: "#5f6f8a", role: "Batches prep into your work blocks" },
  task_planner: { label: "Task Planner", emoji: "⏱️", color: "#5f6f8a", role: "Batches prep into your work blocks" },
  system: { label: "System", emoji: "⚙️", color: "#8b8577", role: "Run bookkeeping" },
  human: { label: "You", emoji: "👩‍🍳", color: "#6f2c3f", role: "Owner" },
};
export function agentMeta(a: string | null | undefined) {
  if (!a) return AGENT_META.system;
  return AGENT_META[a] ?? { label: titleCase(a), emoji: "✿", color: "#8b8577", role: "" };
}
