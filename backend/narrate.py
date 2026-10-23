"""Turns raw audit events into plain-English lines for the staff 'Agent runs' view."""

from typing import Any

TITLES = {"boss": "Boss", "order_taker": "Order Taker", "recipe_collector": "Recipe Collector",
          "inventory": "Inventory Manager", "cash_manager": "Cash Manager", "task_planner": "Task Planner",
          "system": "System"}

TOOL_WORDS = {
    "get_today": "checked today's date and the work week",
    "list_orders": "looked through the order list",
    "get_order": "read the order",
    "week_orders": "pulled this week's cakes",
    "check_capacity": "checked kitchen capacity for the pickup date",
    "search_recipes": "searched the recipe library",
    "get_recipe": "opened a recipe",
    "web_recipe_search": "searched the web for well-reviewed recipes",
    "assign_recipes": "assigned recipes to an order",
    "get_inventory": "checked the pantry",
    "build_shopping_list": "built the Monday shopping list",
    "get_shopping_list": "opened the shopping list",
    "get_cash_summary": "checked the cash balance",
    "check_affordability": "checked the shopping list against cash",
    "draft_production_plan": "drafted the batched kitchen timeline",
    "get_plan": "opened the production plan",
    "move_plan_task": "moved a task in the plan",
    "finalize_plan": "finalized the plan",
    "save_order_review": "saved a review for the owner",
    "save_email_draft": "saved an email draft (not sent)",
}


def _short(result: Any) -> str:
    if not isinstance(result, dict):
        return ""
    if result.get("ok") is False or result.get("found") is False:
        return f" — {result.get('message', 'refused')}"
    for key, label in (("est_total", "total ${:.2f}"), ("count", "{} found"), ("balance", "balance ${:.2f}"),
                       ("status", "status: {}"), ("draft_id", "draft #{}")):
        if key in result and result[key] is not None:
            try:
                return " — " + label.format(result[key])
            except (ValueError, TypeError):
                return ""
    if "summary" in result and isinstance(result["summary"], str):
        return " — " + result["summary"][:140]
    return ""


def narrate(e: dict) -> dict:
    d = e.get("detail") or {}
    agent = e.get("agent")
    who = TITLES.get(agent or "", agent or "")
    ev = e.get("event")
    text, tool, to_agent, tokens, cost = "", None, None, None, None
    if ev == "run_start":
        text = f"Run started ({str(d.get('kind', '')).replace('_', ' ')}) using {d.get('model')} via {d.get('transport')}."
    elif ev == "agent_start":
        text = f"{who} started: {str(d.get('task', ''))[:180]}"
    elif ev == "llm_step":
        calls = [c.get("name") for c in d.get("tool_calls") or []]
        u = d.get("usage") or {}
        tokens = (u.get("input_tokens") or 0) + (u.get("output_tokens") or 0)
        cost = u.get("cost_usd")
        text = f"{who} decided to {', '.join(c.replace('_', ' ') for c in calls)}." if calls else f"{who} is thinking."
    elif ev == "tool_call":
        tool = d.get("tool")
        text = f"{who} {TOOL_WORDS.get(tool, 'used ' + str(tool))}{_short(d.get('result'))}."
    elif ev == "delegation":
        to_agent = d.get("to_agent")
        if d.get("phase") == "start":
            text = f"{who} asked {TITLES.get(to_agent, to_agent)} to: {str(d.get('task', ''))[:160]}"
        else:
            rep = d.get("report") or {}
            text = f"{TITLES.get(to_agent, to_agent)} reported back to {who}: {str(rep.get('summary', ''))[:220]}"
    elif ev == "guardrail":
        text = f"Safety rule '{d.get('rule')}' stopped {who}: {d.get('message') or d.get('reason')}"
    elif ev == "agent_finish":
        text = f"{who} finished: {str((d.get('report') or {}).get('summary', ''))[:260]}"
    elif ev == "run_end":
        u = d.get("usage") or {}
        text = (f"Run finished: {u.get('llm_calls', 0)} LLM calls, "
                f"{(u.get('input_tokens') or 0) + (u.get('output_tokens') or 0):,} tokens, ${u.get('cost_usd', 0):.4f}.")
    elif ev == "safety":
        text = f"Safety catch: {d.get('message')}"
    elif ev == "error":
        text = f"Error in {d.get('where')}: {d.get('error')}"
    else:
        text = str(ev)
    return {"seq": e.get("seq"), "ts": e.get("ts_utc"), "agent": agent, "event": ev, "text": text, "tool": tool,
            "to_agent": to_agent, "tokens": tokens, "cost_usd": cost}
