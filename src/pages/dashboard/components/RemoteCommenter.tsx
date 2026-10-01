import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components";
import { CheckIcon, CopyIcon } from "lucide-react";

type SessionInfo = {
  active: boolean;
  session_id: string;
  token: string;
  host: string;
  port: number;
  connection_url: string;
};

type RemoteComment = {
  id: string;
  source: string;
  text: string;
  device_name?: string | null;
};

type ConnectionEvent = {
  connection_id: string;
  peer: string;
  device_name?: string | null;
};

export const RemoteCommenter = () => {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [comments, setComments] = useState<RemoteComment[]>([]);
  const [connections, setConnections] = useState<ConnectionEvent[]>([]);
  const [copied, setCopied] = useState(false);
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
        if (!event.payload.active) {
          setConnections([]);
        }
      }
    );

    const stopConnected = listen<ConnectionEvent>(
      "remote-commenter-connected",
      (event) => {
        setConnections((current) => [
          ...current.filter(
            (connection) =>
              connection.connection_id !== event.payload.connection_id
          ),
          event.payload,
        ]);
      }
    );

    const stopDisconnected = listen<ConnectionEvent>(
      "remote-commenter-disconnected",
      (event) => {
        setConnections((current) =>
          current.filter(
            (connection) =>
              connection.connection_id !== event.payload.connection_id
          )
        );
      }
    );

    return () => {
      void stopComment.then((fn) => fn());
      void stopStatus.then((fn) => fn());
      void stopConnected.then((fn) => fn());
      void stopDisconnected.then((fn) => fn());
    };
  }, []);

  const start = async () => {
    setError(null);
    setConnections([]);
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
      setConnections([]);
    } catch (e) {
      setError(String(e));
    }
  };

  const copyConnectionLink = async () => {
    if (!session) return;

    try {
      await navigator.clipboard.writeText(session.connection_url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      setError(`Failed to copy connection link: ${String(e)}`);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Twin Commenter</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Start a paired companion session with automatic reconnect and event replay.
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
        <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold">
                REMOTE COMMENTER ACTIVE
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {connections.length > 0
                  ? `${connections.length} commenter${connections.length === 1 ? "" : "s"} connected`
                  : "Waiting for commenter"}
              </div>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={copyConnectionLink}
              className="gap-1.5"
            >
              {copied ? (
                <CheckIcon className="h-3.5 w-3.5" />
              ) : (
                <CopyIcon className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy Connection Link"}
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            Host: <code>{session.host}:{session.port}</code>
          </div>

          <div className="text-[10px] text-muted-foreground break-all">
            <code>{session.connection_url}</code>
          </div>

          {connections.length > 0 && (
            <div className="space-y-1 border-t border-border/50 pt-2">
              {connections.map((connection) => (
                <div
                  key={connection.connection_id}
                  className="text-[10px] text-muted-foreground"
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 mr-1.5" />
                  {connection.device_name || "Twin Commenter"} · {connection.peer}
                </div>
              ))}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground">
            This link contains the temporary session token. Share it only with the intended commenter.
          </p>
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
