use std::collections::{HashSet, VecDeque};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tauri::{AppHandle, Emitter};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio::time::{interval_at, Instant};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use uuid::Uuid;

use super::protocol::{
    CommenterCommand, HostEvent, RemoteComment, SequencedHostEvent, ServerMessage,
    MAX_COMMENT_CHARS,
};

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10);
const CONNECTION_TIMEOUT: Duration = Duration::from_secs(35);
const MAX_DEDUPED_COMMENTS: usize = 5_000;

pub type SharedEventHistory = Arc<Mutex<VecDeque<SequencedHostEvent>>>;
pub type SharedCommentDedupe = Arc<Mutex<CommentDedupe>>;

#[derive(Default)]
pub struct CommentDedupe {
    seen: HashSet<String>,
    order: VecDeque<String>,
}

impl CommentDedupe {
    fn remember(&mut self, id: &str) -> bool {
        if self.seen.contains(id) {
            return false;
        }

        self.seen.insert(id.to_string());
        self.order.push_back(id.to_string());

        while self.order.len() > MAX_DEDUPED_COMMENTS {
            if let Some(oldest) = self.order.pop_front() {
                self.seen.remove(&oldest);
            }
        }

        true
    }
}

pub async fn run_server(
    app: AppHandle,
    listener: TcpListener,
    session_id: String,
    token: String,
    outbound: broadcast::Sender<SequencedHostEvent>,
    history: SharedEventHistory,
    dedupe: SharedCommentDedupe,
) -> Result<(), String> {
    loop {
        let (stream, peer) = listener
            .accept()
            .await
            .map_err(|e| format!("Failed to accept connection: {e}"))?;

        let app = app.clone();
        let session_id = session_id.clone();
        let token = token.clone();
        let outbound_rx = outbound.subscribe();
        let history = history.clone();
        let dedupe = dedupe.clone();

        tokio::spawn(async move {
            if let Err(error) = handle_connection(
                app,
                stream,
                peer,
                session_id,
                token,
                outbound_rx,
                history,
                dedupe,
            )
            .await
            {
                tracing::warn!(peer = %peer, error = %error, "Remote commenter connection ended");
            }
        });
    }
}

async fn handle_connection(
    app: AppHandle,
    stream: TcpStream,
    peer: SocketAddr,
    session_id: String,
    expected_token: String,
    mut outbound_rx: broadcast::Receiver<SequencedHostEvent>,
    history: SharedEventHistory,
    dedupe: SharedCommentDedupe,
) -> Result<(), String> {
    let ws = accept_async(stream)
        .await
        .map_err(|e| format!("WebSocket handshake failed: {e}"))?;

    let (mut sink, mut source) = ws.split();

    let first = source
        .next()
        .await
        .ok_or_else(|| "Connection closed before authentication".to_string())?
        .map_err(|e| format!("Authentication frame failed: {e}"))?;

    let Message::Text(first_text) = first else {
        return Err("First frame must be text authentication".to_string());
    };

    let auth: CommenterCommand =
        serde_json::from_str(&first_text).map_err(|_| "Invalid auth payload".to_string())?;

    let (device_name, requested_last_seq) = match auth {
        CommenterCommand::Authenticate {
            token,
            device_name,
            last_event_seq,
        } if token == expected_token => (device_name, last_event_seq.unwrap_or(0)),
        _ => {
            send_json(&mut sink, &ServerMessage::AuthenticationFailed).await?;
            return Err("Authentication failed".to_string());
        }
    };

    let connection_id = Uuid::new_v4().to_string();
    let latest_event_seq = history
        .lock()
        .map_err(|_| "Remote event history lock poisoned".to_string())?
        .back()
        .map(|event| event.seq)
        .unwrap_or(0);

    send_json(
        &mut sink,
        &ServerMessage::Authenticated {
            session_id: session_id.clone(),
            connection_id: connection_id.clone(),
            latest_event_seq,
        },
    )
    .await?;

    let mut last_sent_seq = replay_history(
        &mut sink,
        &history,
        requested_last_seq,
    )
    .await?;

    let _ = app.emit(
        "remote-commenter-connected",
        serde_json::json!({
            "connection_id": connection_id,
            "peer": peer.to_string(),
            "device_name": device_name,
        }),
    );

    let mut last_seen = Instant::now();
    let mut heartbeat = interval_at(Instant::now() + HEARTBEAT_INTERVAL, HEARTBEAT_INTERVAL);

    loop {
        tokio::select! {
            incoming = source.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        last_seen = Instant::now();

                        let command: CommenterCommand = match serde_json::from_str(&text) {
                            Ok(command) => command,
                            Err(_) => {
                                send_json(
                                    &mut sink,
                                    &ServerMessage::Error {
                                        message: "Invalid command".to_string(),
                                    },
                                ).await?;
                                continue;
                            }
                        };

                        match command {
                            CommenterCommand::CommentSend { comment_id, text } => {
                                let text = text.trim().to_string();
                                let comment_id = comment_id.trim().to_string();

                                if comment_id.is_empty() || comment_id.len() > 128 {
                                    send_json(
                                        &mut sink,
                                        &ServerMessage::Error {
                                            message: "Invalid comment id".to_string(),
                                        },
                                    ).await?;
                                    continue;
                                }

                                if text.is_empty() {
                                    send_json(
                                        &mut sink,
                                        &ServerMessage::Error {
                                            message: "Comment cannot be empty".to_string(),
                                        },
                                    ).await?;
                                    continue;
                                }

                                if text.chars().count() > MAX_COMMENT_CHARS {
                                    send_json(
                                        &mut sink,
                                        &ServerMessage::Error {
                                            message: format!(
                                                "Comment limited to {MAX_COMMENT_CHARS} characters"
                                            ),
                                        },
                                    ).await?;
                                    continue;
                                }

                                let is_new = {
                                    let mut state = dedupe
                                        .lock()
                                        .map_err(|_| "Comment dedupe lock poisoned".to_string())?;
                                    state.remember(&comment_id)
                                };

                                if is_new {
                                    let comment = RemoteComment {
                                        id: comment_id.clone(),
                                        source: "Commenter".to_string(),
                                        text,
                                        device_name: device_name.clone(),
                                        timestamp: std::time::SystemTime::now()
                                            .duration_since(std::time::UNIX_EPOCH)
                                            .map(|d| d.as_millis() as u64)
                                            .unwrap_or(0),
                                    };

                                    app.emit("remote-comment", &comment)
                                        .map_err(|e| format!("Failed to emit comment: {e}"))?;
                                }

                                // A duplicate means the client retried after losing the ACK.
                                // ACK it again without emitting a second host comment.
                                send_json(
                                    &mut sink,
                                    &ServerMessage::CommentAccepted { comment_id },
                                ).await?;
                            }
                            CommenterCommand::Ping { nonce } => {
                                send_json(&mut sink, &ServerMessage::Pong { nonce }).await?;
                            }
                            CommenterCommand::Disconnect => break,
                            CommenterCommand::Authenticate { .. } => {
                                send_json(
                                    &mut sink,
                                    &ServerMessage::Error {
                                        message: "Already authenticated".to_string(),
                                    },
                                ).await?;
                            }
                        }
                    }
                    Some(Ok(Message::Pong(_))) => {
                        last_seen = Instant::now();
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        last_seen = Instant::now();
                        sink.send(Message::Pong(payload))
                            .await
                            .map_err(|e| format!("Failed to send pong: {e}"))?;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {
                        last_seen = Instant::now();
                    }
                    Some(Err(e)) => return Err(format!("WebSocket receive error: {e}")),
                }
            }

            outbound = outbound_rx.recv() => {
                match outbound {
                    Ok(sequenced) => {
                        if sequenced.seq > last_sent_seq {
                            send_host_event(&mut sink, &sequenced).await?;
                            last_sent_seq = sequenced.seq;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        last_sent_seq = replay_history(
                            &mut sink,
                            &history,
                            last_sent_seq,
                        ).await?;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }

            _ = heartbeat.tick() => {
                if last_seen.elapsed() > CONNECTION_TIMEOUT {
                    return Err("Connection heartbeat timed out".to_string());
                }

                sink.send(Message::Ping(Vec::new()))
                    .await
                    .map_err(|e| format!("Failed to send heartbeat: {e}"))?;
            }
        }
    }

    let _ = app.emit(
        "remote-commenter-disconnected",
        serde_json::json!({
            "connection_id": connection_id,
            "peer": peer.to_string(),
            "device_name": device_name,
        }),
    );

    Ok(())
}

async fn replay_history<S>(
    sink: &mut S,
    history: &SharedEventHistory,
    after_seq: u64,
) -> Result<u64, String>
where
    S: futures_util::Sink<Message> + Unpin,
    S::Error: std::fmt::Display,
{
    let replay = history
        .lock()
        .map_err(|_| "Remote event history lock poisoned".to_string())?
        .iter()
        .filter(|item| item.seq > after_seq)
        .cloned()
        .collect::<Vec<_>>();

    let mut last_seq = after_seq;
    for sequenced in replay {
        send_host_event(sink, &sequenced).await?;
        last_seq = sequenced.seq;
    }

    Ok(last_seq)
}

async fn send_host_event<S>(
    sink: &mut S,
    sequenced: &SequencedHostEvent,
) -> Result<(), String>
where
    S: futures_util::Sink<Message> + Unpin,
    S::Error: std::fmt::Display,
{
    send_json(
        sink,
        &ServerMessage::HostEvent {
            seq: sequenced.seq,
            event: sequenced.event.clone(),
        },
    )
    .await
}

async fn send_json<S>(sink: &mut S, message: &ServerMessage) -> Result<(), String>
where
    S: futures_util::Sink<Message> + Unpin,
    S::Error: std::fmt::Display,
{
    let json =
        serde_json::to_string(message).map_err(|e| format!("Encode error: {e}"))?;

    sink.send(Message::Text(json.into()))
        .await
        .map_err(|e| format!("WebSocket send failed: {e}"))
}
