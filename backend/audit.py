"""Append-only audit trail at output/audit_trail.json (for debugging and safety review).

The file is a JSON array. Each write reads the array, appends one event and atomically
replaces the file, so earlier events are never removed. An unreadable file is renamed and
kept, never overwritten. Secrets are never logged; long fields are clipped; customer
passwords never reach this module.
"""

import json
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import AUDIT_PATH

_LOCK = threading.Lock()
MAX_FIELD_CHARS = 6_000
_SEQ = [0]
SECRET_RE = re.compile(r"(sk-[A-Za-z0-9_\-]{12,}|pk-[A-Za-z0-9_\-]{12,}|(?i:password)\s*[:=]\s*\S+)")


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _clip(value: Any) -> Any:
    if isinstance(value, str):
        value = SECRET_RE.sub("[redacted]", value)
        if len(value) > MAX_FIELD_CHARS:
            return value[:MAX_FIELD_CHARS] + f"... [truncated, {len(value)} chars]"
        return value
    if isinstance(value, dict):
        return {k: ("[redacted]" if "password" in str(k).lower() or str(k).lower() in {"api_key", "token"} else _clip(v))
                for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clip(v) for v in value]
    return value


def _read(path: Path) -> list:
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        pass
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    path.rename(path.with_name(f"audit_trail.unreadable-{stamp}.json"))
    return []


def _replace(src: Path, dest: Path, attempts: int = 20) -> None:
    for i in range(attempts):
        try:
            os.replace(src, dest)
            return
        except PermissionError:  # Windows: a reader has the file open
            if i == attempts - 1:
                raise
            time.sleep(0.05)


def audit_event(event: str, *, run_id: str | None = None, agent: str | None = None,
                path: Path | None = None, **detail: Any) -> dict:
    path = path or AUDIT_PATH
    with _LOCK:
        events = _read(path)
        _SEQ[0] = max(_SEQ[0], len(events)) + 1
        entry = {"seq": _SEQ[0], "ts_utc": now_utc(), "event": event, "run_id": run_id, "agent": agent,
                 "detail": _clip(detail)}
        events.append(entry)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(events, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
        _replace(tmp, path)
        return entry


def read_events(run_id: str | None = None, path: Path | None = None) -> list:
    path = path or AUDIT_PATH
    for _ in range(20):
        try:
            if not path.exists():
                return []
            data = json.loads(path.read_text(encoding="utf-8") or "[]")
            if not isinstance(data, list):
                return []
            return [e for e in data if run_id is None or e.get("run_id") == run_id]
        except (PermissionError, json.JSONDecodeError):
            time.sleep(0.05)
    return []
