import { FormEvent, useRef, useState } from "react";

type FeedItem = {
  id: string;
  source: string;
  text: string;
};

export default function App() {
  const [host, setHost] = useState("192.168.1.10");
  const [port, setPort] = useState("8765");
  const [token, setToken] = useState("");
  const [deviceName, setDeviceName] = useState("Twin Commenter");
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Disconnected");
  const [comment, setComment] = useState("");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  function appendFeed(source: string, text: string) {
    const clean = text.trim();
    if (!clean) return;

    setFeed((current) => [
      ...current.slice(-199),
      { id: crypto.randomUUID(), source, text: clean },
    ]);
  }

  function connect() {
    socketRef.current?.close();

    const socket = new WebSocket(`ws://${host}:${port}`);
    socketRef.current = socket;
    setStatus("Connecting...");

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: "authenticate",
          token,
          device_name: deviceName || null,
        })
      );
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === "authenticated") {
        setConnected(true);
        setStatus("Connected");
        return;
      }

      if (message.type === "authentication_failed") {
        setStatus("Authentication failed");
        socket.close();
        return;
      }

      if (message.type === "error") {
        setStatus(message.message);
        return;
      }

      if (message.type === "host_event") {
        const hostEvent = message.event;

        if (hostEvent.type === "speaker_final") {
          appendFeed(hostEvent.speaker, hostEvent.text);
        } else if (hostEvent.type === "assistant_complete") {
          appendFeed("Assistant", hostEvent.text);
        } else if (hostEvent.type === "session_state") {
          appendFeed("Session", hostEvent.state);
        }
      }
    };

    socket.onclose = () => {
      setConnected(false);
      setStatus("Disconnected");
    };

    socket.onerror = () => setStatus("Connection error");
  }

  function sendComment(event: FormEvent) {
    event.preventDefault();

    const text = comment.trim();
    const socket = socketRef.current;

    if (!text || !socket || socket.readyState !== WebSocket.OPEN || !connected) {
      return;
    }

    socket.send(JSON.stringify({ type: "comment_send", text }));
    appendFeed("Commenter", text);
    setComment("");
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "sans-serif" }}>
      <h1>Twin Commenter</h1>
      <p>{status}</p>

      {!connected ? (
        <section style={{ display: "grid", gap: 10 }}>
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="Host IP" />
          <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="Port" />
          <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Session token" />
          <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="Device name" />
          <button onClick={connect}>Connect</button>
        </section>
      ) : (
        <>
          <section style={{ marginTop: 20 }}>
            {feed.map((item) => (
              <article key={item.id} style={{ marginBottom: 14 }}>
                <strong>{item.source}</strong>
                <div>{item.text}</div>
              </article>
            ))}
          </section>

          <form onSubmit={sendComment} style={{ display: "grid", gap: 8 }}>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Send a comment to the host..."
            />
            <button type="submit">Send comment</button>
          </form>
        </>
      )}
    </main>
  );
}
