# Pluely Twin Cloudflare Relay

Production worldwide relay for Twin Commenter using Cloudflare Workers,
SQLite-backed Durable Objects, and the Durable Objects WebSocket Hibernation API.

## Topology

```text
Host App ── outbound WSS ──► Worker ──► TwinSession Durable Object
                                           ▲
Commenter ─ outbound WSS ──────────────────┘
```

Each Twin session maps to one Durable Object. That object owns the session's
Host/Commenter WebSockets and persistent replay/acknowledgement state.

## Why Durable Objects

The relay needs a single coordination point per live session. A Durable Object
naturally provides that without sticky sessions or Redis.

SQLite-backed Durable Object storage persists:

- Host events and sequence numbers
- pending Commenter messages
- acknowledged comment IDs
- session metadata and expiry

The WebSocket Hibernation API allows idle sessions to sleep while their sockets
remain connected.

## Production protocol compatibility

The Worker intentionally preserves the same API contract as the FastAPI
reference relay:

```text
POST /api/v1/sessions
POST /api/v1/sessions/:session_id/close

WS /api/v1/ws/:session_id/host
WS /api/v1/ws/:session_id/commenter
```

The existing Rust Host and Twin Commenter clients therefore do not need a
Cloudflare-specific transport implementation.

## Local development

Requirements:

- Node.js 22+
- a Cloudflare account with Workers/Durable Objects available

```bash
cd cloudflare-relay
npm install
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` with two different random secrets, then run:

```bash
npm run dev
```

Health check:

```text
http://localhost:8787/health
```

Do not commit `.dev.vars`.

## First production deploy

Authenticate Wrangler:

```bash
cd cloudflare-relay
npm install
npx wrangler login
```

Create two independent strong secrets:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Create a local file named `.secrets.production.json`:

```json
{
  "TWIN_RELAY_SECRET_KEY": "FIRST_RANDOM_VALUE",
  "TWIN_RELAY_CREATE_KEY": "SECOND_RANDOM_VALUE"
}
```

Deploy code and secrets together:

```bash
npx wrangler deploy --secrets-file .secrets.production.json
rm .secrets.production.json
```

Wrangler provisions the SQLite-backed `TwinSession` Durable Object namespace
from `wrangler.jsonc`.

The deploy output prints the Worker URL, typically similar to:

```text
https://pluely-twin-relay.<your-subdomain>.workers.dev
```

Open:

```text
https://YOUR-WORKER.workers.dev/health
```

Expected response:

```json
{
  "status": "ok",
  "transport": "cloudflare-durable-objects"
}
```

## Configure the Host app

Open:

```text
Dashboard
→ Twin Commenter
→ Connection settings
```

Enter:

```text
Twin Relay URL
https://YOUR-WORKER.workers.dev

Relay create key
<the TWIN_RELAY_CREATE_KEY value>
```

Then press:

```text
Start Worldwide Session
```

The Host creates a session and receives a copyable invite like:

```text
pluely-twin://connect?relay=...&session=...&token=...
```

The Commenter can use that link from any internet-connected network.

## GitHub Actions deployment

A manual workflow is included:

```text
.github/workflows/deploy-relay-cloudflare.yml
```

Add these GitHub repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `TWIN_RELAY_SECRET_KEY`
- `TWIN_RELAY_CREATE_KEY`

The Cloudflare API token should be scoped to the account and permissions needed
to create/update the Worker and its Durable Object binding.

Then run:

```text
Actions
→ Deploy Twin Relay to Cloudflare
→ Run workflow
```

The workflow deploys the Worker and uploads Worker secrets without committing
them to the repository.

## Runtime configuration

Non-secret defaults are in `wrangler.jsonc`:

```text
TWIN_RELAY_SESSION_TTL_SECONDS = 28800
TWIN_RELAY_MAX_EVENTS = 5000
TWIN_RELAY_MAX_COMMENTS = 5000
```

Current session TTL is 8 hours.

## Reliability

### Commenter disconnect

The Commenter reconnects automatically and authenticates with its last received
event sequence. Durable Object SQLite replays newer Host events.

### Host disconnect

The Commenter can remain attached to the Durable Object while the Host
reconnects. Comments stay in `pending_comments` until the Host receives and
acknowledges them.

### Durable Object hibernation

Per-socket authentication/connection metadata is stored with
`serializeAttachment()`. Cloudflare can evict the Durable Object from memory
while leaving the WebSockets connected. The state is recovered when it wakes.

Plain-text `ping` / `pong` frames use Cloudflare WebSocket auto-response, so
heartbeats do not need to wake an idle Durable Object.

### Host Stop

The Host calls the authenticated close endpoint. The Durable Object marks the
session revoked, tells connected Commenters the session expired, and closes the
session sockets.

## FastAPI reference relay

The repository's sibling `relay/` directory remains as a local/self-hosted
reference implementation of the same wire protocol. Cloudflare is the intended
production worldwide relay.
