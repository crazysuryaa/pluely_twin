# Pluely Twin Cloudflare Relay

Production worldwide relay for Twin Commenter using Cloudflare Workers,
SQLite-backed Durable Objects, and WebSocket Hibernation.

## What this means for distributed binaries

After this relay is deployed once:

```text
Host binary
  Open → Start Worldwide Session → Copy Connection Link

Commenter binary
  Open → Paste Connection Link → Connect
```

Users do not need:

- a Cloudflare account
- Wrangler
- a relay create key
- the relay URL
- port forwarding
- your IP address

The production relay URL is already the default in the Host app:

```text
https://pluely-twin-relay.karta-testing.workers.dev
```

## Architecture

```text
Host App ── outbound WSS ──► Cloudflare Worker
                                  │
                                  ▼
                           TwinSession Durable Object
                                  ▲
Commenter ─ outbound WSS ─────────┘
```

Each session gets one SQLite-backed Durable Object. It owns that session's
WebSockets and persistent replay/acknowledgement state.

Durable Object SQLite stores:

- Host events and sequence numbers
- pending Commenter messages
- acknowledged comment IDs
- session metadata and expiry

WebSocket Hibernation allows idle sessions to sleep while their WebSockets stay
connected.

## Session creation security

Session creation is intentionally zero-config for distributed Host binaries.

```text
POST /api/v1/sessions
```

does not require a permanent client secret.

Instead:

- Cloudflare rate-limits session creation
- each created session gets a unique random session ID
- Host and Commenter receive different short-lived signed JWTs
- Host credentials cannot be used as Commenter credentials and vice versa
- session credentials expire with the session
- Host Stop revokes the session immediately
- knowing the public Worker URL does not grant access to an existing session

The current creation limit is:

```text
20 session creations per 60 seconds per source network
```

Normal use creates approximately one session when the user presses Start.

## First production deploy

You only need to do this once.

### 1. Install and log in

```bash
cd cloudflare-relay
npm install
npx wrangler login
```

### 2. Generate one signing secret

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Keep the output private. This is:

```text
TWIN_RELAY_SECRET_KEY
```

It signs temporary Host and Commenter session tokens. It is never shipped in
either desktop binary.

### 3. Create the temporary deployment secrets file

Create:

```text
.secrets.production.json
```

containing:

```json
{
  "TWIN_RELAY_SECRET_KEY": "PASTE_YOUR_RANDOM_VALUE"
}
```

This filename is ignored by git.

### 4. Deploy

```bash
npx wrangler deploy --secrets-file .secrets.production.json
rm .secrets.production.json
```

The expected production URL is:

```text
https://pluely-twin-relay.karta-testing.workers.dev
```

If Cloudflare gives you a different URL, update `DEFAULT_RELAY_URL` in:

```text
src/pages/dashboard/components/RemoteCommenter.tsx
```

before distributing new Host binaries.

### 5. Verify

Open:

```text
https://pluely-twin-relay.karta-testing.workers.dev/health
```

Expected response:

```json
{
  "status": "ok",
  "transport": "cloudflare-durable-objects"
}
```

That is the complete relay setup.

## GitHub Actions deployment

The repo also contains:

```text
.github/workflows/deploy-relay-cloudflare.yml
```

For future deployments, add these GitHub repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `TWIN_RELAY_SECRET_KEY`

Then run:

```text
GitHub → Actions → Deploy Twin Relay to Cloudflare → Run workflow
```

No create-key secret is required.

## Local development

```bash
cd cloudflare-relay
npm install
cp .dev.vars.example .dev.vars
```

Put only the signing secret in `.dev.vars`:

```text
TWIN_RELAY_SECRET_KEY=your-development-secret
```

Then:

```bash
npm run dev
```

## Reliability

### Commenter disconnect

The Commenter reconnects automatically and sends its last received event
sequence. Durable Object SQLite replays newer Host events.

### Host disconnect

The Commenter can stay connected to Cloudflare while the Host reconnects.
Comments remain persisted until the Host receives and acknowledges them.

### Durable Object hibernation

Per-WebSocket authentication and connection metadata is stored using serialized
WebSocket attachments. Cloudflare can hibernate the Durable Object while its
WebSockets remain connected.

Exact plain-text `ping` / `pong` frames are handled by WebSocket
auto-response so an idle object does not need to wake for heartbeats.

### Host Stop

The Host calls the authenticated close endpoint. The Durable Object revokes the
session and disconnects the Commenters.

## FastAPI reference relay

`../relay/` remains a local/self-hosted reference implementation of the same
wire protocol. Cloudflare is the intended production relay.
