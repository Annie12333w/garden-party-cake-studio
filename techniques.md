# MGT409 Toolkit: what we learned (HW 1–5, Lectures 2–13)

A reference for choosing what goes into the final project.

## Shared foundation
- **LLM access:** OpenAI SDK pointed at Portkey (`base_url=https://api.portkey.ai/v1`), using `PORTKEY_API_KEY` from `MGT409/.env`.
- **Models:** `gpt-5.6-luna` (HW 1–4), `gpt-6-luna` (HW 5; routes to Azure, so tool calls need `reasoning_effort="none"`), and `gpt-6-astra` (premium; about 100× luna's price).
- **Prices (Lecture 11):** luna costs $0.10 per 1M input tokens and $0.50 per 1M output tokens; astra costs $10 / $50.
- **Agent framework:** PydanticAI (`Agent`, `OpenAIChatModel` / `OpenAIResponsesModel`, tools, output validators, `MCPToolset`).
- **Web search:** OpenAI's native `web_search` tool (Responses API / PydanticAI `WebSearchTool`).

## Techniques by source
| # | Technique | Where we used it |
|---|-----------|------------------|
| 1 | PDF extraction into strict JSON (pypdf + schema, `fields_not_found`) | Lec 2 (leases), HW 1 (receipts, bank and card statements) |
| 2 | Reconciliation with logged judgement calls; HTML report | HW 1 |
| 3 | Tool calling with the plain SDK (function tools + web_search) | Lec 3 (stock chatbot) |
| 4 | PydanticAI agent with tools and structured outputs | Lec 4 (financial agent), HW 2 (sales prospecting) |
| 5 | Budgets and stopping rules (max searches, fetches and steps; domain allowlist; no duplicate URLs) | HW 2 |
| 6 | Screen-aware / computer-use agent (mss screenshots, PySide6 desktop shell) | Lec 5, root `desktop.py` |
| 7 | Vision: image description, catalogue building, multi-image matching | HW 3 |
| 8 | Video: ffmpeg frame sampling, audio transcription, structured verdicts | Lec 6 (dunks and fouls), HW 3 (ad effectiveness) |
| 9 | Concurrency (`asyncio.gather` + `Semaphore`) with errors handled per item | HW 3 |
| 10 | Evaluation of agent accuracy on a held-out test set | HW 3 (`agent_evaluation.md`) |
| 11 | Full-stack app: FastAPI + React/Vite/TypeScript | Lec 7–13, HW 4–5 |
| 12 | Dash chat UIs (quick prototypes, background jobs, status updates) | Lec 2–6 |
| 13 | SQLite as the source of truth; semantic search done by the LLM | Lec 8, HW 4–5 |
| 14 | Auth (salted PBKDF2, hashed session tokens, rate limit) and per-user memory | HW 4 |
| 15 | Structured UI contract (agent reply drives product cards on the page) | HW 4 |
| 16 | MCP server (FastMCP) with tools registered in `.mcp.json` | Lec 9, HW 5 |
| 17 | Multi-agent: boss and specialists, delegation, per-agent tool allowlists | Lec 10, HW 5 |
| 18 | RAG: retrieve text chunks from SQLite instead of stuffing whole documents into the prompt | Lec 10 |
| 19 | Tokenomics: cost ledger per agent, $ spend limit, safety stop | Lec 11, HW 5 |
| 20 | Human-in-the-loop approval (agents only queue actions; a human executes them) | HW 5 |
| 21 | Prompt-injection defense (hidden text in web pages and PDFs; "glass box" reasoning view) | Lec 12 |
| 22 | Persona agents (NPCs) in a 3D world (three.js / react-three-fiber) | Lec 13 |
| 23 | Append-only audit trail (tool calls, tokens, stop reason, redaction) | HW 2–5, Lec 7–8 |
| 24 | Plain-English narration of agent actions | HW 5 |

## Deliverable conventions carried through every HW
- **Prompt log:** `AI_prompts.md` (used in the HWs; not needed for the final project).
- **Prompts:** system prompts live in `prompts/*.md`, not inline in code.
- **Outputs:** `output/` holds `harness.md` (tables, tools, agents, routes, safety rules, runbook), `design.md`, `audit_trail.json`, evaluation and reflection docs, and screenshots.
- **Repo hygiene:** `.env.example` with placeholders and a `.gitignore` covering `.env`, `node_modules/`, `__pycache__/`, `.claude/` and `CLAUDE.md`; README; public GitHub repo.
- **Safety:** never invent data; drafts only, with no real outbound email or payments; keep the original data read-only and work on a resettable copy.
