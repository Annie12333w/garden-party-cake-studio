import { useState } from "react";
import { api } from "../../api";
import { ErrorNote } from "../../components/common";
import type { InventoryItem } from "../../types";
import { errMsg, useLoad } from "../../util";

/** Per-unit costs can be fractions of a cent (salt is $0.002/g), so show enough digits to be useful. */
function unitCost(v: number): string {
  if (v >= 0.1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(v >= 0.01 ? 3 : 4)}`;
}

export default function StaffInventory() {
  const inv = useLoad(() => api.inventory(), []);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "ingredient" | "supply" | "low">("all");

  const save = async (it: InventoryItem) => {
    const v = Number(edits[it.id]);
    if (Number.isNaN(v) || v < 0) {
      setError("Quantity must be zero or more.");
      return;
    }
    setError(null);
    try {
      const u = await api.updateInventory(it.id, v);
      inv.setData((cur) => (cur ?? []).map((x) => (x.id === u.id ? u : x)));
      setEdits((e) => {
        const n = { ...e };
        delete n[it.id];
        return n;
      });
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const rows = (inv.data ?? []).filter((i) =>
    filter === "all" ? true : filter === "low" ? i.qty_on_hand < i.par_level : i.category === filter,
  );

  return (
    <div>
      <header className="staff-head">
        <h1 className="display sm">Inventory</h1>
        <div className="filter-tabs small">
          {(["all", "ingredient", "supply", "low"] as const).map((f) => (
            <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "ingredient" ? "Ingredients" : f === "supply" ? "Supplies" : "Below par"}
            </button>
          ))}
        </div>
      </header>
      <p className="small muted">Confirmed receipts add stock automatically. Edit a count after a pantry check.</p>
      <ErrorNote error={error || inv.error} />
      <div className="card">
        <table className="table inventory-table">
          <colgroup>
            <col className="c-item" />
            <col className="c-type" />
            <col className="c-qty" />
            <col className="c-unit" />
            <col className="c-par" />
            <col className="c-pack" />
            <col className="c-cost" />
            <col className="c-store" />
            <col className="c-save" />
          </colgroup>
          <thead>
            <tr>
              <th>Item</th>
              <th>Type</th>
              <th className="num">On hand</th>
              <th>Unit</th>
              <th className="num">Par</th>
              <th>Pack</th>
              <th className="num">Unit cost</th>
              <th>Store</th>
              <th aria-label="Save" />
            </tr>
          </thead>
          <tbody>
            {rows.map((it) => {
              const low = it.qty_on_hand < it.par_level;
              const editing = edits[it.id] !== undefined;
              const name = it.label || it.item.replace(/_/g, " ");
              return (
                <tr key={it.id} className={low ? "low-row" : ""}>
                  <td>{name}</td>
                  <td className="tiny muted">{it.category}</td>
                  <td className="num">
                    <input
                      className="qty-input"
                      type="number"
                      min={0}
                      step="any"
                      aria-label={`${name} on hand (${it.unit})`}
                      value={editing ? edits[it.id] : it.qty_on_hand}
                      onChange={(e) => setEdits((x) => ({ ...x, [it.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter" && editing) void save(it); }}
                    />
                  </td>
                  <td className="tiny muted">{it.unit}</td>
                  <td className="num">{it.par_level} <span className="tiny muted">{it.unit}</span></td>
                  <td className="tiny">{it.pack_label}</td>
                  <td className="num">{unitCost(it.unit_cost)}<span className="tiny muted">/{it.unit}</span></td>
                  <td className="tiny muted">{it.store}</td>
                  <td>
                    {editing && (
                      <button className="btn btn-sm btn-primary" onClick={() => void save(it)}>Save</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
