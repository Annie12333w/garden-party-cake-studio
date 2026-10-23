"""The operations agent team: who exists, what each may do, and which MCP tools each may call."""

from dataclasses import dataclass

from .config import PROMPTS_DIR


@dataclass(frozen=True)
class AgentSpec:
    name: str
    title: str
    description: str
    tools: tuple[str, ...]


AGENTS: dict[str, AgentSpec] = {a.name: a for a in [
    AgentSpec("boss", "Boss", "Directs the team, decides who works on what, and writes the final summary for the owner.",
              ("get_today", "list_orders", "get_order", "week_orders", "get_cash_summary", "get_plan", "get_shopping_list")),
    AgentSpec("order_taker", "Order Taker",
              "Checks new order requests: capacity, allergens, design fit, price sanity; drafts customer emails.",
              ("get_order", "check_capacity", "list_orders", "save_order_review", "save_email_draft")),
    AgentSpec("recipe_collector", "Recipe Collector",
              "Matches each order to approved recipes (owner's first); searches the web for well-reviewed new ones.",
              ("get_order", "week_orders", "search_recipes", "get_recipe", "web_recipe_search", "assign_recipes")),
    AgentSpec("inventory", "Inventory Manager",
              "Tracks supplies and builds the Monday shopping list with quantities and packs.",
              ("week_orders", "get_inventory", "get_recipe", "build_shopping_list", "get_shopping_list")),
    AgentSpec("cash_manager", "Cash Manager",
              "Watches the cash balance, deposits and grocery spend; flags if a shopping list is unaffordable.",
              ("get_cash_summary", "get_shopping_list", "check_affordability")),
    AgentSpec("task_planner", "Task Planner",
              "Builds the week's kitchen timeline: batches shared prep, fits work hours, schedules pickups/deliveries.",
              ("get_today", "week_orders", "draft_production_plan", "get_plan", "move_plan_task", "finalize_plan")),
]}

# Tools no agent may ever call (kept here so a mistaken allowlist edit is still refused).
HUMAN_ONLY_ACTIONS = ("accept_order", "decline_order", "set_price", "record_payment", "approve_shopping_list",
                      "approve_recipe", "confirm_receipt")


def load_prompt(name: str) -> str:
    shared = (PROMPTS_DIR / "team_shared.md").read_text(encoding="utf-8")
    role = (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")
    return shared + "\n\n" + role
