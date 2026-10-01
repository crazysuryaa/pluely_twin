from __future__ import annotations

import asyncio
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket


@dataclass
class CommenterConnection:
    connection_id: str
    websocket: WebSocket
    device_name: str | None
    last_pong: float = field(default_factory=time.monotonic)


@dataclass
class PendingComment:
    comment_id: str
    text: str
    device_name: str | None
    source_connection_id: str


@dataclass
class RelaySession:
    session_id: str
    created_at: float
    expires_at: float
    max_events: int
    max_comments: int
    host: WebSocket | None = None
    host_last_pong: float = field(default_factory=time.monotonic)
    commenters: dict[str, CommenterConnection] = field(default_factory=dict)
    events: deque[dict[str, Any]] = field(default_factory=deque)
    event_seqs: set[int] = field(default_factory=set)
    pending_comments: dict[str, PendingComment] = field(default_factory=dict)
    acked_comments: deque[str] = field(default_factory=deque)
    acked_comment_ids: set[str] = field(default_factory=set)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def latest_event_seq(self) -> int:
        return self.events[-1]["seq"] if self.events else 0

    def add_event(self, seq: int, event: dict[str, Any]) -> bool:
        if seq in self.event_seqs:
            return False

        self.events.append({"seq": seq, "event": event})
        self.event_seqs.add(seq)

        while len(self.events) > self.max_events:
            removed = self.events.popleft()
            self.event_seqs.discard(removed["seq"])

        return True

    def remember_comment_ack(self, comment_id: str) -> None:
        if comment_id in self.acked_comment_ids:
            return

        self.acked_comment_ids.add(comment_id)
        self.acked_comments.append(comment_id)

        while len(self.acked_comments) > self.max_comments:
            old = self.acked_comments.popleft()
            self.acked_comment_ids.discard(old)


class RelayManager:
    def __init__(self) -> None:
        self._sessions: dict[str, RelaySession] = {}
        self._lock = asyncio.Lock()

    async def create_session(
        self,
        ttl_seconds: int,
        max_events: int,
        max_comments: int,
    ) -> RelaySession:
        session_id = str(uuid.uuid4())
        now = time.time()
        session = RelaySession(
            session_id=session_id,
            created_at=now,
            expires_at=now + ttl_seconds,
            max_events=max_events,
            max_comments=max_comments,
        )

        async with self._lock:
            self._sessions[session_id] = session

        return session

    async def get_session(self, session_id: str) -> RelaySession | None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return None

            if session.expires_at <= time.time():
                self._sessions.pop(session_id, None)
                return None

            return session

    async def remove_expired(self) -> list[RelaySession]:
        now = time.time()
        async with self._lock:
            expired_ids = [
                session_id
                for session_id, session in self._sessions.items()
                if session.expires_at <= now
            ]
            return [self._sessions.pop(session_id) for session_id in expired_ids]


manager = RelayManager()
