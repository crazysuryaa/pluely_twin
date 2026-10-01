import {
  constantTimeEqual,
  signSessionToken,
  verifySessionToken,
} from "./auth";
import { intEnv, type Env } from "./env";

export { TwinSession } from "./TwinSession";

function jsonResponse(
  value: unknown,
  status = 200,
): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function websocketBase(origin: string): string {
  return origin
    .replace(/^https:/, "wss:")
    .replace(/^http:/, "ws:");
}

function bearerToken(request: Request): string {
  const value = request.headers.get("Authorization") ?? "";
  if (!value.toLowerCase().startsWith("bearer ")) return "";
  return value.slice(7).trim();
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/health" && request.method === "GET") {
      return jsonResponse({
        status: "ok",
        transport: "cloudflare-durable-objects",
      });
    }

    if (path === "/api/v1/sessions" && request.method === "POST") {
      const expectedCreateKey = env.TWIN_RELAY_CREATE_KEY?.trim() ?? "";
      if (expectedCreateKey) {
        const supplied = request.headers.get("X-Relay-Create-Key") ?? "";
        if (!constantTimeEqual(supplied, expectedCreateKey)) {
          return jsonResponse({ detail: "Invalid relay create key" }, 401);
        }
      }

      if (!env.TWIN_RELAY_SECRET_KEY?.trim()) {
        return jsonResponse(
          { detail: "Relay signing secret is not configured" },
          500,
        );
      }

      const ttlSeconds = intEnv(
        env.TWIN_RELAY_SESSION_TTL_SECONDS,
        8 * 60 * 60,
        300,
        24 * 60 * 60,
      );

      const sessionId = crypto.randomUUID();
      const expiresAt = Date.now() + ttlSeconds * 1000;
      const stub = env.TWIN_SESSIONS.getByName(sessionId);
      await stub.initialize(sessionId, expiresAt);

      const [hostToken, commenterToken] = await Promise.all([
        signSessionToken(
          env.TWIN_RELAY_SECRET_KEY,
          sessionId,
          "host",
          ttlSeconds,
        ),
        signSessionToken(
          env.TWIN_RELAY_SECRET_KEY,
          sessionId,
          "commenter",
          ttlSeconds,
        ),
      ]);

      const origin = url.origin;
      const wsBase = websocketBase(origin);
      const encodedRelay = encodeURIComponent(origin);
      const encodedSession = encodeURIComponent(sessionId);
      const encodedCommenterToken = encodeURIComponent(commenterToken);

      return jsonResponse({
        session_id: sessionId,
        host_token: hostToken,
        commenter_token: commenterToken,
        host_ws_url:
          `${wsBase}/api/v1/ws/${encodedSession}/host`,
        commenter_ws_url:
          `${wsBase}/api/v1/ws/${encodedSession}/commenter`,
        connection_url:
          `pluely-twin://connect?relay=${encodedRelay}&session=${encodedSession}&token=${encodedCommenterToken}`,
        expires_in_seconds: ttlSeconds,
      });
    }

    const closeMatch = path.match(
      /^\/api\/v1\/sessions\/([^/]+)\/close$/,
    );
    if (closeMatch && request.method === "POST") {
      const sessionId = decodeURIComponent(closeMatch[1]);
      const valid = await verifySessionToken(
        env.TWIN_RELAY_SECRET_KEY,
        bearerToken(request),
        sessionId,
        "host",
      );

      if (!valid) {
        return jsonResponse({ detail: "Invalid Host token" }, 401);
      }

      const stub = env.TWIN_SESSIONS.getByName(sessionId);
      await stub.closeSession();
      return jsonResponse({ status: "closed" });
    }

    const wsMatch = path.match(
      /^\/api\/v1\/ws\/([^/]+)\/(host|commenter)$/,
    );
    if (wsMatch) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }

      const sessionId = decodeURIComponent(wsMatch[1]);
      const stub = env.TWIN_SESSIONS.getByName(sessionId);
      return stub.fetch(request);
    }

    return jsonResponse({ detail: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
