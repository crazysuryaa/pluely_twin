mod protocol;
mod server;

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use uuid::Uuid;

pub use protocol::{HostEvent, RemoteComment};

#[derive(Default)]
pub struct RemoteState {
    inner: Mutex<RemoteInner>,
}

#[derive(Default)]
struct RemoteInner {
    task: Option<JoinHandle<()>>,
    outbound: Option<broadcast::Sender<HostEvent>>,
    session: Option<RemoteSessionInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSessionInfo {
    pub active: bool,
    pub session_id: String,
    pub token: String,
    pub port: u16,
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
    let (tx, _) = broadcast::channel::<HostEvent>(256);

    let info = RemoteSessionInfo {
        active: true,
        session_id: session_id.clone(),
        token: token.clone(),
        port,
    };

    let app_for_task = app.clone();
    let tx_for_task = tx.clone();

    let task = tokio::spawn(async move {
        if let Err(error) =
            server::run_server(app_for_task, bind_addr, session_id, token, tx_for_task).await
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

    inner.outbound = None;
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
    let inner = state
        .inner
        .lock()
        .map_err(|_| "Remote state lock poisoned".to_string())?;

    if let Some(tx) = inner.outbound.as_ref() {
        let _ = tx.send(event);
    }

    Ok(())
}
