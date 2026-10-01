# Pluely Twin Relay

The relay gives Twin Commenter worldwide connectivity without requiring the Host
computer to expose an inbound port.

Both desktop applications create outbound connections:

```text
Host App ───── outbound WSS ─────► Relay ◄───── outbound WSS ───── Commenter
```

## Reliability protocol

The relay preserves the reliability mechanisms used by the LAN transport:

- application heartbeat
- automatic client reconnect
- monotonic Host event sequence numbers
- event replay after reconnect
- Host event acknowledgements
- queued Commenter messages while Host is offline
- end-to-end comment acknowledgement
- comment deduplication
- session expiry

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

for local development.

## Cloud Run

Build the `relay/` directory as the container context.

For the first deployment, keep exactly one warm instance:

```bash
gcloud run deploy pluely-twin-relay \
  --source relay \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --set-env-vars TWIN_RELAY_SECRET_KEY=...,TWIN_RELAY_CREATE_KEY=...,TWIN_RELAY_PUBLIC_URL=https://YOUR-SERVICE.run.app
```

The WebSocket endpoints still authenticate using signed session-role JWTs.
`--allow-unauthenticated` only means Cloud Run itself does not require Google
identity before the application receives the request.

### Why max-instances=1 initially?

The current relay keeps live WebSocket objects and replay buffers in process
memory. If Cloud Run scaled to two instances, Host and Commenter could land on
different instances.

Before horizontal scaling, add Redis Pub/Sub + shared session/replay storage.
Do not raise `max-instances` until that layer exists.

## Session creation

```http
POST /api/v1/sessions
X-Relay-Create-Key: <private create key>
```

Response includes:

- session ID
- Host JWT
- Commenter JWT
- Host WSS URL
- Commenter WSS URL
- copyable `pluely-twin://` connection link

The Host token and Commenter token are role-specific and expire with the session.


## GitHub Actions deployment

The repository includes:

```text
.github/workflows/deploy-relay-cloud-run.yml
```

Configure these repository or organization secrets before running it:

- `GCP_PROJECT_ID`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`
- `TWIN_RELAY_SECRET_KEY`
- `TWIN_RELAY_CREATE_KEY`

Then run **Deploy Twin Relay to Cloud Run** from the Actions tab. The workflow
prints the final Relay URL in its job summary. Paste that URL into the Host
Dashboard → Twin Commenter → Connection settings.

The create key is intentionally not stored in browser local storage.
