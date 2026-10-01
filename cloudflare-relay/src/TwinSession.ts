import { DurableObject } from "cloudflare:workers";
import { verifySessionToken, type SessionRole } from "./auth";
import { intEnv, type Env } from "./env";

type SocketAttachment = {
  authenticated: boolean;
  expectedRole: SessionRole;
  role?: SessionRole;
  connectionId: string;
  deviceName?: string | null;
  lastEventSeq: number;
};

type SessionMeta = {
  session_id: string;
  expires_at: number;
  revoked: number;
};

type EventRow = {
  seq: number;
  payload: string;
};

type PendingCommentRow = {
  comment_id: string;
  text: string;
  device_name: string | null;
  source_connection_id: string;
};

export class TwinSession extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS session_meta (
        session_id TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_comments (
        comment_id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        device_name TEXT,
        source_connection_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS acked_comments (
        comment_id TEXT PRIMARY KEY,
        acked_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_created_at
        ON events(created_at);

      CREATE INDEX IF NOT EXISTS idx_pending_comments_created_at
        ON pending_comments(created_at);

      CREATE INDEX IF NOT EXISTS idx_acked_comments_acked_at
        ON acked_comments(acked_at);
    `);

    // These exact application-level frames are answered by Cloudflare without
    // waking a hibernating Durable Object.
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }

  async initialize(sessionId: string, expiresAt: number): Promise<void> {
    const existing = this.getMeta();
    if (existing && existing.session_id !== sessionId) {
      throw new Error("Durable Object is already initialized for another session");
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO session_meta (session_id, expires_at, revoked)
       VALUES (?, ?, 0)
       ON CONFLICT(session_id)
       DO UPDATE SET expires_at = excluded.expires_at, revoked = 0`,
      sessionId,
      expiresAt,
    );

    await this.ctx.storage.setAlarm(expiresAt);
  }

  async closeSession(): Promise<void> {
    this.ctx.storage.sql.exec(
      "UPDATE session_meta SET revoked = 1",
    );

    this.broadcastJson({ type: "session_expired" });

    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, "Session closed by Host");
      } catch {
        // Best-effort shutdown.
      }
    }

    this.ctx.storage.sql.exec("DELETE FROM pending_comments");
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const meta = this.getMeta();
    if (!meta) {
      return new Response("Session not initialized", { status: 404 });
    }

    if (meta.revoked || meta.expires_at <= Date.now()) {
      return new Response("Session expired", { status: 410 });
    }

    const url = new URL(request.url);
    const expectedRole: SessionRole = url.pathname.endsWith("/host")
      ? "host"
      : "commenter";

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);

    const attachment: SocketAttachment = {
      authenticated: false,
      expectedRole,
      connectionId: crypto.randomUUID(),
      deviceName: null,
      lastEventSeq: 0,
    };
    server.serializeAttachment(attachment);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string") {
      this.sendJson(ws, {
        type: "error",
        message: "Binary messages are not supported",
      });
      return;
    }

    // Plain ping/pong is normally consumed by setWebSocketAutoResponse without
    // waking the object. Keep this fallback for local/dev runtimes.
    if (message === "ping") {
      ws.send("pong");
      return;
    }
    if (message === "pong") return;

    let value: Record<string, unknown>;
    try {
      value = JSON.parse(message) as Record<string, unknown>;
    } catch {
      this.sendJson(ws, { type: "error", message: "Invalid JSON message" });
      return;
    }

    const attachment =
      (ws.deserializeAttachment() as SocketAttachment | null) ?? {
        authenticated: false,
        expectedRole: "commenter",
        connectionId: crypto.randomUUID(),
        deviceName: null,
        lastEventSeq: 0,
      };

    if (!attachment.authenticated) {
      await this.authenticateSocket(ws, attachment, value);
      return;
    }

    if (attachment.role === "host") {
      await this.handleHostMessage(ws, attachment, value);
    } else {
      await this.handleCommenterMessage(ws, attachment, value);
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const attachment =
      ws.deserializeAttachment() as SocketAttachment | null;

    if (attachment?.authenticated) {
      if (attachment.role === "host") {
        const replacementHostExists = this.getSocketsByRole("host").some(
          (candidate) => candidate !== ws,
        );

        if (!replacementHostExists) {
          this.broadcastToRole("commenter", { type: "host_disconnected" });
        }
      } else {
        this.broadcastToRole("host", {
          type: "commenter_disconnected",
          connection_id: attachment.connectionId,
          device_name: attachment.deviceName ?? null,
        });
      }
    }

    try {
      ws.close(code || 1000, reason || "Connection closed");
    } catch {
      // Cloudflare may already have replied to the Close frame.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    const attachment =
      ws.deserializeAttachment() as SocketAttachment | null;

    if (!attachment?.authenticated) return;

    if (attachment.role === "host") {
      const replacementHostExists = this.getSocketsByRole("host").some(
        (candidate) => candidate !== ws,
      );

      if (!replacementHostExists) {
        this.broadcastToRole("commenter", { type: "host_disconnected" });
      }
    } else {
      this.broadcastToRole("host", {
        type: "commenter_disconnected",
        connection_id: attachment.connectionId,
        device_name: attachment.deviceName ?? null,
      });
    }
  }

  async alarm(): Promise<void> {
    const meta = this.getMeta();
    if (!meta || meta.revoked || meta.expires_at > Date.now()) {
      return;
    }

    await this.closeSession();
    this.ctx.storage.sql.exec("DELETE FROM events");
    this.ctx.storage.sql.exec("DELETE FROM acked_comments");
  }

  private getMeta(): SessionMeta | null {
    const rows = this.ctx.storage.sql
      .exec<SessionMeta>(
        "SELECT session_id, expires_at, revoked FROM session_meta LIMIT 1",
      )
      .toArray();

    return rows[0] ?? null;
  }

  private latestEventSeq(): number {
    const row = this.ctx.storage.sql
      .exec<{ latest: number | null }>(
        "SELECT MAX(seq) AS latest FROM events",
      )
      .one();

    return row.latest ?? 0;
  }

  private async authenticateSocket(
    ws: WebSocket,
    attachment: SocketAttachment,
    value: Record<string, unknown>,
  ): Promise<void> {
    if (value.type !== "authenticate") {
      this.sendJson(ws, { type: "authentication_failed" });
      ws.close(1008, "Authentication required");
      return;
    }

    const meta = this.getMeta();
    if (!meta || meta.revoked || meta.expires_at <= Date.now()) {
      this.sendJson(ws, { type: "session_expired" });
      ws.close(1008, "Session expired");
      return;
    }

    const token = typeof value.token === "string" ? value.token : "";
    const valid = await verifySessionToken(
      this.env.TWIN_RELAY_SECRET_KEY,
      token,
      meta.session_id,
      attachment.expectedRole,
    );

    if (!valid) {
      this.sendJson(ws, { type: "authentication_failed" });
      ws.close(1008, "Authentication failed");
      return;
    }

    const connectionId =
      typeof value.connection_id === "string" && value.connection_id.trim()
        ? value.connection_id.trim().slice(0, 128)
        : attachment.connectionId;

    const deviceName =
      typeof value.device_name === "string" && value.device_name.trim()
        ? value.device_name.trim().slice(0, 200)
        : null;

    const lastEventSeq =
      typeof value.last_event_seq === "number" &&
      Number.isSafeInteger(value.last_event_seq) &&
      value.last_event_seq >= 0
        ? value.last_event_seq
        : 0;

    const authenticatedAttachment: SocketAttachment = {
      authenticated: true,
      expectedRole: attachment.expectedRole,
      role: attachment.expectedRole,
      connectionId,
      deviceName,
      lastEventSeq,
    };

    if (attachment.expectedRole === "host") {
      for (const existing of this.getSocketsByRole("host")) {
        if (existing !== ws) {
          try {
            existing.close(1000, "Replaced by newer Host connection");
          } catch {
            // Best effort.
          }
        }
      }
    }

    ws.serializeAttachment(authenticatedAttachment);

    this.sendJson(ws, {
      type: "authenticated",
      session_id: meta.session_id,
      connection_id: connectionId,
      latest_event_seq: this.latestEventSeq(),
      host_connected: this.getSocketsByRole("host").length > 0,
    });

    if (attachment.expectedRole === "commenter") {
      await this.replayEvents(ws, lastEventSeq);

      this.broadcastToRole("host", {
        type: "commenter_connected",
        connection_id: connectionId,
        device_name: deviceName,
      });
    } else {
      this.broadcastToRole("commenter", { type: "host_connected" });
      this.flushPendingCommentsToHost(ws);
    }
  }

  private async handleHostMessage(
    ws: WebSocket,
    _attachment: SocketAttachment,
    value: Record<string, unknown>,
  ): Promise<void> {
    if (value.type === "disconnect") {
      ws.close(1000, "Host disconnected");
      return;
    }

    if (value.type === "host_event") {
      const seq = value.seq;
      const event = value.event;

      if (
        typeof seq !== "number" ||
        !Number.isSafeInteger(seq) ||
        seq <= 0 ||
        !event ||
        typeof event !== "object"
      ) {
        this.sendJson(ws, {
          type: "error",
          message: "Invalid host event",
        });
        return;
      }

      const existing = this.ctx.storage.sql
        .exec<{ seq: number }>(
          "SELECT seq FROM events WHERE seq = ? LIMIT 1",
          seq,
        )
        .toArray();

      if (existing.length === 0) {
        this.ctx.storage.sql.exec(
          "INSERT INTO events (seq, payload, created_at) VALUES (?, ?, ?)",
          seq,
          JSON.stringify(event),
          Date.now(),
        );

        this.trimEvents();

        this.broadcastToRole("commenter", {
          type: "host_event",
          seq,
          event,
        });
      }

      // ACK duplicate/replayed events too.
      this.sendJson(ws, {
        type: "host_event_accepted",
        seq,
      });
      return;
    }

    if (value.type === "comment_received") {
      const commentId =
        typeof value.comment_id === "string"
          ? value.comment_id.trim()
          : "";

      if (!commentId) return;

      const pending = this.ctx.storage.sql
        .exec<PendingCommentRow>(
          `SELECT comment_id, text, device_name, source_connection_id
           FROM pending_comments
           WHERE comment_id = ?
           LIMIT 1`,
          commentId,
        )
        .toArray()[0];

      this.ctx.storage.sql.exec(
        "DELETE FROM pending_comments WHERE comment_id = ?",
        commentId,
      );
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO acked_comments (comment_id, acked_at)
         VALUES (?, ?)`,
        commentId,
        Date.now(),
      );
      this.trimAckedComments();

      if (pending) {
        this.sendToConnectionId(pending.source_connection_id, {
          type: "comment_accepted",
          comment_id: commentId,
        });
      }
      return;
    }
  }

  private async handleCommenterMessage(
    ws: WebSocket,
    attachment: SocketAttachment,
    value: Record<string, unknown>,
  ): Promise<void> {
    if (value.type === "disconnect") {
      ws.close(1000, "Commenter disconnected");
      return;
    }

    if (value.type !== "comment_send") return;

    const commentId =
      typeof value.comment_id === "string"
        ? value.comment_id.trim().slice(0, 128)
        : "";
    const text =
      typeof value.text === "string"
        ? value.text.trim()
        : "";

    if (!commentId) {
      this.sendJson(ws, { type: "error", message: "Invalid comment id" });
      return;
    }

    if (!text) {
      this.sendJson(ws, {
        type: "error",
        message: "Comment cannot be empty",
      });
      return;
    }

    if (text.length > 2000) {
      this.sendJson(ws, {
        type: "error",
        message: "Comment is too long",
      });
      return;
    }

    const alreadyAcked = this.ctx.storage.sql
      .exec<{ comment_id: string }>(
        "SELECT comment_id FROM acked_comments WHERE comment_id = ? LIMIT 1",
        commentId,
      )
      .toArray();

    if (alreadyAcked.length > 0) {
      this.sendJson(ws, {
        type: "comment_accepted",
        comment_id: commentId,
      });
      return;
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO pending_comments
        (comment_id, text, device_name, source_connection_id, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(comment_id)
       DO UPDATE SET
         text = excluded.text,
         device_name = excluded.device_name,
         source_connection_id = excluded.source_connection_id`,
      commentId,
      text,
      attachment.deviceName ?? null,
      attachment.connectionId,
      Date.now(),
    );

    this.trimPendingComments();

    this.broadcastToRole("host", {
      type: "comment",
      comment_id: commentId,
      text,
      device_name: attachment.deviceName ?? null,
    });
  }

  private async replayEvents(
    ws: WebSocket,
    afterSeq: number,
  ): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<EventRow>(
        `SELECT seq, payload
         FROM events
         WHERE seq > ?
         ORDER BY seq ASC`,
        afterSeq,
      )
      .toArray();

    for (const row of rows) {
      try {
        this.sendJson(ws, {
          type: "host_event",
          seq: row.seq,
          event: JSON.parse(row.payload),
        });
      } catch {
        // Skip corrupt rows rather than breaking the whole replay.
      }
    }
  }

  private flushPendingCommentsToHost(host: WebSocket): void {
    const rows = this.ctx.storage.sql
      .exec<PendingCommentRow>(
        `SELECT comment_id, text, device_name, source_connection_id
         FROM pending_comments
         ORDER BY created_at ASC`,
      )
      .toArray();

    for (const row of rows) {
      this.sendJson(host, {
        type: "comment",
        comment_id: row.comment_id,
        text: row.text,
        device_name: row.device_name,
      });
    }
  }

  private trimEvents(): void {
    const maxEvents = intEnv(
      this.env.TWIN_RELAY_MAX_EVENTS,
      5000,
      100,
      50_000,
    );
    const count = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM events")
      .one().count;

    const removeCount = count - maxEvents;
    if (removeCount > 0) {
      this.ctx.storage.sql.exec(
        `DELETE FROM events
         WHERE seq IN (
           SELECT seq FROM events ORDER BY seq ASC LIMIT ?
         )`,
        removeCount,
      );
    }
  }

  private trimPendingComments(): void {
    const maxComments = intEnv(
      this.env.TWIN_RELAY_MAX_COMMENTS,
      5000,
      100,
      50_000,
    );
    const count = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM pending_comments",
      )
      .one().count;

    const removeCount = count - maxComments;
    if (removeCount > 0) {
      this.ctx.storage.sql.exec(
        `DELETE FROM pending_comments
         WHERE comment_id IN (
           SELECT comment_id
           FROM pending_comments
           ORDER BY created_at ASC
           LIMIT ?
         )`,
        removeCount,
      );
    }
  }

  private trimAckedComments(): void {
    const maxComments = intEnv(
      this.env.TWIN_RELAY_MAX_COMMENTS,
      5000,
      100,
      50_000,
    );
    const count = this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM acked_comments",
      )
      .one().count;

    const removeCount = count - maxComments;
    if (removeCount > 0) {
      this.ctx.storage.sql.exec(
        `DELETE FROM acked_comments
         WHERE comment_id IN (
           SELECT comment_id
           FROM acked_comments
           ORDER BY acked_at ASC
           LIMIT ?
         )`,
        removeCount,
      );
    }
  }

  private getSocketsByRole(role: SessionRole): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      const attachment =
        ws.deserializeAttachment() as SocketAttachment | null;
      return attachment?.authenticated && attachment.role === role;
    });
  }

  private sendToConnectionId(
    connectionId: string,
    payload: unknown,
  ): void {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment =
        ws.deserializeAttachment() as SocketAttachment | null;

      if (
        attachment?.authenticated &&
        attachment.connectionId === connectionId
      ) {
        this.sendJson(ws, payload);
      }
    }
  }

  private broadcastToRole(
    role: SessionRole,
    payload: unknown,
  ): void {
    for (const ws of this.getSocketsByRole(role)) {
      this.sendJson(ws, payload);
    }
  }

  private broadcastJson(payload: unknown): void {
    for (const ws of this.ctx.getWebSockets()) {
      this.sendJson(ws, payload);
    }
  }

  private sendJson(ws: WebSocket, payload: unknown): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Reconnect/replay handles delivery after a dead socket disappears.
    }
  }
}
