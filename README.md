# Pluely Twin

A companion-enabled fork of the last public Pluely v0.1.9 source.

## Upstream

This repository is based on:

- **Project:** Pluely
- **Upstream repository:** https://github.com/iamsrikanthnani/pluely
- **Pinned source:** `4fb23ac348ad087ef22920272012030398b6b155`
- **Release:** v0.1.9
- **Source date:** January 14, 2026
- **License:** GNU GPL v3

See [UPSTREAM.md](UPSTREAM.md) and [LICENSE](LICENSE).

## Twin Commenter

Twin Commenter now supports two transports:

- **Worldwide Relay** — Host and Commenter both make outbound WSS connections to a deployed FastAPI relay.
- **LAN fallback** — direct local WebSocket connection on the same reachable network.

The companion app is designed around a deliberately narrow permission model.

### Host → Commenter

- live transcript events
- AI response stream
- session state
- later: explicitly shared screen media

### Commenter → Host

- authenticate
- send text comment
- ping
- disconnect

There are intentionally **no** protocol commands for remote mouse, keyboard, clipboard, shell, file writes, or application control.

## Live session sources

The current Pluely v0.1.9 system-audio path has one transcript source rather than speaker diarization, so the fork currently renders:

```text
System:     live transcription
Commenter:  text received from the paired Twin Commenter
AI:         assistant response
```

If speaker diarization is added later, the same Commenter source can coexist with Speaker 1 / Speaker 2.

## Implemented on `develop`

- complete pinned Pluely v0.1.9 source tree
- worldwide FastAPI/WSS Twin Relay service
- role-scoped expiring Host / Commenter JWTs
- outbound Host relay client with automatic reconnect
- Commenter worldwide relay-link support
- Host event acknowledgements + replay after reconnect
- queued Commenter messages while Host is temporarily offline
- comment acknowledgement + deduplication
- explicit relay session revocation when Host presses Stop
- LAN transport retained as fallback
- Rust WebSocket remote-commenter service
- ephemeral session ID and pairing token
- explicit host Start / Stop controls
- visible `REMOTE COMMENTER ACTIVE` state
- separate `Commenter` event source
- host transcript and AI stream mirrored to the companion
- incoming comments displayed in the live session UI
- Twin Commenter Tauri + React desktop client starter
- dashboard Commenter feed
- GitHub Actions validation workflow

## Repository layout

```text
src/                         Pluely React UI
src-tauri/                   Pluely Tauri/Rust backend
src-tauri/src/remote/        integrated Twin Commenter backend

commenter/                   Twin Commenter desktop app
relay/                       FastAPI worldwide relay service

host-patch/                  integration reference / patch documentation
docs/ARCHITECTURE.md         protocol architecture
UPSTREAM.md                  upstream attribution
```

## Development branch

Active development is currently on **`develop`**.

For worldwide use, deploy `relay/` and enter its HTTPS URL in Dashboard → Twin Commenter → Connection settings.

The first deployment should run a single always-warm relay instance because live sockets and replay buffers are currently process-local. See `relay/README.md`. Horizontal scaling should wait for Redis/pub-sub shared state.

The next major media feature is a consent-based read-only host screen stream. Structured transcript/AI/comment traffic should remain separate from that media channel.


### Worldwide session flow

1. Deploy `relay/` and copy its HTTPS service URL.
2. In the Host dashboard, open **Twin Commenter → Connection settings** and enter the Relay URL.
3. Press **Start Worldwide Session**.
4. Press **Copy Connection Link**.
5. Paste that link into the Twin Commenter app on the other computer.
6. Both apps connect outbound to the relay and recover automatically from ordinary network interruptions.

The copied link contains a short-lived Commenter credential. Treat it like a temporary invitation and stop the Host session when it is no longer needed.
