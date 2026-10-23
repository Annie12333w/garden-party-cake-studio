"""The single LLM entry point: gpt-6-luna through Portkey. Every call's tokens are recorded.

- chat(): /chat/completions with optional function tools. gpt-6-luna (routed by Portkey to
  Azure OpenAI) rejects function tools unless reasoning_effort="none", so that is always set.
- web_search(): the Responses API with OpenAI's native web_search tool (recipe research).
- Every call writes one llm_usage row (input, cached and output tokens, dollars), which feeds
  the staff Tokenomics view and the spend limit.
"""

import sqlite3
from typing import Any, Protocol

from openai import OpenAI

from .config import MODEL, PORTKEY_BASE_URL, cost_usd, now_local, portkey_api_key


class LLMError(RuntimeError):
    pass


def usage_numbers(usage: Any) -> dict[str, int]:
    if usage is None:
        return {"input_tokens": 0, "cached_tokens": 0, "output_tokens": 0}
    inp = getattr(usage, "prompt_tokens", None)
    if inp is None:
        inp = getattr(usage, "input_tokens", 0)
    out = getattr(usage, "completion_tokens", None)
    if out is None:
        out = getattr(usage, "output_tokens", 0)
    details = getattr(usage, "prompt_tokens_details", None) or getattr(usage, "input_tokens_details", None)
    cached = getattr(details, "cached_tokens", 0) if details is not None else 0
    return {"input_tokens": int(inp or 0), "cached_tokens": int(cached or 0), "output_tokens": int(out or 0)}


def record_usage(conn: sqlite3.Connection | None, numbers: dict[str, int], *, feature: str, agent: str,
                 run_id: str | None = None, order_id: int | None = None, user_id: int | None = None) -> dict:
    cost = cost_usd(numbers["input_tokens"], numbers["output_tokens"], numbers["cached_tokens"])
    row = {**numbers, "cost_usd": round(cost, 7)}
    if conn is not None:
        conn.execute("INSERT INTO llm_usage(ts, feature, agent, run_id, order_id, user_id, input_tokens, cached_tokens, "
                     "output_tokens, cost_usd) VALUES(?,?,?,?,?,?,?,?,?,?)",
                     (now_local().isoformat(), feature, agent, run_id, order_id, user_id, numbers["input_tokens"],
                      numbers["cached_tokens"], numbers["output_tokens"], cost))
        conn.commit()
    return row


def total_spend(conn: sqlite3.Connection) -> float:
    return float(conn.execute("SELECT COALESCE(SUM(cost_usd), 0) FROM llm_usage").fetchone()[0])


class ChatLLM(Protocol):
    def chat(self, *, messages: list[dict], tools: list[dict] | None = None, tool_choice: Any = None,
             max_tokens: int = 900) -> Any: ...

    def web_search(self, *, prompt: str, max_tokens: int = 1500) -> Any: ...


class PortkeyLLM:
    model = MODEL

    def __init__(self) -> None:
        key = portkey_api_key()
        self._client = OpenAI(api_key=key, base_url=PORTKEY_BASE_URL, timeout=90,
                              default_headers={"x-portkey-api-key": key, "x-portkey-provider": "openai"})

    def chat(self, *, messages: list[dict], tools: list[dict] | None = None, tool_choice: Any = None,
             max_tokens: int = 900) -> Any:
        assert self.model == "gpt-6-luna", "Only gpt-6-luna may be used."
        kwargs: dict[str, Any] = {"model": self.model, "messages": messages, "max_completion_tokens": max_tokens,
                                  "reasoning_effort": "none"}
        if tools:
            kwargs.update(tools=tools, tool_choice=tool_choice or "auto", parallel_tool_calls=False)
        try:
            return self._client.chat.completions.create(**kwargs)
        except Exception as exc:  # surface provider errors as one type
            raise LLMError(f"LLM call failed: {exc}") from exc

    def web_search(self, *, prompt: str, max_tokens: int = 4000) -> Any:
        # Live test (2026-10-20): with no limits the model ran 8 searches, read 47k tokens and used its whole
        # 1,500-token output budget on reasoning, returning no answer. Cap searches and reasoning effort.
        kwargs: dict[str, Any] = {"model": self.model, "input": prompt, "tools": [{"type": "web_search"}],
                                  "max_output_tokens": max_tokens, "max_tool_calls": 3,
                                  "reasoning": {"effort": "low"}}
        try:
            return self._client.responses.create(**kwargs)
        except Exception as exc:
            if "max_tool_calls" not in str(exc) and "reasoning" not in str(exc):
                raise LLMError(f"Web search failed: {exc}") from exc
        try:  # provider rejected an optional limit: retry with only the token cap
            return self._client.responses.create(model=self.model, input=prompt, tools=[{"type": "web_search"}],
                                                 max_output_tokens=max_tokens)
        except Exception as exc:
            raise LLMError(f"Web search failed: {exc}") from exc


_LLM: list[ChatLLM] = []


def get_llm() -> ChatLLM:
    if not _LLM:
        _LLM.append(PortkeyLLM())
    return _LLM[0]


def set_llm(llm: ChatLLM | None) -> None:
    """Tests swap in a fake LLM here."""
    _LLM.clear()
    if llm is not None:
        _LLM.append(llm)
