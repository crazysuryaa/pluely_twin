import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type SessionInfo = {
  active: boolean;
  session_id: string;
  token: string;
  port: number;
};

type RemoteComment = {
  id: string;
  source: string;
  text: string;
  device_name?: string | null;
};

export default function RemoteCommenterPanel() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [comments, setComments] = useState<RemoteComment[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<SessionInfo | null>("get_remote_commenter_status")
      .then(setSession)
      .catch(() => setSession(null));

    const stopComment = listen<RemoteComment>("remote-comment", (event) => {
      setComments((current) => [...current.slice(-99), event.payload]);
    });

    const stopStatus = listen<SessionInfo | { active: false }>(
      "remote-commenter-status",
      (event) => {
        setSession(event.payload.active ? (event.payload as SessionInfo) : null);
      }
    );

    return () => {
      void stopComment.then((fn) => fn());
      void stopStatus.then((fn) => fn());
    };
  }, []);

  async function start() {
    setError(null);
    try {
      const next = await invoke<SessionInfo>("start_remote_commenter", {
        port: 8765,
      });
      setSession(next);
    } catch (e) {
      setError(String(e));
    }
  }

  async function stop() {
    setError(null);
    try {
      await invoke("stop_remote_commenter");
      setSession(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section style={{ padding: 16 }}>
      <div style={{ border: "1px solid currentColor", borderRadius: 10, padding: 12 }}>
        <strong>
          {session ? "REMOTE COMMENTER ACTIVE" : "Remote Commenter inactive"}
        </strong>

        {session ? (
          <>
            <div>Port: {session.port}</div>
            <div>
              Session token: <code>{session.token}</code>
            </div>
            <button onClick={stop}>Stop Remote Commenter</button>
          </>
        ) : (
          <button onClick={start}>Start Remote Commenter</button>
        )}

        {error ? <div role="alert">{error}</div> : null}
      </div>

      <div style={{ marginTop: 16 }}>
        <strong>Comments</strong>
        {comments.length === 0 ? (
          <p>No comments yet.</p>
        ) : (
          comments.map((comment) => (
            <article key={comment.id} style={{ marginTop: 10 }}>
              <strong>Commenter</strong>
              {comment.device_name ? ` · ${comment.device_name}` : ""}
              <div>{comment.text}</div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
