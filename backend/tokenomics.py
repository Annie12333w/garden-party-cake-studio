"""Tokenomics for the staff view: measured tokens and dollars, plus projections.

Measured numbers come from the llm_usage table (one row per LLM call, written by llm.py).
A "run" is one chat message, one photo read, or one team run (all calls with the same run_id).
Where a feature has not been measured yet, a clearly labelled estimate is used instead.
"""

import sqlite3

from .config import MODEL, PRICE_CACHED_INPUT_PER_M, PRICE_INPUT_PER_M, PRICE_OUTPUT_PER_M, cost_usd

# Estimates used only until real runs exist (input, cached, output tokens per run).
ESTIMATES = {
    "chat": (7000, 5000, 300),
    "inspiration_vision": (1500, 0, 250),
    "receipt_vision": (1800, 0, 600),
    "order_review": (40000, 25000, 2500),
    "plan_week": (90000, 60000, 5000),
    "ideas": (3500, 2500, 400),
    "web_search": (8000, 0, 1500),
}
# A month for one bakery (one owner) in the projection.
MONTH = {"orders": 12, "chat_turns_per_order": 8, "photos_per_order": 1, "reviews_per_order": 1,
         "plan_weeks": 4, "receipts": 4, "ideas": 6, "web_searches": 1}

COST_CUTTING = [
    ("Code does the math", "Prices, capacity, recipe scaling, the shopping list and the timeline are Python, not LLM "
                           "output: no tokens spent on arithmetic, and no wrong numbers."),
    ("Prompt caching", "Long, unchanging instructions (and the full menu) come first in every call, so repeat calls "
                       "are billed at the cached rate ($0.01 vs $0.10 per 1M input tokens)."),
    ("One cheap model", "Everything runs on gpt-6-luna ($0.10 / $0.50 per 1M tokens), about 100x cheaper than gpt-6-astra."),
    ("Short history", "The chat sends only the last 12 turns, each clipped to 1,500 characters."),
    ("Small images", "Photos are shrunk to 768 px JPEG before the vision call."),
    ("Recipe cache", "The library is checked before any web search; web results are saved and reused."),
    ("Ideas cache", "History-based ideas are generated at most once per customer per day."),
    ("Hard limits", "Max 5 tool steps per chat message, 8 steps per agent, 36 LLM calls and $0.25 per team run, "
                    "plus an owner-set total spend limit."),
    ("Clipped tool results", "Tool results sent back to the model are capped at 7,000 characters."),
]


def _rows(conn: sqlite3.Connection, sql: str, args=()) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, args)]


def tokenomics(conn: sqlite3.Connection) -> dict:
    tot = _rows(conn, "SELECT COUNT(*) llm_calls, COALESCE(SUM(input_tokens),0) input_tokens, COALESCE(SUM(cached_tokens),0) "
                      "cached_tokens, COALESCE(SUM(output_tokens),0) output_tokens, COALESCE(SUM(cost_usd),0) cost_usd "
                      "FROM llm_usage")[0]
    by_agent = _rows(conn, "SELECT agent, COUNT(*) llm_calls, SUM(input_tokens) input_tokens, SUM(cached_tokens) "
                           "cached_tokens, SUM(output_tokens) output_tokens, ROUND(SUM(cost_usd), 6) cost_usd FROM llm_usage "
                           "GROUP BY agent ORDER BY cost_usd DESC")
    feats = _rows(conn, "SELECT feature, COUNT(DISTINCT COALESCE(run_id, 'call-' || id)) runs, SUM(input_tokens) i, "
                        "SUM(cached_tokens) c, SUM(output_tokens) o, SUM(cost_usd) usd FROM llm_usage GROUP BY feature")
    measured = {f["feature"]: f for f in feats}
    by_feature = []
    avg_cost = {}
    for name, (ei, ec, eo) in ESTIMATES.items():
        m = measured.get(name)
        if m and m["runs"]:
            r = m["runs"]
            row = {"feature": name, "runs": r, "avg_cost_usd": round(m["usd"] / r, 6),
                   "avg_input_tokens": round(m["i"] / r), "avg_cached_tokens": round(m["c"] / r),
                   "avg_output_tokens": round(m["o"] / r), "measured": True}
        else:
            row = {"feature": name, "runs": 0, "avg_cost_usd": round(cost_usd(ei, eo, ec), 6), "avg_input_tokens": ei,
                   "avg_cached_tokens": ec, "avg_output_tokens": eo, "measured": False}
        avg_cost[name] = row["avg_cost_usd"]
        by_feature.append(row)

    per_order = (MONTH["chat_turns_per_order"] * avg_cost["chat"] + MONTH["photos_per_order"] * avg_cost["inspiration_vision"]
                 + MONTH["reviews_per_order"] * avg_cost["order_review"])
    per_month = (MONTH["orders"] * per_order + MONTH["plan_weeks"] * avg_cost["plan_week"]
                 + MONTH["receipts"] * avg_cost["receipt_vision"] + MONTH["ideas"] * avg_cost["ideas"]
                 + MONTH["web_searches"] * avg_cost["web_search"])
    cached_share = (tot["cached_tokens"] / tot["input_tokens"]) if tot["input_tokens"] else 0
    saved = tot["cached_tokens"] * (PRICE_INPUT_PER_M - PRICE_CACHED_INPUT_PER_M) / 1_000_000
    cutting = [{"step": s, "effect": e} for s, e in COST_CUTTING]
    cutting.insert(1, {"step": "Measured caching", "effect": f"{cached_share:.0%} of input tokens so far were cached, "
                                                           f"saving ${saved:.4f}."})
    return {
        "prices": {"model": MODEL, "input_per_m": PRICE_INPUT_PER_M, "cached_input_per_m": PRICE_CACHED_INPUT_PER_M,
                   "output_per_m": PRICE_OUTPUT_PER_M},
        "totals": {**tot, "cost_usd": round(tot["cost_usd"], 6)},
        "by_agent": by_agent, "by_feature": by_feature,
        "per_order_usd": round(per_order, 5), "per_user_month_usd": round(per_month, 4),
        "per_bakery_month_usd": round(per_month, 4),
        "projections": [{"users": n, "monthly_usd": round(per_month * n, 2)} for n in (1, 100, 10_000)],
        "assumptions": [
            f"A 'user' is one bakery owner. A month = {MONTH['orders']} orders, {MONTH['chat_turns_per_order']} chat "
            f"messages and {MONTH['photos_per_order']} photo per order, one AI order review per order, "
            f"{MONTH['plan_weeks']} weekly plans, {MONTH['receipts']} receipts, {MONTH['ideas']} idea refreshes and "
            f"{MONTH['web_searches']} web recipe search.",
            "Features marked measured=false use estimates until real runs exist.",
            f"Prices: {MODEL} ${PRICE_INPUT_PER_M}/1M input, ${PRICE_CACHED_INPUT_PER_M}/1M cached input, "
            f"${PRICE_OUTPUT_PER_M}/1M output.",
        ],
        "cost_cutting": cutting,
    }
