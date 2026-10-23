"""The operations team loop: Boss + specialists, any-to-any delegation, guardrails, budgets, audit.

Every agent runs the same loop (same design as HW 5):
  1. Send its system prompt (static, so it is prompt-cached), the task and its tool list to gpt-6-luna.
  2. Run each tool call: an MCP tool on that agent's allowlist, `delegate` (runs another agent and
     returns its report) or `finish` (ends the loop with a report).
  3. Feed results back and repeat within the Budget (steps, LLM calls, tokens, dollars).
Every step goes to output/audit_trail.json and every LLM call to the llm_usage table.
"""

import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .agents import AGENTS, HUMAN_ONLY_ACTIONS, AgentSpec, load_prompt
from .audit import audit_event
from .config import MODEL, TOOL_TRANSPORT, cost_usd
from .db import db_session, get_settings, jd
from .llm import ChatLLM, LLMError, get_llm, record_usage, total_spend, usage_numbers
from .toolhost import LocalToolHost, MCPToolHost
from .tools import INJECTED_PARAMS


@dataclass
class Budget:
    max_steps_per_agent: int = 8
    max_llm_calls: int = 36
    max_total_tokens: int = 220_000
    max_run_usd: float = 0.25
    max_delegation_depth: int = 3
    max_tool_result_chars: int = 7_000
    max_completion_tokens: int = 900


@dataclass
class Usage:
    llm_calls: int = 0
    input_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    by_agent: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {"llm_calls": self.llm_calls, "input_tokens": self.input_tokens, "cached_tokens": self.cached_tokens,
                "output_tokens": self.output_tokens, "cost_usd": round(self.cost_usd, 6), "by_agent": self.by_agent}


def _fn(name: str, description: str, parameters: dict) -> dict:
    return {"type": "function", "function": {"name": name, "description": description, "parameters": parameters}}


FINISH_TOOL = _fn("finish", "End your turn and report back in plain English. Use only tool values.", {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "2-6 short sentences or bullets for the owner."},
        "facts": {"type": "array", "items": {"type": "string"}, "description": "Key numbers from tools."},
        "owner_actions": {"type": "array", "items": {"type": "string"}, "description": "What Annie must do or decide."},
        "safety_catches": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary"],
})


class Team:
    def __init__(self, host, llm: ChatLLM, run_id: str, kind: str, budget: Budget, order_id: int | None = None):
        self.host, self.llm, self.run_id, self.kind, self.budget = host, llm, run_id, kind, budget
        self.order_id = order_id
        self.usage = Usage()
        self.seq = 0

    def log(self, event: str, agent: str | None, **detail: Any) -> None:
        self.seq += 1
        audit_event(event, run_id=self.run_id, agent=agent, run_seq=self.seq, **detail)

    # ----- tools ---------------------------------------------------------------------
    def tool_schemas(self, spec: AgentSpec) -> list[dict]:
        tools = []
        for name in spec.tools:
            if name not in self.host.tools:
                continue
            schema = self.host.input_schema(name)
            props = schema.get("properties", {})
            for p in INJECTED_PARAMS:
                props.pop(p, None)
            schema["required"] = [r for r in schema.get("required", []) if r not in INJECTED_PARAMS]
            tools.append(_fn(name, self.host.description(name)[:900], schema))
        others = [a for n, a in AGENTS.items() if n != spec.name]
        tools.append(_fn("delegate", "Hand one job to another team member and wait for its report. Team: " +
                         "; ".join(f"{a.name}: {a.description}" for a in others), {
            "type": "object",
            "properties": {"to_agent": {"type": "string", "enum": [a.name for a in others]},
                           "task": {"type": "string"},
                           "context": {"type": "string", "description": "Facts you already have, with values."}},
            "required": ["to_agent", "task"]}))
        tools.append(FINISH_TOOL)
        return tools

    def exhausted(self) -> str | None:
        b, u = self.budget, self.usage
        if u.llm_calls >= b.max_llm_calls:
            return f"LLM-call limit reached ({b.max_llm_calls})"
        if u.input_tokens + u.output_tokens >= b.max_total_tokens:
            return f"token limit reached ({b.max_total_tokens})"
        if u.cost_usd >= b.max_run_usd:
            return f"run dollar limit reached (${u.cost_usd:.4f} of ${b.max_run_usd:g})"
        return None

    def count(self, agent: str, resp: Any) -> dict:
        n = usage_numbers(getattr(resp, "usage", None))
        self.usage.llm_calls += 1
        self.usage.input_tokens += n["input_tokens"]
        self.usage.cached_tokens += n["cached_tokens"]
        self.usage.output_tokens += n["output_tokens"]
        c = cost_usd(n["input_tokens"], n["output_tokens"], n["cached_tokens"])
        self.usage.cost_usd += c
        a = self.usage.by_agent.setdefault(agent, {"llm_calls": 0, "input_tokens": 0, "cached_tokens": 0,
                                                   "output_tokens": 0, "cost_usd": 0.0})
        a["llm_calls"] += 1
        for k in ("input_tokens", "cached_tokens", "output_tokens"):
            a[k] += n[k]
        a["cost_usd"] = round(a["cost_usd"] + c, 7)
        with db_session() as conn:
            record_usage(conn, n, feature=self.kind, agent=agent, run_id=self.run_id, order_id=self.order_id)
        return {**n, "cost_usd": round(c, 7)}

    def clip(self, result: Any) -> str:
        text = json.dumps(result, ensure_ascii=False, default=str)
        lim = self.budget.max_tool_result_chars
        return text if len(text) <= lim else text[:lim] + f"... [truncated from {len(text)} chars]"

    # ----- agent loop ----------------------------------------------------------------
    async def run_agent(self, name: str, task: str, chain: list[str], depth: int) -> dict:
        spec = AGENTS[name]
        chain = chain + [name]
        tools = self.tool_schemas(spec)
        messages: list[dict] = [{"role": "system", "content": load_prompt(name)},
                                {"role": "user", "content": f"Run {self.run_id}. Chain: {' -> '.join(chain)}. "
                                                            f"You have at most {self.budget.max_steps_per_agent} steps."
                                                            f"\n\nTASK:\n{task}"}]
        self.log("agent_start", name, depth=depth, chain=chain, task=task, tools=[t["function"]["name"] for t in tools])
        for step in range(1, self.budget.max_steps_per_agent + 1):
            reason = self.exhausted()
            if reason:
                return self.stopped(name, reason, depth)
            forced = step == self.budget.max_steps_per_agent
            choice = {"type": "function", "function": {"name": "finish"}} if forced else "auto"
            try:
                resp = await asyncio.to_thread(self.llm.chat, messages=messages, tools=tools, tool_choice=choice,
                                               max_tokens=self.budget.max_completion_tokens)
            except LLMError as exc:
                self.log("error", name, where="llm_call", error=str(exc))
                return {"agent": name, "summary": f"The model call failed: {exc}", "stopped": "llm_error"}
            used = self.count(name, resp)
            msg = resp.choices[0].message
            calls = list(msg.tool_calls or [])
            self.log("llm_step", name, step=step, depth=depth, model=MODEL, forced_finish=forced, content=msg.content,
                     tool_calls=[{"name": c.function.name, "arguments": c.function.arguments} for c in calls], usage=used)
            messages.append({"role": "assistant", "content": msg.content, **({"tool_calls": [
                {"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}}
                for c in calls]} if calls else {})})
            if not calls:
                messages.append({"role": "user", "content": "Call a tool, or call finish with your report."})
                continue
            for call in calls:
                try:
                    args = json.loads(call.function.arguments or "{}")
                    if not isinstance(args, dict):
                        raise ValueError("arguments must be an object")
                except (json.JSONDecodeError, ValueError) as exc:
                    result: Any = {"ok": False, "message": f"Bad JSON arguments: {exc}"}
                else:
                    if call.function.name == "finish":
                        report = {"agent": name, "summary": str(args.get("summary", ""))[:3000],
                                  "facts": [str(x)[:300] for x in args.get("facts") or []][:15],
                                  "owner_actions": [str(x)[:300] for x in args.get("owner_actions") or []][:10],
                                  "safety_catches": [str(x)[:300] for x in args.get("safety_catches") or []][:10]}
                        self.log("agent_finish", name, depth=depth, report=report)
                        return report
                    result = await self.dispatch(spec, call.function.name, args, chain, depth)
                messages.append({"role": "tool", "tool_call_id": call.id, "content": self.clip(result)})
        return self.stopped(name, f"step limit reached ({self.budget.max_steps_per_agent})", depth)

    def stopped(self, name: str, reason: str, depth: int) -> dict:
        self.log("guardrail", name, rule="budget", reason=reason, depth=depth)
        return {"agent": name, "summary": f"Stopped before finishing: {reason}.", "stopped": reason,
                "owner_actions": ["Check this manually; an agent hit a safety limit."]}

    async def dispatch(self, spec: AgentSpec, tool: str, args: dict, chain: list[str], depth: int) -> Any:
        def block(rule: str, message: str) -> dict:
            self.log("guardrail", spec.name, rule=rule, tool=tool, arguments=args, message=message)
            return {"ok": False, "blocked_by_guardrail": rule, "message": message}

        if tool in HUMAN_ONLY_ACTIONS:
            return block("human_only", f"{tool} is the owner's decision. Recommend it in your report instead.")
        if tool == "delegate":
            to, task = str(args.get("to_agent", "")), str(args.get("task", "")).strip()
            if to not in AGENTS or to == spec.name:
                return block("bad_delegate", "to_agent must be another team member.")
            if to in chain:
                return block("delegation_cycle", f"{to} is already waiting in this chain ({' -> '.join(chain)}).")
            if depth + 1 > self.budget.max_delegation_depth:
                return block("delegation_depth", "Too many levels of delegation; finish with what you have.")
            if not task:
                return block("empty_task", "Give the delegate a specific job.")
            text = task + (f"\n\nCONTEXT FROM {spec.title.upper()}:\n{args['context']}" if args.get("context") else "")
            self.log("delegation", spec.name, phase="start", to_agent=to, task=text[:3000])
            report = await self.run_agent(to, text[:4000], chain, depth + 1)
            self.log("delegation", spec.name, phase="end", to_agent=to, report=report)
            return {"ok": True, "delegated_to": to, "report": report}
        if tool not in spec.tools or tool not in self.host.tools:
            return block("tool_not_allowed", f"{spec.title} may not call {tool}. Delegate to the right teammate.")
        props = self.host.input_schema(tool).get("properties", {})
        injected = {k: v for k, v in (("run_id", self.run_id), ("agent", spec.name)) if k in props}
        started = time.perf_counter()
        try:
            ok, result = await self.host.call(tool, {**{k: v for k, v in args.items() if k not in INJECTED_PARAMS},
                                                     **injected})
        except Exception as exc:
            ok, result = False, {"ok": False, "message": f"Tool call failed: {exc!r}"}
        self.log("tool_call", spec.name, tool=tool, arguments=args, ok=ok,
                 duration_ms=int((time.perf_counter() - started) * 1000), result=result)
        return result


# ----- run entry points -----------------------------------------------------------------

class _Closing:
    """Closes the MCP host (if one was opened) when the run ends."""

    def __init__(self, host):
        self.host = host

    async def __aenter__(self):
        return self.host

    async def __aexit__(self, *exc):
        if self.host is not None:
            await self.host.__aexit__(*exc)


def new_run_id(kind: str) -> str:
    return f"{kind}-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:4]}"


def start_run_record(kind: str, order_id: int | None = None, week_start: str | None = None) -> str:
    run_id = new_run_id(kind)
    with db_session() as conn:
        conn.execute("INSERT INTO runs(run_id, kind, status, started_at, order_id, week_start) VALUES(?,?,?,?,?,?)",
                     (run_id, kind, "running", datetime.now().isoformat(timespec="seconds"), order_id, week_start))
    return run_id


def spend_check() -> str | None:
    with db_session() as conn:
        limit = float(get_settings(conn)["spend_limit_usd"])
        spent = total_spend(conn)
    if spent >= limit:
        return f"The AI spend limit is reached (${spent:.4f} of ${limit:.2f}). Raise it in Settings to continue."
    return None


async def run_team(run_id: str, kind: str, task: str, order_id: int | None = None, llm: ChatLLM | None = None,
                   budget: Budget | None = None) -> dict:
    budget = budget or Budget()
    with db_session() as conn:
        remaining = float(get_settings(conn)["spend_limit_usd"]) - total_spend(conn)
    budget.max_run_usd = max(0.0, min(budget.max_run_usd, remaining))
    status, report = "done", None
    team = None
    stack = None
    try:
        llm = llm or get_llm()
        host = None
        if TOOL_TRANSPORT == "mcp":
            try:
                host = await MCPToolHost().__aenter__()
                stack = host
            except Exception as exc:  # fall back to the same tools in-process, and say so in the audit trail
                audit_event("error", run_id=run_id, agent="system", where="mcp_start", error=repr(exc),
                            fallback="local tool host")
                host = None
        host = host or LocalToolHost()
        async with _Closing(stack):
            team = Team(host, llm, run_id, kind, budget, order_id)
            transport = "mcp" if isinstance(host, MCPToolHost) else "local"
            team.log("run_start", "system", kind=kind, model=MODEL, transport=transport, task=task,
                     budget=budget.__dict__, tools=sorted(host.tools))
            report = await team.run_agent("boss", task, [], 0)
            if report.get("stopped"):
                status = "stopped"
            team.log("run_end", "system", report=report, usage=team.usage.as_dict())
    except Exception as exc:  # MCP start-up or other failure: keep the error visible, never crash the server
        status = "error"
        report = {"agent": "system", "summary": f"Run failed: {exc!r}"}
        audit_event("error", run_id=run_id, agent="system", where="run_team", error=repr(exc))
    usage = team.usage.as_dict() if team else Usage().as_dict()
    with db_session() as conn:
        conn.execute("UPDATE runs SET status = ?, finished_at = ?, summary = ?, usage = ? WHERE run_id = ?",
                     (status, datetime.now().isoformat(timespec="seconds"), jd(report), jd(usage), run_id))
    return {"run_id": run_id, "status": status, "report": report, "usage": usage}


def review_task(order_id: int) -> str:
    return (f"Review order {order_id} for the owner. Delegate the checks to the Order Taker (and the Recipe Collector "
            "only if a recipe is missing). Finish with your recommendation and what the owner must decide.")


def plan_task(week_start: str) -> str:
    return (f"Plan the week starting Monday {week_start}: Recipe Collector (recipes assigned), Inventory Manager "
            "(shopping list), Cash Manager (affordability), Task Planner (batched timeline). Then finish with a short "
            "summary for the owner.")
