from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager, suppress
from typing import Any
from urllib.parse import quote

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect

from app.config import settings
from app.manager import CommenterConnection, PendingComment, RelaySession, manager
from app.security import create_session_token, decode_session_token

logger = logging.getLogger("pluely_twin_relay")
logging.basicConfig(level=logging.INFO)


async def _close_quietly(websocket: WebSocket | None, code: int = 1000, reason: str = "") -> None:
    if websocket is None:
        return
    with suppress(Exception):
        await websocket.close(code=code, reason=reason)


async def _cleanup_loop() -> None:
    while True:
        await asyncio.sleep(60)
        expired = await manager.remove_expired()
        for session in expired:
            logger.info("Expiring Twin session %s", session.session_id)
            await _close_quietly(session.host, 1000, "Session expired")
            for commenter in list(session.commenters.values()):
                with suppress(Exception):
                    await commenter.websocket.send_json({"type": "session_expired"})
                await _close_quietly(commenter.websocket, 1000, "Session expired")


@asynccontextmanager
async def lifespan(_: FastAPI):
    cleanup_task = asyncio.create_task(_cleanup_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            await cleanup_task


app = FastAPI(
    title="Pluely Twin Relay",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/sessions")
async def create_session(
    x_relay_create_key: str | None = Header(default=None),
) -> dict[str, Any]:
    if settings.create_key and x_relay_create_key != settings.create_key:
        raise HTTPException(status_code=401, detail="Invalid relay create key")

    session = await manager.create_session(
        ttl_seconds=settings.session_ttl_seconds,
        max_events=settings.max_events,
        max_comments=settings.max_comments,
    )

    host_token = create_session_token(
        settings.secret_key,
        session.session_id,
        "host",
        settings.session_ttl_seconds,
    )
    commenter_token = create_session_token(
        settings.secret_key,
        session.session_id,
        "commenter",
        settings.session_ttl_seconds,
    )

    public_url = settings.public_url.rstrip("/")
    ws_base = (
        public_url.replace("https://", "wss://", 1)
        if public_url.startswith("https://")
        else public_url.replace("http://", "ws://", 1)
    )

    connection_url = (
        "pluely-twin://connect"
        f"?relay={quote(public_url, safe='')}"
        f"&session={quote(session.session_id, safe='')}"
        f"&token={quote(commenter_token, safe='')}"
    )

    return {
        "session_id": session.session_id,
        "host_token": host_token,
        "commenter_token": commenter_token,
        "host_ws_url": f"{ws_base}/api/v1/ws/{session.session_id}/host",
        "commenter_ws_url": f"{ws_base}/api/v1/ws/{session.session_id}/commenter",
        "connection_url": connection_url,
        "expires_in_seconds": settings.session_ttl_seconds,
    }


@app.post("/api/v1/sessions/{session_id}/close")
async def close_session(
    session_id: str,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()

    if not _valid_token(token, session_id, "host"):
        raise HTTPException(status_code=401, detail="Invalid Host token")

    session = await manager.remove_session(session_id)
    if session is None:
        return {"status": "already_closed"}

    await _close_quietly(session.host, 1000, "Session closed by Host")
    for commenter in list(session.commenters.values()):
        with suppress(Exception):
            await commenter.websocket.send_json({"type": "session_expired"})
        await _close_quietly(
            commenter.websocket,
            1000,
            "Session closed by Host",
        )

    return {"status": "closed"}


def _valid_token(token: str, session_id: str, role: str) -> bool:
    payload = decode_session_token(settings.secret_key, token)
    return bool(
        payload
        and payload.get("session_id") == session_id
        and payload.get("role") == role
    )


async def _receive_auth(
    websocket: WebSocket,
    session_id: str,
    role: str,
) -> dict[str, Any] | None:
    try:
        message = await asyncio.wait_for(websocket.receive_json(), timeout=15)
    except (asyncio.TimeoutError, WebSocketDisconnect):
        return None

    if not isinstance(message, dict) or message.get("type") != "authenticate":
        return None

    token = str(message.get("token") or "")
    if not _valid_token(token, session_id, role):
        with suppress(Exception):
            await websocket.send_json({"type": "authentication_failed"})
        return None

    return message


async def _heartbeat_host(session: RelaySession, websocket: WebSocket) -> None:
    while session.host is websocket:
        await asyncio.sleep(settings.ping_interval_seconds)

        if time.monotonic() - session.host_last_pong > settings.pong_timeout_seconds:
            await _close_quietly(websocket, 1001, "Heartbeat timeout")
            return

        with suppress(Exception):
            await websocket.send_json({"type": "ping"})


async def _heartbeat_commenter(
    session: RelaySession,
    connection_id: str,
    websocket: WebSocket,
) -> None:
    while True:
        await asyncio.sleep(settings.ping_interval_seconds)

        connection = session.commenters.get(connection_id)
        if connection is None or connection.websocket is not websocket:
            return

        if time.monotonic() - connection.last_pong > settings.pong_timeout_seconds:
            await _close_quietly(websocket, 1001, "Heartbeat timeout")
            return

        with suppress(Exception):
            await websocket.send_json({"type": "ping"})


async def _send_host(session: RelaySession, payload: dict[str, Any]) -> bool:
    host = session.host
    if host is None:
        return False

    try:
        await host.send_json(payload)
        return True
    except Exception:
        return False


async def _send_commenter(
    session: RelaySession,
    connection_id: str,
    payload: dict[str, Any],
) -> bool:
    connection = session.commenters.get(connection_id)
    if connection is None:
        return False

    try:
        await connection.websocket.send_json(payload)
        return True
    except Exception:
        return False


async def _broadcast_commenters(
    session: RelaySession,
    payload: dict[str, Any],
) -> None:
    dead: list[str] = []

    for connection_id, connection in list(session.commenters.items()):
        try:
            await connection.websocket.send_json(payload)
        except Exception:
            dead.append(connection_id)

    for connection_id in dead:
        session.commenters.pop(connection_id, None)


async def _forward_pending_comments(session: RelaySession) -> None:
    for pending in list(session.pending_comments.values()):
        await _send_host(
            session,
            {
                "type": "comment",
                "comment_id": pending.comment_id,
                "text": pending.text,
                "device_name": pending.device_name,
            },
        )


@app.websocket("/api/v1/ws/{session_id}/host")
async def host_socket(websocket: WebSocket, session_id: str) -> None:
    session = await manager.get_session(session_id)
    if session is None:
        await websocket.close(code=1008, reason="Session not found or expired")
        return

    await websocket.accept()

    auth = await _receive_auth(websocket, session_id, "host")
    if auth is None:
        await _close_quietly(websocket, 1008, "Authentication failed")
        return

    old_host = session.host
    if old_host is not None and old_host is not websocket:
        await _close_quietly(old_host, 1000, "Replaced by new host connection")

    session.host = websocket
    session.host_last_pong = time.monotonic()

    await websocket.send_json(
        {
            "type": "authenticated",
            "session_id": session.session_id,
            "latest_event_seq": session.latest_event_seq,
        }
    )

    await _broadcast_commenters(session, {"type": "host_connected"})
    await _forward_pending_comments(session)

    heartbeat = asyncio.create_task(_heartbeat_host(session, websocket))

    try:
        while True:
            message = await websocket.receive_json()
            if not isinstance(message, dict):
                continue

            message_type = message.get("type")

            if message_type == "pong":
                session.host_last_pong = time.monotonic()
                continue

            if message_type == "ping":
                session.host_last_pong = time.monotonic()
                await websocket.send_json(
                    {"type": "pong", "nonce": message.get("nonce")}
                )
                continue

            if message_type == "host_event":
                try:
                    seq = int(message["seq"])
                    event = message["event"]
                except (KeyError, TypeError, ValueError):
                    await websocket.send_json(
                        {"type": "error", "message": "Invalid host event"}
                    )
                    continue

                async with session.lock:
                    is_new = session.add_event(seq, event)

                if is_new:
                    await _broadcast_commenters(
                        session,
                        {"type": "host_event", "seq": seq, "event": event},
                    )

                # ACK duplicates too. The host may be replaying after reconnect.
                await websocket.send_json(
                    {"type": "host_event_accepted", "seq": seq}
                )
                continue

            if message_type == "comment_received":
                comment_id = str(message.get("comment_id") or "").strip()
                if not comment_id:
                    continue

                async with session.lock:
                    pending = session.pending_comments.pop(comment_id, None)
                    session.remember_comment_ack(comment_id)

                if pending:
                    await _send_commenter(
                        session,
                        pending.source_connection_id,
                        {
                            "type": "comment_accepted",
                            "comment_id": comment_id,
                        },
                    )
                continue

            if message_type == "disconnect":
                break

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("Host socket error for %s: %s", session_id, exc)
    finally:
        heartbeat.cancel()
        with suppress(asyncio.CancelledError):
            await heartbeat

        if session.host is websocket:
            session.host = None
            await _broadcast_commenters(session, {"type": "host_disconnected"})


@app.websocket("/api/v1/ws/{session_id}/commenter")
async def commenter_socket(websocket: WebSocket, session_id: str) -> None:
    session = await manager.get_session(session_id)
    if session is None:
        await websocket.close(code=1008, reason="Session not found or expired")
        return

    await websocket.accept()

    auth = await _receive_auth(websocket, session_id, "commenter")
    if auth is None:
        await _close_quietly(websocket, 1008, "Authentication failed")
        return

    connection_id = str(auth.get("connection_id") or "") or __import__("uuid").uuid4().hex
    device_name = str(auth.get("device_name") or "").strip() or None

    try:
        last_event_seq = int(auth.get("last_event_seq") or 0)
    except (TypeError, ValueError):
        last_event_seq = 0

    connection = CommenterConnection(
        connection_id=connection_id,
        websocket=websocket,
        device_name=device_name,
    )
    session.commenters[connection_id] = connection

    await websocket.send_json(
        {
            "type": "authenticated",
            "session_id": session.session_id,
            "connection_id": connection_id,
            "latest_event_seq": session.latest_event_seq,
            "host_connected": session.host is not None,
        }
    )

    # Replay missed structured events before returning to the live stream.
    for item in list(session.events):
        if item["seq"] > last_event_seq:
            await websocket.send_json(
                {
                    "type": "host_event",
                    "seq": item["seq"],
                    "event": item["event"],
                }
            )

    await _send_host(
        session,
        {
            "type": "commenter_connected",
            "connection_id": connection_id,
            "device_name": device_name,
        },
    )

    heartbeat = asyncio.create_task(
        _heartbeat_commenter(session, connection_id, websocket)
    )

    try:
        while True:
            message = await websocket.receive_json()
            if not isinstance(message, dict):
                continue

            message_type = message.get("type")

            if message_type == "pong":
                connection.last_pong = time.monotonic()
                continue

            if message_type == "ping":
                connection.last_pong = time.monotonic()
                await websocket.send_json(
                    {"type": "pong", "nonce": message.get("nonce")}
                )
                continue

            if message_type == "comment_send":
                comment_id = str(message.get("comment_id") or "").strip()
                text = str(message.get("text") or "").strip()

                if not comment_id or len(comment_id) > 128:
                    await websocket.send_json(
                        {"type": "error", "message": "Invalid comment id"}
                    )
                    continue

                if not text:
                    await websocket.send_json(
                        {"type": "error", "message": "Comment cannot be empty"}
                    )
                    continue

                if len(text) > 2000:
                    await websocket.send_json(
                        {"type": "error", "message": "Comment is too long"}
                    )
                    continue

                async with session.lock:
                    if comment_id in session.acked_comment_ids:
                        already_acked = True
                    else:
                        already_acked = False
                        session.pending_comments[comment_id] = PendingComment(
                            comment_id=comment_id,
                            text=text,
                            device_name=device_name,
                            source_connection_id=connection_id,
                        )

                if already_acked:
                    await websocket.send_json(
                        {
                            "type": "comment_accepted",
                            "comment_id": comment_id,
                        }
                    )
                    continue

                await _send_host(
                    session,
                    {
                        "type": "comment",
                        "comment_id": comment_id,
                        "text": text,
                        "device_name": device_name,
                    },
                )
                continue

            if message_type == "disconnect":
                break

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("Commenter socket error for %s: %s", session_id, exc)
    finally:
        heartbeat.cancel()
        with suppress(asyncio.CancelledError):
            await heartbeat

        if session.commenters.get(connection_id) is connection:
            session.commenters.pop(connection_id, None)

        await _send_host(
            session,
            {
                "type": "commenter_disconnected",
                "connection_id": connection_id,
                "device_name": device_name,
            },
        )
