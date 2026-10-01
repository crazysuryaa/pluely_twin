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
  └── outbound WSS ──► Twin Relay ◄── outbound WSS ── Commenter
```

The Host does not expose an inbound public port.

### Session creation

The Host calls:

```text
POST /api/v1/sessions
X-Relay-Create-Key: <optional deployment key>
```

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

### Disconnect behavior

- Commenter network interruption: Commenter reconnects with capped exponential backoff and asks for replay.
- Host network interruption: Commenter remains connected to the relay; comments queue there until Host reconnects.
- Host presses Stop: Host relay token is used to revoke the relay session immediately and connected Commenters are closed.
- Relay process restart: current in-memory session state is lost. A production HA version should add Redis/shared state.

### Deployment constraint

Until shared state is implemented, run exactly one relay instance. Cloud Run
should use `min-instances=1` and `max-instances=1` for this phase.
