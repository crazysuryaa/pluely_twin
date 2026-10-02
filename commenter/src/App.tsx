import { FormEvent, useEffect, useRef, useState } from "react";

type FeedItem = {
  id: string;
  source: string;
  text: string;
  status?: "pending" | "sent";
};

type ConnectionConfig =
  | {
      mode: "relay";
      relayBaseUrl: string;
      sessionId: string;
      token: string;
      deviceName: string;
    }
  | {
      mode: "lan";
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
      connection_id?: string;
      latest_event_seq: number;
      host_connected?: boolean;
    }
  | { type: "authentication_failed" }
  | { type: "comment_accepted"; comment_id: string }
  | { type: "pong"; nonce?: string | null }
  | { type: "ping"; nonce?: string | null }
  | { type: "host_connected" }
  | { type: "host_disconnected" }
  | { type: "session_expired" }
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
  const [hostConnected, setHostConnected] = useState(true);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [status, setStatus] = useState("Disconnected");
  const [comment, setComment] = useState("");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [screenFrameUrl, setScreenFrameUrl] = useState<string | null>(null);
  const [screenStatus, setScreenStatus] = useState("Waiting for Host screen share");

  const socketRef = useRef<WebSocket | null>(null);
  const connectionConfigRef = useRef<ConnectionConfig | null>(null);
  const manualDisconnectRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const mediaSocketRef = useRef<WebSocket | null>(null);
  const mediaReconnectTimerRef = useRef<number | null>(null);
  const mediaReconnectAttemptRef = useRef(0);
  const screenFrameUrlRef = useRef<string | null>(null);
  const lastPongAtRef = useRef(Date.now());
  const lastEventSeqRef = useRef(0);
  const pendingCommentsRef = useRef<Map<string, string>>(new Map());
  const assistantDraftIdRef = useRef<string | null>(null);
  const clientConnectionIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    return () => {
      manualDisconnectRef.current = true;
      clearReconnectTimer();
      clearHeartbeat();
      clearMediaReconnectTimer();
      mediaSocketRef.current?.close();
      mediaSocketRef.current = null;
      clearScreenFrame();
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

  function clearMediaReconnectTimer() {
    if (mediaReconnectTimerRef.current !== null) {
      window.clearTimeout(mediaReconnectTimerRef.current);
      mediaReconnectTimerRef.current = null;
    }
  }

  function clearScreenFrame() {
    const current = screenFrameUrlRef.current;
    if (current) {
      URL.revokeObjectURL(current);
      screenFrameUrlRef.current = null;
    }
    setScreenFrameUrl(null);
  }

  function mediaWebSocketUrl(
    config: Extract<ConnectionConfig, { mode: "relay" }>
  ) {
    return `${relayWsBase(config.relayBaseUrl)}/api/v1/ws/${encodeURIComponent(config.sessionId)}/media/commenter`;
  }

  function scheduleMediaReconnect(
    config: Extract<ConnectionConfig, { mode: "relay" }>
  ) {
    if (manualDisconnectRef.current) return;

    clearMediaReconnectTimer();
    const attempt = mediaReconnectAttemptRef.current;
    const delay = Math.min(1_000 * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
    mediaReconnectAttemptRef.current = attempt + 1;
    setScreenStatus(
      `Screen stream reconnecting in ${Math.ceil(delay / 1000)}s`
    );

    mediaReconnectTimerRef.current = window.setTimeout(() => {
      if (!manualDisconnectRef.current) {
        startMediaSocket(config, true);
      }
    }, delay);
  }

  function startMediaSocket(
    config: Extract<ConnectionConfig, { mode: "relay" }>,
    reconnecting = false
  ) {
    clearMediaReconnectTimer();

    const existing = mediaSocketRef.current;
    if (
      existing &&
      (existing.readyState === WebSocket.OPEN ||
        existing.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const socket = new WebSocket(mediaWebSocketUrl(config));
    socket.binaryType = "arraybuffer";
    mediaSocketRef.current = socket;
    setScreenStatus(
      reconnecting ? "Reconnecting screen stream…" : "Connecting screen stream…"
    );

    socket.onopen = () => {
      if (mediaSocketRef.current !== socket) return;

      socket.send(
        JSON.stringify({
          type: "authenticate",
          token: config.token,
          device_name: config.deviceName || null,
          connection_id: `${clientConnectionIdRef.current}-media`,
          last_event_seq: 0,
        })
      );
    };

    socket.onmessage = (event) => {
      if (mediaSocketRef.current !== socket) return;

      if (typeof event.data === "string") {
        if (event.data === "ping") {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send("pong");
          }
          return;
        }

        if (event.data === "pong") {
          return;
        }

        try {
          const value = JSON.parse(event.data) as {
            type?: string;
            state?: string;
          };

          if (value.type === "authenticated") {
            mediaReconnectAttemptRef.current = 0;
            setScreenStatus("Waiting for Host screen share");
            return;
          }

          if (value.type === "screen_status") {
            if (value.state === "started") {
              setScreenStatus("Host is sharing screen");
            } else {
              clearScreenFrame();
              setScreenStatus("Screen share stopped");
            }
            return;
          }

          if (value.type === "authentication_failed") {
            setScreenStatus("Screen stream authentication failed");
            mediaSocketRef.current = null;
            socket.close();
          }
        } catch {
          // Ignore unknown text messages on the media channel.
        }
        return;
      }

      const bytes =
        event.data instanceof ArrayBuffer
          ? event.data
          : null;

      if (!bytes || bytes.byteLength === 0) return;

      const blob = new Blob([bytes], { type: "image/jpeg" });
      const nextUrl = URL.createObjectURL(blob);
      const previousUrl = screenFrameUrlRef.current;
      screenFrameUrlRef.current = nextUrl;
      setScreenFrameUrl(nextUrl);
      setScreenStatus("Live");

      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
    };

    socket.onerror = () => {
      if (mediaSocketRef.current !== socket) return;
      try {
        socket.close();
      } catch {
        scheduleMediaReconnect(config);
      }
    };

    socket.onclose = () => {
      if (mediaSocketRef.current !== socket) return;
      mediaSocketRef.current = null;

      if (manualDisconnectRef.current) return;
      scheduleMediaReconnect(config);
    };
  }

  function stopMediaSocket() {
    clearMediaReconnectTimer();
    const socket = mediaSocketRef.current;
    mediaSocketRef.current = null;
    try {
      socket?.close();
    } catch {
      // Best effort.
    }
    mediaReconnectAttemptRef.current = 0;
    clearScreenFrame();
    setScreenStatus("Waiting for Host screen share");
  }

  function appendFeed(
    source: string,
    text: string,
    id = crypto.randomUUID(),
    status?: FeedItem["status"]
  ) {
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

  function relayWsBase(relayBaseUrl: string) {
    if (relayBaseUrl.startsWith("https://")) {
      return relayBaseUrl.replace(/^https:/, "wss:");
    }
    if (relayBaseUrl.startsWith("http://")) {
      return relayBaseUrl.replace(/^http:/, "ws:");
    }
    throw new Error("Relay URL must start with http:// or https://");
  }

  function parseConnectionLink(value: string): ConnectionConfig {
    const url = new URL(value.trim());

    if (url.protocol !== "pluely-twin:") {
      throw new Error("Expected a pluely-twin:// connection link");
    }

    const parsedToken = url.searchParams.get("token")?.trim() || "";
    if (!parsedToken) {
      throw new Error("Connection link is missing its session token");
    }

    const relay = url.searchParams.get("relay")?.trim();
    const relaySession = url.searchParams.get("session")?.trim();

    if (relay && relaySession) {
      return {
        mode: "relay",
        relayBaseUrl: relay.replace(/\/$/, ""),
        sessionId: relaySession,
        token: parsedToken,
        deviceName: deviceName.trim() || "Twin Commenter",
      };
    }

    const parsedHost = url.searchParams.get("host")?.trim() || "";
    const parsedPort = url.searchParams.get("port")?.trim() || "8765";

    if (!parsedHost) {
      throw new Error("Connection link is missing relay/session or LAN host");
    }

    return {
      mode: "lan",
      host: parsedHost,
      port: parsedPort,
      token: parsedToken,
      deviceName: deviceName.trim() || "Twin Commenter",
    };
  }

  function buildLanConnectionLink(config: Extract<ConnectionConfig, { mode: "lan" }>) {
    return `pluely-twin://connect?host=${encodeURIComponent(config.host)}&port=${encodeURIComponent(config.port)}&token=${encodeURIComponent(config.token)}`;
  }

  function websocketUrl(config: ConnectionConfig) {
    if (config.mode === "relay") {
      return `${relayWsBase(config.relayBaseUrl)}/api/v1/ws/${encodeURIComponent(config.sessionId)}/commenter`;
    }

    return `ws://${formatWsHost(config.host)}:${config.port}`;
  }

  function scheduleReconnect() {
    if (manualDisconnectRef.current || !connectionConfigRef.current) return;

    clearReconnectTimer();

    const attempt = reconnectAttemptRef.current;
    const delay = Math.min(
      1_000 * 2 ** attempt,
      MAX_RECONNECT_DELAY_MS
    );
    reconnectAttemptRef.current = attempt + 1;

    setConnected(false);
    setStatus(
      `Connection interrupted · reconnecting in ${Math.ceil(delay / 1000)}s`
    );

    reconnectTimerRef.current = window.setTimeout(() => {
      const config = connectionConfigRef.current;
      if (config && !manualDisconnectRef.current) {
        openSocket(config, true);
      }
    }, delay);
  }

  function startHeartbeat(
    socket: WebSocket,
    config: ConnectionConfig
  ) {
    clearHeartbeat();

    lastPongAtRef.current = Date.now();

    heartbeatTimerRef.current = window.setInterval(() => {
      if (
        socketRef.current !== socket ||
        socket.readyState !== WebSocket.OPEN
      ) {
        return;
      }

      if (Date.now() - lastPongAtRef.current > 35_000) {
        socket.close();
        return;
      }

      try {
        if (config.mode === "relay") {
          // Cloudflare Durable Objects can auto-answer this exact frame
          // while hibernating, so the session stays cheap and responsive.
          socket.send("ping");
        } else {
          socket.send(
            JSON.stringify({
              type: "ping",
              nonce: String(Date.now()),
            })
          );
        }
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

    const socket = new WebSocket(websocketUrl(config));
    socketRef.current = socket;

    socket.onopen = () => {
      if (socketRef.current !== socket) return;

      socket.send(
        JSON.stringify({
          type: "authenticate",
          token: config.token,
          device_name: config.deviceName || null,
          connection_id: clientConnectionIdRef.current,
          last_event_seq: lastEventSeqRef.current,
        })
      );
    };

    socket.onmessage = (event) => {
      if (socketRef.current !== socket) return;

      lastPongAtRef.current = Date.now();

      if (event.data === "ping") {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send("pong");
        }
        return;
      }

      if (event.data === "pong") {
        return;
      }

      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        setStatus("Received an invalid relay message");
        return;
      }

      if (message.type === "authenticated") {
        reconnectAttemptRef.current = 0;
        setConnected(true);
        setHostConnected(message.host_connected ?? true);
        setSessionId(message.session_id);
        setStatus(
          message.host_connected === false
            ? "Connected to relay · waiting for Host"
            : "Connected"
        );
        startHeartbeat(socket, config);
        flushPendingComments(socket);
        if (config.mode === "relay") {
          startMediaSocket(config);
        }
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

      if (message.type === "ping") {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: "pong",
              nonce: message.nonce ?? null,
            })
          );
        }
        return;
      }

      if (message.type === "host_connected") {
        setHostConnected(true);
        setStatus("Connected");
        return;
      }

      if (message.type === "host_disconnected") {
        setHostConnected(false);
        setStatus("Connected to relay · Host reconnecting");
        return;
      }

      if (message.type === "session_expired") {
        manualDisconnectRef.current = true;
        setConnected(false);
        setSessionActive(false);
        setStatus("Session expired");
        stopMediaSocket();
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

        if (config.mode === "lan") {
          setHost(config.host);
          setPort(config.port);
          setToken(config.token);
        }
      } else {
        const lanConfig: Extract<ConnectionConfig, { mode: "lan" }> = {
          mode: "lan",
          host: host.trim(),
          port: port.trim() || "8765",
          token: token.trim(),
          deviceName: deviceName.trim() || "Twin Commenter",
        };

        if (!lanConfig.host || !lanConfig.token) {
          setStatus("Paste a connection link or enter LAN host and token");
          return;
        }

        config = lanConfig;
        const generatedLink = buildLanConnectionLink(lanConfig);
        setConnectionLink(generatedLink);
        localStorage.setItem(SAVED_LINK_KEY, generatedLink);
      }

      localStorage.setItem(DEVICE_NAME_KEY, config.deviceName);
      if (connectionLink.trim()) {
        localStorage.setItem(SAVED_LINK_KEY, connectionLink.trim());
      }

      lastEventSeqRef.current = 0;
      reconnectAttemptRef.current = 0;
      clientConnectionIdRef.current = crypto.randomUUID();
      setFeed([]);
      stopMediaSocket();
      setSessionId("");
      setHostConnected(true);
      openSocket(config, false);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  function disconnect() {
    manualDisconnectRef.current = true;
    clearReconnectTimer();
    clearHeartbeat();
    stopMediaSocket();

    const socket = socketRef.current;
    socketRef.current = null;

    if (socket?.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: "disconnect" }));
      } catch {
        // Best effort.
      }
    }

    socket?.close();
    connectionConfigRef.current = null;
    setConnected(false);
    setHostConnected(true);
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
        maxWidth: 1440,
        width: "100%",
        height: "100dvh",
        margin: "0 auto",
        padding: 12,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        overflow: sessionActive ? "hidden" : "auto",
        fontFamily: "sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "start",
          gap: 16,
          flex: "0 0 auto",
        }}
      >
        <div>
          <h1 style={{ margin: "0 0 3px", fontSize: 22, lineHeight: 1.1 }}>
            Twin Commenter
          </h1>
          <div style={{ fontSize: 13, lineHeight: 1.2 }}>{status}</div>
          {sessionId ? (
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              Session {sessionId.slice(0, 8)}
              {!hostConnected ? " · Host temporarily offline" : ""}
            </div>
          ) : null}
        </div>

        {sessionActive ? (
          <button onClick={disconnect}>Disconnect</button>
        ) : null}
      </header>

      {!sessionActive ? (
        <section
          style={{
            display: "grid",
            gap: 10,
            marginTop: 20,
          }}
        >
          <label>
            Connection link
            <input
              value={connectionLink}
              onChange={(e) => setConnectionLink(e.target.value)}
              placeholder="Paste the connection link from the Host"
              style={{
                display: "block",
                width: "100%",
                marginTop: 5,
              }}
            />
          </label>

          <details>
            <summary>LAN fallback</summary>
            <div
              style={{
                display: "grid",
                gap: 10,
                marginTop: 10,
              }}
            >
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
              style={{
                display: "block",
                width: "100%",
                marginTop: 5,
              }}
            />
          </label>

          <button onClick={connect}>Connect</button>
        </section>
      ) : (
        <div
          style={{
            display: "flex",
            flex: 1,
            minHeight: 0,
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.65fr) minmax(320px, 0.85fr)",
              gap: 16,
              marginTop: 10,
              flex: "0 1 84dvh",
              minHeight: 0,
            }}
          >
            <section
              style={{
                minWidth: 0,
                minHeight: 0,
                border: "1px solid #d8d8d8",
                borderRadius: 12,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                background: "#111",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 12px",
                  background: "#1b1b1b",
                  color: "#fff",
                  borderBottom: "1px solid #333",
                }}
              >
                <strong style={{ fontSize: 13 }}>Live Host Screen</strong>
                <span
                  style={{
                    fontSize: 11,
                    opacity: 0.7,
                  }}
                >
                  {screenStatus}
                </span>
              </div>

              <div
                id="host-screen-surface"
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: "grid",
                  placeItems: "center",
                  overflow: "hidden",
                  color: "#d4d4d4",
                  background:
                    "radial-gradient(circle at center, #202020 0%, #111 72%)",
                  textAlign: "center",
                }}
              >
                {screenFrameUrl ? (
                  <img
                    src={screenFrameUrl}
                    alt="Live Host screen"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      display: "block",
                      background: "#000",
                    }}
                  />
                ) : (
                  <div style={{ maxWidth: 360, padding: 24 }}>
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 700,
                        marginBottom: 8,
                      }}
                    >
                      {screenStatus}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        lineHeight: 1.5,
                        opacity: 0.72,
                      }}
                    >
                      When the Host starts screen sharing, the primary monitor
                      appears here automatically.
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section
              style={{
                minWidth: 0,
                minHeight: 0,
                border: "1px solid #d8d8d8",
                borderRadius: 12,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                background: "#fff",
              }}
            >
              <div
                style={{
                  padding: "10px 12px",
                  borderBottom: "1px solid #e6e6e6",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                Session Feed
              </div>

              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  padding: 14,
                }}
              >
                {feed.length === 0 ? (
                  <div style={{ opacity: 0.6 }}>
                    Waiting for transcript, assistant output, or comments…
                  </div>
                ) : (
                  feed.map((item) => (
                    <article
                      key={item.id}
                      style={{
                        marginBottom: 14,
                        paddingBottom: 12,
                        borderBottom: "1px solid #f0f0f0",
                      }}
                    >
                      <strong>{item.source}</strong>
                      {item.status === "pending" ? (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 11,
                            opacity: 0.6,
                          }}
                        >
                          sending…
                        </span>
                      ) : null}
                      <div
                        style={{
                          whiteSpace: "pre-wrap",
                          marginTop: 3,
                          lineHeight: 1.4,
                        }}
                      >
                        {item.text}
                      </div>
                    </article>
                  ))
                )}
              </div>

              <form
                onSubmit={sendComment}
                style={{
                  display: "grid",
                  gap: 8,
                  padding: 12,
                  borderTop: "1px solid #e6e6e6",
                  background: "#fafafa",
                }}
              >
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={2000}
                  rows={4}
                  placeholder={
                    connected
                      ? hostConnected
                        ? "Send a comment to the Host…"
                        : "Host is reconnecting — comment will remain queued…"
                      : "Connection is recovering — comment will be queued…"
                  }
                  style={{
                    width: "100%",
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  type="submit"
                  disabled={!comment.trim()}
                >
                  {connected && hostConnected
                    ? "Send comment"
                    : "Queue comment"}
                </button>
              </form>
            </section>
          </div>
        </div>
      )}
    </main>
  );
}
