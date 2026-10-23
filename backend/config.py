"""Paths, the one allowed model, token prices and key loading for Garden Party Cake Studio."""

import os
from datetime import date, datetime
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BACKEND_DIR.parent
PROMPTS_DIR = BACKEND_DIR / "prompts"

DATA_DIR = PROJECT_DIR / "data"
DB_PATH = Path(os.getenv("GP_DB_PATH", DATA_DIR / "bakery.db")).resolve()
UPLOAD_DIR = Path(os.getenv("GP_UPLOAD_DIR", DATA_DIR / "uploads")).resolve()

OUTPUT_DIR = PROJECT_DIR / "output"
AUDIT_PATH = Path(os.getenv("GP_AUDIT_PATH", OUTPUT_DIR / "audit_trail.json")).resolve()

MCP_SERVER_SCRIPT = PROJECT_DIR / "mcp_server" / "server.py"
# "mcp" = the ops agent team calls tools through the MCP server (stdio subprocess).
# "local" = same tool functions called in-process (used by offline tests, or as a fallback).
TOOL_TRANSPORT = os.getenv("GP_TOOL_TRANSPORT", "mcp")

# The course key (PORTKEY_API_KEY) only works with gpt-6-luna, so it is the only model.
MODEL = "gpt-6-luna"
PORTKEY_BASE_URL = "https://api.portkey.ai/v1"

# USD per 1M tokens for gpt-6-luna (same table as Lecture 11 pricing.py).
PRICE_INPUT_PER_M = float(os.getenv("LUNA_PRICE_INPUT_PER_M", "0.10"))
PRICE_CACHED_INPUT_PER_M = float(os.getenv("LUNA_PRICE_CACHED_INPUT_PER_M", "0.01"))
PRICE_OUTPUT_PER_M = float(os.getenv("LUNA_PRICE_OUTPUT_PER_M", "0.50"))

# .env is looked up in the project folder first, then one level up (where staff keep their keys).
ENV_FILE = PROJECT_DIR / ".env"
PARENT_ENV_FILE = PROJECT_DIR.parent / ".env"
load_dotenv(ENV_FILE)
load_dotenv(PARENT_ENV_FILE)  # never overrides a key already loaded


def portkey_api_key() -> str:
    key = os.getenv("PORTKEY_API_KEY")
    if not key:
        raise RuntimeError(f"PORTKEY_API_KEY was not found. Copy .env.example to {ENV_FILE} and add your key.")
    return key


def llm_configured() -> bool:
    return bool(os.getenv("PORTKEY_API_KEY"))


def today() -> date:
    """Business 'today'. GP_TODAY=YYYY-MM-DD pins it for repeatable demos and tests."""
    pinned = os.getenv("GP_TODAY")
    return date.fromisoformat(pinned) if pinned else date.today()


def now_local() -> datetime:
    return datetime.now().replace(microsecond=0)


def cost_usd(input_tokens: int, output_tokens: int, cached_tokens: int = 0) -> float:
    cached = min(cached_tokens, input_tokens)
    return ((input_tokens - cached) * PRICE_INPUT_PER_M + cached * PRICE_CACHED_INPUT_PER_M
            + output_tokens * PRICE_OUTPUT_PER_M) / 1_000_000
