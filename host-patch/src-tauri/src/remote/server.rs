use std::net::SocketAddr;

use futures_util::{SinkExt, StreamExt};
use tauri::{AppHandle, Emitter};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::{accept_async, tungstenite::Message};
use uuid::Uuid;

use super::protocol::{
    CommenterCommand, HostEvent, RemoteComment, ServerMessage, MAX_COMMENT_CHARS,
};

pub async fn run_server(
    app: AppHandle,
    bind_addr: SocketAddr,
    session_id: String,
    token: String,
    outbound: broadcast::Sender<HostEvent>,
) -> Result<(), String> {
    let listener = TcpListener::bind(bind_addr)
        .await
        .map_err(|e| format!("Failed to bind remote commenter listener: {e}"))?;

    loop {
        let (stream, peer) = listener
            .accept()
            .await
            .map_err(|e| format!("Failed to accept connection: {e}"))?;

        let app = app.clone();
        let session_id = session_id.clone();
        let token = token.clone();
        let outbound_rx = outbound.subscribe();

        tokio::spawn(async move {
            if let Err(error) =
                handle_connection(app, stream, peer, session_id, token, outbound_rx).await
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
    mut outbound_rx: broadcast::Receiver<HostEvent>,
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

    let device_name = match auth {
        CommenterCommand::Authenticate { token, device_name } if token == expected_token => {
            device_name
        }
        _ => {
            send_json(&mut sink, &ServerMessage::AuthenticationFailed).await?;
            return Err("Authentication failed".to_string());
        }
    };

    send_json(
        &mut sink,
        &ServerMessage::Authenticated {
            session_id: session_id.clone(),
        },
    )
    .await?;

    let _ = app.emit(
        "remote-commenter-connected",
        serde_json::json!({
            "peer": peer.to_string(),
            "device_name": device_name,
        }),
    );

    loop {
        tokio::select! {
            incoming = source.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
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
                            CommenterCommand::CommentSend { text } => {
                                let text = text.trim().to_string();

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

                                let comment_id = Uuid::new_v4().to_string();

                                let comment = RemoteComment {
                                    id: comment_id.clone(),
                                    source: "Commenter".to_string(),
                                    text,
                                    device_name: device_name.clone(),
                                };

                                app.emit("remote-comment", &comment)
                                    .map_err(|e| format!("Failed to emit comment: {e}"))?;

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
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(payload))) => {
                        sink.send(Message::Pong(payload))
                            .await
                            .map_err(|e| format!("Failed to send pong: {e}"))?;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => return Err(format!("WebSocket receive error: {e}")),
                }
            }

            outbound = outbound_rx.recv() => {
                match outbound {
                    Ok(event) => {
                        send_json(
                            &mut sink,
                            &ServerMessage::HostEvent { event },
                        ).await?;
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    let _ = app.emit(
        "remote-commenter-disconnected",
        serde_json::json!({
            "peer": peer.to_string(),
            "device_name": device_name,
        }),
    );

    Ok(())
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
