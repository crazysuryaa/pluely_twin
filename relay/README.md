# Pluely Twin FastAPI Relay

This directory contains the original FastAPI implementation of the Twin Relay.

It is retained as:

- a local development relay
- a self-hosting option
- a readable reference implementation of the Twin wire protocol

The intended production worldwide relay is now:

```text
cloudflare-relay/
```

using Cloudflare Workers + SQLite-backed Durable Objects.

## Run locally

```bash
cd relay
cp .env.example .env
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8787
```

Set:

```text
TWIN_RELAY_PUBLIC_URL=http://localhost:8787
```

The Host can then use:

```text
http://localhost:8787
```

as its Twin Relay URL for local testing.

## Reliability protocol

This reference relay implements the same core concepts as the production
Cloudflare relay:

- automatic client reconnect
- monotonic Host event sequence numbers
- replay after reconnect
- Host event acknowledgements
- queued Commenter messages while Host is offline
- end-to-end comment acknowledgements
- comment deduplication
- session expiry/revocation

Unlike the Cloudflare Durable Object implementation, this FastAPI version keeps
live routing/replay state in one Python process. Do not horizontally scale this
implementation without adding shared state/pub-sub.

## Session creation

By default, local/reference deployments do not require a create key:

```http
POST /api/v1/sessions
```

The response includes:

- session ID
- Host JWT
- Commenter JWT
- Host WebSocket URL
- Commenter WebSocket URL
- copyable `pluely-twin://` invitation link
