mod protocol;
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
    outbound: Option<broadcast::Sender<SequencedHostEvent>>,
    history: Option<server::SharedEventHistory>,
    dedupe: Option<server::SharedCommentDedupe>,
    next_seq: u64,
    session: Option<RemoteSessionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSessionInfo {
    pub active: bool,
    pub session_id: String,
    pub token: String,
    pub host: String,
    pub port: u16,
    pub connection_url: String,
}

fn discover_lan_host() -> String {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

#[tauri::command]
pub async fn start_remote_commenter(
    app: AppHandle,
    state: State<'_, RemoteState>,
    port: Option<u16>,
) -> Result<RemoteSessionInfo, String> {
    let port = port.unwrap_or(8765);

    {
        let inner = state
            .inner
            .lock()
            .map_err(|_| "Remote state lock poisoned".to_string())?;

        if inner.task.is_some() {
            return Err("Remote commenter is already active".to_string());
        }
    }

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

    let (tx, _) = broadcast::channel::<SequencedHostEvent>(512);
    let history: server::SharedEventHistory =
        Arc::new(Mutex::new(VecDeque::with_capacity(EVENT_HISTORY_LIMIT)));
    let dedupe: server::SharedCommentDedupe =
        Arc::new(Mutex::new(server::CommentDedupe::default()));

    let info = RemoteSessionInfo {
        active: true,
        session_id: session_id.clone(),
        token: token.clone(),
        host,
        port,
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
            tracing::error!(%error, "Remote commenter server stopped");
        }
    });

    {
        let mut inner = state
            .inner
            .lock()
            .map_err(|_| "Remote state lock poisoned".to_string())?;

        inner.task = Some(task);
        inner.outbound = Some(tx);
        inner.history = Some(history);
        inner.dedupe = Some(dedupe);
        inner.next_seq = 0;
        inner.session = Some(info.clone());
    }

    let _ = app.emit("remote-commenter-status", &info);
    Ok(info)
}

#[tauri::command]
pub fn stop_remote_commenter(
    app: AppHandle,
    state: State<'_, RemoteState>,
) -> Result<(), String> {
    let mut inner = state
        .inner
        .lock()
        .map_err(|_| "Remote state lock poisoned".to_string())?;

    if let Some(task) = inner.task.take() {
        task.abort();
    }

    // Dropping the sender closes active connection receivers too.
    inner.outbound = None;
    inner.history = None;
    inner.dedupe = None;
    inner.next_seq = 0;
    inner.session = None;

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

    // Even with no active viewer the event remains in history for reconnect replay.
    let _ = tx.send(sequenced);

    Ok(())
}
