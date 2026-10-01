# Twin Commenter architecture

## Goal
A second computer can receive explicitly shared session information and send text comments back to the host.

## Host -> Commenter
- speaker.partial
- speaker.final
- assistant.delta
- assistant.complete
- session.state
- host.status

## Commenter -> Host
- authenticate
- comment.send
- ping
- disconnect

There are intentionally no protocol messages for mouse, keyboard, clipboard, shell, file writes, or application control.

## Source separation
```text
microphone/system audio -> Speaker 1 / Speaker 2
remote connection       -> Commenter
LLM                     -> Assistant
```

Commenter text should not be inserted into the speech-to-text pipeline.


## Worldwide relay transport

The preferred production topology is:

```text
Host App
  └── outbound WSS ──► Cloudflare Worker
                           │
                           ▼
                    TwinSession Durable Object
                           ▲
  Commenter ─ outbound WSS ┘
```

Each logical Twin session is mapped by name to one SQLite-backed Durable Object.
That Durable Object is the coordination point for its Host and Commenter
connections. The Host does not expose an inbound public port.

### Session creation

The Host calls:

```text
POST /api/v1/sessions
```

No permanent client secret is embedded in distributed Host binaries. Cloudflare
rate-limits session creation, and every successful creation returns fresh,
role-scoped, short-lived credentials.

The relay returns:

- session ID
- role-scoped Host JWT
- role-scoped Commenter JWT
- Host WSS endpoint
- Commenter WSS endpoint
- a copyable `pluely-twin://` Commenter link

### Reliability

Host events keep their monotonic sequence numbers. The relay stores the latest
event window and replays events newer than the Commenter's `last_event_seq`.

Host event delivery is acknowledged by the relay. If the Host connection drops,
the Host replays locally buffered events that were not acknowledged.

Commenter messages use a caller-generated `comment_id`. The relay keeps them
pending until the Host sends `comment_received`. Only then does the relay send
`comment_accepted` to the Commenter. Re-sends are deduplicated.

### Cloudflare persistence and hibernation

The production relay stores the event replay window, pending comments,
acknowledged comment IDs, session ID and expiry in Durable Object SQLite.

Per-WebSocket role/device/connection metadata is stored using WebSocket
attachments so it survives Durable Object hibernation. Exact plain-text
`ping`/`pong` heartbeat frames use Cloudflare WebSocket auto-response and do
not need to wake an idle session object.

### Disconnect behavior

- Commenter network interruption: Commenter reconnects with capped exponential backoff and asks for replay.
- Host network interruption: Commenter can remain connected to the Durable Object; comments persist until Host reconnects.
- Durable Object hibernation: WebSockets remain attached at Cloudflare and connection metadata is restored on wake.
- Host presses Stop: Host relay token revokes the session immediately and connected Commenters are closed.
- Session expiry: a Durable Object alarm revokes/cleans the session after its configured TTL.

The FastAPI implementation under `relay/` remains a local/self-hosted reference
implementation and is not the primary production deployment.
