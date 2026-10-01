import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components";

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

export const RemoteCommenter = () => {
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

  const start = async () => {
    setError(null);
    try {
      const next = await invoke<SessionInfo>("start_remote_commenter", {
        port: 8765,
      });
      setSession(next);
    } catch (e) {
      setError(String(e));
    }
  };

  const stop = async () => {
    setError(null);
    try {
      await invoke("stop_remote_commenter");
      setSession(null);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Twin Commenter</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Share session updates with a paired companion and receive text comments.
          </p>
        </div>

        {session ? (
          <Button variant="destructive" size="sm" onClick={stop}>
            Stop
          </Button>
        ) : (
          <Button size="sm" onClick={start}>
            Start
          </Button>
        )}
      </div>

      {session ? (
        <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1">
          <div className="text-xs font-semibold">REMOTE COMMENTER ACTIVE</div>
          <div className="text-xs text-muted-foreground">
            Port: {session.port}
          </div>
          <div className="text-xs text-muted-foreground break-all">
            Session token: <code>{session.token}</code>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="text-xs text-destructive">{error}</div>
      ) : null}

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Commenter feed
        </div>

        {comments.length === 0 ? (
          <div className="text-xs text-muted-foreground">No comments yet.</div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-auto">
            {comments.map((comment) => (
              <div
                key={comment.id}
                className="rounded-md border border-border/50 bg-muted/20 p-3"
              >
                <div className="text-xs font-semibold">
                  Commenter
                  {comment.device_name ? ` · ${comment.device_name}` : ""}
                </div>
                <div className="text-sm mt-1 whitespace-pre-wrap">
                  {comment.text}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
