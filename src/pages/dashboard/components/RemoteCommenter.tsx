import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button, Input } from "@/components";
import { CheckIcon, CopyIcon, Globe2Icon, WifiIcon } from "lucide-react";
import { getItem, saveItem, removeItem } from "tauri-plugin-keychain";

const RELAY_URL_KEY = "twin-relay-url";
const RELAY_CREATE_KEY_KEYCHAIN = "pluely-twin-relay-create-key";
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

export const RemoteCommenter = () => {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [comments, setComments] = useState<RemoteComment[]>([]);
  const [connections, setConnections] = useState<ConnectionEvent[]>([]);
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(null);
  const [relayUrl, setRelayUrl] = useState(
    () => localStorage.getItem(RELAY_URL_KEY) || DEFAULT_RELAY_URL
  );
  const [relayCreateKey, setRelayCreateKey] = useState("");
  const [rememberRelayCreateKey, setRememberRelayCreateKey] = useState(true);
  const [keyLoaded, setKeyLoaded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [starting, setStarting] = useState<"relay" | "lan" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<SessionInfo | null>("get_remote_commenter_status")
      .then(setSession)
      .catch(() => setSession(null));

    getItem(RELAY_CREATE_KEY_KEYCHAIN)
      .then((savedKey) => {
        if (savedKey) {
          setRelayCreateKey(savedKey);
          setRememberRelayCreateKey(true);
        }
      })
      .catch(() => {
        // Keychain may be unavailable on some development environments.
      })
      .finally(() => setKeyLoaded(true));

    const stopComment = listen<RemoteComment>("remote-comment", (event) => {
      setComments((current) => [...current.slice(-99), event.payload]);
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

    return () => {
      void stopComment.then((fn) => fn());
      void stopStatus.then((fn) => fn());
      void stopConnected.then((fn) => fn());
      void stopDisconnected.then((fn) => fn());
      void stopRelay.then((fn) => fn());
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

    if (!keyLoaded) {
      setError("Secure relay settings are still loading. Try again in a moment.");
      return;
    }

    if (!relayCreateKey.trim()) {
      setError("Enter the relay create key once. It can be remembered securely after that.");
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
          createKey: relayCreateKey.trim(),
        }
      );

      if (rememberRelayCreateKey) {
        await saveItem(
          RELAY_CREATE_KEY_KEYCHAIN,
          relayCreateKey.trim()
        );
      } else {
        await removeItem(RELAY_CREATE_KEY_KEYCHAIN).catch(() => undefined);
      }

      setSession(next);
    } catch (e) {
      setRelayStatus(null);
      setError(String(e));
    } finally {
      setStarting(null);
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
            {showAdvanced ? "Hide connection settings" : "Connection settings"}
          </button>

          {showAdvanced ? (
            <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-3">
              <label className="space-y-1 block">
                <span className="text-xs font-medium">Twin Relay URL</span>
                <Input
                  value={relayUrl}
                  onChange={(event) => setRelayUrl(event.target.value)}
                  placeholder="https://your-relay.workers.dev"
                />
              </label>

              <label className="space-y-1 block">
                <span className="text-xs font-medium">
                  Relay create key
                </span>
                <Input
                  type="password"
                  value={relayCreateKey}
                  onChange={(event) =>
                    setRelayCreateKey(event.target.value)
                  }
                  placeholder="Enter once"
                />
              </label>

              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={rememberRelayCreateKey}
                  onChange={(event) =>
                    setRememberRelayCreateKey(event.target.checked)
                  }
                />
                Remember create key securely on this computer
              </label>

              <p className="text-[10px] text-muted-foreground">
                The relay URL is preconfigured. The create key is stored in the
                operating system keychain, not browser local storage.
              </p>

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
                  reachable on the same network.
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
