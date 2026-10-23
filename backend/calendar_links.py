"""Calendar and Gmail without storing any Google credentials.

The app's own calendar (built from orders, production plans and Monday shopping trips) is
the source of truth. Each event gets an "Add to Google Calendar" link and the whole calendar
can be downloaded as an .ics file. Email drafts get a "compose in Gmail" link that opens a
pre-filled draft in the owner's browser — the owner presses send, never the app.
"""

import sqlite3
from datetime import date, datetime, timedelta
from urllib.parse import quote, urlencode

from .db import jl
from .models import OrderSpec

TZ = "America/New_York"
STUDIO = "Garden Party Cake Studio, New Haven, CT"


def google_link(title: str, start: datetime, end: datetime, details: str = "", location: str = "") -> str:
    fmt = "%Y%m%dT%H%M%S"
    return "https://calendar.google.com/calendar/render?" + urlencode({
        "action": "TEMPLATE", "text": title, "dates": f"{start.strftime(fmt)}/{end.strftime(fmt)}",
        "details": details, "location": location, "ctz": TZ}, quote_via=quote)


def gmail_link(to: str, subject: str, body: str) -> str:
    return "https://mail.google.com/mail/?" + urlencode({"view": "cm", "fs": "1", "to": to, "su": subject,
                                                          "body": body}, quote_via=quote)


def _dt(d: str, t: str) -> datetime:
    return datetime.fromisoformat(f"{d}T{t}:00")


def order_event(o: sqlite3.Row, customer_name: str) -> dict:
    spec = OrderSpec(**jl(o["spec"], {}))
    start = _dt(o["pickup_date"], o["pickup_time"])
    delivery = spec.fulfillment == "delivery"
    if delivery:
        start = start - timedelta(minutes=45)
    end = start + timedelta(minutes=60 if delivery else 30)
    kind = "hold" if o["status"] == "requested" else ("delivery" if delivery else "pickup")
    title = (f"HOLD (awaiting review): cake #{o['id']} for {customer_name}" if kind == "hold"
             else f"{'Deliver' if delivery else 'Pickup'}: cake #{o['id']} for {customer_name}")
    location = spec.delivery_address if delivery else STUDIO
    details = f"{spec.occasion}. Order #{o['id']} ({o['status']})."
    return {"id": o["id"], "kind": kind, "title": title, "start": start.isoformat(), "end": end.isoformat(),
            "location": location, "order_id": o["id"],
            "status": "confirmed" if o["status"] in ("confirmed", "in_production", "ready", "completed") else "tentative",
            "google_link": google_link(title, start, end, details, location or "")}


def calendar_events(conn: sqlite3.Connection, start: date, end: date) -> list[dict]:
    events = []
    rows = conn.execute("SELECT o.*, u.name AS customer_name FROM orders o JOIN users u ON u.id = o.customer_id "
                        "WHERE o.status NOT IN ('declined','cancelled','expired') AND o.pickup_date BETWEEN ? AND ?",
                        (start.isoformat(), end.isoformat())).fetchall()
    events += [order_event(o, o["customer_name"]) for o in rows]
    plans = conn.execute("SELECT * FROM plans WHERE id IN (SELECT MAX(id) FROM plans GROUP BY week_start)").fetchall()
    n = 100000
    for p in plans:
        for t in jl(p["tasks"], []):
            if t["kind"] in ("pickup", "deliver") or not (start.isoformat() <= t["day"] <= end.isoformat()):
                continue
            n += 1
            s, e = _dt(t["day"], t["start"]), _dt(t["day"], t["end"])
            kind = "shopping" if t["kind"] == "shop" else "prep"
            events.append({"id": n, "kind": kind, "title": t["title"], "start": s.isoformat(), "end": e.isoformat(),
                           "location": None, "order_id": (t["order_ids"] or [None])[0],
                           "status": "confirmed" if p["status"] == "final" else "tentative",
                           "google_link": google_link(t["title"], s, e, t.get("notes") or "")})
    have_shop = {e["start"][:10] for e in events if e["kind"] == "shopping"}
    d = start
    while d <= end:
        if d.weekday() == 0 and d.isoformat() not in have_shop:
            n += 1
            s, e = datetime.combine(d, datetime.min.time()).replace(hour=10), datetime.combine(d, datetime.min.time()).replace(hour=11, minute=30)
            events.append({"id": n, "kind": "shopping", "title": "Monday grocery run", "start": s.isoformat(),
                           "end": e.isoformat(), "location": None, "order_id": None, "status": "confirmed",
                           "google_link": google_link("Monday grocery run", s, e, "See the shopping list in the staff portal.")})
        d += timedelta(days=1)
    return sorted(events, key=lambda e: e["start"])


def to_ics(events: list[dict]) -> str:
    def esc(s: str) -> str:
        return (s or "").replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")

    fmt = "%Y%m%dT%H%M%S"
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Garden Party Cake Studio//Kitchen//EN", "CALSCALE:GREGORIAN"]
    stamp = datetime.now().strftime(fmt)
    for e in events:
        lines += ["BEGIN:VEVENT", f"UID:gp-{e['kind']}-{e['id']}@gardenpartycakes", f"DTSTAMP:{stamp}",
                  f"DTSTART;TZID={TZ}:{datetime.fromisoformat(e['start']).strftime(fmt)}",
                  f"DTEND;TZID={TZ}:{datetime.fromisoformat(e['end']).strftime(fmt)}",
                  f"SUMMARY:{esc(e['title'])}", f"STATUS:{'CONFIRMED' if e['status'] == 'confirmed' else 'TENTATIVE'}"]
        if e.get("location"):
            lines.append(f"LOCATION:{esc(e['location'])}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"
