import { useState } from "react";
import { api } from "../../api";
import { agentMeta, Card, ErrorNote, Stat } from "../../components/common";
import { money, num, titleCase, usd4, useLoad } from "../../util";

export default function StaffTokenomics() {
  const { data: t, error, loading } = useLoad(() => api.tokenomics(), []);
  const [ordersPerMonth, setOrdersPerMonth] = useState(20);

  const maxAgentCost = Math.max(0.000001, ...(t?.by_agent ?? []).map((a) => a.cost_usd));
  const maxFeature = Math.max(0.000001, ...(t?.by_feature ?? []).map((f) => f.avg_cost_usd));
  const cacheShare = t && t.totals.input_tokens ? t.totals.cached_tokens / t.totals.input_tokens : 0;
  const perBakery = t ? t.per_order_usd * ordersPerMonth : 0;

  return (
    <div>
      <header className="staff-head">
        <h1 className="display sm">Tokenomics</h1>
      </header>
      <p className="small muted">
        Every LLM call is logged to the audit trail with input, cached and output tokens. These numbers are measured, not guessed.
      </p>
      <ErrorNote error={error} />
      {loading && !t && <p className="muted small">Loading…</p>}
      {t && (
        <>
          <div className="stat-row">
            <Stat label="Total AI spend" value={usd4(t.totals.cost_usd)} sub={`${num(t.totals.llm_calls)} LLM calls`} />
            <Stat label="Input tokens" value={num(t.totals.input_tokens)} sub={`${Math.round(cacheShare * 100)}% served from cache`} />
            <Stat label="Output tokens" value={num(t.totals.output_tokens)} />
            <Stat label="Per order" value={usd4(t.per_order_usd)} sub="chat + photo + review + planning share" />
            <Stat label="Per bakery / month" value={usd4(t.per_user_month_usd)} />
          </div>

          <div className="tok-grid">
            <Card title="Cost by agent">
              <ul className="plain bars">
                {t.by_agent.map((a) => {
                  const m = agentMeta(a.agent);
                  return (
                    <li key={a.agent}>
                      <div className="row-between small">
                        <span>{m.emoji} {m.label}</span>
                        <span>{usd4(a.cost_usd)}</span>
                      </div>
                      <div className="bar"><div className="bar-fill" style={{ width: `${(a.cost_usd / maxAgentCost) * 100}%`, background: m.color }} /></div>
                      <span className="tiny muted">
                        {num(a.llm_calls)} calls · in {num(a.input_tokens)} (cached {num(a.cached_tokens)}) · out {num(a.output_tokens)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <Card title="Average cost per run, by feature">
              <ul className="plain bars">
                {t.by_feature.map((f) => (
                  <li key={f.feature}>
                    <div className="row-between small">
                      <span>{titleCase(f.feature)} <span className="tiny muted">({f.runs} runs)</span></span>
                      <span>{usd4(f.avg_cost_usd)}</span>
                    </div>
                    <div className="bar"><div className="bar-fill" style={{ width: `${(f.avg_cost_usd / maxFeature) * 100}%` }} /></div>
                    <span className="tiny muted">
                      avg in {num(Math.round(f.avg_input_tokens))} · cached {num(Math.round(f.avg_cached_tokens))} · out {num(Math.round(f.avg_output_tokens))}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="tok-grid">
            <Card title="At scale">
              <table className="table">
                <thead>
                  <tr>
                    <th>Bakeries using the app</th>
                    <th className="num">AI cost / month</th>
                    <th className="num">per bakery</th>
                  </tr>
                </thead>
                <tbody>
                  {t.projections.map((p) => (
                    <tr key={p.users}>
                      <td>{num(p.users)}</td>
                      <td className="num">{money(p.monthly_usd, true)}</td>
                      <td className="num">{usd4(p.users ? p.monthly_usd / p.users : 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="calc">
                <label className="small">
                  Try it: orders per bakery per month
                  <input type="range" min={1} max={120} value={ordersPerMonth} onChange={(e) => setOrdersPerMonth(Number(e.target.value))} />
                  <strong>{ordersPerMonth}</strong>
                </label>
                <p className="small">
                  ≈ {usd4(perBakery)} per bakery per month · {money(perBakery * 100, true)} for 100 bakeries ·{" "}
                  {money(perBakery * 10000, true)} for 10,000
                </p>
                <p className="tiny muted">For scale: one cake is at least {money(150)}.</p>
              </div>
              <ul className="tiny muted">
                {t.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </Card>
            <Card title="How we keep it cheap">
              <p className="tiny muted">
                {t.prices.model}: {money(t.prices.input_per_m, true)} / 1M input · {money(t.prices.cached_input_per_m, true)} / 1M cached ·{" "}
                {money(t.prices.output_per_m, true)} / 1M output
              </p>
              <ul className="cut-list">
                {t.cost_cutting.map((c, i) => (
                  <li key={i}>
                    <strong className="small">{c.step}</strong>
                    <span className="small block muted">{c.effect}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
