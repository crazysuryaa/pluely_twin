import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button, Input } from "@/components";
import { CheckIcon, CopyIcon, Globe2Icon, WifiIcon } from "lucide-react";

const RELAY_URL_KEY = "twin-relay-url";
const DEFAULT_RELAY_URL =
  import.meta.env.VITE_TWIN_RELAY_URL ||
  "https://pluely-twin-relay.karta-testing.workers.dev";

type SessionInfo = {
  active: boolean;
  mode: "relay" | "lan";
  session_id: string;
  token: string;
  host: string;
  port: number;
  relay_url?: string | null;
  connection_url: string;
};

type RemoteComment = {
  id: string;
  source: string;
  text: string;
  device_name?: string | null;
  timestamp?: number;
};

type ConnectionEvent = {
  connection_id: string;
  peer: string;
  device_name?: string | null;
};

type RelayStatus = {
  status: "connecting" | "connected" | "reconnecting";
  retry_in_seconds?: number;
  error?: string;
};

type ScreenShareStatus = {
  status: "stopped" | "starting" | "streaming" | "reconnecting" | "error";
  retry_in_seconds?: number;
  error?: string;
};

export const RemoteCommenter = () => {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [comments, setComments] = useState<RemoteComment[]>([]);
  const [connections, setConnections] = useState<ConnectionEvent[]>([]);
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(null);
  const [screenShareStatus, setScreenShareStatus] =
    useState<ScreenShareStatus>({ status: "stopped" });
  const [relayUrl, setRelayUrl] = useState(
    () => localStorage.getItem(RELAY_URL_KEY) || DEFAULT_RELAY_URL
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [starting, setStarting] = useState<"relay" | "lan" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<SessionInfo | null>("get_remote_commenter_status")
      .then(setSession)
      .catch(() => setSession(null));

    invoke<boolean>("get_remote_screen_share_status")
      .then((active) =>
        setScreenShareStatus({
          status: active ? "streaming" : "stopped",
        })
      )
      .catch(() => setScreenShareStatus({ status: "stopped" }));

    const stopComment = listen<RemoteComment>("remote-comment", (event) => {
      const commentWithTimestamp: RemoteComment = {
        ...event.payload,
        timestamp: event.payload.timestamp || Date.now(),
      };
      setComments((current) => [...current.slice(-99), commentWithTimestamp]);
    });

    const stopStatus = listen<SessionInfo | { active: false }>(
      "remote-commenter-status",
      (event) => {
        setSession(event.payload.active ? (event.payload as SessionInfo) : null);
        if (!event.payload.active) {
          setConnections([]);
          setRelayStatus(null);
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

    const stopRelay = listen<RelayStatus>(
      "remote-commenter-relay-status",
      (event) => setRelayStatus(event.payload)
    );

    const stopScreenShare = listen<ScreenShareStatus>(
      "remote-screen-share-status",
      (event) => {
        setScreenShareStatus(event.payload);
        if (event.payload.status === "error" && event.payload.error) {
          setError(event.payload.error);
        }
      }
    );

    return () => {
      void stopComment.then((fn) => fn());
      void stopStatus.then((fn) => fn());
      void stopConnected.then((fn) => fn());
      void stopDisconnected.then((fn) => fn());
      void stopRelay.then((fn) => fn());
      void stopScreenShare.then((fn) => fn());
    };
  }, []);

  const startRelay = async () => {
    setError(null);

    const normalizedRelayUrl = relayUrl.trim().replace(/\/$/, "");
    if (!normalizedRelayUrl) {
      setError("Enter the deployed Twin Relay URL first.");
      setShowAdvanced(true);
      return;
    }

    setStarting("relay");
    setConnections([]);
    setRelayStatus({ status: "connecting" });

    localStorage.setItem(RELAY_URL_KEY, normalizedRelayUrl);

    try {
      const next = await invoke<SessionInfo>(
        "start_remote_commenter_relay",
        {
          relayBaseUrl: normalizedRelayUrl,
        }
      );

      setSession(next);
    } catch (e) {
      setRelayStatus(null);
      setError(String(e));
    } finally {
      setStarting(null);
    }
  };

  const startScreenShare = async () => {
    setError(null);
    setScreenShareStatus({ status: "starting" });

    try {
      await invoke("start_remote_screen_share");
    } catch (e) {
      setScreenShareStatus({
        status: "error",
        error: String(e),
      });
      setError(String(e));
    }
  };

  const stopScreenShare = async () => {
    setError(null);

    try {
      await invoke("stop_remote_screen_share");
      setScreenShareStatus({ status: "stopped" });
    } catch (e) {
      setError(String(e));
    }
  };

  const startLan = async () => {
    setError(null);
    setStarting("lan");
    setConnections([]);
    setRelayStatus(null);

    try {
      const next = await invoke<SessionInfo>("start_remote_commenter", {
        port: 8765,
      });
      setSession(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(null);
    }
  };

  const stop = async () => {
    setError(null);
    try {
      await invoke("stop_remote_commenter");
      setSession(null);
      setConnections([]);
      setRelayStatus(null);
      setScreenShareStatus({ status: "stopped" });
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

  const connectionLabel = (() => {
    if (!session) return null;

    if (session.mode === "relay") {
      if (relayStatus?.status === "reconnecting") {
        return `Relay reconnecting${relayStatus.retry_in_seconds ? ` in ${relayStatus.retry_in_seconds}s` : ""}`;
      }

      if (relayStatus?.status === "connecting") {
        return "Connecting to relay";
      }

      return "Worldwide relay connected";
    }

    return `LAN · ${session.host}:${session.port}`;
  })();

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Twin Commenter</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Start a consent-based companion session with reconnect, replay and
            acknowledged comments.
          </p>
        </div>

        {session ? (
          <Button variant="destructive" size="sm" onClick={stop}>
            Stop
          </Button>
        ) : null}
      </div>

      {!session ? (
        <div className="space-y-3">
          <Button
            onClick={startRelay}
            disabled={starting !== null}
            className="w-full gap-2"
          >
            <Globe2Icon className="h-4 w-4" />
            {starting === "relay"
              ? "Creating worldwide session…"
              : "Start Worldwide Session"}
          </Button>

          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowAdvanced((value) => !value)}
          >
            {showAdvanced ? "Hide advanced settings" : "Advanced connection settings"}
          </button>

          {showAdvanced ? (
            <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-3">
              <label className="space-y-1 block">
                <span className="text-xs font-medium">Twin Relay URL override</span>
                <Input
                  value={relayUrl}
                  onChange={(event) => setRelayUrl(event.target.value)}
                  placeholder="https://your-relay.workers.dev"
                />
              </label>

              <div className="border-t border-border/50 pt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={startLan}
                  disabled={starting !== null}
                  className="gap-2"
                >
                  <WifiIcon className="h-3.5 w-3.5" />
                  {starting === "lan" ? "Starting LAN…" : "Use LAN instead"}
                </Button>
                <p className="text-[10px] text-muted-foreground mt-2">
                  LAN mode is a local fallback and requires both devices to be
                  reachable on the same network. Worldwide mode needs no user setup.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold">
                REMOTE COMMENTER ACTIVE
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {connectionLabel}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {connections.length > 0
                  ? `${connections.length} commenter${connections.length === 1 ? "" : "s"} connected`
                  : "Waiting for commenter"}
              </div>
              {session.mode === "relay" ? (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Screen share:{" "}
                  {screenShareStatus.status === "streaming"
                    ? "live"
                    : screenShareStatus.status === "reconnecting"
                      ? "reconnecting"
                      : screenShareStatus.status === "starting"
                        ? "starting"
                        : screenShareStatus.status === "error"
                          ? "error"
                          : "off"}
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {session.mode === "relay" ? (
                screenShareStatus.status === "streaming" ||
                screenShareStatus.status === "reconnecting" ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={stopScreenShare}
                  >
                    Stop Screen Share
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={startScreenShare}
                    disabled={screenShareStatus.status === "starting"}
                  >
                    {screenShareStatus.status === "starting"
                      ? "Starting Screen Share…"
                      : "Share Primary Screen"}
                  </Button>
                )
              ) : null}

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
          </div>

          <div className="text-[10px] text-muted-foreground break-all">
            <code>{session.connection_url}</code>
          </div>

          {connections.length > 0 ? (
            <div className="space-y-1 border-t border-border/50 pt-2">
              {connections.map((connection) => (
                <div
                  key={connection.connection_id}
                  className="text-[10px] text-muted-foreground"
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 mr-1.5" />
                  {connection.device_name || "Twin Commenter"}
                  {connection.peer ? ` · ${connection.peer}` : ""}
                </div>
              ))}
            </div>
          ) : null}

          {session.mode === "relay" ? (
            <p className="text-[10px] text-muted-foreground">
              The Host and Commenter both make outbound encrypted WSS
              connections to the relay. No inbound Host port is exposed.
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              This LAN link contains a temporary session token.
            </p>
          )}
        </div>
      )}

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
