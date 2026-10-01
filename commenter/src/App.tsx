import { FormEvent, useEffect, useRef, useState } from "react";

type FeedItem = {
  id: string;
  source: string;
  text: string;
  status?: "pending" | "sent";
};

type ConnectionConfig = {
  host: string;
  port: string;
  token: string;
  deviceName: string;
};

type HostEvent =
  | { type: "host_status"; remote_active: boolean; session_id: string }
  | { type: "speaker_partial"; speaker: string; text: string }
  | { type: "speaker_final"; speaker: string; text: string }
  | { type: "assistant_delta"; text: string }
  | { type: "assistant_complete"; text: string }
  | { type: "session_state"; state: string };

type ServerMessage =
  | {
      type: "authenticated";
      session_id: string;
      connection_id: string;
      latest_event_seq: number;
    }
  | { type: "authentication_failed" }
  | { type: "comment_accepted"; comment_id: string }
  | { type: "pong"; nonce?: string | null }
  | { type: "error"; message: string }
  | { type: "host_event"; seq: number; event: HostEvent };

const SAVED_LINK_KEY = "pluely-twin:last-connection-link";
const DEVICE_NAME_KEY = "pluely-twin:device-name";
const MAX_RECONNECT_DELAY_MS = 8_000;

export default function App() {
  const [connectionLink, setConnectionLink] = useState(
    () => localStorage.getItem(SAVED_LINK_KEY) || ""
  );
  const [host, setHost] = useState("");
  const [port, setPort] = useState("8765");
  const [token, setToken] = useState("");
  const [deviceName, setDeviceName] = useState(
    () => localStorage.getItem(DEVICE_NAME_KEY) || "Twin Commenter"
  );
  const [connected, setConnected] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [status, setStatus] = useState("Disconnected");
  const [comment, setComment] = useState("");
  const [feed, setFeed] = useState<FeedItem[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const connectionConfigRef = useRef<ConnectionConfig | null>(null);
  const manualDisconnectRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const lastEventSeqRef = useRef(0);
  const pendingCommentsRef = useRef<Map<string, string>>(new Map());
  const assistantDraftIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      manualDisconnectRef.current = true;
      clearReconnectTimer();
      clearHeartbeat();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  function clearReconnectTimer() {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  function clearHeartbeat() {
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }

  function appendFeed(source: string, text: string, id = crypto.randomUUID(), status?: FeedItem["status"]) {
    const clean = text.trim();
    if (!clean) return;

    setFeed((current) => [
      ...current.slice(-399),
      { id, source, text: clean, status },
    ]);
  }

  function upsertAssistantDelta(chunk: string) {
    if (!chunk) return;

    let draftId = assistantDraftIdRef.current;
    if (!draftId) {
      draftId = crypto.randomUUID();
      assistantDraftIdRef.current = draftId;
      setFeed((current) => [
        ...current.slice(-399),
        {
          id: draftId!,
          source: "Assistant",
          text: chunk,
        },
      ]);
      return;
    }

    setFeed((current) =>
      current.map((item) =>
        item.id === draftId
          ? { ...item, text: item.text + chunk }
          : item
      )
    );
  }

  function completeAssistant(text: string) {
    const clean = text.trim();
    const draftId = assistantDraftIdRef.current;

    if (draftId) {
      setFeed((current) =>
        current.map((item) =>
          item.id === draftId
            ? { ...item, text: clean || item.text }
            : item
        )
      );
      assistantDraftIdRef.current = null;
      return;
    }

    if (clean) appendFeed("Assistant", clean);
  }

  function consumeHostEvent(event: HostEvent) {
    if (event.type === "speaker_final") {
      appendFeed(event.speaker, event.text);
    } else if (event.type === "assistant_delta") {
      upsertAssistantDelta(event.text);
    } else if (event.type === "assistant_complete") {
      completeAssistant(event.text);
    } else if (event.type === "session_state") {
      appendFeed("Session", event.state);
    }
  }

  function formatWsHost(value: string) {
    if (value.includes(":") && !value.startsWith("[")) {
      return `[${value}]`;
    }
    return value;
  }

  function parseConnectionLink(value: string): ConnectionConfig {
    const url = new URL(value.trim());

    if (url.protocol !== "pluely-twin:") {
      throw new Error("Expected a pluely-twin:// connection link");
    }

    const parsedHost = url.searchParams.get("host")?.trim() || "";
    const parsedPort = url.searchParams.get("port")?.trim() || "8765";
    const parsedToken = url.searchParams.get("token")?.trim() || "";

    if (!parsedHost || !parsedToken) {
      throw new Error("Connection link is missing host or token");
    }

    return {
      host: parsedHost,
      port: parsedPort,
      token: parsedToken,
      deviceName: deviceName.trim() || "Twin Commenter",
    };
  }

  function buildConnectionLink(config: ConnectionConfig) {
    return `pluely-twin://connect?host=${encodeURIComponent(config.host)}&port=${encodeURIComponent(config.port)}&token=${encodeURIComponent(config.token)}`;
  }

  function scheduleReconnect() {
    if (manualDisconnectRef.current || !connectionConfigRef.current) return;

    clearReconnectTimer();

    const attempt = reconnectAttemptRef.current;
    const delay = Math.min(1_000 * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
    reconnectAttemptRef.current = attempt + 1;

    setConnected(false);
    setStatus(`Connection interrupted · reconnecting in ${Math.ceil(delay / 1000)}s`);

    reconnectTimerRef.current = window.setTimeout(() => {
      const config = connectionConfigRef.current;
      if (config && !manualDisconnectRef.current) {
        openSocket(config, true);
      }
    }, delay);
  }

  function startHeartbeat(socket: WebSocket) {
    clearHeartbeat();

    heartbeatTimerRef.current = window.setInterval(() => {
      if (socketRef.current !== socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        socket.send(
          JSON.stringify({
            type: "ping",
            nonce: String(Date.now()),
          })
        );
      } catch {
        socket.close();
      }
    }, 10_000);
  }

  function flushPendingComments(socket: WebSocket) {
    if (socket.readyState !== WebSocket.OPEN) return;

    for (const [commentId, text] of pendingCommentsRef.current.entries()) {
      socket.send(
        JSON.stringify({
          type: "comment_send",
          comment_id: commentId,
          text,
        })
      );
    }
  }

  function openSocket(config: ConnectionConfig, reconnecting = false) {
    clearReconnectTimer();
    clearHeartbeat();

    const previous = socketRef.current;
    socketRef.current = null;
    if (previous && previous.readyState < WebSocket.CLOSING) {
      previous.close();
    }

    connectionConfigRef.current = config;
    manualDisconnectRef.current = false;
    setSessionActive(true);
    setStatus(reconnecting ? "Reconnecting…" : "Connecting…");

    const wsUrl = `ws://${formatWsHost(config.host)}:${config.port}`;
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      if (socketRef.current !== socket) return;

      socket.send(
        JSON.stringify({
          type: "authenticate",
          token: config.token,
          device_name: config.deviceName || null,
          last_event_seq: lastEventSeqRef.current,
        })
      );
    };

    socket.onmessage = (event) => {
      if (socketRef.current !== socket) return;

      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        setStatus("Received an invalid host message");
        return;
      }

      if (message.type === "authenticated") {
        reconnectAttemptRef.current = 0;
        setConnected(true);
        setSessionId(message.session_id);
        setStatus("Connected");
        startHeartbeat(socket);
        flushPendingComments(socket);
        return;
      }

      if (message.type === "authentication_failed") {
        manualDisconnectRef.current = true;
        setConnected(false);
        setSessionActive(false);
        setStatus("Authentication failed");
        socket.close();
        return;
      }

      if (message.type === "comment_accepted") {
        pendingCommentsRef.current.delete(message.comment_id);
        setFeed((current) =>
          current.map((item) =>
            item.id === message.comment_id
              ? { ...item, status: "sent" }
              : item
          )
        );
        return;
      }

      if (message.type === "error") {
        setStatus(message.message);
        return;
      }

      if (message.type === "host_event") {
        if (message.seq <= lastEventSeqRef.current) {
          return;
        }

        lastEventSeqRef.current = message.seq;
        consumeHostEvent(message.event);
      }
    };

    socket.onerror = () => {
      if (socketRef.current !== socket) return;
      setStatus("Connection interrupted");
      try {
        socket.close();
      } catch {
        scheduleReconnect();
      }
    };

    socket.onclose = () => {
      if (socketRef.current !== socket) return;

      socketRef.current = null;
      clearHeartbeat();
      setConnected(false);

      if (manualDisconnectRef.current) {
        setStatus("Disconnected");
        return;
      }

      scheduleReconnect();
    };
  }

  function connect() {
    try {
      let config: ConnectionConfig;

      if (connectionLink.trim()) {
        config = parseConnectionLink(connectionLink);
        setHost(config.host);
        setPort(config.port);
        setToken(config.token);
      } else {
        config = {
          host: host.trim(),
          port: port.trim() || "8765",
          token: token.trim(),
          deviceName: deviceName.trim() || "Twin Commenter",
        };

        if (!config.host || !config.token) {
          setStatus("Host and session token are required");
          return;
        }

        const generatedLink = buildConnectionLink(config);
        setConnectionLink(generatedLink);
        localStorage.setItem(SAVED_LINK_KEY, generatedLink);
      }

      localStorage.setItem(DEVICE_NAME_KEY, config.deviceName);
      localStorage.setItem(SAVED_LINK_KEY, buildConnectionLink(config));

      lastEventSeqRef.current = 0;
      reconnectAttemptRef.current = 0;
      setFeed([]);
      setSessionId("");
      openSocket(config, false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function disconnect() {
    manualDisconnectRef.current = true;
    clearReconnectTimer();
    clearHeartbeat();

    const socket = socketRef.current;
    socketRef.current = null;

    if (socket?.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: "disconnect" }));
      } catch {
        // Best effort only.
      }
    }

    socket?.close();
    connectionConfigRef.current = null;
    setConnected(false);
    setSessionActive(false);
    setSessionId("");
    setStatus("Disconnected");
  }

  function sendComment(event: FormEvent) {
    event.preventDefault();

    const text = comment.trim();
    if (!text || !sessionActive) return;

    const commentId = crypto.randomUUID();
    pendingCommentsRef.current.set(commentId, text);
    appendFeed("Commenter", text, commentId, "pending");
    setComment("");

    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN && connected) {
      socket.send(
        JSON.stringify({
          type: "comment_send",
          comment_id: commentId,
          text,
        })
      );
    }
  }

  return (
    <main
      style={{
        maxWidth: 980,
        margin: "0 auto",
        padding: 24,
        fontFamily: "sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "start",
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ marginBottom: 6 }}>Twin Commenter</h1>
          <div>{status}</div>
          {sessionId ? (
            <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
              Session {sessionId.slice(0, 8)}
            </div>
          ) : null}
        </div>

        {sessionActive ? (
          <button onClick={disconnect}>Disconnect</button>
        ) : null}
      </header>

      {!sessionActive ? (
        <section style={{ display: "grid", gap: 10, marginTop: 20 }}>
          <label>
            Connection link
            <input
              value={connectionLink}
              onChange={(e) => setConnectionLink(e.target.value)}
              placeholder="Paste pluely-twin:// connection link"
              style={{ display: "block", width: "100%", marginTop: 5 }}
            />
          </label>

          <details>
            <summary>Manual connection</summary>
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="Host IP"
              />
              <input
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="Port"
              />
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Session token"
                autoComplete="off"
              />
            </div>
          </details>

          <label>
            Device name
            <input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="Device name"
              style={{ display: "block", width: "100%", marginTop: 5 }}
            />
          </label>

          <button onClick={connect}>Connect</button>
        </section>
      ) : (
        <>
          {!connected ? (
            <div
              style={{
                marginTop: 18,
                padding: 12,
                border: "1px solid #444",
                borderRadius: 8,
              }}
            >
              Reconnecting automatically. You can keep typing comments; they will
              be queued and delivered after the connection returns.
            </div>
          ) : null}

          <section style={{ marginTop: 20, minHeight: 360 }}>
            {feed.length === 0 ? (
              <div style={{ opacity: 0.6 }}>
                Waiting for transcript, assistant output, or comments…
              </div>
            ) : (
              feed.map((item) => (
                <article key={item.id} style={{ marginBottom: 14 }}>
                  <strong>{item.source}</strong>
                  {item.status === "pending" ? (
                    <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.6 }}>
                      sending…
                    </span>
                  ) : null}
                  <div style={{ whiteSpace: "pre-wrap", marginTop: 3 }}>
                    {item.text}
                  </div>
                </article>
              ))
            )}
          </section>

          <form onSubmit={sendComment} style={{ display: "grid", gap: 8 }}>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder={
                connected
                  ? "Send a comment to the host…"
                  : "Connection is recovering — comment will be queued…"
              }
            />
            <button type="submit" disabled={!comment.trim()}>
              {connected ? "Send comment" : "Queue comment"}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
