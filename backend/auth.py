"""Passwords, sessions, roles and rate limits (same approach as HW 4).

- Passwords: PBKDF2-HMAC-SHA256, 600,000 iterations, a unique random salt per user,
  compared in constant time. Plain passwords are never stored or logged.
- Sessions: a random token goes in an httpOnly, SameSite=Lax cookie; the database stores
  only its SHA-256 hash, so a leaked database cannot be used to log in.
- Login rate limit: 5 failed attempts per email+IP in 15 minutes -> HTTP 429.
- Unknown emails still run a dummy hash so response time does not reveal who has an account.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta

ALGORITHM = "pbkdf2_sha256"
ITERATIONS = 600_000
SALT_BYTES = 16
SESSION_COOKIE = "gp_session"
SESSION_DAYS = 7

MAX_FAILED_LOGINS = 5
FAILED_WINDOW_S = 15 * 60


def hash_password(password: str, *, iterations: int = ITERATIONS, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), iterations).hex()
    return f"{ALGORITHM}${iterations}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    parts = stored.split("$")
    if len(parts) != 4 or parts[0] != ALGORITHM or not parts[1].isdigit():
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), parts[2].encode(), int(parts[1])).hex()
    return hmac.compare_digest(digest, parts[3])


_DUMMY_HASH: list[str] = []


def dummy_verify(password: str) -> None:
    if not _DUMMY_HASH:
        _DUMMY_HASH.append(hash_password(secrets.token_hex(16)))
    verify_password(password, _DUMMY_HASH[0])


def password_problems(password: str) -> str | None:
    if len(password) < 8:
        return "Use at least 8 characters."
    if password.lower() == password or not any(c.isdigit() for c in password):
        return "Use at least one capital letter and one number."
    return None


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(conn: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.now()
    conn.execute("INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES(?,?,?,?)",
                 (_token_hash(token), user_id, now.isoformat(timespec="seconds"),
                  (now + timedelta(days=SESSION_DAYS)).isoformat(timespec="seconds")))
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now.isoformat(timespec="seconds"),))
    conn.commit()
    return token


def user_for_token(conn: sqlite3.Connection, token: str | None) -> sqlite3.Row | None:
    if not token:
        return None
    row = conn.execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
        (_token_hash(token), datetime.now().isoformat(timespec="seconds"))).fetchone()
    return row


def delete_session(conn: sqlite3.Connection, token: str | None) -> None:
    if token:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
        conn.commit()


class RateLimiter:
    """Sliding-window counter kept in memory (per key)."""

    def __init__(self, limit: int, window_s: int):
        self.limit, self.window_s = limit, window_s
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def _trim(self, key: str, now: float) -> deque:
        q = self._hits[key]
        while q and now - q[0] > self.window_s:
            q.popleft()
        return q

    def blocked(self, key: str) -> bool:
        with self._lock:
            return len(self._trim(key, time.monotonic())) >= self.limit

    def hit(self, key: str) -> bool:
        """Record a hit. Returns False if the key was already over the limit."""
        with self._lock:
            now = time.monotonic()
            q = self._trim(key, now)
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)


failed_logins = RateLimiter(MAX_FAILED_LOGINS, FAILED_WINDOW_S)
# Cost guards: the chat and vision features spend money, so they are rate-limited too.
chat_anon_limiter = RateLimiter(30, 3600)
chat_user_limiter = RateLimiter(80, 3600)
upload_limiter = RateLimiter(12, 3600)


def public_user(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"], "phone": row["phone"],
            "allergies": row["allergies"], "preferences": row["preferences"]}
