"""Recipe scaling, the Monday shopping list and the batched production plan. All in code.

Units: every recipe is written for 1 "unit" = one 8-inch tier (three 8" layers, or enough
frosting/filling for one 8" tier). A tier of diameter d needs (d/8)^2 units, so a 6" tier is
0.56 units and a 10" tier is 1.56 units. 10% is added for waste.

The production plan batches shared prep across cakes: every freezer-safe buttercream for the
week is made in one session and frozen, cakes of the same flavor bake together, and
make-ahead decorations (candied citrus, pressed petals) are done early. Decorating happens as
late as possible so flowers and fruit are fresh.
"""

import math
import sqlite3
from datetime import date, datetime, timedelta
from typing import Any

from .db import get_settings, jd, jl
from .models import COMMITTED_STATUSES, OrderSpec
from .pricing import load_menu

WASTE = 1.10
SETUP_MIN = {"frosting": 30, "filling": 20, "bake": 50, "prep": 15}
KIND_ORDER = {"shop": 0, "frosting": 1, "filling": 2, "prep": 3, "bake": 4, "assemble": 5, "decorate": 6,
              "deliver": 7, "pickup": 8}


# ----- recipes -------------------------------------------------------------------------

def recipe_dict(r: sqlite3.Row) -> dict:
    return {"id": r["id"], "name": r["name"], "kind": r["kind"], "source": r["source"], "source_url": r["source_url"],
            "rating": r["rating"], "review_count": r["review_count"], "status": r["status"],
            "yield_note": r["yield_note"], "ingredients": jl(r["ingredients"], []), "steps": jl(r["steps"], []),
            "active_minutes": r["active_minutes"], "shelf_life_days": r["shelf_life_days"],
            "freezer_ok": bool(r["freezer_ok"]), "flavor_codes": jl(r["flavor_codes"], [])}


def default_recipe(conn: sqlite3.Connection, flavor_code: str, kind: str) -> dict | None:
    """Approved recipe for a flavor: owner's own first, then sample, then approved web ones."""
    if not flavor_code or flavor_code == "none":
        return None
    rows = conn.execute("SELECT * FROM recipes WHERE kind = ? AND status = 'approved'", (kind,)).fetchall()
    rank = {"owner": 0, "sample": 1, "web": 2}
    matches = [r for r in rows if flavor_code in jl(r["flavor_codes"], [])]
    if not matches:
        return None
    matches.sort(key=lambda r: (rank.get(r["source"], 9), -(r["rating"] or 0)))
    return recipe_dict(matches[0])


def order_recipes(conn: sqlite3.Connection, o: sqlite3.Row, spec: OrderSpec) -> dict[str, dict | None]:
    out = {}
    for kind, field, col in (("cake", "cake_flavor", "cake_recipe_id"), ("filling", "filling", "filling_recipe_id"),
                             ("frosting", "frosting", "frosting_recipe_id")):
        rid = o[col]
        rec = None
        if rid:
            row = conn.execute("SELECT * FROM recipes WHERE id = ? AND status = 'approved'", (rid,)).fetchone()
            rec = recipe_dict(row) if row else None
        out[kind] = rec or default_recipe(conn, getattr(spec, field), kind)
    return out


def tier_units(diameters: list[int]) -> float:
    return round(sum((d / 8) ** 2 for d in diameters), 4)


# ----- orders for a week ---------------------------------------------------------------

def monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


def default_week_start(today: date) -> date:
    """Plan the coming week: next Monday (or today if it is Monday)."""
    return today if today.weekday() == 0 else today + timedelta(days=7 - today.weekday())


def week_orders(conn: sqlite3.Connection, week_start: date, include_requested: bool = False) -> list[dict]:
    """Orders whose cake is made this week: pickup Tuesday through the next Monday."""
    statuses = list(COMMITTED_STATUSES) + (["requested"] if include_requested else [])
    rows = conn.execute(
        f"SELECT o.*, u.name AS customer_name, u.email AS customer_email FROM orders o JOIN users u ON u.id = o.customer_id "
        f"WHERE o.status IN ({','.join('?' * len(statuses))}) AND o.pickup_date > ? AND o.pickup_date <= ? "
        f"ORDER BY o.pickup_date, o.pickup_time",
        (*statuses, week_start.isoformat(), (week_start + timedelta(days=7)).isoformat())).fetchall()
    menu = load_menu(conn)
    sizes = {z["code"]: z for z in menu["all_sizes"]}
    out = []
    for o in rows:
        spec = OrderSpec(**jl(o["spec"], {}))
        size = sizes.get(spec.size_code)
        recs = order_recipes(conn, o, spec)
        out.append({"order": o, "spec": spec, "size": size, "recipes": recs,
                    "units": tier_units(size["tier_diameters"]) if size else 1.0})
    return out


def order_summary(w: dict) -> dict:
    o, spec, size = w["order"], w["spec"], w["size"]
    return {"order_id": o["id"], "status": o["status"], "customer": o["customer_name"], "pickup_date": o["pickup_date"],
            "pickup_time": o["pickup_time"], "size": size["label"] if size else spec.size_code,
            "cake_flavor": spec.cake_flavor, "filling": spec.filling, "frosting": spec.frosting,
            "addons": [a.model_dump() for a in spec.addons], "fulfillment": spec.fulfillment,
            "delivery_address": spec.delivery_address, "labor_hours": o["labor_hours"],
            "recipes": {k: ({"id": v["id"], "name": v["name"], "source": v["source"]} if v else None)
                        for k, v in w["recipes"].items()}}


# ----- ingredient needs ------------------------------------------------------------------

def order_needs(conn: sqlite3.Connection, w: dict) -> dict[str, float]:
    needs: dict[str, float] = {}

    def add(item: str, qty: float) -> None:
        needs[item] = needs.get(item, 0.0) + qty

    u = w["units"] * WASTE
    for kind in ("cake", "frosting", "filling"):
        rec = w["recipes"].get(kind)
        if rec:
            for ing in rec["ingredients"]:
                add(ing["item"], ing["qty"] * u)
    size, spec = w["size"], w["spec"]
    diams = size["tier_diameters"] if size else [8]
    tiers = len(diams)
    for d in diams:
        add(f"cake_board_{d}", 1)
        add(f"parchment_{d}", 3)
    add("cake_box_tall" if tiers > 1 else "cake_box_10", 1)
    if tiers > 1:
        add("cake_drum_12", 1)
        add("dowels", 4 * (tiers - 1))
    add("piping_bags", 2)
    add("plastic_wrap", 6 * tiers)
    for pick in spec.addons:
        for m in conn.execute("SELECT * FROM addon_materials WHERE addon_code = ?", (pick.code,)):
            mult = {"order": 1, "tier": tiers, "qty": pick.qty}[m["per"]]
            add(m["item"], m["qty"] * mult)
    return needs


def order_cost_estimate(conn: sqlite3.Connection, w: dict) -> float:
    inv = {r["item"]: r["unit_cost"] for r in conn.execute("SELECT item, unit_cost FROM inventory")}
    return round(sum(q * inv.get(item, 0.0) for item, q in order_needs(conn, w).items()), 2)


def cash_balance(conn: sqlite3.Connection) -> float:
    row = conn.execute("SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END), 0) FROM cash_ledger"
                       ).fetchone()
    return round(row[0], 2)


def build_shopping_list(conn: sqlite3.Connection, week_start: date, run_id: str | None = None,
                        include_requested: bool = False) -> dict:
    orders = week_orders(conn, week_start, include_requested)
    need: dict[str, float] = {}
    for_orders: dict[str, set] = {}
    for w in orders:
        for item, q in order_needs(conn, w).items():
            need[item] = need.get(item, 0.0) + q
            for_orders.setdefault(item, set()).add(w["order"]["id"])
    items = []
    for inv in conn.execute("SELECT * FROM inventory ORDER BY category, label"):
        n = need.get(inv["item"], 0.0)
        to_buy = max(0.0, n + inv["par_level"] - inv["qty_on_hand"]) if (n > 0 or inv["qty_on_hand"] < inv["par_level"]) else 0.0
        if to_buy <= 1e-9:
            continue
        packs = math.ceil(to_buy / inv["pack_size"] - 1e-9)
        items.append({"item": inv["label"], "item_code": inv["item"], "category": inv["category"],
                      "need": round(n, 1), "on_hand": inv["qty_on_hand"], "to_buy": round(to_buy, 1),
                      "unit": inv["unit"], "packs": packs, "pack_label": inv["pack_label"], "store": inv["store"],
                      "est_cost": round(packs * inv["pack_size"] * inv["unit_cost"], 2),
                      "for_orders": sorted(for_orders.get(inv["item"], set()))})
    unknown = sorted(set(need) - {r["item"] for r in conn.execute("SELECT item FROM inventory")})
    est_total = round(sum(i["est_cost"] for i in items), 2)
    shop_date = week_start.isoformat()
    created = datetime.now().isoformat(timespec="seconds")
    cur = conn.execute("INSERT INTO shopping_lists(week_start, shop_date, created_at, status, run_id, items, est_total) "
                       "VALUES(?,?,?,?,?,?,?)", (week_start.isoformat(), shop_date, created, "draft", run_id, jd(items),
                                                 est_total))
    conn.commit()
    return {"id": cur.lastrowid, "week_start": week_start.isoformat(), "shop_date": shop_date, "created_at": created,
            "status": "draft", "items": items, "est_total": est_total, "cash_after": round(cash_balance(conn) - est_total, 2),
            "orders": [w["order"]["id"] for w in orders], "unknown_items": unknown}


def shopping_list_dict(conn: sqlite3.Connection, r: sqlite3.Row | None) -> dict | None:
    if r is None:
        return None
    return {"id": r["id"], "week_start": r["week_start"], "shop_date": r["shop_date"], "created_at": r["created_at"],
            "status": r["status"], "items": jl(r["items"], []), "est_total": r["est_total"],
            "cash_after": round(cash_balance(conn) - (r["est_total"] if r["status"] == "draft" else 0), 2)}


# ----- production plan -----------------------------------------------------------------

def _hm(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _fmt(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def work_days(settings: dict, week_start: date, today: date) -> dict[date, tuple[int, int]]:
    out = {}
    for i in range(7):
        d = week_start + timedelta(days=i)
        if d < today:
            continue
        blocks = [b for b in settings["work_blocks"] if b["weekday"] == d.weekday()]
        if blocks:
            out[d] = (min(_hm(b["start"]) for b in blocks), max(_hm(b["end"]) for b in blocks))
    return out


def draft_production_plan(conn: sqlite3.Connection, week_start: date, today: date, run_id: str | None = None) -> dict:
    s = get_settings(conn)
    menu = load_menu(conn)
    addons = {a["code"]: a for a in menu["addons"]}
    days = work_days(s, week_start, today)
    day_list = sorted(days)
    warnings: list[str] = []
    tasks: list[dict] = []
    savings = 0
    orders = week_orders(conn, week_start)
    if not day_list:
        warnings.append("No work days left in this week.")

    def prev_day(d: date | None) -> date | None:
        earlier = [x for x in day_list if d is not None and x < d]
        return earlier[-1] if earlier else None

    plan_orders = []
    for w in orders:
        o, spec = w["order"], w["spec"]
        pickup = date.fromisoformat(o["pickup_date"])
        deco = prev_day(pickup)
        # Decorate on pickup day itself when that day's work block ends before the pickup time.
        if pickup in days and days[pickup][1] <= _hm(o["pickup_time"]):
            deco = pickup
        if deco is None:
            warnings.append(f"Order #{o['id']} ({o['customer_name']}) has no work day before pickup on {pickup}.")
            continue
        assemble = prev_day(deco) or deco
        bake = prev_day(assemble) or assemble
        if assemble == deco:
            warnings.append(f"Order #{o['id']}: assembled and decorated the same day; chill at least 2 hours between.")
        u = w["units"]
        tiers = w["size"]["tiers"] if w["size"] else 1
        prep_min = sum(int(addons[p.code]["labor_hours"] * 60 * 0.6) for p in spec.addons
                       if p.code in addons and addons[p.code]["prep_component"])
        frost_min = 30 + int(20 * u)
        fill_min = (20 + int(10 * u)) if spec.filling and spec.filling != "none" else 0
        bake_min = 50 + int(30 * u)
        assemble_min = 40 * tiers
        decorate_min = max(30, int(o["labor_hours"] * 60) - (prep_min + frost_min + fill_min + bake_min + assemble_min))
        plan_orders.append({"w": w, "pickup": pickup, "deco": deco, "assemble": assemble, "bake": bake, "u": u,
                            "frost_min": frost_min, "fill_min": fill_min, "bake_min": bake_min,
                            "assemble_min": assemble_min, "decorate_min": decorate_min})

    def batch(kind: str, key_fn, day_fn, minutes_key: str, title_fn, storage_fn):
        nonlocal savings
        groups: dict[tuple, list] = {}
        for po in plan_orders:
            key = key_fn(po)
            if key is None:
                continue
            groups.setdefault((key, day_fn(po)), []).append(po)
        for (key, d), members in groups.items():
            minutes = sum(m[minutes_key] for m in members) - SETUP_MIN[kind] * (len(members) - 1)
            savings += SETUP_MIN[kind] * (len(members) - 1)
            ids = [m["w"]["order"]["id"] for m in members]
            tasks.append({"kind": kind, "day": d, "minutes": minutes, "order_ids": ids, "batch": len(members) > 1,
                          "title": title_fn(key, members), "notes": "", "storage": storage_fn(key, members)})

    first = day_list[0] if day_list else None

    def frost_day(po):
        rec = po["w"]["recipes"]["frosting"]
        if rec and rec["freezer_ok"] and first:
            return first
        return po["assemble"]

    def frost_key(po):
        rec = po["w"]["recipes"]["frosting"]
        if rec is None:
            warnings.append(f"Order #{po['w']['order']['id']}: no approved recipe for frosting '{po['w']['spec'].frosting}'.")
            return None
        return rec["name"]

    batch("frosting", frost_key, frost_day, "frost_min",
          lambda k, m: f"Make {k.replace(' (sample)', '')} for {len(m)} cake{'s' if len(m) > 1 else ''}",
          lambda k, m: ("Divide by order, label and freeze. Move to the fridge the night before assembly; re-whip."
                        if m[0]["w"]["recipes"]["frosting"]["freezer_ok"] else "Keep chilled; use within "
                        f"{m[0]['w']['recipes']['frosting']['shelf_life_days']} day(s)."))

    def fill_key(po):
        rec = po["w"]["recipes"]["filling"]
        return rec["name"] if rec else None

    def fill_day(po):
        rec = po["w"]["recipes"]["filling"]
        if rec and first and (po["assemble"] - first).days <= rec["shelf_life_days"]:
            return first
        return po["assemble"]

    batch("filling", fill_key, fill_day, "fill_min",
          lambda k, m: f"Make {k.replace(' (sample)', '')} for {len(m)} cake{'s' if len(m) > 1 else ''}",
          lambda k, m: "Cool, cover and refrigerate until assembly.")

    for po in plan_orders:
        for p in po["w"]["spec"].addons:
            a = addons.get(p.code)
            if a and a["prep_component"]:
                d = po["assemble"] if p.code == "sugared_fruit" else (first or po["assemble"])
                tasks.append({"kind": "prep", "day": d, "minutes": int(a["labor_hours"] * 60 * 0.6), "order_ids":
                              [po["w"]["order"]["id"]], "batch": False, "title": f"Prep {a['name'].lower()}",
                              "notes": "", "storage": "Store airtight at room temperature."})
    # merge identical prep tasks on the same day into one batch
    merged: dict[tuple, dict] = {}
    for t in [t for t in tasks if t["kind"] == "prep"]:
        key = (t["title"], t["day"])
        if key in merged:
            merged[key]["minutes"] += t["minutes"] - SETUP_MIN["prep"]
            merged[key]["order_ids"] += t["order_ids"]
            merged[key]["batch"] = True
            savings += SETUP_MIN["prep"]
        else:
            merged[key] = t
    tasks = [t for t in tasks if t["kind"] != "prep"] + list(merged.values())

    batch("bake", lambda po: po["w"]["spec"].cake_flavor, lambda po: po["bake"], "bake_min",
          lambda k, m: f"Bake {k.replace('_', ' ')} layers for {len(m)} cake{'s' if len(m) > 1 else ''}",
          lambda k, m: "Cool, wrap in plastic and chill (or freeze) until assembly.")

    for po in plan_orders:
        o, spec = po["w"]["order"], po["w"]["spec"]
        name = o["customer_name"].split()[0]
        tasks.append({"kind": "assemble", "day": po["assemble"], "minutes": po["assemble_min"], "order_ids": [o["id"]],
                      "batch": False, "title": f"Fill, stack & crumb-coat #{o['id']} ({name})",
                      "notes": "Insert dowels for tiered cakes." if po["w"]["size"] and po["w"]["size"]["tiers"] > 1 else "",
                      "storage": "Chill overnight before the final coat."})
        decor = ", ".join(p.code.replace("_", " ") for p in spec.addons) or "simple finish"
        tasks.append({"kind": "decorate", "day": po["deco"], "minutes": po["decorate_min"], "order_ids": [o["id"]],
                      "batch": False, "title": f"Final coat & decorate #{o['id']} ({name}): {decor}",
                      "notes": "Add fresh flowers and fruit last.", "storage": "Box and refrigerate until pickup."})
        if spec.fulfillment == "delivery":
            start = max(0, _hm(o["pickup_time"]) - 45)
            tasks.append({"kind": "deliver", "day": po["pickup"], "minutes": 60, "order_ids": [o["id"]], "batch": False,
                          "title": f"Deliver #{o['id']} to {spec.delivery_address or 'address on file'}",
                          "notes": f"Leave by {_fmt(start)}; drive with the AC on and the cake flat.", "storage": None,
                          "fixed_start": start})
        else:
            tasks.append({"kind": "pickup", "day": po["pickup"], "minutes": 15, "order_ids": [o["id"]], "batch": False,
                          "title": f"Pickup #{o['id']}: {o['customer_name']} at {o['pickup_time']}",
                          "notes": "Collect the balance (demo).", "storage": None,
                          "fixed_start": _hm(o["pickup_time"])})

    if week_start >= today and plan_orders:
        tasks.append({"kind": "shop", "day": week_start, "minutes": 90, "order_ids": [], "batch": True,
                      "title": "Monday grocery run (see shopping list)", "notes": "", "storage": None, "fixed_start": 600})

    # balance: move make-ahead tasks off over-full days (within each task's allowed days)
    def latest_day(t: dict) -> date | None:
        lim = [po["assemble"] for po in plan_orders if po["w"]["order"]["id"] in t["order_ids"]]
        return min(lim) if lim else None

    movable = ("prep", "filling", "frosting", "bake")
    cap = {d: days[d][1] - days[d][0] for d in day_list}
    for _ in range(30):
        load = {d: sum(t["minutes"] for t in tasks if t["day"] == d and "fixed_start" not in t) for d in day_list}
        over = [d for d in day_list if load[d] > cap[d]]
        if not over:
            break
        d = over[0]
        moved = False
        for t in sorted([t for t in tasks if t["day"] == d and t["kind"] in movable], key=lambda t: -t["minutes"]):
            last = latest_day(t)
            options = [x for x in day_list if x != d and (last is None or x <= last)
                       and load[x] + t["minutes"] <= cap[x]]
            if options:
                t["day"] = max(options, key=lambda x: cap[x] - load[x])
                moved = True
                break
        if not moved:
            break

    # storage notes that match the final days: use today's portion fresh, freeze only what waits
    for t in tasks:
        if t["kind"] != "frosting":
            continue
        later = [po for po in plan_orders if po["w"]["order"]["id"] in t["order_ids"] and po["assemble"] > t["day"]]
        rec = next((po["w"]["recipes"]["frosting"] for po in plan_orders if po["w"]["order"]["id"] in t["order_ids"]), None)
        if not later:
            t["storage"] = "Use the same day; keep covered at cool room temperature."
        elif rec and rec["freezer_ok"]:
            ids = ", ".join(f"#{po['w']['order']['id']}" for po in later)
            t["storage"] = (f"Portion by order. Freeze the portions for {ids}; move each to the fridge the night "
                            "before its assembly and re-whip.")

    # pack tasks into each day's work block
    out: list[dict] = []
    n = 0
    for d in sorted({t["day"] for t in tasks}):
        day_tasks = sorted([t for t in tasks if t["day"] == d], key=lambda t: (KIND_ORDER[t["kind"]], t["order_ids"]))
        block = days.get(d)
        cursor = block[0] if block else 0
        for t in day_tasks:
            n += 1
            if "fixed_start" in t:
                start = t["fixed_start"]
            else:
                start = cursor
                cursor += t["minutes"]
            end = start + t["minutes"]
            out.append({"id": f"T{n}", "day": d.isoformat(), "start": _fmt(start), "end": _fmt(end), "title": t["title"],
                        "kind": t["kind"], "order_ids": t["order_ids"], "batch": t["batch"], "notes": t["notes"],
                        "storage": t["storage"], "minutes": t["minutes"]})
        if block and cursor > block[1]:
            warnings.append(f"{d.strftime('%A %b %d')} is over the work block by {cursor - block[1]} minutes. "
                            "Move a make-ahead task to an earlier day.")
    work_min = sum(t["minutes"] for t in out if t["kind"] not in ("pickup", "deliver", "shop"))
    summary = (f"{len(plan_orders)} cake(s) this week, {work_min / 60:.1f} hours of kitchen work. Batching saves "
               f"about {savings} minutes.")
    created = datetime.now().isoformat(timespec="seconds")
    cur = conn.execute("INSERT INTO plans(week_start, created_at, status, run_id, tasks, summary, warnings, "
                       "batching_savings_minutes) VALUES(?,?,?,?,?,?,?,?)",
                       (week_start.isoformat(), created, "draft", run_id, jd(out), summary, jd(warnings), savings))
    conn.commit()
    return plan_dict(conn.execute("SELECT * FROM plans WHERE id = ?", (cur.lastrowid,)).fetchone())


def plan_dict(r: sqlite3.Row | None) -> dict | None:
    if r is None:
        return None
    return {"id": r["id"], "week_start": r["week_start"], "created_at": r["created_at"], "status": r["status"],
            "run_id": r["run_id"], "tasks": jl(r["tasks"], []), "summary": r["summary"],
            "warnings": jl(r["warnings"], []), "batching_savings_minutes": r["batching_savings_minutes"]}


def move_plan_task(conn: sqlite3.Connection, plan_id: int, task_id: str, day: str, start: str, today: date) -> dict:
    """Move one task, then validate the whole plan. Refuses moves that break a rule."""
    r = conn.execute("SELECT * FROM plans WHERE id = ?", (plan_id,)).fetchone()
    if r is None:
        return {"ok": False, "message": f"Plan {plan_id} not found."}
    plan = plan_dict(r)
    if plan["status"] == "final":
        return {"ok": False, "message": "Plan is already final."}
    tasks = plan["tasks"]
    t = next((x for x in tasks if x["id"] == task_id), None)
    if t is None:
        return {"ok": False, "message": f"Task {task_id} not found."}
    if t["kind"] in ("pickup", "deliver", "shop"):
        return {"ok": False, "message": "Pickups, deliveries and the shopping trip are fixed to the order/calendar."}
    s = get_settings(conn)
    week_start = date.fromisoformat(plan["week_start"])
    days = work_days(s, week_start, today)
    try:
        d = date.fromisoformat(day)
        st = _hm(start)
    except ValueError:
        return {"ok": False, "message": "day must be YYYY-MM-DD and start HH:MM."}
    if d not in days:
        return {"ok": False, "message": f"{day} is not a work day in this week. Work days: "
                                        f"{', '.join(x.isoformat() for x in sorted(days))}."}
    end = st + t["minutes"]
    if st < days[d][0] or end > days[d][1]:
        return {"ok": False, "message": f"Must fit inside {_fmt(days[d][0])}-{_fmt(days[d][1])} on {day}."}
    for other in tasks:
        if other["id"] != task_id and other["day"] == day and other["kind"] not in ("pickup", "deliver", "shop"):
            if st < _hm(other["end"]) and _hm(other["start"]) < end:
                return {"ok": False, "message": f"Overlaps {other['id']} ({other['title']}) {other['start']}-{other['end']}."}
    order_rank = {"frosting": 0, "filling": 0, "prep": 0, "bake": 1, "assemble": 2, "decorate": 3}
    for oid in t["order_ids"]:
        for other in tasks:
            if other["id"] == task_id or oid not in other["order_ids"] or other["kind"] not in order_rank:
                continue
            if order_rank[other["kind"]] > order_rank[t["kind"]] and day > other["day"]:
                return {"ok": False, "message": f"{t['title']} must happen before {other['title']} ({other['day']})."}
            if order_rank[other["kind"]] < order_rank[t["kind"]] and day < other["day"]:
                return {"ok": False, "message": f"{t['title']} must happen after {other['title']} ({other['day']})."}
        pickup = conn.execute("SELECT pickup_date FROM orders WHERE id = ?", (oid,)).fetchone()
        if pickup and day >= pickup["pickup_date"]:
            return {"ok": False, "message": f"Order #{oid} is picked up {pickup['pickup_date']}; work must finish before."}
    t["day"], t["start"], t["end"] = day, _fmt(st), _fmt(end)
    tasks.sort(key=lambda x: (x["day"], x["start"]))
    conn.execute("UPDATE plans SET tasks = ? WHERE id = ?", (jd(tasks), plan_id))
    conn.commit()
    return {"ok": True, "task": t}


def finalize_plan(conn: sqlite3.Connection, plan_id: int, summary: str, tips: list[str]) -> dict:
    r = conn.execute("SELECT * FROM plans WHERE id = ?", (plan_id,)).fetchone()
    if r is None:
        return {"ok": False, "message": f"Plan {plan_id} not found."}
    latest = conn.execute("SELECT MAX(id) FROM plans WHERE week_start = ?", (r["week_start"],)).fetchone()[0]
    if latest != plan_id:
        return {"ok": False, "message": f"Plan {plan_id} is outdated; the latest plan for this week is {latest}."}
    text = (r["summary"] + ("\n\n" + summary.strip() if summary.strip() else "")
            + ("".join(f"\n- {t.strip()}" for t in tips[:8] if t.strip())))
    conn.execute("UPDATE plans SET status = 'final', summary = ? WHERE id = ?", (text[:3000], plan_id))
    conn.commit()
    return {"ok": True, "plan": plan_dict(conn.execute("SELECT * FROM plans WHERE id = ?", (plan_id,)).fetchone())}
