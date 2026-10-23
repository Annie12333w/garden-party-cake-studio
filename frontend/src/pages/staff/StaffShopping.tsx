import { useMemo, useState } from "react";
import { api } from "../../api";
import { ErrorNote, Stat } from "../../components/common";
import { errMsg, money, num, prettyDate, useLoad } from "../../util";
import { defaultWeek, weekOptions } from "./StaffPlan";

export default function StaffShopping() {
  const weeks = weekOptions();
  const [week, setWeek] = useState(defaultWeek(weeks));
  const list = useLoad(() => api.shoppingList(week), [week]);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const m = new Map<string, NonNullable<typeof list.data>["items"]>();
    for (const it of list.data?.items ?? []) m.set(it.category, [...(m.get(it.category) ?? []), it]);
    return [...m.entries()];
  }, [list.data]);

  const approve = async () => {
    if (!list.data) return;
    setError(null);
    try {
      list.setData(await api.approveShoppingList(list.data.id));
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const l = list.data;
  const toBuy = l?.items.filter((i) => i.to_buy > 0) ?? [];

  return (
    <div>
      <header className="staff-head">
        <h1 className="display sm">Monday shopping list</h1>
        <div className="row gap wrap">
          <select value={week} onChange={(e) => setWeek(e.target.value)} aria-label="Week">
            {weeks.map((w) => (
              <option key={w.value} value={w.value}>{w.label}</option>
            ))}
          </select>
          {l && l.status === "draft" && (
            <button className="btn btn-primary btn-sm" onClick={() => void approve()}>Approve list</button>
          )}
          {l && <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>Print</button>}
        </div>
      </header>
      <ErrorNote error={error || list.error} />
      {list.loading && !l && <p className="muted small">Loading…</p>}
      {!list.loading && !l && (
        <div className="card empty-card">
          <p>No list for the week of {prettyDate(week)} yet.</p>
          <p className="small muted">Run <strong>Plan my week</strong> on the Production plan page; the Inventory agent builds the list from your orders and stock.</p>
        </div>
      )}
      {l && (
        <>
          <div className="stat-row">
            <Stat label="Shopping day" value={prettyDate(l.shop_date)} />
            <Stat label="Items to buy" value={toBuy.length} sub={`${l.items.length} checked`} />
            <Stat label="Estimated cost" value={money(l.est_total, true)} />
            <Stat label="Cash after shopping" value={money(l.cash_after, true)} tone={l.cash_after < 0 ? "bad" : l.cash_after < 100 ? "warn" : "ok"} />
            <Stat label="Status" value={l.status === "approved" ? "Approved" : "Draft"} tone={l.status === "approved" ? "ok" : undefined} />
          </div>
          {l.cash_after < 0 && <div className="error-note">This list costs more than the cash on hand. Collect deposits or trim the list first.</div>}
          {groups.map(([cat, items]) => (
            <section key={cat} className="card shop-group">
              <h3>{cat}</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th aria-label="Got it" />
                    <th>Item</th>
                    <th className="num">Need</th>
                    <th className="num">On hand</th>
                    <th className="num">To buy</th>
                    <th>Buy</th>
                    <th className="num">Est.</th>
                    <th>For orders</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.item} className={it.to_buy <= 0 ? "dim" : checked[it.item] ? "done-row" : ""}>
                      <td>
                        {it.to_buy > 0 && (
                          <input
                            type="checkbox"
                            aria-label={`Got ${it.item}`}
                            checked={!!checked[it.item]}
                            onChange={(e) => setChecked((c) => ({ ...c, [it.item]: e.target.checked }))}
                          />
                        )}
                      </td>
                      <td>{it.item}</td>
                      <td className="num">{num(it.need)} {it.unit}</td>
                      <td className="num">{num(it.on_hand)} {it.unit}</td>
                      <td className="num"><strong>{it.to_buy > 0 ? `${num(it.to_buy)} ${it.unit}` : "–"}</strong></td>
                      <td>{it.to_buy > 0 ? `${it.packs} × ${it.pack_label}` : "have enough"}</td>
                      <td className="num">{it.est_cost ? money(it.est_cost, true) : "–"}</td>
                      <td className="tiny">{it.for_orders.map((o) => `#${o}`).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
