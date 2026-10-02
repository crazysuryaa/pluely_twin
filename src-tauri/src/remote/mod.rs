mod protocol;
mod relay;
mod server;

use std::collections::VecDeque;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use uuid::Uuid;

pub use protocol::{HostEvent, RemoteComment, SequencedHostEvent};

const EVENT_HISTORY_LIMIT: usize = 5_000;
#[derive(Default)]
pub struct RemoteState {
    inner: Mutex<RemoteInner>,
}

#[derive(Default)]
struct RemoteInner {
    task: Option<JoinHandle<()>>,
    screen_task: Option<JoinHandle<()>>,
    outbound: Option<broadcast::Sender<SequencedHostEvent>>,
    history: Option<server::SharedEventHistory>,
    dedupe: Option<server::SharedCommentDedupe>,
    next_seq: u64,
    relay_close: Option<RelayCloseInfo>,
    relay_media: Option<RelayMediaInfo>,
    session: Option<RemoteSessionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSessionInfo {
    pub active: bool,
    pub mode: String,
    pub session_id: String,
    pub token: String,
    pub host: String,
    pub port: u16,
    pub relay_url: Option<String>,
    pub connection_url: String,
}

#[derive(Debug, Clone)]
struct RelayCloseInfo {
    relay_base_url: String,
    session_id: String,
    host_token: String,
}

#[derive(Debug, Clone)]
struct RelayMediaInfo {
    host_ws_url: String,
    host_token: String,
}

fn discover_lan_host() -> String {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

fn ensure_not_active(state: &State<'_, RemoteState>) -> Result<(), String> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| "Remote state lock poisoned".to_string())?;

    if inner.task.is_some() {
        return Err("Remote commenter is already active".to_string());
    }

    Ok(())
}

fn new_event_state() -> (
    broadcast::Sender<SequencedHostEvent>,
    server::SharedEventHistory,
) {
    let (tx, _) = broadcast::channel::<SequencedHostEvent>(512);
    let history: server::SharedEventHistory =
        Arc::new(Mutex::new(VecDeque::with_capacity(EVENT_HISTORY_LIMIT)));

    (tx, history)
}

#[tauri::command]
pub async fn start_remote_commenter(
    app: AppHandle,
    state: State<'_, RemoteState>,
    port: Option<u16>,
) -> Result<RemoteSessionInfo, String> {
    ensure_not_active(&state)?;

    let port = port.unwrap_or(8765);
    let session_id = Uuid::new_v4().to_string();
    let token = Uuid::new_v4().simple().to_string();
    let bind_addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port);

    // Bind before returning success. This catches port conflicts immediately.
    let listener = TcpListener::bind(bind_addr)
        .await
        .map_err(|e| format!("Failed to start remote commenter on port {port}: {e}"))?;

    let host = discover_lan_host();
    let connection_url = format!(
        "pluely-twin://connect?host={host}&port={port}&token={token}"
    );

    let (tx, history) = new_event_state();
    let dedupe: server::SharedCommentDedupe =
        Arc::new(Mutex::new(server::CommentDedupe::default()));

    let info = RemoteSessionInfo {
        active: true,
        mode: "lan".to_string(),
        session_id: session_id.clone(),
        token: token.clone(),
        host,
        port,
        relay_url: None,
        connection_url,
    };

    let app_for_task = app.clone();
    let tx_for_task = tx.clone();
    let history_for_task = history.clone();
    let dedupe_for_task = dedupe.clone();

    let task = tokio::spawn(async move {
        if let Err(error) = server::run_server(
            app_for_task,
            listener,
            session_id,
            token,
            tx_for_task,
            history_for_task,
            dedupe_for_task,
        )
        .await
        {
            tracing::error!(%error, "Remote commenter LAN server stopped");
        }
    });

    {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "Remote state lock poisoned".to_string())?;

        inner.task = Some(task);
        inner.screen_task = None;
        inner.outbound = Some(tx);
        inner.history = Some(history);
        inner.dedupe = Some(dedupe);
        inner.next_seq = 0;
        inner.relay_close = None;
        inner.relay_media = None;
        inner.session = Some(info.clone());
    }

    let _ = app.emit("remote-commenter-status", &info);
    Ok(info)
}

#[tauri::command]
pub async fn start_remote_commenter_relay(
    app: AppHandle,
    state: State<'_, RemoteState>,
    relay_base_url: String,
) -> Result<RemoteSessionInfo, String> {
    ensure_not_active(&state)?;

    let relay_base_url = relay_base_url.trim().trim_end_matches('/').to_string();
    if relay_base_url.is_empty() {
        return Err("Twin relay URL is required".to_string());
    }

    let relay_session = relay::create_relay_session(
        &relay_base_url,
        None,
    )
    .await?;

    let (tx, history) = new_event_state();

    let info = RemoteSessionInfo {
        active: true,
        mode: "relay".to_string(),
        session_id: relay_session.session_id.clone(),
        token: relay_session.commenter_token.clone(),
        host: relay_base_url.clone(),
        port: 0,
        relay_url: Some(relay_base_url.clone()),
        connection_url: relay_session.connection_url.clone(),
    };

    let app_for_task = app.clone();
    let relay_for_task = relay_session.clone();
    let history_for_task = history.clone();
    let outbound_rx = tx.subscribe();

    let task = tokio::spawn(async move {
        if let Err(error) = relay::run_host_relay(
            app_for_task,
            relay_for_task,
            outbound_rx,
            history_for_task,
        )
        .await
        {
            tracing::error!(%error, "Twin relay host client stopped");
        }
    });

    {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "Remote state lock poisoned".to_string())?;

        inner.task = Some(task);
        inner.screen_task = None;
        inner.outbound = Some(tx);
        inner.history = Some(history);
        inner.dedupe = None;
        inner.next_seq = 0;
        inner.relay_close = Some(RelayCloseInfo {
            relay_base_url: relay_base_url.clone(),
            session_id: relay_session.session_id.clone(),
            host_token: relay_session.host_token.clone(),
        });
        inner.relay_media = Some(RelayMediaInfo {
            host_ws_url: relay_session.host_ws_url.clone(),
            host_token: relay_session.host_token.clone(),
        });
        inner.session = Some(info.clone());
    }

    let _ = app.emit("remote-commenter-status", &info);
    Ok(info)
}

#[tauri::command]
pub async fn start_remote_screen_share(
    app: AppHandle,
    state: State<'_, RemoteState>,
) -> Result<(), String> {
    let media = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "Remote state lock poisoned".to_string())?;

        if let Some(existing) = inner.screen_task.as_ref() {
            if !existing.is_finished() {
                return Ok(());
            }
        }
        inner.screen_task = None;

        let session = inner
            .session
            .as_ref()
            .ok_or_else(|| "Start a remote commenter session first".to_string())?;

        if session.mode != "relay" {
            return Err(
                "Live screen streaming currently requires Worldwide relay mode."
                    .to_string(),
            );
        }

        inner
            .relay_media
            .clone()
            .ok_or_else(|| "Relay media session is not available".to_string())?
    };

    let app_for_task = app.clone();
    let task = tokio::spawn(async move {
        if let Err(error) = relay::run_host_screen_stream(
            app_for_task.clone(),
            media.host_ws_url,
            media.host_token,
        )
        .await
        {
            tracing::error!(%error, "Twin screen stream stopped");
            let _ = app_for_task.emit(
                "remote-screen-share-status",
                serde_json::json!({
                    "status": "error",
                    "error": error,
                }),
            );
        }
    });

    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Remote state lock poisoned".to_string())?;
    inner.screen_task = Some(task);

    Ok(())
}

#[tauri::command]
pub fn stop_remote_screen_share(
    app: AppHandle,
    state: State<'_, RemoteState>,
) -> Result<(), String> {
    let task = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "Remote state lock poisoned".to_string())?;
        inner.screen_task.take()
    };

    if let Some(task) = task {
        task.abort();
    }

    let _ = app.emit(
        "remote-screen-share-status",
        serde_json::json!({ "status": "stopped" }),
    );

    Ok(())
}

#[tauri::command]
pub fn get_remote_screen_share_status(
    state: State<'_, RemoteState>,
) -> Result<bool, String> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| "Remote state lock poisoned".to_string())?;

    Ok(inner
        .screen_task
        .as_ref()
        .map(|task| !task.is_finished())
        .unwrap_or(false))
}

#[tauri::command]
pub async fn stop_remote_commenter(
    app: AppHandle,
    state: State<'_, RemoteState>,
) -> Result<(), String> {
    let (task, screen_task, relay_close) = {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "Remote state lock poisoned".to_string())?;

        let task = inner.task.take();
        let screen_task = inner.screen_task.take();
        let relay_close = inner.relay_close.take();

        inner.outbound = None;
        inner.history = None;
        inner.dedupe = None;
        inner.next_seq = 0;
        inner.relay_media = None;
        inner.session = None;

        (task, screen_task, relay_close)
    };

    if let Some(task) = task {
        task.abort();
    }

    if let Some(screen_task) = screen_task {
        screen_task.abort();
    }

    let _ = app.emit(
        "remote-screen-share-status",
        serde_json::json!({ "status": "stopped" }),
    );

    if let Some(close) = relay_close {
        if let Err(error) = relay::close_relay_session(
            &close.relay_base_url,
            &close.session_id,
            &close.host_token,
        )
        .await
        {
            tracing::warn!(%error, "Failed to revoke Twin relay session");
        }
    }

    let _ = app.emit(
        "remote-commenter-status",
        serde_json::json!({ "active": false }),
    );

    Ok(())
}

#[tauri::command]
pub fn get_remote_commenter_status(
    state: State<'_, RemoteState>,
) -> Result<Option<RemoteSessionInfo>, String> {
    let inner = state
        .inner
        .lock()
        .map_err(|_| "Remote state lock poisoned".to_string())?;

    Ok(inner.session.clone())
}

#[tauri::command]
pub fn publish_host_event(
    state: State<'_, RemoteState>,
    event: HostEvent,
) -> Result<(), String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Remote state lock poisoned".to_string())?;

    let Some(tx) = inner.outbound.as_ref().cloned() else {
        return Ok(());
    };

    let Some(history) = inner.history.as_ref().cloned() else {
        return Ok(());
    };

    inner.next_seq = inner.next_seq.saturating_add(1);
    let sequenced = SequencedHostEvent {
        seq: inner.next_seq,
        event,
    };

    {
        let mut events = history
            .lock()
            .map_err(|_| "Remote event history lock poisoned".to_string())?;

        events.push_back(sequenced.clone());
        while events.len() > EVENT_HISTORY_LIMIT {
            events.pop_front();
        }
    }

    // The event stays in local history until the transport confirms delivery.
    let _ = tx.send(sequenced);

    Ok(())
}
