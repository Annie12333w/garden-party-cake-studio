"""How the agent team reaches its tools.

MCPToolHost: starts mcp_server/server.py over stdio and calls tools through MCP (default).
LocalToolHost: calls the same functions in backend/tools.py in-process (offline tests, or
GP_TOOL_TRANSPORT=local if the MCP subprocess cannot start).
Both give the same tool names, descriptions and JSON schemas.
"""

import asyncio
import inspect
import json
import os
import sys
from contextlib import AsyncExitStack
from typing import Any

from pydantic import create_model

from .config import AUDIT_PATH, DB_PATH, MCP_SERVER_SCRIPT, UPLOAD_DIR
from .tools import ALL_TOOLS


def _local_schema(fn) -> dict:
    fields = {}
    for name, p in inspect.signature(fn).parameters.items():
        ann = p.annotation if p.annotation is not inspect.Parameter.empty else Any
        fields[name] = (ann, ... if p.default is inspect.Parameter.empty else p.default)
    schema = create_model(f"{fn.__name__}_args", **fields).model_json_schema()
    schema.pop("title", None)
    for prop in schema.get("properties", {}).values():
        prop.pop("title", None)
    return schema


class LocalToolHost:
    def __init__(self) -> None:
        self.tools = {n: {"description": inspect.getdoc(f) or "", "schema": _local_schema(f)} for n, f in ALL_TOOLS.items()}

    async def __aenter__(self) -> "LocalToolHost":
        return self

    async def __aexit__(self, *exc) -> None:
        return None

    def input_schema(self, name: str) -> dict:
        return json.loads(json.dumps(self.tools[name]["schema"]))

    def description(self, name: str) -> str:
        return self.tools[name]["description"]

    async def call(self, name: str, arguments: dict) -> tuple[bool, Any]:
        try:
            return True, await asyncio.to_thread(ALL_TOOLS[name], **arguments)
        except TypeError as exc:
            return False, {"ok": False, "message": f"Bad arguments: {exc}"}
        except ValueError as exc:
            return False, {"ok": False, "message": str(exc)}


class MCPToolHost:
    def __init__(self) -> None:
        self._stack = AsyncExitStack()
        self.session = None
        self.tools: dict[str, Any] = {}

    async def __aenter__(self) -> "MCPToolHost":
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
        env = {**os.environ, "GP_DB_PATH": str(DB_PATH), "GP_AUDIT_PATH": str(AUDIT_PATH), "GP_UPLOAD_DIR": str(UPLOAD_DIR)}
        params = StdioServerParameters(command=sys.executable, args=[str(MCP_SERVER_SCRIPT)], env=env)
        read, write = await self._stack.enter_async_context(stdio_client(params))
        self.session = await self._stack.enter_async_context(ClientSession(read, write))
        await self.session.initialize()
        listed = await self.session.list_tools()
        self.tools = {t.name: t for t in listed.tools}
        return self

    async def __aexit__(self, *exc) -> None:
        await self._stack.aclose()

    def input_schema(self, name: str) -> dict:
        tool = self.tools[name]
        return json.loads(json.dumps(getattr(tool, "inputSchema", None) or getattr(tool, "input_schema", None) or {}))

    def description(self, name: str) -> str:
        return self.tools[name].description or ""

    async def call(self, name: str, arguments: dict) -> tuple[bool, Any]:
        res = await self.session.call_tool(name, arguments)
        is_error = bool(getattr(res, "isError", None) or getattr(res, "is_error", None))
        structured = getattr(res, "structuredContent", None) or getattr(res, "structured_content", None)
        if structured is not None:
            result = structured.get("result", structured) if set(structured) == {"result"} else structured
        else:
            text = "".join(getattr(c, "text", "") for c in res.content)
            try:
                result = json.loads(text)
            except (json.JSONDecodeError, TypeError):
                result = text
        return (not is_error), result
