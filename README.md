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

host-patch/                  integration reference / patch documentation
docs/ARCHITECTURE.md         protocol architecture
UPSTREAM.md                  upstream attribution
```

## Development branch

Active development is currently on **`develop`**.

The next major feature is the read-only host screen media stream for the Commenter. Structured transcript/AI/comment traffic stays separate from that media channel.
