import { useEffect, useState } from "react";
import { api } from "../../api";
import { Card, ErrorNote } from "../../components/common";
import type { Settings, WorkBlock } from "../../types";
import { errMsg, useLoad, weekdayName } from "../../util";
import { loadMenu } from "../../menu";

export default function StaffSettings() {
  const { data, error } = useLoad(() => api.settings(), []);
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setS(data);
  }, [data]);

  if (!s) return <div><ErrorNote error={error} /><p className="muted small">Loading…</p></div>;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const setBlock = (i: number, patch: Partial<WorkBlock>) =>
    set("work_blocks", s.work_blocks.map((b, k) => (k === i ? { ...b, ...patch } : b)));

  const save = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const saved = await api.saveSettings(s);
      setS(saved);
      void loadMenu(true);
      setMsg("Saved. New quotes and availability use these settings.");
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!confirm("Rebuild the demo database from the seed? All orders, runs' data and cash changes since the seed will be replaced (the audit trail is kept).")) return;
    try {
      await api.resetDemo();
      setMsg("Demo data rebuilt.");
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  return (
    <div>
      <header className="staff-head">
        <h1 className="display sm">Settings</h1>
      </header>
      <ErrorNote error={err} />
      {msg && <div className="ok-note">{msg}</div>}
      <div className="settings-grid">
        <Card title="Pricing">
          <label>
            Per-serving rate ($)
            <input type="number" step="0.5" min={1} value={s.per_serving_rate} onChange={(e) => set("per_serving_rate", Number(e.target.value))} />
          </label>
          <label>
            Minimum price ($)
            <input type="number" step="5" min={0} value={s.min_price} onChange={(e) => set("min_price", Number(e.target.value))} />
          </label>
          <label>
            Deposit (%)
            <input
              type="number"
              step="5"
              min={0}
              max={100}
              value={Math.round(s.deposit_pct * 100)}
              onChange={(e) => set("deposit_pct", Number(e.target.value) / 100)}
            />
          </label>
          <label>
            Minimum notice (days)
            <input type="number" min={1} max={60} value={s.min_lead_days} onChange={(e) => set("min_lead_days", Number(e.target.value))} />
          </label>
          <p className="tiny muted">Benchmark: Lovely Cakes (Stratford, CT) has a $150 minimum, from $8 per serving for buttercream, a 50% non-refundable deposit and 7 days' notice.</p>
        </Card>
        <Card title="Work blocks">
          <p className="tiny muted">The hours you bake. Availability and the production plan only use these.</p>
          <table className="table compact">
            <thead>
              <tr>
                <th>Day</th>
                <th>Start</th>
                <th>End</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.work_blocks.map((b, i) => (
                <tr key={i}>
                  <td>
                    <select value={b.weekday} onChange={(e) => setBlock(i, { weekday: Number(e.target.value) })} aria-label="Day">
                      {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                        <option key={d} value={d}>{weekdayName(d)}</option>
                      ))}
                    </select>
                  </td>
                  <td><input type="time" value={b.start} onChange={(e) => setBlock(i, { start: e.target.value })} aria-label="Start" /></td>
                  <td><input type="time" value={b.end} onChange={(e) => setBlock(i, { end: e.target.value })} aria-label="End" /></td>
                  <td>
                    <button className="link-btn tiny danger" onClick={() => set("work_blocks", s.work_blocks.filter((_, k) => k !== i))}>remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="link-btn small" onClick={() => set("work_blocks", [...s.work_blocks, { weekday: 1, start: "13:00", end: "18:00" }])}>
            + Add a block
          </button>
        </Card>
        <Card title="AI spend">
          <label>
            Spend limit ($)
            <input type="number" step="0.5" min={0.1} value={s.spend_limit_usd} onChange={(e) => set("spend_limit_usd", Number(e.target.value))} />
          </label>
          <p className="tiny muted">Agents stop and nothing new starts once total AI spend reaches this limit.</p>
        </Card>
        <Card title="Demo data">
          <p className="small muted">Rebuild the seeded test database (customers, staff, orders, cash and supplies), with dates relative to today.</p>
          <button className="btn btn-ghost btn-sm danger" onClick={() => void reset()}>Reset demo data</button>
        </Card>
      </div>
      <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save settings"}</button>
    </div>
  );
}
