"""Kitchen capacity: which pickup dates still fit, given the owner's work hours.

Every cake needs labor hours (size + add-ons). A cake can only be worked on during the
owner's work blocks in the few days before its pickup (production_window_days). A new
pickup date is offered only if ALL booked cakes plus the new one can still be finished on
time. The check is an earliest-deadline-first schedule, which is exact for this kind of
problem (one baker, work can be split across days). This is code, not the LLM, so an
agent can never overbook the kitchen.
"""

import sqlite3
from datetime import date, datetime, timedelta
from typing import Any

from .db import get_settings
from .models import ACTIVE_STATUSES, OrderSpec
from .pricing import labor_hours, load_menu


def _block_hours(block: dict) -> float:
    s = datetime.strptime(block["start"], "%H:%M")
    e = datetime.strptime(block["end"], "%H:%M")
    return max(0.0, (e - s).seconds / 3600)


def day_capacity(settings: dict, d: date) -> float:
    hours = sum(_block_hours(b) for b in settings["work_blocks"] if b["weekday"] == d.weekday())
    return round(hours * settings["capacity_utilization"], 2)


def active_jobs(conn: sqlite3.Connection, today: date, exclude_order_id: int | None = None) -> list[dict]:
    """Orders that hold kitchen time. A request only holds time until its hold expires."""
    now = datetime.combine(today, datetime.now().time()).isoformat(timespec="seconds")
    rows = conn.execute(
        f"SELECT id, status, pickup_date, labor_hours, hold_expires_at FROM orders "
        f"WHERE status IN ({','.join('?' * len(ACTIVE_STATUSES))}) AND pickup_date > ?",
        (*ACTIVE_STATUSES, today.isoformat())).fetchall()
    jobs = []
    for r in rows:
        if r["id"] == exclude_order_id:
            continue
        if r["status"] == "requested" and r["hold_expires_at"] and r["hold_expires_at"] < now:
            continue
        jobs.append({"id": r["id"], "pickup": date.fromisoformat(r["pickup_date"]), "hours": float(r["labor_hours"]),
                     "status": r["status"]})
    return jobs


def _schedule(jobs: list[dict], settings: dict, today: date) -> tuple[bool, dict[date, float], list[int]]:
    """Earliest-deadline-first. Returns (all on time?, hours used per day, late job ids)."""
    if not jobs:
        return True, {}, []
    window = settings["production_window_days"]
    remaining = {j["id"]: j["hours"] for j in jobs}
    release = {j["id"]: max(today + timedelta(days=1), j["pickup"] - timedelta(days=window)) for j in jobs}
    deadline = {j["id"]: j["pickup"] for j in jobs}  # work must finish on a day before pickup
    used: dict[date, float] = {}
    day = min(release.values())
    last = max(deadline.values())
    late: list[int] = []
    while day < last:
        cap = day_capacity(settings, day)
        ready = sorted((jid for jid in remaining if remaining[jid] > 1e-9 and release[jid] <= day < deadline[jid]),
                       key=lambda jid: deadline[jid])
        for jid in ready:
            if cap <= 1e-9:
                break
            take = min(cap, remaining[jid])
            remaining[jid] -= take
            cap -= take
            used[day] = used.get(day, 0.0) + take
        day += timedelta(days=1)
        for jid, d in deadline.items():
            if d == day and remaining[jid] > 1e-9 and jid not in late:
                late.append(jid)
    late += [jid for jid in remaining if remaining[jid] > 1e-9 and jid not in late]
    return not late, used, late


def check_date(conn: sqlite3.Connection, hours: float, pickup: date, today: date,
               exclude_order_id: int | None = None, settings: dict | None = None) -> dict[str, Any]:
    s = settings or get_settings(conn)
    if pickup <= today:
        return {"status": "past", "ok": False, "free_hours_before": 0.0, "note": "Date has passed."}
    if (pickup - today).days < s["min_lead_days"]:
        return {"status": "too_soon", "ok": False, "free_hours_before": 0.0,
                "note": f"Needs {s['min_lead_days']} days' notice."}
    if pickup.weekday() not in s["pickup_weekdays"]:
        return {"status": "closed", "ok": False, "free_hours_before": 0.0, "note": "No pickups this day."}
    jobs = active_jobs(conn, today, exclude_order_id)
    ok_before, used_before, _ = _schedule(jobs, s, today)
    window_days = [pickup - timedelta(days=i) for i in range(1, s["production_window_days"] + 1)]
    window_days = [d for d in window_days if d > today]
    free = sum(max(0.0, day_capacity(s, d) - used_before.get(d, 0.0)) for d in window_days)
    candidate = {"id": -1, "pickup": pickup, "hours": hours, "status": "new"}
    ok, _, late = _schedule(jobs + [candidate], s, today)
    if not ok:
        note = "Fully booked." if -1 in late else "Would make another booked cake late."
        return {"status": "full", "ok": False, "free_hours_before": round(free, 1), "note": note}
    status = "limited" if free < hours * 1.75 else "available"
    return {"status": status, "ok": True, "free_hours_before": round(free, 1),
            "note": "Only a little time left that week." if status == "limited" else None}


def availability(conn: sqlite3.Connection, spec: OrderSpec, today: date, days: int = 75,
                 exclude_order_id: int | None = None) -> dict[str, Any]:
    s = get_settings(conn)
    menu = load_menu(conn)
    if not spec.size_code:
        spec = spec.model_copy(update={"size_code": menu["sizes"][0]["code"]})
    hours = labor_hours(conn, spec, menu)
    out = []
    first = None
    for i in range(0, days + 1):
        d = today + timedelta(days=i)
        r = check_date(conn, hours, d, today, exclude_order_id, s) if i else \
            {"status": "past", "ok": False, "free_hours_before": 0.0, "note": "Today."}
        out.append({"date": d.isoformat(), "status": r["status"], "free_hours_before": r["free_hours_before"],
                    "note": r.get("note")})
        if r["ok"] and first is None:
            first = d.isoformat()
    return {"labor_hours": hours, "lead_days": s["min_lead_days"], "first_available": first, "days": out}


def week_load(conn: sqlite3.Connection, week_start: date, today: date) -> dict[str, float]:
    s = get_settings(conn)
    jobs = active_jobs(conn, today)
    _, used, _ = _schedule(jobs, s, today)
    days = [week_start + timedelta(days=i) for i in range(7)]
    return {"committed": round(sum(used.get(d, 0.0) for d in days), 1),
            "capacity": round(sum(day_capacity(s, d) for d in days), 1)}
