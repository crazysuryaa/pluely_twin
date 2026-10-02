import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type RemoteSession = {
  active: boolean;
  mode: "relay" | "lan";
};

type RelayStatus = {
  status: "connecting" | "connected" | "reconnecting";
  retry_in_seconds?: number;
};

type ScreenShareStatus = {
  status: "stopped" | "starting" | "streaming" | "reconnecting" | "error";
};

type ConnectionEvent = {
  connection_id: string;
};

export type RemoteSessionPresentation = {
  sessionLabel: string;
  screenLabel: string;
  commenterLabel: string;
  active: boolean;
};

export function describeRemoteSession(
  session: RemoteSession | null,
  relayStatus: RelayStatus | null,
  screenShareStatus: ScreenShareStatus,
  commenterCount: number
): RemoteSessionPresentation {
  let sessionLabel = "No Worldwide session";

  if (session?.mode === "lan") {
    sessionLabel = "LAN session active";
  } else if (session?.mode === "relay") {
    if (relayStatus?.status === "reconnecting") {
      sessionLabel = `Worldwide reconnecting${
        relayStatus.retry_in_seconds ? ` in ${relayStatus.retry_in_seconds}s` : ""
      }`;
    } else if (relayStatus?.status === "connecting") {
      sessionLabel = "Worldwide connecting";
    } else {
      sessionLabel = "Worldwide connected";
    }
  }

  const screenLabel =
    screenShareStatus.status === "streaming"
      ? "Screen live"
      : screenShareStatus.status === "reconnecting"
        ? "Screen reconnecting"
        : screenShareStatus.status === "starting"
          ? "Screen starting"
          : screenShareStatus.status === "error"
            ? "Screen error"
            : "Screen off";

  return {
    sessionLabel,
    screenLabel,
    commenterLabel:
      commenterCount === 0
        ? "No commenters"
        : `${commenterCount} commenter${commenterCount === 1 ? "" : "s"}`,
    active: Boolean(session?.active),
  };
}

export function useRemoteSessionStatus() {
  const [session, setSession] = useState<RemoteSession | null>(null);
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(null);
  const [screenShareStatus, setScreenShareStatus] = useState<ScreenShareStatus>({
    status: "stopped",
  });
  const [connectionIds, setConnectionIds] = useState<string[]>([]);

  useEffect(() => {
    void invoke<RemoteSession | null>("get_remote_commenter_status")
      .then(setSession)
      .catch(() => setSession(null));

    void invoke<boolean>("get_remote_screen_share_status")
      .then((active) =>
        setScreenShareStatus({ status: active ? "streaming" : "stopped" })
      )
      .catch(() => setScreenShareStatus({ status: "stopped" }));

    const subscriptions = [
      listen<RemoteSession | { active: false }>("remote-commenter-status", (event) => {
        setSession(event.payload.active ? (event.payload as RemoteSession) : null);
        if (!event.payload.active) {
          setRelayStatus(null);
          setConnectionIds([]);
        }
      }),
      listen<RelayStatus>("remote-commenter-relay-status", (event) => {
        setRelayStatus(event.payload);
      }),
      listen<ScreenShareStatus>("remote-screen-share-status", (event) => {
        setScreenShareStatus(event.payload);
      }),
      listen<ConnectionEvent>("remote-commenter-connected", (event) => {
        setConnectionIds((current) => [
          ...current.filter((id) => id !== event.payload.connection_id),
          event.payload.connection_id,
        ]);
      }),
      listen<ConnectionEvent>("remote-commenter-disconnected", (event) => {
        setConnectionIds((current) =>
          current.filter((id) => id !== event.payload.connection_id)
        );
      }),
    ];

    return () => {
      for (const subscription of subscriptions) {
        void subscription.then((unlisten) => unlisten());
      }
    };
  }, []);

  return useMemo(
    () =>
      describeRemoteSession(
        session,
        relayStatus,
        screenShareStatus,
        connectionIds.length
      ),
    [connectionIds.length, relayStatus, screenShareStatus, session]
  );
}
