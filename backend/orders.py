"""Order lifecycle. Every money or status change here is a human action (customer or owner),
never an agent action.

requested --(owner accepts at a final price)--> accepted --(customer pays deposit, demo)--> confirmed
  --> in_production --> ready --(balance paid at pickup, demo)--> completed
requested --> declined (owner) | cancelled (customer)
"""

import re
import sqlite3
from datetime import date, datetime, timedelta

from fastapi import HTTPException

from .audit import audit_event
from .calendar_links import gmail_link, order_event
from .capacity import check_date
from .db import get_settings, jd, jl
from .models import OrderSpec
from .pricing import load_menu, quote
from .safety import check_untrusted, off_brand

HARD_BLOCKS = ("unknown_size", "unknown_cake_flavor", "unknown_filling", "unknown_frosting", "unknown_addon",
               "too_soon", "bad_date")


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def event(conn: sqlite3.Connection, order_id: int, status: str, actor: str, note: str) -> None:
    conn.execute("INSERT INTO order_events(order_id, ts, status, actor, note) VALUES(?,?,?,?,?)",
                 (order_id, _now(), status, actor, note))


def get_row(conn: sqlite3.Connection, order_id: int) -> sqlite3.Row:
    o = conn.execute("SELECT o.*, u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone "
                     "FROM orders o JOIN users u ON u.id = o.customer_id WHERE o.id = ?", (order_id,)).fetchone()
    if o is None:
        raise HTTPException(404, "Order not found.")
    return o


def order_dict(conn: sqlite3.Connection, o: sqlite3.Row) -> dict:
    invoices = [dict(r) for r in conn.execute("SELECT id, kind, amount, status, issued_at, paid_at, due_date FROM invoices "
                                              "WHERE order_id = ? ORDER BY id", (o["id"],))]
    timeline = [dict(r) for r in conn.execute("SELECT ts, status, actor, note FROM order_events WHERE order_id = ? "
                                              "ORDER BY id", (o["id"],))]
    insp = None
    if o["inspiration_upload_id"]:
        up = conn.execute("SELECT id, analysis FROM uploads WHERE id = ?", (o["inspiration_upload_id"],)).fetchone()
        if up:
            insp = {"image_url": f"/api/uploads/{up['id']}", "analysis": jl(up["analysis"])}
    recipes = {}
    for kind in ("cake", "filling", "frosting"):
        rid = o[f"{kind}_recipe_id"]
        if rid:
            r = conn.execute("SELECT id, name, source FROM recipes WHERE id = ?", (rid,)).fetchone()
            if r:
                recipes[kind] = dict(r)
    review = jl(o["ai_review"])
    ev = order_event(o, o["customer_name"])
    dep = next((i for i in invoices if i["kind"] == "deposit"), None)
    bal = next((i for i in invoices if i["kind"] == "balance"), None)
    return {
        "id": o["id"], "status": o["status"], "created_at": o["created_at"], "hold_expires_at": o["hold_expires_at"],
        "customer": {"id": o["customer_id"], "name": o["customer_name"], "email": o["customer_email"],
                     "phone": o["customer_phone"]},
        "spec": jl(o["spec"], {}), "quote": jl(o["quote"], {}), "final_price": o["final_price"],
        "deposit_amount": dep["amount"] if dep else None, "balance_amount": bal["amount"] if bal else None,
        "invoices": invoices, "timeline": timeline, "owner_note": o["owner_note"], "decline_reason": o["decline_reason"],
        "flags": jl(o["flags"], []), "inspiration": insp, "recipes": recipes or None,
        "ai_review": ({"run_id": review.get("run_id"), "summary": review.get("summary", ""),
                       "recommendation": review.get("recommendation", ""), "created_at": review.get("created_at", ""),
                       "risks": review.get("risks", []), "suggested_price": review.get("suggested_price")}
                      if review else None),
        "calendar": {"google_link": ev["google_link"], "ics_url": f"/api/orders/{o['id']}/calendar.ics"},
        "labor_hours": o["labor_hours"],
    }


def create_order(conn: sqlite3.Connection, user: sqlite3.Row, spec: OrderSpec, today: date) -> dict:
    missing = [f for f in ("size_code", "cake_flavor", "frosting", "pickup_date", "pickup_time") if not getattr(spec, f)]
    if not spec.occasion.strip():
        missing.append("occasion")
    if spec.fulfillment == "delivery" and not (spec.delivery_address or "").strip():
        missing.append("delivery_address")
    if missing:
        raise HTTPException(400, f"Please fill in: {', '.join(missing)}.")
    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", spec.pickup_time or "") or not ("09:00" <= spec.pickup_time <= "19:00"):
        raise HTTPException(400, "Pickup time must be between 09:00 and 19:00.")
    menu = load_menu(conn)
    q = quote(conn, spec, today, menu)
    hard = [f for f in q["flags"] if f["code"] in HARD_BLOCKS]
    if hard:
        raise HTTPException(400, " ".join(f["message"] for f in hard))
    cap = check_date(conn, q["labor_hours"], date.fromisoformat(spec.pickup_date), today)
    if not cap["ok"]:
        raise HTTPException(409, f"Sorry, {spec.pickup_date} is no longer available ({cap['note']}). Please pick another date.")
    flags = list(q["flags"])
    text = " | ".join(x for x in (spec.occasion, spec.design_notes, spec.message_on_cake or "", spec.allergies,
                                  spec.dietary or "", spec.delivery_address or "") if x)
    scan = check_untrusted(conn, text, f"new order from {user['email']}", user_id=user["id"])
    flags += scan["flags"]
    brand = off_brand(text)
    if brand:
        flags.append({"code": "off_brand", "severity": "warn",
                      "message": f"Asked for {', '.join(brand)}; suggest a natural buttercream alternative."})
    upload_id = None
    if spec.inspiration_image_id:
        up = conn.execute("SELECT * FROM uploads WHERE id = ? AND user_id = ? AND kind = 'inspiration'",
                          (spec.inspiration_image_id, user["id"])).fetchone()
        if up is None:
            raise HTTPException(400, "That inspiration photo was not found on your account.")
        upload_id = up["id"]
        a = jl(up["analysis"], {}) or {}
        if a.get("natural_style_fit") == "off_brand":
            flags.append({"code": "photo_off_brand", "severity": "warn",
                          "message": "The inspiration photo looks off-brand: " + "; ".join(a.get("concerns", [])[:3])})
    s = get_settings(conn)
    hold = (datetime.now() + timedelta(hours=s["hold_hours"])).isoformat(timespec="seconds")
    cur = conn.execute(
        "INSERT INTO orders(customer_id, status, spec, quote, pickup_date, pickup_time, labor_hours, flags, "
        "inspiration_upload_id, hold_expires_at, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        (user["id"], "requested", spec.model_dump_json(), jd(q), spec.pickup_date, spec.pickup_time, q["labor_hours"],
         jd(flags), upload_id, hold, _now(), _now()))
    oid = cur.lastrowid
    event(conn, oid, "requested", "customer", f"Requested for {spec.pickup_date} {spec.pickup_time}. "
                                              f"Estimated ${q['total']:.2f}. Date held for {s['hold_hours']} hours.")
    conn.commit()
    audit_event("order_requested", agent="customer", order_id=oid, user_id=user["id"], quote_total=q["total"],
                labor_hours=q["labor_hours"], flags=[f["code"] for f in flags])
    return order_dict(conn, get_row(conn, oid))


def _draft(conn: sqlite3.Connection, kind: str, o: sqlite3.Row, subject: str, body: str) -> None:
    conn.execute("INSERT INTO drafts(kind, to_addr, subject, body, order_id, created_by, created_at) VALUES(?,?,?,?,?,?,?)",
                 (kind, o["customer_email"], subject, body, o["id"], "owner", _now()))


def accept(conn: sqlite3.Connection, order_id: int, final_price: float, note: str | None, staff: sqlite3.Row,
           today: date) -> dict:
    o = get_row(conn, order_id)
    if o["status"] != "requested":
        raise HTTPException(409, f"Only requested orders can be accepted (this one is {o['status']}).")
    cap = check_date(conn, float(o["labor_hours"]), date.fromisoformat(o["pickup_date"]), today, exclude_order_id=order_id)
    if not cap["ok"] and cap["status"] == "full":
        raise HTTPException(409, f"Accepting would overbook the kitchen ({cap['note']}). Decline or move the date.")
    s = get_settings(conn)
    final = round(final_price, 2)
    dep = round(final * s["deposit_pct"], 2)
    quoted = jl(o["quote"], {}).get("total")
    conn.execute("UPDATE orders SET status='accepted', final_price=?, owner_note=?, hold_expires_at=NULL, updated_at=? "
                 "WHERE id=?", (final, note, _now(), order_id))
    due = (today + timedelta(days=3)).isoformat()
    conn.execute("INSERT INTO invoices(order_id, kind, amount, status, issued_at, due_date) VALUES(?,?,?,?,?,?)",
                 (order_id, "deposit", dep, "issued", _now(), due))
    conn.execute("INSERT INTO invoices(order_id, kind, amount, status, issued_at, due_date) VALUES(?,?,?,?,?,?)",
                 (order_id, "balance", round(final - dep, 2), "issued", _now(), o["pickup_date"]))
    change = "" if quoted is None or abs(final - quoted) < 0.005 else f" (quote was ${quoted:.2f})"
    event(conn, order_id, "accepted", staff["name"], f"Accepted at ${final:.2f}{change}. Deposit ${dep:.2f} due {due}."
          + (f" Note: {note}" if note else ""))
    first = o["customer_name"].split()[0]
    _draft(conn, "deposit_request", o, "Your Garden Party cake is accepted — deposit to hold the date",
           f"Hi {first},\n\nThank you for your order! We'd love to make your cake for {o['pickup_date']}. The final price is "
           f"${final:.2f}. To hold your date, please pay the {int(s['deposit_pct'] * 100)}% non-refundable deposit "
           f"(${dep:.2f}) from your account page by {due}. The balance of ${final - dep:.2f} is due at pickup.\n\n"
           "Warmly,\nAnnie\nGarden Party Cake Studio")
    conn.commit()
    audit_event("human_action", agent="owner", action="accept_order", order_id=order_id, final_price=final,
                quoted=quoted, deposit=dep)
    return order_dict(conn, get_row(conn, order_id))


def decline(conn: sqlite3.Connection, order_id: int, reason: str, staff: sqlite3.Row) -> dict:
    o = get_row(conn, order_id)
    if o["status"] not in ("requested", "accepted"):
        raise HTTPException(409, f"This order is {o['status']} and cannot be declined.")
    conn.execute("UPDATE orders SET status='declined', decline_reason=?, hold_expires_at=NULL, updated_at=? WHERE id=?",
                 (reason, _now(), order_id))
    event(conn, order_id, "declined", staff["name"], reason)
    _draft(conn, "decline", o, "About your Garden Party cake request",
           f"Hi {o['customer_name'].split()[0]},\n\nThank you so much for thinking of us. Unfortunately we can't take this "
           f"order: {reason}\n\nWe hope we can bake for you another time.\n\nWarmly,\nAnnie\nGarden Party Cake Studio")
    conn.commit()
    audit_event("human_action", agent="owner", action="decline_order", order_id=order_id, reason=reason)
    return order_dict(conn, get_row(conn, order_id))


ALLOWED_NEXT = {"in_production": ("confirmed",), "ready": ("confirmed", "in_production"), "completed": ("ready",)}


def set_status(conn: sqlite3.Connection, order_id: int, status: str, staff: sqlite3.Row) -> dict:
    o = get_row(conn, order_id)
    if o["status"] not in ALLOWED_NEXT[status]:
        raise HTTPException(409, f"Cannot move from {o['status']} to {status}.")
    if status == "completed":
        unpaid = conn.execute("SELECT COUNT(*) FROM invoices WHERE order_id=? AND status='issued'", (order_id,)).fetchone()[0]
        if unpaid:
            raise HTTPException(409, "Record the balance payment first.")
    conn.execute("UPDATE orders SET status=?, updated_at=? WHERE id=?", (status, _now(), order_id))
    event(conn, order_id, status, staff["name"], f"Marked {status.replace('_', ' ')}.")
    conn.commit()
    audit_event("human_action", agent="owner", action="set_status", order_id=order_id, status=status)
    return order_dict(conn, get_row(conn, order_id))


def _record_payment(conn: sqlite3.Connection, inv: sqlite3.Row, actor: str) -> None:
    conn.execute("UPDATE invoices SET status='paid', paid_at=? WHERE id=?", (_now(), inv["id"]))
    conn.execute("INSERT INTO cash_ledger(date, direction, amount, category, description, order_id, demo, actor) "
                 "VALUES(?,?,?,?,?,?,1,?)", (date.today().isoformat(), "in", inv["amount"], inv["kind"],
                                             f"{inv['kind'].title()}, order #{inv['order_id']} (demo payment)",
                                             inv["order_id"], actor))


def pay_invoice(conn: sqlite3.Connection, order_id: int, invoice_id: int, user: sqlite3.Row) -> dict:
    o = get_row(conn, order_id)
    if o["customer_id"] != user["id"]:
        raise HTTPException(404, "Order not found.")
    inv = conn.execute("SELECT * FROM invoices WHERE id=? AND order_id=?", (invoice_id, order_id)).fetchone()
    if inv is None:
        raise HTTPException(404, "Invoice not found.")
    if inv["status"] == "paid":
        raise HTTPException(409, "This invoice is already paid.")
    if inv["kind"] == "deposit" and o["status"] != "accepted":
        raise HTTPException(409, "The deposit can be paid once the owner accepts the order.")
    if inv["kind"] == "balance":
        dep_paid = conn.execute("SELECT COUNT(*) FROM invoices WHERE order_id=? AND kind='deposit' AND status='paid'",
                                (order_id,)).fetchone()[0]
        if not dep_paid:
            raise HTTPException(409, "Pay the deposit first.")
    _record_payment(conn, inv, "customer")
    if inv["kind"] == "deposit":
        conn.execute("UPDATE orders SET status='confirmed', updated_at=? WHERE id=?", (_now(), order_id))
        event(conn, order_id, "confirmed", "customer", f"Deposit ${inv['amount']:.2f} paid (demo). Date confirmed.")
    else:
        event(conn, order_id, o["status"], "customer", f"Balance ${inv['amount']:.2f} paid (demo).")
    conn.commit()
    audit_event("human_action", agent="customer", action="pay_invoice_demo", order_id=order_id, invoice_id=invoice_id,
                amount=inv["amount"], kind=inv["kind"])
    return order_dict(conn, get_row(conn, order_id))


def balance_paid(conn: sqlite3.Connection, order_id: int, staff: sqlite3.Row) -> dict:
    o = get_row(conn, order_id)
    if o["status"] not in ("confirmed", "in_production", "ready"):
        raise HTTPException(409, f"Order is {o['status']}.")
    inv = conn.execute("SELECT * FROM invoices WHERE order_id=? AND kind='balance'", (order_id,)).fetchone()
    if inv is None or inv["status"] == "paid":
        raise HTTPException(409, "No unpaid balance.")
    _record_payment(conn, inv, staff["name"])
    conn.execute("UPDATE orders SET status='completed', updated_at=? WHERE id=?", (_now(), order_id))
    event(conn, order_id, "completed", staff["name"], f"Picked up. Balance ${inv['amount']:.2f} paid (demo).")
    conn.commit()
    audit_event("human_action", agent="owner", action="balance_paid_demo", order_id=order_id, amount=inv["amount"])
    return order_dict(conn, get_row(conn, order_id))


def cancel(conn: sqlite3.Connection, order_id: int, user: sqlite3.Row) -> dict:
    o = get_row(conn, order_id)
    if o["customer_id"] != user["id"]:
        raise HTTPException(404, "Order not found.")
    if o["status"] != "requested":
        raise HTTPException(409, "Only requests that are still waiting for review can be cancelled here. "
                                 "Please email the studio.")
    conn.execute("UPDATE orders SET status='cancelled', hold_expires_at=NULL, updated_at=? WHERE id=?", (_now(), order_id))
    event(conn, order_id, "cancelled", "customer", "Cancelled by the customer.")
    conn.commit()
    return order_dict(conn, get_row(conn, order_id))


def gmail_for_draft(d: sqlite3.Row) -> str:
    return gmail_link(d["to_addr"], d["subject"], d["body"])
