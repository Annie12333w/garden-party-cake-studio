import { useState } from "react";
import { api } from "../../api";
import { Card, ErrorNote } from "../../components/common";
import { prettyDateTime, titleCase, useLoad } from "../../util";

const DEFENSES = [
  ["Prompt injection", "Customer messages, order notes, emails and recipe web pages are scanned and wrapped as untrusted data. Instructions inside them are never followed."],
  ["Price manipulation", "Prices come only from the price table in code. The AI can't set, discount or approve a price; only you can, at acceptance."],
  ["Overbooking", "Dates come from the capacity calculator. The server re-checks capacity when an order is submitted."],
  ["Money", "Agents can't move money. Demo payments and receipts change the ledger only through your buttons."],
  ["Overspending", "Per-run step, token and dollar limits, a studio-wide spend limit, and chat rate limits per visitor."],
  ["Allergens", "Allergens are tracked per flavor and add-on, and flagged on every order. The AI never promises allergen-free."],
  ["Accounts", "Salted PBKDF2 passwords, hashed session tokens, login rate limiting, and server-side role checks."],
];

export default function StaffSafety() {
  const { data, error, loading } = useLoad(() => api.safety(), []);
  const [sev, setSev] = useState<"all" | "block" | "warn" | "info">("all");
  const rows = (data?.events ?? []).filter((e) => sev === "all" || e.severity === sev);
  return (
    <div>
      <header className="staff-head">
        <h1 className="display sm">Safety</h1>
        <div className="filter-tabs small">
          {(["all", "block", "warn", "info"] as const).map((s) => (
            <button key={s} className={sev === s ? "active" : ""} onClick={() => setSev(s)}>{s === "all" ? "All" : titleCase(s)}</button>
          ))}
        </div>
      </header>
      <Card title="Defenses in place">
        <dl className="defenses">
          {DEFENSES.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className="small muted">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <ErrorNote error={error} />
      <Card title="Guardrail catches (from the audit trail)">
        {loading && !data && <p className="muted small">Loading…</p>}
        {rows.length === 0 && !loading && <p className="muted small">Nothing caught yet.</p>}
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Severity</th>
              <th>Kind</th>
              <th>Where</th>
              <th>What happened</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              <tr key={i} className={`sev-row sev-${e.severity}`}>
                <td className="tiny">{prettyDateTime(e.ts)}</td>
                <td><span className={`chip tiny sev-${e.severity}`}>{e.severity}</span></td>
                <td className="small">{titleCase(e.kind)}</td>
                <td className="tiny muted">{e.where}</td>
                <td className="small">
                  {e.message}
                  {e.excerpt && <blockquote className="excerpt tiny">{e.excerpt}</blockquote>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
