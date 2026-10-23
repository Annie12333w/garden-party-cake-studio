"""Menu loading and the price/labor calculator. Prices are computed only here, in code.

Rule: base = max(min_price, servings x per_serving_rate), plus premium flavors (per tier),
plus add-ons, plus a short-notice fee, plus delivery. The LLM can explain a quote but can
never set or change one; the owner sets the official price when she accepts an order.
"""

import math
import sqlite3
from datetime import date
from typing import Any

from .db import get_settings, jl
from .models import OrderSpec

ALLERGEN_WORDS = {
    "tree_nuts": ("nut", "almond", "pistachio", "walnut", "pecan", "hazelnut", "cashew"),
    "peanuts": ("peanut",),
    "eggs": ("egg",),
    "milk": ("dairy", "milk", "lactose", "butter", "cream"),
    "wheat": ("gluten", "wheat", "celiac", "coeliac"),
    "soy": ("soy",),
}


def load_menu(conn: sqlite3.Connection) -> dict[str, Any]:
    s = get_settings(conn)
    sizes = []       # what customers can order
    all_sizes = []   # also retired sizes, so earlier orders still display and plan correctly
    for r in conn.execute("SELECT * FROM sizes ORDER BY COALESCE(price, servings * 9), servings"):
        keys = r.keys()
        price = r["price"] if "price" in keys else None
        item = {
            "id": r["id"], "code": r["code"], "label": r["label"], "tiers": r["tiers"],
            "tier_diameters": jl(r["tier_diameters"], []), "servings": r["servings"],
            "labor_hours": r["labor_hours"], "description": r["description"],
            "needs_review": bool(r["needs_review"]),
            # each size has a set price (owner's choice); the per-serving rule is only a fallback
            "base_price": round(max(s["min_price"], price), 2) if price is not None else base_price(r["servings"], s),
            "active": bool(r["active"]) if "active" in keys else True,
        }
        all_sizes.append(item)
        if item["active"]:
            sizes.append(item)
    flavors: dict[str, list] = {"cake": [], "filling": [], "frosting": []}
    for r in conn.execute("SELECT * FROM flavors ORDER BY premium, name"):
        flavors[r["kind"]].append({
            "code": r["code"], "name": r["name"], "kind": r["kind"], "premium": bool(r["premium"]),
            "upcharge": r["upcharge"], "allergens": jl(r["allergens"], []), "description": r["description"],
        })
    addons = [{
        "id": r["id"], "code": r["code"], "name": r["name"], "category": r["category"], "price": r["price"],
        "price_type": r["price_type"], "labor_hours": r["labor_hours"], "allergens": jl(r["allergens"], []),
        "description": r["description"], "needs_review": bool(r["needs_review"]),
        "prep_component": bool(r["prep_component"]),
    } for r in conn.execute("SELECT * FROM addons ORDER BY category, price")]
    gallery = []
    size_by_code = {z["code"]: z for z in all_sizes}
    for r in conn.execute("SELECT * FROM gallery ORDER BY id"):
        g = {"id": r["id"], "slug": r["slug"], "title": r["title"], "image": r["image"],
             "description": r["description"], "tags": jl(r["tags"], []), "addon_codes": jl(r["addon_codes"], []),
             "size_code": r["size_code"], "cake_flavor": r["cake_flavor"], "filling": r["filling"],
             "frosting": r["frosting"], "kind": r["kind"], "related": jl(r["related"], [])}
        spec = OrderSpec(size_code=g["size_code"], cake_flavor=g["cake_flavor"] or "", filling=g["filling"] or "none",
                         frosting=g["frosting"] or "", addons=[{"code": c, "qty": 1} for c in g["addon_codes"]])
        g["from_price"] = _price_parts(spec, size_by_code, flavors, addons, s, None)["subtotal"]
        gallery.append(g)
    policies = {k: s[k] for k in ("min_price", "per_serving_rate", "deposit_pct", "min_lead_days", "hold_hours",
                                  "rush_days", "rush_pct", "delivery_fees", "work_blocks", "pickup_weekdays",
                                  "pickup_times", "style_note")}
    return {"sizes": sizes, "all_sizes": all_sizes, "flavors": flavors, "addons": addons, "gallery": gallery,
            "policies": policies}


def base_price(servings: int, settings: dict) -> float:
    return round(max(settings["min_price"], servings * settings["per_serving_rate"]), 2)


def _flavor_index(flavors: dict) -> dict[str, dict]:
    return {f["code"]: f for kind in flavors.values() for f in kind}


def _price_parts(spec: OrderSpec, sizes: dict, flavors: dict, addons: list, s: dict,
                 today: date | None) -> dict[str, Any]:
    lines: list[dict] = []
    flags: list[dict] = []
    fidx = _flavor_index(flavors)
    aidx = {a["code"]: a for a in addons}
    size = sizes.get(spec.size_code)
    if size is None:
        servings, tiers = 0, 1
        base = s["min_price"]
        lines.append({"code": "base", "label": f"Starting price (choose a size)", "amount": base})
        if spec.size_code:
            flags.append({"code": "unknown_size", "severity": "block", "message": f"Unknown size '{spec.size_code}'."})
    else:
        servings, tiers = size["servings"], size["tiers"]
        base = size["base_price"]
        label = f"{size['label']} (serves about {servings})"
        lines.append({"code": "base", "label": label, "amount": base})
        if size.get("needs_review"):
            flags.append({"code": "size_review", "severity": "warn",
                          "message": f"{size['label']} needs the owner's review (large build)."})
    labor = size["labor_hours"] if size else 0.0

    for field, kind in (("cake_flavor", "cake"), ("filling", "filling"), ("frosting", "frosting")):
        code = getattr(spec, field)
        if not code or code == "none":
            continue
        f = fidx.get(code)
        if f is None or f["kind"] != kind:
            flags.append({"code": f"unknown_{field}", "severity": "block", "message": f"Unknown {kind} '{code}'."})
            continue
        if f["upcharge"]:
            lines.append({"code": code, "label": f"{f['name']} (premium, ${f['upcharge']:g} per tier)",
                          "amount": round(f["upcharge"] * tiers, 2)})

    addon_total = 0.0
    percent_addons = []
    for pick in spec.addons:
        a = aidx.get(pick.code)
        if a is None:
            flags.append({"code": "unknown_addon", "severity": "block", "message": f"Unknown add-on '{pick.code}'."})
            continue
        if a["price_type"] == "percent":
            percent_addons.append((a, pick.qty))
            continue
        unit = a["price"]
        if a["price_type"] == "per_tier":
            amount, label = unit * tiers * pick.qty, f"{a['name']} (${unit:g} x {tiers} tier{'s' if tiers > 1 else ''})"
        elif a["price_type"] == "per_serving":
            amount, label = unit * max(servings, 1) * pick.qty, f"{a['name']} (${unit:g} x {servings} servings)"
        else:
            amount, label = unit * pick.qty, a["name"] + (f" x {pick.qty}" if pick.qty > 1 else "")
        amount = round(amount, 2)
        addon_total += amount
        lines.append({"code": a["code"], "label": label, "amount": amount})
        labor += a["labor_hours"] * (tiers if a["price_type"] == "per_tier" else 1) * pick.qty
        if a["needs_review"]:
            flags.append({"code": f"review_{a['code']}", "severity": "warn",
                          "message": f"{a['name']} needs the owner's review before it can be promised."})

    subtotal = round(sum(l["amount"] for l in lines), 2)
    for a, qty in percent_addons:
        amt = round(subtotal * a["price"] / 100 * qty, 2)
        lines.append({"code": a["code"], "label": f"{a['name']} ({a['price']:g}%)", "amount": amt})
        addon_total += amt
    subtotal = round(sum(l["amount"] for l in lines), 2)

    rush_fee = 0.0
    if today and spec.pickup_date:
        try:
            days_out = (date.fromisoformat(spec.pickup_date) - today).days
        except ValueError:
            days_out = None
            flags.append({"code": "bad_date", "severity": "block", "message": "Pickup date is not a valid date."})
        if days_out is not None:
            if days_out < s["min_lead_days"]:
                flags.append({"code": "too_soon", "severity": "block",
                              "message": f"Orders need at least {s['min_lead_days']} days' notice."})
            elif days_out < s["rush_days"]:
                rush_fee = round(subtotal * s["rush_pct"], 2)
                lines.append({"code": "rush", "label": f"Short notice (under {s['rush_days']} days, "
                                                       f"{int(s['rush_pct'] * 100)}%)", "amount": rush_fee})

    delivery_fee = 0.0
    if spec.fulfillment == "delivery":
        zone = spec.delivery_zone or "new_haven"
        delivery_fee = float(s["delivery_fees"].get(zone, 0))
        lines.append({"code": "delivery", "label": f"Delivery ({zone.replace('_', ' ')})", "amount": delivery_fee})
        labor += 1.0 if zone != "far" else 2.0
        if zone == "far":
            flags.append({"code": "delivery_far", "severity": "warn",
                          "message": "Delivery beyond 15 miles of New Haven needs the owner's review."})
        if not spec.delivery_address:
            flags.append({"code": "no_address", "severity": "warn", "message": "Add a delivery address."})

    return {"lines": lines, "flags": flags, "servings": servings, "base_price": base, "subtotal": subtotal,
            "addons_total": round(addon_total, 2), "rush_fee": rush_fee, "delivery_fee": delivery_fee,
            "labor_hours": round(labor, 2), "tiers": tiers}


def allergen_flags(spec: OrderSpec, menu: dict) -> list[dict]:
    """Compare what the customer is allergic to with what the chosen components contain."""
    text = f"{spec.allergies} {spec.dietary or ''}".lower()
    if not text.strip() or text.strip() in {"none", "no", "n/a", "na"}:
        return []
    fidx = _flavor_index(menu["flavors"])
    aidx = {a["code"]: a for a in menu["addons"]}
    contains: dict[str, list[str]] = {}
    for code in (spec.cake_flavor, spec.filling, spec.frosting):
        f = fidx.get(code)
        for al in (f or {}).get("allergens", []):
            contains.setdefault(al, []).append(f["name"])
    for p in spec.addons:
        a = aidx.get(p.code)
        for al in (a or {}).get("allergens", []):
            contains.setdefault(al, []).append(a["name"])
    flags = []
    for allergen, words in ALLERGEN_WORDS.items():
        if any(w in text for w in words) and allergen in contains:
            flags.append({"code": f"allergen_{allergen}", "severity": "block",
                          "message": f"Customer listed '{spec.allergies or spec.dietary}', but "
                                     f"{', '.join(sorted(set(contains[allergen])))} contain {allergen.replace('_', ' ')}. "
                                     "The owner must review; never promise allergen-free."})
    if not flags:
        flags.append({"code": "allergy_noted", "severity": "warn",
                      "message": f"Allergy/dietary note: '{(spec.allergies or spec.dietary or '').strip()}'. "
                                 "Home kitchen: cross-contact is possible."})
    return flags


def quote(conn: sqlite3.Connection, spec: OrderSpec, today: date | None, menu: dict | None = None) -> dict[str, Any]:
    menu = menu or load_menu(conn)
    s = get_settings(conn)
    sizes = {z["code"]: z for z in menu["sizes"]}
    p = _price_parts(spec, sizes, menu["flavors"], menu["addons"], s, today)
    total = float(math.ceil(p["subtotal"] + p["rush_fee"] + p["delivery_fee"]))
    deposit = round(total * s["deposit_pct"], 2)
    flags = p["flags"] + allergen_flags(spec, menu)
    return {
        "lines": p["lines"], "servings": p["servings"], "base_price": p["base_price"],
        "addons_total": p["addons_total"], "rush_fee": p["rush_fee"], "delivery_fee": p["delivery_fee"],
        "total": total, "deposit": deposit, "balance": round(total - deposit, 2),
        "labor_hours": p["labor_hours"],
        "rule": f"size price (from ${min(z['base_price'] for z in menu['sizes']):g}) + premium flavors + add-ons",
        "flags": flags,
    }


def labor_hours(conn: sqlite3.Connection, spec: OrderSpec, menu: dict | None = None) -> float:
    menu = menu or load_menu(conn)
    s = get_settings(conn)
    sizes = {z["code"]: z for z in menu["all_sizes"]}
    return _price_parts(spec, sizes, menu["flavors"], menu["addons"], s, None)["labor_hours"]
