import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { Card, ErrorNote, Flags, Stat } from "../../components/common";
import type { Receipt, ReceiptItem } from "../../types";
import { errMsg, money, prettyDate, useLoad } from "../../util";

export default function StaffCash() {
  const cash = useLoad(() => api.cash(), []);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Receipt | null>(null);

  const upload = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const r = await api.uploadReceipt(file);
      setEditing(r);
      void cash.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setUploading(false);
    }
  };

  const c = cash.data;
  const pending = c?.pending_receipts ?? [];

  return (
    <div>
      <header className="staff-head">
        <h1 className="display sm">Cash</h1>
        <label className="btn btn-primary btn-sm upload-btn">
          {uploading ? "Reading receipt…" : "Upload a receipt"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </label>
      </header>
      <p className="small muted">
        Seeded with {money(c?.seed ?? 1000)} for groceries. Money in comes from demo deposits and balances; money out comes from
        receipts you confirm. No real payments are made.
      </p>
      <ErrorNote error={error || cash.error} />
      {c && (
        <div className="stat-row">
          <Stat label="Balance" value={money(c.balance, true)} tone={c.balance < 0 ? "bad" : c.balance < 150 ? "warn" : "ok"} />
          <Stat label="Seed" value={money(c.seed, true)} />
          <Stat label="Money in" value={money(c.money_in, true)} sub="deposits + balances (demo)" />
          <Stat label="Money out" value={money(c.money_out, true)} sub="receipts" />
        </div>
      )}

      {editing && editing.status === "pending" && (
        <ReceiptEditor
          receipt={editing}
          onClose={() => setEditing(null)}
          onConfirmed={() => {
            setEditing(null);
            void cash.reload();
          }}
          onRejected={() => {
            setEditing(null);
            void cash.reload();
          }}
        />
      )}

      {pending.length > 0 && !editing && (
        <Card title="Receipts waiting for you">
          <ul className="plain">
            {pending.map((r) => (
              <li key={r.id} className="row-between">
                <span>{r.vendor || "Receipt"} · {prettyDate(r.date)} · {money(r.total, true)}</span>
                <span className="row gap">
                  {r.flags.some((f) => f.code === "injection_detected" || f.code === "possible_duplicate") && (
                    <span className="chip tiny sev-warn">suspicious</span>
                  )}
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing(r)}>Check &amp; confirm or reject</button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {c && (
        <div className="cash-grid">
          <Card title="Ledger">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th className="num">In</th>
                  <th className="num">Out</th>
                </tr>
              </thead>
              <tbody>
                {c.ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="tiny">{prettyDate(l.date)}</td>
                    <td>
                      {l.description}
                      {l.order_id ? <> · <Link to={`/staff/orders/${l.order_id}`}>#{l.order_id}</Link></> : null}
                      {l.demo && <span className="chip tiny">demo</span>}
                    </td>
                    <td className="tiny muted">{l.category}</td>
                    <td className="num ok-text">{l.direction === "in" ? money(l.amount, true) : ""}</td>
                    <td className="num">{l.direction === "out" ? money(l.amount, true) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Margin by order (estimate)">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th className="num">Revenue</th>
                  <th className="num">Ingredients</th>
                  <th className="num">Margin</th>
                </tr>
              </thead>
              <tbody>
                {c.by_order.map((o) => (
                  <tr key={o.order_id}>
                    <td>
                      <Link to={`/staff/orders/${o.order_id}`}>#{o.order_id}</Link> <span className="tiny muted">{o.customer}</span>
                    </td>
                    <td className="num">{money(o.revenue, true)}</td>
                    <td className="num">{money(o.ingredient_cost_est, true)}</td>
                    <td className="num"><strong>{money(o.margin_est, true)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="tiny muted">Ingredient cost uses scaled recipes × unit costs from inventory. Labor isn't counted.</p>
          </Card>
        </div>
      )}
    </div>
  );
}

function ReceiptEditor({ receipt, onClose, onConfirmed, onRejected }: { receipt: Receipt; onClose: () => void; onConfirmed: () => void; onRejected: () => void }) {
  const suspicious = receipt.flags.some((f) => f.code === "injection_detected" || f.code === "possible_duplicate");
  const [reason, setReason] = useState(
    receipt.flags.some((f) => f.code === "injection_detected")
      ? "Fictitious receipt: contains instructions to the AI."
      : receipt.flags.some((f) => f.code === "possible_duplicate")
        ? "Duplicate of a receipt already recorded."
        : "",
  );
  const [vendor, setVendor] = useState(receipt.vendor);
  const [date, setDate] = useState(receipt.date);
  const [items, setItems] = useState<ReceiptItem[]>(receipt.items);
  const inventory = useLoad(() => api.inventory(), []);
  const invById = new Map((inventory.data ?? []).map((i) => [i.id, i]));
  /** Pick (or change) the inventory item for a line; its store pack becomes the unit. */
  const setInventory = (k: number, value: string) => {
    const id = value ? Number(value) : null;
    const prev = items[k]?.inventory_id ? invById.get(items[k].inventory_id!) : undefined;
    const next = id ? invById.get(id) : undefined;
    upd(k, {
      inventory_id: id,
      inventory_label: next?.label ?? null,
      // replace the unit only if it was empty or came from the previous match
      ...(next && (!items[k].unit || items[k].unit === prev?.pack_label) ? { unit: next.pack_label } : {}),
    });
  };
  const addLine = () =>
    setItems((cur) => [...cur, { item: "", qty: 1, unit: "", line_total: 0, inventory_id: null, inventory_label: null }]);
  const [total, setTotal] = useState(String(receipt.total));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sum = items.reduce((s, i) => s + (Number(i.line_total) || 0), 0);
  const upd = (k: number, patch: Partial<ReceiptItem>) => setItems((cur) => cur.map((x, i) => (i === k ? { ...x, ...patch } : x)));

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.confirmReceipt(receipt.id, { vendor, date, total: Number(total), items });
      onConfirmed();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.rejectReceipt(receipt.id, reason);
      onRejected();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Check the receipt before it hits the books" actions={<button className="link-btn small" onClick={onClose}>Later</button>}>
      <div className="receipt-edit">
        {receipt.image_url && <img src={receipt.image_url} alt="Receipt" className="receipt-img" />}
        <div>
          <p className="tiny muted">Read by AI. Please check every line; nothing is recorded until you confirm.</p>
          <Flags flags={receipt.flags} />
          <div className="grid-3">
            <label>Store<input value={vendor} onChange={(e) => setVendor(e.target.value)} /></label>
            <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label>Total<input type="number" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} /></label>
          </div>
          <table className="table compact">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Qty</th>
                <th>Unit (store pack)</th>
                <th className="num">Line total</th>
                <th>Inventory</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((it, k) => (
                <tr key={k}>
                  <td><input value={it.item} onChange={(e) => upd(k, { item: e.target.value })} aria-label="Item" /></td>
                  <td className="num"><input type="number" step="any" value={it.qty} onChange={(e) => upd(k, { qty: Number(e.target.value) })} aria-label="Quantity" /></td>
                  <td>
                    <input
                      value={it.unit || (it.inventory_id ? invById.get(it.inventory_id)?.pack_label ?? "" : "")}
                      onChange={(e) => upd(k, { unit: e.target.value })}
                      aria-label="Unit"
                      placeholder="e.g. 1 lb"
                    />
                  </td>
                  <td className="num"><input type="number" step="0.01" value={it.line_total} onChange={(e) => upd(k, { line_total: Number(e.target.value) })} aria-label="Line total" /></td>
                  <td>
                    <select
                      className="inv-select"
                      value={it.inventory_id ?? ""}
                      onChange={(e) => setInventory(k, e.target.value)}
                      aria-label="Inventory item"
                    >
                      <option value="">Not an inventory item</option>
                      {(inventory.data ?? []).map((inv) => (
                        <option key={inv.id} value={inv.id}>{inv.label}</option>
                      ))}
                    </select>
                  </td>
                  <td><button className="link-btn tiny danger" onClick={() => setItems((cur) => cur.filter((_, i) => i !== k))}>remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn btn-sm btn-ghost add-line" onClick={addLine}>+ Add a line</button>
          <p className={`tiny ${Math.abs(sum - Number(total)) > 0.05 ? "warn-text" : "muted"}`}>
            Lines add up to {money(sum, true)}{Math.abs(sum - Number(total)) > 0.05 ? ", which doesn't match the total. Please check." : "."}
          </p>
          <ErrorNote error={error} />
          <div className={`receipt-actions ${suspicious ? "suspicious" : ""}`}>
            <button className="btn btn-primary" disabled={busy} onClick={() => void confirm()}>
              Confirm: record {money(Number(total) || 0, true)} out and add to inventory
            </button>
            <div className="reject-box">
              {suspicious && <p className="tiny warn-text">This receipt looks suspicious. Rejecting it records nothing.</p>}
              <label className="tiny">
                Reason for rejecting
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. not a real receipt, duplicate" />
              </label>
              <button className="btn btn-sm btn-ghost danger-btn" disabled={busy} onClick={() => void reject()}>
                Reject receipt
              </button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
