"""Garden Party Cake Studio API (FastAPI).

Run from the project folder:  python -m uvicorn backend.main:app --port 8000
The React app (frontend/, port 5173) proxies /api to this server.
"""

import json
import re
import shutil
import sqlite3
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from PIL import Image

from . import orders as order_svc
from .audit import audit_event, read_events
from .auth import (SESSION_COOKIE, SESSION_DAYS, chat_anon_limiter, chat_user_limiter, create_session, delete_session,
                   dummy_verify, failed_logins, hash_password, password_problems, public_user, upload_limiter,
                   user_for_token, verify_password)
from .calendar_links import calendar_events, order_event, to_ics
from .capacity import availability, week_load
from .config import UPLOAD_DIR, llm_configured, today
from .db import DEFAULT_SETTINGS, connect, ensure_db, get_settings, jd, jl, set_settings
from .llm import total_spend
from .models import (AcceptIn, ChatIn, DeclineIn, InventoryPatch, LoginIn, OrderSpec, PlanWeekIn, ReceiptConfirmIn, ReceiptRejectIn,
                     RegisterIn, StatusIn)
from .narrate import narrate
from .planning import (cash_balance, default_week_start, order_cost_estimate, order_recipes, plan_dict, recipe_dict,
                       shopping_list_dict, tier_units)
from .pricing import load_menu, quote
from .tokenomics import tokenomics

app = FastAPI(title="Garden Party Cake Studio")
MAX_UPLOAD_BYTES = 6 * 1024 * 1024
IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


@app.on_event("startup")
def _startup() -> None:
    ensure_db()
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ----- dependencies ----------------------------------------------------------------------

def get_conn():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def current_user(request: Request, conn: sqlite3.Connection = Depends(get_conn)) -> sqlite3.Row | None:
    return user_for_token(conn, request.cookies.get(SESSION_COOKIE))


def require_user(user=Depends(current_user)) -> sqlite3.Row:
    if user is None:
        raise HTTPException(401, "Please log in.")
    return user


def require_staff(user=Depends(current_user)) -> sqlite3.Row:
    if user is None:
        raise HTTPException(401, "Please log in.")
    if user["role"] != "staff":
        audit_event("safety", kind="access_denied", where="staff route", severity="warn",
                    message=f"Customer {user['id']} tried a staff route.")
        raise HTTPException(403, "Staff only.")
    return user


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax", max_age=SESSION_DAYS * 86400, path="/")


# ----- public ---------------------------------------------------------------------------

@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "today": today().isoformat(), "llm_configured": llm_configured()}


@app.get("/api/menu")
def menu(conn=Depends(get_conn)) -> dict:
    return load_menu(conn)


@app.post("/api/quote")
def post_quote(body: dict, conn=Depends(get_conn)) -> dict:
    try:
        spec = OrderSpec(**{k: v for k, v in body.items() if k in OrderSpec.model_fields and v is not None})
    except Exception as exc:
        raise HTTPException(400, f"Invalid order: {exc}")
    return quote(conn, spec, today())


@app.get("/api/availability")
def get_availability(size_code: str = "", addons: str = "", days: int = 75, conn=Depends(get_conn)) -> dict:
    picks = [{"code": c, "qty": 1} for c in addons.split(",") if c.strip()]
    spec = OrderSpec(size_code=size_code, addons=picks)
    return availability(conn, spec, today(), max(7, min(days, 120)))


@app.post("/api/auth/register")
def register(body: RegisterIn, response: Response, conn=Depends(get_conn)) -> dict:
    email = body.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(400, "Please enter a valid email.")
    problem = password_problems(body.password)
    if problem:
        raise HTTPException(400, problem)
    if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        raise HTTPException(409, "An account with this email already exists. Please log in.")
    cur = conn.execute("INSERT INTO users(name, email, phone, role, password_hash, created_at) VALUES(?,?,?,?,?,?)",
                       (body.name.strip(), email, body.phone, "customer", hash_password(body.password),
                        datetime.now().isoformat(timespec="seconds")))
    conn.commit()
    _set_cookie(response, create_session(conn, cur.lastrowid))
    audit_event("auth", action="register", user_id=cur.lastrowid)
    return {"user": public_user(conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone())}


@app.post("/api/auth/login")
def login(body: LoginIn, request: Request, response: Response, conn=Depends(get_conn)) -> dict:
    email = body.email.strip().lower()
    key = f"{email}|{_ip(request)}"
    if failed_logins.blocked(key):
        audit_event("safety", kind="login_rate_limit", where="login", severity="block", message=f"Too many attempts for {email}.")
        raise HTTPException(429, "Too many failed attempts. Please wait 15 minutes and try again.")
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if row is None:
        dummy_verify(body.password)
        ok = False
    else:
        ok = verify_password(body.password, row["password_hash"])
    if not ok:
        failed_logins.hit(key)
        audit_event("auth", action="login_failed", email=email)
        raise HTTPException(401, "Email or password is incorrect.")
    failed_logins.reset(key)
    _set_cookie(response, create_session(conn, row["id"]))
    audit_event("auth", action="login", user_id=row["id"], role=row["role"])
    return {"user": public_user(row)}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, conn=Depends(get_conn)) -> dict:
    delete_session(conn, request.cookies.get(SESSION_COOKIE))
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def me(user=Depends(current_user)) -> dict:
    return {"user": public_user(user)}


# ----- Order Taker chat -------------------------------------------------------------------

@app.post("/api/concierge/chat")
def concierge_chat(body: ChatIn, request: Request, user=Depends(current_user), conn=Depends(get_conn)) -> dict:
    from .concierge import chat
    from .team import spend_check
    limiter, key = (chat_user_limiter, f"u{user['id']}") if user else (chat_anon_limiter, _ip(request))
    if not limiter.hit(key):
        audit_event("safety", kind="chat_rate_limit", where="concierge", severity="block", message=f"Rate limit for {key}.")
        raise HTTPException(429, "You've sent a lot of messages — please take a short break and try again soon.")
    if not llm_configured():
        raise HTTPException(503, "The AI assistant is not configured (PORTKEY_API_KEY missing). The order form still works.")
    blocked = spend_check()
    if blocked:
        raise HTTPException(503, "The AI assistant is resting for today. The order form still works.")
    insp = None
    if body.inspiration_image_id and user:
        up = conn.execute("SELECT analysis FROM uploads WHERE id = ? AND user_id = ?",
                          (body.inspiration_image_id, user["id"])).fetchone()
        insp = jl(up["analysis"]) if up else None
    return chat(conn, message=body.message, history=[t.model_dump() for t in body.history], draft=body.draft,
                user=user, today=today(), inspiration=insp)


@app.get("/api/ideas")
def ideas(user=Depends(require_user), conn=Depends(get_conn)) -> dict:
    from .concierge import ideas_for
    if not llm_configured():
        return {"ideas": [], "based_on": []}
    return ideas_for(conn, user, today())


# ----- uploads -----------------------------------------------------------------------------

def _save_upload(file: UploadFile, user_id: int, kind: str, conn: sqlite3.Connection) -> tuple[int, Path]:
    if file.content_type not in IMAGE_TYPES:
        raise HTTPException(400, "Please upload a JPG, PNG or WEBP image.")
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "Image is larger than 6 MB.")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    path = UPLOAD_DIR / f"{kind}-{uuid.uuid4().hex}.{IMAGE_TYPES[file.content_type]}"
    path.write_bytes(data)
    try:
        with Image.open(path) as im:
            im.verify()
    except Exception:
        path.unlink(missing_ok=True)
        raise HTTPException(400, "That file is not a readable image.")
    cur = conn.execute("INSERT INTO uploads(user_id, kind, path, mime, created_at) VALUES(?,?,?,?,?)",
                       (user_id, kind, str(path), file.content_type, datetime.now().isoformat(timespec="seconds")))
    conn.commit()
    return cur.lastrowid, path


@app.post("/api/uploads/inspiration")
def upload_inspiration(file: UploadFile = File(...), user=Depends(require_user), conn=Depends(get_conn)) -> dict:
    from .team import spend_check
    from .vision import analyze_inspiration
    if not upload_limiter.hit(f"u{user['id']}"):
        raise HTTPException(429, "Too many uploads this hour.")
    upload_id, path = _save_upload(file, user["id"], "inspiration", conn)
    analysis = None
    if llm_configured() and not spend_check():
        try:
            analysis = analyze_inspiration(conn, path, user["id"])
        except Exception as exc:
            audit_event("error", where="inspiration_vision", error=repr(exc))
    if analysis:
        conn.execute("UPDATE uploads SET analysis = ? WHERE id = ?", (jd(analysis), upload_id))
        conn.commit()
    audit_event("upload", kind="inspiration", upload_id=upload_id, user_id=user["id"], analyzed=bool(analysis))
    return {"image_id": upload_id, "url": f"/api/uploads/{upload_id}", "analysis": analysis or {
        "summary": "Photo saved. Annie will look at it when she reviews your order.", "elements": [], "colors": [],
        "tiers_estimate": None, "natural_style_fit": "adaptable", "matched_addons": [], "concerns": []}}


@app.get("/api/uploads/{upload_id}")
def get_upload(upload_id: int, user=Depends(require_user), conn=Depends(get_conn)):
    up = conn.execute("SELECT * FROM uploads WHERE id = ?", (upload_id,)).fetchone()
    if up is None or (user["role"] != "staff" and up["user_id"] != user["id"]):
        raise HTTPException(404, "Not found.")
    return FileResponse(up["path"], media_type=up["mime"])


# ----- customer orders ---------------------------------------------------------------------

@app.post("/api/orders")
def create_order(spec: OrderSpec, user=Depends(require_user), conn=Depends(get_conn)) -> dict:
    return order_svc.create_order(conn, user, spec, today())


@app.get("/api/orders/mine")
def my_orders(user=Depends(require_user), conn=Depends(get_conn)) -> list:
    rows = conn.execute("SELECT o.*, u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone "
                        "FROM orders o JOIN users u ON u.id = o.customer_id WHERE o.customer_id = ? "
                        "ORDER BY o.pickup_date DESC", (user["id"],)).fetchall()
    return [order_svc.order_dict(conn, r) for r in rows]


def _own_or_staff(conn, order_id: int, user) -> sqlite3.Row:
    o = order_svc.get_row(conn, order_id)
    if user["role"] != "staff" and o["customer_id"] != user["id"]:
        raise HTTPException(404, "Order not found.")  # 404, not 403: do not reveal that the order exists
    return o


@app.get("/api/orders/{order_id}")
def get_order(order_id: int, user=Depends(require_user), conn=Depends(get_conn)) -> dict:
    return order_svc.order_dict(conn, _own_or_staff(conn, order_id, user))


@app.get("/api/orders/{order_id}/calendar.ics")
def order_ics(order_id: int, user=Depends(require_user), conn=Depends(get_conn)):
    o = _own_or_staff(conn, order_id, user)
    return PlainTextResponse(to_ics([order_event(o, o["customer_name"])]), media_type="text/calendar",
                             headers={"Content-Disposition": f'attachment; filename="cake-{order_id}.ics"'})


@app.post("/api/orders/{order_id}/cancel")
def cancel_order(order_id: int, user=Depends(require_user), conn=Depends(get_conn)) -> dict:
    return order_svc.cancel(conn, order_id, user)


@app.post("/api/orders/{order_id}/invoices/{invoice_id}/pay")
def pay(order_id: int, invoice_id: int, user=Depends(require_user), conn=Depends(get_conn)) -> dict:
    return order_svc.pay_invoice(conn, order_id, invoice_id, user)


# ----- staff ------------------------------------------------------------------------------

@app.get("/api/staff/dashboard")
def dashboard(staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    t = today()
    week = []
    for r in conn.execute("SELECT o.id, o.pickup_date, o.pickup_time, o.spec, u.name FROM orders o JOIN users u ON "
                          "u.id = o.customer_id WHERE o.status IN ('accepted','confirmed','in_production','ready') AND "
                          "o.pickup_date BETWEEN ? AND ? ORDER BY o.pickup_date, o.pickup_time",
                          (t.isoformat(), (t + timedelta(days=7)).isoformat())):
        s = jl(r["spec"], {})
        week.append({"date": r["pickup_date"], "order_id": r["id"], "customer": r["name"], "title": s.get("occasion", ""),
                     "time": r["pickup_time"], "fulfillment": s.get("fulfillment", "pickup")})
    settings = get_settings(conn)
    today_spend = conn.execute("SELECT COALESCE(SUM(cost_usd),0) FROM llm_usage WHERE ts >= ?", (t.isoformat(),)).fetchone()[0]
    low = [{"item": r["label"], "qty_on_hand": r["qty_on_hand"], "par_level": r["par_level"], "unit": r["unit"]}
           for r in conn.execute("SELECT * FROM inventory WHERE qty_on_hand < par_level ORDER BY label")]
    return {
        "today": t.isoformat(), "cash_balance": cash_balance(conn),
        "pending_requests": conn.execute("SELECT COUNT(*) FROM orders WHERE status='requested'").fetchone()[0],
        "awaiting_deposit": conn.execute("SELECT COUNT(*) FROM orders WHERE status='accepted'").fetchone()[0],
        "this_week": week, "week_hours": week_load(conn, t - timedelta(days=t.weekday()), t),
        "spend": {"total_usd": round(total_spend(conn), 6), "limit_usd": settings["spend_limit_usd"],
                  "today_usd": round(today_spend, 6)},
        "low_stock": low, "recent_safety": _safety(conn, 5),
    }


@app.get("/api/staff/orders")
def staff_orders(status: str | None = None, staff=Depends(require_staff), conn=Depends(get_conn)) -> list:
    q = ("SELECT o.*, u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone FROM orders o "
         "JOIN users u ON u.id = o.customer_id")
    args: list = []
    if status:
        q += " WHERE o.status = ?"
        args.append(status)
    q += " ORDER BY CASE o.status WHEN 'requested' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END, o.pickup_date"
    return [order_svc.order_dict(conn, r) for r in conn.execute(q, args).fetchall()]


@app.post("/api/staff/orders/{order_id}/accept")
def accept(order_id: int, body: AcceptIn, staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    s = get_settings(conn)
    if body.final_price < s["min_price"]:
        raise HTTPException(400, f"The studio minimum is ${s['min_price']:g}.")
    return order_svc.accept(conn, order_id, body.final_price, body.owner_note, staff, today())


@app.post("/api/staff/orders/{order_id}/decline")
def decline(order_id: int, body: DeclineIn, staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    return order_svc.decline(conn, order_id, body.reason, staff)


@app.post("/api/staff/orders/{order_id}/status")
def set_status(order_id: int, body: StatusIn, staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    return order_svc.set_status(conn, order_id, body.status, staff)


@app.post("/api/staff/orders/{order_id}/balance-paid")
def balance_paid(order_id: int, staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    return order_svc.balance_paid(conn, order_id, staff)


def _launch(background: BackgroundTasks, kind: str, task: str, order_id: int | None = None,
            week_start: str | None = None) -> dict:
    from .team import run_team, spend_check, start_run_record
    if not llm_configured():
        raise HTTPException(503, "PORTKEY_API_KEY is not set, so the agent team cannot run.")
    blocked = spend_check()
    if blocked:
        raise HTTPException(409, blocked)
    run_id = start_run_record(kind, order_id, week_start)
    background.add_task(run_team, run_id, kind, task, order_id)
    return {"run_id": run_id}


@app.post("/api/staff/orders/{order_id}/review")
def review(order_id: int, background: BackgroundTasks, staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    from .team import review_task
    order_svc.get_row(conn, order_id)
    return _launch(background, "order_review", review_task(order_id), order_id=order_id)


@app.post("/api/staff/plan-week")
def plan_week(body: PlanWeekIn, background: BackgroundTasks, staff=Depends(require_staff)) -> dict:
    from .team import plan_task
    ws = date.fromisoformat(body.week_start) if body.week_start else default_week_start(today())
    if ws.weekday() != 0:
        raise HTTPException(400, "week_start must be a Monday.")
    return _launch(background, "plan_week", plan_task(ws.isoformat()), week_start=ws.isoformat())


def _run_info(r: sqlite3.Row) -> dict:
    usage = jl(r["usage"], {}) or {}
    report = jl(r["summary"]) if r["summary"] else None
    return {"run_id": r["run_id"], "kind": r["kind"], "status": r["status"], "started_at": r["started_at"],
            "finished_at": r["finished_at"],
            "summary": (report.get("summary") if isinstance(report, dict) else report),
            "report": report, "order_id": r["order_id"], "week_start": r["week_start"],
            "usage": {k: usage.get(k, 0) for k in ("llm_calls", "input_tokens", "cached_tokens", "output_tokens", "cost_usd")}}


@app.get("/api/staff/runs")
def runs(staff=Depends(require_staff), conn=Depends(get_conn)) -> list:
    return [_run_info(r) for r in conn.execute("SELECT * FROM runs ORDER BY started_at DESC LIMIT 50")]


@app.get("/api/staff/runs/{run_id}")
def run_detail(run_id: str, staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    r = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
    if r is None:
        raise HTTPException(404, "Run not found.")
    return {**_run_info(r), "events": [narrate(e) for e in read_events(run_id)]}


@app.get("/api/staff/calendar")
def staff_calendar(start: str | None = None, end: str | None = None, staff=Depends(require_staff),
                   conn=Depends(get_conn)) -> dict:
    s = date.fromisoformat(start) if start else today() - timedelta(days=today().weekday())
    e = date.fromisoformat(end) if end else s + timedelta(days=27)
    return {"events": calendar_events(conn, s, e)}


@app.get("/api/staff/calendar.ics")
def staff_ics(staff=Depends(require_staff), conn=Depends(get_conn)):
    t = today()
    return PlainTextResponse(to_ics(calendar_events(conn, t - timedelta(days=7), t + timedelta(days=90))),
                             media_type="text/calendar",
                             headers={"Content-Disposition": 'attachment; filename="garden-party-kitchen.ics"'})


@app.get("/api/staff/plan")
def get_plan(week_start: str | None = None, staff=Depends(require_staff), conn=Depends(get_conn)):
    ws = week_start or default_week_start(today()).isoformat()
    return plan_dict(conn.execute("SELECT * FROM plans WHERE week_start = ? ORDER BY id DESC LIMIT 1", (ws,)).fetchone())


@app.get("/api/staff/shopping-list")
def get_shopping(week_start: str | None = None, staff=Depends(require_staff), conn=Depends(get_conn)):
    ws = week_start or default_week_start(today()).isoformat()
    return shopping_list_dict(conn, conn.execute("SELECT * FROM shopping_lists WHERE week_start = ? ORDER BY id DESC LIMIT 1",
                                                 (ws,)).fetchone())


@app.post("/api/staff/shopping-list/{list_id}/approve")
def approve_shopping(list_id: int, staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    r = conn.execute("SELECT * FROM shopping_lists WHERE id = ?", (list_id,)).fetchone()
    if r is None:
        raise HTTPException(404, "List not found.")
    conn.execute("UPDATE shopping_lists SET status = 'approved' WHERE id = ?", (list_id,))
    conn.commit()
    audit_event("human_action", agent="owner", action="approve_shopping_list", list_id=list_id, est_total=r["est_total"])
    return shopping_list_dict(conn, conn.execute("SELECT * FROM shopping_lists WHERE id = ?", (list_id,)).fetchone())


@app.get("/api/staff/inventory")
def inventory(staff=Depends(require_staff), conn=Depends(get_conn)) -> list:
    return [dict(r) for r in conn.execute("SELECT * FROM inventory ORDER BY category, label")]


@app.patch("/api/staff/inventory/{item_id}")
def patch_inventory(item_id: int, body: InventoryPatch, staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    r = conn.execute("SELECT * FROM inventory WHERE id = ?", (item_id,)).fetchone()
    if r is None:
        raise HTTPException(404, "Item not found.")
    conn.execute("UPDATE inventory SET qty_on_hand = ? WHERE id = ?", (body.qty_on_hand, item_id))
    conn.commit()
    audit_event("human_action", agent="owner", action="set_inventory", item=r["item"], before=r["qty_on_hand"],
                after=body.qty_on_hand)
    return dict(conn.execute("SELECT * FROM inventory WHERE id = ?", (item_id,)).fetchone())


@app.get("/api/staff/recipes")
def recipes(staff=Depends(require_staff), conn=Depends(get_conn)) -> list:
    return [recipe_dict(r) for r in conn.execute("SELECT * FROM recipes ORDER BY status DESC, kind, name")]


@app.post("/api/staff/recipes/{recipe_id}/approve")
def approve_recipe(recipe_id: int, staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    r = conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone()
    if r is None:
        raise HTTPException(404, "Recipe not found.")
    conn.execute("UPDATE recipes SET status = 'approved' WHERE id = ?", (recipe_id,))
    conn.commit()
    audit_event("human_action", agent="owner", action="approve_recipe", recipe_id=recipe_id, name=r["name"])
    return recipe_dict(conn.execute("SELECT * FROM recipes WHERE id = ?", (recipe_id,)).fetchone())


def _receipt_dict(r: sqlite3.Row, conn: sqlite3.Connection | None = None) -> dict:
    items = jl(r["items"], [])
    if conn is not None:  # show inventory names, not ids, next to each line
        inv = {x["id"]: (x["label"], x["pack_label"]) for x in conn.execute("SELECT id, label, pack_label FROM inventory")}
        items = [{**i, "inventory_label": inv.get(i.get("inventory_id"), (None, None))[0],
                  "unit": i.get("unit") or inv.get(i.get("inventory_id"), (None, ""))[1] or ""} for i in items]
    return {"id": r["id"], "status": r["status"], "vendor": r["vendor"], "date": r["date"], "total": r["total"],
            "items": items, "flags": jl(r["flags"], []),
            "reject_reason": r["reject_reason"] if "reject_reason" in r.keys() else None,
            "image_url": f"/api/uploads/{r['upload_id']}" if r["upload_id"] else ""}


@app.get("/api/staff/cash")
def cash(staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    ledger = [{**dict(r), "demo": bool(r["demo"])} for r in conn.execute(
        "SELECT id, date, direction, amount, category, description, order_id, receipt_id, demo FROM cash_ledger "
        "ORDER BY date DESC, id DESC")]
    sums = {r["direction"]: r["s"] for r in conn.execute("SELECT direction, SUM(amount) s FROM cash_ledger GROUP BY direction")}
    seed = conn.execute("SELECT COALESCE(SUM(amount),0) FROM cash_ledger WHERE category='seed'").fetchone()[0]
    by_order = []
    sizes = {z["code"]: z for z in load_menu(conn)["all_sizes"]}
    for r in conn.execute("SELECT o.*, u.name AS customer_name FROM orders o JOIN users u ON u.id=o.customer_id WHERE "
                          "o.status IN ('accepted','confirmed','in_production','ready','completed') ORDER BY o.pickup_date"):
        revenue = conn.execute("SELECT COALESCE(SUM(amount),0) FROM cash_ledger WHERE order_id = ? AND direction='in'",
                               (r["id"],)).fetchone()[0]
        spec = OrderSpec(**jl(r["spec"], {}))
        size = sizes.get(spec.size_code)
        w = {"order": r, "spec": spec, "size": size, "recipes": order_recipes(conn, r, spec),
             "units": tier_units(size["tier_diameters"]) if size else 1.0}
        cost = order_cost_estimate(conn, w)
        by_order.append({"order_id": r["id"], "customer": r["customer_name"], "revenue": round(revenue, 2),
                         "final_price": r["final_price"], "ingredient_cost_est": cost,
                         "margin_est": round((r["final_price"] or 0) - cost, 2)})
    pending = [_receipt_dict(r, conn) for r in conn.execute("SELECT * FROM receipts WHERE status='pending' ORDER BY id DESC")]
    return {"balance": cash_balance(conn), "seed": seed, "money_in": round(sums.get("in", 0) or 0, 2),
            "money_out": round(sums.get("out", 0) or 0, 2), "ledger": ledger, "by_order": by_order,
            "pending_receipts": pending}


@app.post("/api/staff/receipts")
def upload_receipt(file: UploadFile = File(...), staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    from .team import spend_check
    from .vision import extract_receipt
    upload_id, path = _save_upload(file, staff["id"], "receipt", conn)
    data = {"vendor": "", "date": today().isoformat(), "total": 0.0, "items": [],
            "flags": [{"code": "manual", "severity": "info", "message": "Enter the receipt details by hand."}]}
    if llm_configured() and not spend_check():
        try:
            data = extract_receipt(conn, path)
            data["date"] = data["date"] or today().isoformat()
        except Exception as exc:
            audit_event("error", where="receipt_vision", error=repr(exc))
    dup = conn.execute("SELECT id, status FROM receipts WHERE vendor = ? AND date = ? AND ABS(total - ?) < 0.01 "
                       "AND total > 0", (data["vendor"], data["date"], data["total"])).fetchone() if data["vendor"] else None
    if dup:
        data["flags"].append({"code": "possible_duplicate", "severity": "warn",
                              "message": f"Looks like receipt #{dup['id']} ({dup['status']}): same store, date and "
                                         "total. Confirming both would count this spend twice."})
    cur = conn.execute("INSERT INTO receipts(upload_id, status, vendor, date, total, items, flags, created_at) "
                       "VALUES(?,?,?,?,?,?,?,?)", (upload_id, "pending", data["vendor"], data["date"], data["total"],
                                                   jd(data["items"]), jd(data["flags"]),
                                                   datetime.now().isoformat(timespec="seconds")))
    conn.commit()
    audit_event("upload", kind="receipt", receipt_id=cur.lastrowid, vendor=data["vendor"], total=data["total"])
    return _receipt_dict(conn.execute("SELECT * FROM receipts WHERE id = ?", (cur.lastrowid,)).fetchone(), conn)


@app.post("/api/staff/receipts/{receipt_id}/reject")
def reject_receipt(receipt_id: int, body: ReceiptRejectIn, staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    """Owner rejects a receipt (fictitious, duplicate, or carrying instructions to the AI). Nothing is recorded:
    no money out, no inventory change. The receipt stays on file as 'rejected' for the audit trail."""
    r = conn.execute("SELECT * FROM receipts WHERE id = ?", (receipt_id,)).fetchone()
    if r is None:
        raise HTTPException(404, "Receipt not found.")
    if r["status"] != "pending":
        raise HTTPException(409, f"This receipt is already {r['status']}.")
    reason = body.reason.strip() or "Rejected by the owner."
    conn.execute("UPDATE receipts SET status = 'rejected', reject_reason = ? WHERE id = ?", (reason, receipt_id))
    conn.commit()
    flags = [f.get("code") for f in jl(r["flags"], [])]
    audit_event("human_action", agent="owner", action="reject_receipt", receipt_id=receipt_id, reason=reason,
                total=r["total"], flags=flags)
    if "injection_detected" in flags or "possible_duplicate" in flags:
        from .safety import record
        record(conn, "receipt_rejected", f"receipt #{receipt_id}", "info",
               f"Owner rejected a suspicious receipt ({', '.join(flags)}): {reason} No cash or inventory was changed.")
    return _receipt_dict(conn.execute("SELECT * FROM receipts WHERE id = ?", (receipt_id,)).fetchone(), conn)


@app.post("/api/staff/receipts/{receipt_id}/confirm")
def confirm_receipt(receipt_id: int, body: ReceiptConfirmIn, staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    r = conn.execute("SELECT * FROM receipts WHERE id = ?", (receipt_id,)).fetchone()
    if r is None:
        raise HTTPException(404, "Receipt not found.")
    if r["status"] != "pending":
        raise HTTPException(409, f"This receipt is already {r['status']}.")
    try:
        date.fromisoformat(body.date)
    except ValueError:
        raise HTTPException(400, "Date must be YYYY-MM-DD.")
    if body.total <= 0:
        raise HTTPException(400, "Enter the receipt total.")
    items = [i.model_dump() for i in body.items]
    updated = []
    for i in items:
        if i["inventory_id"]:
            inv = conn.execute("SELECT * FROM inventory WHERE id = ?", (i["inventory_id"],)).fetchone()
            if inv:
                add = i["qty"] * inv["pack_size"]  # receipt quantities are store packs
                conn.execute("UPDATE inventory SET qty_on_hand = qty_on_hand + ? WHERE id = ?", (add, inv["id"]))
                updated.append({"item": inv["label"], "added": add, "unit": inv["unit"]})
    supplies = sum(1 for u in updated if conn.execute("SELECT category FROM inventory WHERE label = ?",
                                                      (u["item"],)).fetchone()[0] == "supply")
    category = "supplies" if updated and supplies > len(updated) / 2 else "groceries"
    conn.execute("UPDATE receipts SET status='confirmed', vendor=?, date=?, total=?, items=? WHERE id=?",
                 (body.vendor, body.date, body.total, jd(items), receipt_id))
    conn.execute("INSERT INTO cash_ledger(date, direction, amount, category, description, receipt_id, demo, actor) "
                 "VALUES(?,?,?,?,?,?,0,?)", (body.date, "out", round(body.total, 2), category,
                                             f"{body.vendor or 'Store'} receipt #{receipt_id}", receipt_id, staff["name"]))
    conn.commit()
    audit_event("human_action", agent="owner", action="confirm_receipt", receipt_id=receipt_id, total=body.total,
                inventory_updates=updated)
    return _receipt_dict(conn.execute("SELECT * FROM receipts WHERE id = ?", (receipt_id,)).fetchone())


@app.get("/api/staff/drafts")
def drafts(staff=Depends(require_staff), conn=Depends(get_conn)) -> list:
    return [{"id": d["id"], "kind": d["kind"], "to": d["to_addr"], "subject": d["subject"], "body": d["body"],
             "order_id": d["order_id"], "created_at": d["created_at"], "created_by": d["created_by"],
             "gmail_link": order_svc.gmail_for_draft(d)}
            for d in conn.execute("SELECT * FROM drafts ORDER BY id DESC")]


@app.get("/api/staff/tokenomics")
def get_tokenomics(staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    return tokenomics(conn)


def _safety(conn: sqlite3.Connection, limit: int = 200) -> list:
    return [{"ts": r["ts"], "kind": r["kind"], "where": r["location"], "severity": r["severity"], "message": r["message"],
             "excerpt": r["excerpt"]} for r in conn.execute("SELECT * FROM safety_events ORDER BY id DESC LIMIT ?", (limit,))]


@app.get("/api/staff/safety")
def safety(staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    return {"events": _safety(conn)}


SETTINGS_KEYS = ("per_serving_rate", "min_price", "deposit_pct", "min_lead_days", "spend_limit_usd", "work_blocks")


@app.get("/api/staff/settings")
def get_settings_route(staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    s = get_settings(conn)
    return {k: s[k] for k in SETTINGS_KEYS}


@app.put("/api/staff/settings")
def put_settings(body: dict, staff=Depends(require_staff), conn=Depends(get_conn)) -> dict:
    vals = {k: v for k, v in body.items() if k in SETTINGS_KEYS}
    checks = {"per_serving_rate": (1, 50), "min_price": (0, 2000), "deposit_pct": (0, 1), "min_lead_days": (1, 60),
              "spend_limit_usd": (0.01, 100)}
    for k, (lo, hi) in checks.items():
        if k in vals and not (isinstance(vals[k], (int, float)) and lo <= vals[k] <= hi):
            raise HTTPException(400, f"{k} must be between {lo} and {hi}.")
    if "work_blocks" in vals:
        for b in vals["work_blocks"]:
            if not (isinstance(b, dict) and b.get("weekday") in range(7)
                    and re.fullmatch(r"\d\d:\d\d", str(b.get("start"))) and re.fullmatch(r"\d\d:\d\d", str(b.get("end")))
                    and b["start"] < b["end"]):
                raise HTTPException(400, "Each work block needs weekday 0-6 and start < end (HH:MM).")
    s = set_settings(conn, vals)
    audit_event("human_action", agent="owner", action="settings", changed=vals)
    return {k: s[k] for k in SETTINGS_KEYS}


@app.post("/api/staff/reset-demo")
def reset_demo(staff=Depends(require_staff)) -> dict:
    from .seed import build
    try:
        info = build()
    except PermissionError:
        raise HTTPException(409, "The database is busy; try again in a moment.")
    audit_event("reset", agent="owner", **info)
    return {"ok": True, **info}
