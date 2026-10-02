use std::collections::{HashSet, VecDeque};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use image::codecs::jpeg::JpegEncoder;
use image::{ColorType, DynamicImage};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::broadcast;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use xcap::Monitor;

use super::protocol::{RemoteComment, SequencedHostEvent};
use super::server::SharedEventHistory;

const RECONNECT_MAX_SECONDS: u64 = 8;
const MAX_SEEN_COMMENTS: usize = 5_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayCreateResponse {
    pub session_id: String,
    pub host_token: String,
    pub commenter_token: String,
    pub host_ws_url: String,
    pub commenter_ws_url: String,
    pub connection_url: String,
    pub expires_in_seconds: u64,
}

pub async fn create_relay_session(
    relay_base_url: &str,
    create_key: Option<&str>,
) -> Result<RelayCreateResponse, String> {
    let url = format!("{}/api/v1/sessions", relay_base_url.trim_end_matches('/'));

    let client = Client::new();
    let mut request = client.post(url);

    if let Some(key) = create_key.filter(|value| !value.trim().is_empty()) {
        request = request.header("X-Relay-Create-Key", key);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Failed to reach Twin relay: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Twin relay session creation failed ({status}): {body}"
        ));
    }

    response
        .json::<RelayCreateResponse>()
        .await
        .map_err(|e| format!("Invalid Twin relay response: {e}"))
}

pub async fn close_relay_session(
    relay_base_url: &str,
    session_id: &str,
    host_token: &str,
) -> Result<(), String> {
    let url = format!(
        "{}/api/v1/sessions/{}/close",
        relay_base_url.trim_end_matches('/'),
        session_id
    );

    let response = Client::new()
        .post(url)
        .bearer_auth(host_token)
        .send()
        .await
        .map_err(|e| format!("Failed to revoke Twin relay session: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Twin relay session revoke failed ({status}): {body}"
        ));
    }

    Ok(())
}

pub async fn run_host_relay(
    app: AppHandle,
    relay_session: RelayCreateResponse,
    mut outbound_rx: broadcast::Receiver<SequencedHostEvent>,
    history: SharedEventHistory,
) -> Result<(), String> {
    let mut reconnect_attempt = 0u32;
    let mut last_acked_seq = 0u64;
    let mut seen_comments = HashSet::<String>::new();
    let mut seen_comment_order = VecDeque::<String>::new();

    loop {
        let _ = app.emit(
            "remote-commenter-relay-status",
            json!({
                "status": if reconnect_attempt == 0 { "connecting" } else { "reconnecting" },
                "session_id": relay_session.session_id,
            }),
        );

        let (ws_stream, _) = match connect_async(&relay_session.host_ws_url).await {
            Ok(value) => value,
            Err(error) => {
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                let seconds = reconnect_delay_seconds(reconnect_attempt);
                let _ = app.emit(
                    "remote-commenter-relay-status",
                    json!({
                        "status": "reconnecting",
                        "retry_in_seconds": seconds,
                        "error": error.to_string(),
                    }),
                );
                tokio::time::sleep(Duration::from_secs(seconds)).await;
                continue;
            }
        };

        let (mut sink, mut source) = ws_stream.split();

        send_json(
            &mut sink,
            &json!({
                "type": "authenticate",
                "token": relay_session.host_token,
            }),
        )
        .await?;

        let authenticated = source
            .next()
            .await
            .ok_or_else(|| "Relay closed before authentication".to_string())?
            .map_err(|e| format!("Relay authentication failed: {e}"))?;

        let Message::Text(auth_text) = authenticated else {
            return Err("Relay returned an invalid authentication frame".to_string());
        };

        let auth_value: Value = serde_json::from_str(&auth_text)
            .map_err(|e| format!("Invalid relay authentication response: {e}"))?;

        if auth_value.get("type").and_then(|item| item.as_str()) != Some("authenticated") {
            return Err(format!("Relay rejected Host authentication: {auth_value}"));
        }

        reconnect_attempt = 0;
        let _ = app.emit(
            "remote-commenter-relay-status",
            json!({
                "status": "connected",
                "session_id": relay_session.session_id,
            }),
        );

        replay_after(&mut sink, &history, last_acked_seq).await?;

        let mut heartbeat = tokio::time::interval(Duration::from_secs(10));
        let mut last_pong = Instant::now();

        let disconnected = loop {
            tokio::select! {
                incoming = source.next() => {
                    match incoming {
                        Some(Ok(Message::Text(text))) => {
                            if text.as_str() == "ping" {
                                if sink.send(Message::Text("pong".into())).await.is_err() {
                                    break true;
                                }
                                continue;
                            }

                            if text.as_str() == "pong" {
                                last_pong = Instant::now();
                                continue;
                            }

                            let value: Value = match serde_json::from_str(&text) {
                                Ok(value) => value,
                                Err(_) => continue,
                            };

                            match value.get("type").and_then(|item| item.as_str()) {
                                Some("ping") => {
                                    last_pong = Instant::now();
                                    if send_json(
                                        &mut sink,
                                        &json!({
                                            "type": "pong",
                                            "nonce": value.get("nonce"),
                                        }),
                                    ).await.is_err() {
                                        break true;
                                    }
                                }
                                Some("pong") => {
                                    last_pong = Instant::now();
                                }
                                Some("host_event_accepted") => {
                                    if let Some(seq) = value.get("seq").and_then(Value::as_u64) {
                                        last_acked_seq = last_acked_seq.max(seq);
                                    }
                                }
                                Some("comment") => {
                                    let comment_id = value
                                        .get("comment_id")
                                        .and_then(|item| item.as_str())
                                        .unwrap_or("")
                                        .to_string();

                                    if comment_id.is_empty() {
                                        continue;
                                    }

                                    let is_new = remember_comment(
                                        &mut seen_comments,
                                        &mut seen_comment_order,
                                        &comment_id,
                                    );

                                    if is_new {
                                        let comment = RemoteComment {
                                            id: comment_id.clone(),
                                            source: "Commenter".to_string(),
                                            text: value
                                                .get("text")
                                                .and_then(|item| item.as_str())
                                                .unwrap_or("")
                                                .to_string(),
                                            device_name: value
                                                .get("device_name")
                                                .and_then(|item| item.as_str())
                                                .map(ToString::to_string),
                                            timestamp: value
                                                .get("timestamp")
                                                .and_then(|item| item.as_u64())
                                                .unwrap_or_else(|| {
                                                    std::time::SystemTime::now()
                                                        .duration_since(std::time::UNIX_EPOCH)
                                                        .map(|d| d.as_millis() as u64)
                                                        .unwrap_or(0)
                                                }),
                                        };

                                        let _ = app.emit("remote-comment", &comment);
                                    }

                                    if send_json(
                                        &mut sink,
                                        &json!({
                                            "type": "comment_received",
                                            "comment_id": comment_id,
                                        }),
                                    ).await.is_err() {
                                        break true;
                                    }
                                }
                                Some("commenter_connected") => {
                                    let _ = app.emit(
                                        "remote-commenter-connected",
                                        json!({
                                            "connection_id": value.get("connection_id"),
                                            "peer": "relay",
                                            "device_name": value.get("device_name"),
                                        }),
                                    );
                                }
                                Some("commenter_disconnected") => {
                                    let _ = app.emit(
                                        "remote-commenter-disconnected",
                                        json!({
                                            "connection_id": value.get("connection_id"),
                                            "peer": "relay",
                                            "device_name": value.get("device_name"),
                                        }),
                                    );
                                }
                                Some("error") => {
                                    tracing::warn!(
                                        message = %value.get("message").and_then(|item| item.as_str()).unwrap_or("relay error"),
                                        "Twin relay reported an error"
                                    );
                                }
                                _ => {}
                            }
                        }
                        Some(Ok(Message::Ping(payload))) => {
                            last_pong = Instant::now();
                            if sink.send(Message::Pong(payload)).await.is_err() {
                                break true;
                            }
                        }
                        Some(Ok(Message::Pong(_))) => {
                            last_pong = Instant::now();
                        }
                        Some(Ok(Message::Close(_))) | None => break true,
                        Some(Ok(_)) => {
                            last_pong = Instant::now();
                        }
                        Some(Err(_)) => break true,
                    }
                }

                outbound = outbound_rx.recv() => {
                    match outbound {
                        Ok(event) => {
                            if event.seq <= last_acked_seq {
                                continue;
                            }

                            if send_host_event(&mut sink, &event).await.is_err() {
                                break true;
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => {
                            if replay_after(
                                &mut sink,
                                &history,
                                last_acked_seq,
                            ).await.is_err() {
                                break true;
                            }
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            return Ok(());
                        }
                    }
                }

                _ = heartbeat.tick() => {
                    if last_pong.elapsed() > Duration::from_secs(35) {
                        break true;
                    }

                    if sink
                        .send(Message::Text("ping".into()))
                        .await
                        .is_err()
                    {
                        break true;
                    }
                }
            }
        };

        if !disconnected {
            return Ok(());
        }

        reconnect_attempt = reconnect_attempt.saturating_add(1);
        let delay = reconnect_delay_seconds(reconnect_attempt);

        let _ = app.emit(
            "remote-commenter-relay-status",
            json!({
                "status": "reconnecting",
                "retry_in_seconds": delay,
            }),
        );

        tokio::time::sleep(Duration::from_secs(delay)).await;
    }
}

const SCREEN_FPS: u64 = 10;
const SCREEN_MAX_WIDTH: u32 = 1440;
const SCREEN_MAX_HEIGHT: u32 = 900;
const SCREEN_JPEG_QUALITY: u8 = 60;
const SCREEN_MAX_FRAME_BYTES: usize = 2_000_000;
// Resend an unchanged screen periodically so late-joining or reconnected
// viewers get a picture, and so dead sockets are noticed.
const SCREEN_KEYFRAME_INTERVAL: Duration = Duration::from_secs(2);
const SCREEN_SEND_TIMEOUT: Duration = Duration::from_secs(10);

pub async fn run_host_screen_stream(
    app: AppHandle,
    host_ws_url: String,
    host_token: String,
) -> Result<(), String> {
    let media_ws_url = host_ws_url
        .strip_suffix("/host")
        .map(|base| format!("{base}/media/host"))
        .ok_or_else(|| "Invalid Twin relay Host WebSocket URL".to_string())?;

    // Capture runs on its own thread and only publishes the latest frame, so a
    // slow network never queues stale frames and never stalls capture. The
    // thread exits once this task (and its receiver) is dropped.
    let (frame_tx, mut frame_rx) = tokio::sync::watch::channel(Vec::<u8>::new());
    let capture_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || run_screen_capture_loop(capture_app, frame_tx));

    let mut reconnect_attempt = 0u32;

    loop {
        let _ = app.emit(
            "remote-screen-share-status",
            json!({
                "status": if reconnect_attempt == 0 { "starting" } else { "reconnecting" },
                "fps": SCREEN_FPS,
            }),
        );

        let (ws_stream, _) = match connect_async(&media_ws_url).await {
            Ok(value) => value,
            Err(error) => {
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                let delay = reconnect_delay_seconds(reconnect_attempt);
                let _ = app.emit(
                    "remote-screen-share-status",
                    json!({
                        "status": "reconnecting",
                        "retry_in_seconds": delay,
                        "error": error.to_string(),
                    }),
                );
                tokio::time::sleep(Duration::from_secs(delay)).await;
                continue;
            }
        };

        let (mut sink, mut source) = ws_stream.split();

        send_json(
            &mut sink,
            &json!({
                "type": "authenticate",
                "token": host_token,
                "device_name": "Pluely Twin Host",
            }),
        )
        .await?;

        let authenticated = source
            .next()
            .await
            .ok_or_else(|| "Screen relay closed before authentication".to_string())?
            .map_err(|e| format!("Screen relay authentication failed: {e}"))?;

        let Message::Text(auth_text) = authenticated else {
            return Err("Screen relay returned an invalid authentication frame".to_string());
        };

        let auth_value: Value = serde_json::from_str(&auth_text)
            .map_err(|e| format!("Invalid screen relay authentication response: {e}"))?;

        if auth_value.get("type").and_then(|item| item.as_str()) != Some("authenticated") {
            return Err(format!(
                "Screen relay rejected Host authentication: {auth_value}"
            ));
        }

        reconnect_attempt = 0;
        let _ = app.emit(
            "remote-screen-share-status",
            json!({
                "status": "streaming",
                "fps": SCREEN_FPS,
            }),
        );

        // Send the latest frame right away after (re)connecting.
        frame_rx.mark_changed();

        let disconnected = loop {
            tokio::select! {
                incoming = source.next() => {
                    match incoming {
                        Some(Ok(Message::Text(text))) => {
                            if text.as_str() == "ping" {
                                if sink.send(Message::Text("pong".into())).await.is_err() {
                                    break true;
                                }
                            } else if text.as_str() != "pong" {
                                let value: Value = match serde_json::from_str(&text) {
                                    Ok(value) => value,
                                    Err(_) => continue,
                                };

                                if value.get("type").and_then(|item| item.as_str())
                                    == Some("authentication_failed")
                                {
                                    return Err(
                                        "Screen relay authentication failed".to_string()
                                    );
                                }
                            }
                        }
                        Some(Ok(Message::Ping(payload))) => {
                            if sink.send(Message::Pong(payload)).await.is_err() {
                                break true;
                            }
                        }
                        Some(Ok(Message::Close(_))) | None => break true,
                        Some(Ok(_)) => {}
                        Some(Err(_)) => break true,
                    }
                }

                changed = frame_rx.changed() => {
                    if changed.is_err() {
                        return Err("Screen capture stopped unexpectedly".to_string());
                    }

                    let frame = frame_rx.borrow_and_update().clone();
                    if frame.is_empty() {
                        continue;
                    }

                    // A stalled connection blocks here instead of erroring, so
                    // bound it and reconnect rather than freezing silently.
                    match tokio::time::timeout(
                        SCREEN_SEND_TIMEOUT,
                        sink.send(Message::Binary(frame.into())),
                    )
                    .await
                    {
                        Ok(Ok(())) => {}
                        _ => break true,
                    }
                }
            }
        };

        if !disconnected {
            return Ok(());
        }

        reconnect_attempt = reconnect_attempt.saturating_add(1);
        let delay = reconnect_delay_seconds(reconnect_attempt);
        let _ = app.emit(
            "remote-screen-share-status",
            json!({
                "status": "reconnecting",
                "retry_in_seconds": delay,
            }),
        );
        tokio::time::sleep(Duration::from_secs(delay)).await;
    }
}

fn run_screen_capture_loop(app: AppHandle, frame_tx: tokio::sync::watch::Sender<Vec<u8>>) {
    let frame_interval = Duration::from_millis(1000 / SCREEN_FPS);
    let mut monitor: Option<Monitor> = None;
    let mut previous_raw: Vec<u8> = Vec::new();
    let mut last_published: Option<Instant> = None;
    let mut failing = false;

    while !frame_tx.is_closed() {
        let started = Instant::now();

        let result = (|| -> Result<Option<Vec<u8>>, String> {
            if monitor.is_none() {
                monitor = Some(primary_monitor()?);
            }
            let image = monitor
                .as_ref()
                .expect("monitor was just set")
                .capture_image()
                .map_err(|e| format!("Failed to capture primary monitor: {e}"))?;

            let unchanged = image.as_raw().as_slice() == previous_raw.as_slice();
            let keyframe_due =
                last_published.map_or(true, |at| at.elapsed() >= SCREEN_KEYFRAME_INTERVAL);
            if unchanged && !keyframe_due {
                return Ok(None);
            }

            let encoded = encode_screen_frame(&image)?;
            previous_raw = image.into_raw();
            Ok(Some(encoded))
        })();

        match result {
            Ok(Some(frame)) => {
                if failing {
                    failing = false;
                    let _ = app.emit(
                        "remote-screen-share-status",
                        json!({ "status": "streaming", "fps": SCREEN_FPS }),
                    );
                }
                last_published = Some(Instant::now());
                if frame.len() > SCREEN_MAX_FRAME_BYTES {
                    tracing::warn!(bytes = frame.len(), "Skipping oversized Twin screen frame");
                } else {
                    frame_tx.send_replace(frame);
                }
            }
            Ok(None) => {}
            Err(error) => {
                // Display sleep, monitor changes, or a revoked permission:
                // report it, re-enumerate monitors, and keep retrying.
                monitor = None;
                if !failing {
                    failing = true;
                    tracing::warn!(%error, "Twin screen capture failed");
                    let _ = app.emit(
                        "remote-screen-share-status",
                        json!({ "status": "error", "error": error }),
                    );
                }
                std::thread::sleep(Duration::from_secs(1));
                continue;
            }
        }

        std::thread::sleep(frame_interval.saturating_sub(started.elapsed()));
    }
}

fn primary_monitor() -> Result<Monitor, String> {
    Monitor::all()
        .map_err(|e| format!("Failed to enumerate monitors: {e}"))?
        .into_iter()
        .find(|monitor| monitor.is_primary())
        .ok_or_else(|| "No primary monitor found".to_string())
}

fn encode_screen_frame(image: &image::RgbaImage) -> Result<Vec<u8>, String> {
    let rgb = if image.width() > SCREEN_MAX_WIDTH || image.height() > SCREEN_MAX_HEIGHT {
        // thumbnail() is a fast area-averaging downscale (~3x faster than
        // Triangle resize on Retina captures) and stays sharp for text.
        // imageops::thumbnail does not keep aspect ratio, so fit it here.
        let scale = f64::min(
            SCREEN_MAX_WIDTH as f64 / image.width() as f64,
            SCREEN_MAX_HEIGHT as f64 / image.height() as f64,
        );
        let width = ((image.width() as f64 * scale).round() as u32).max(1);
        let height = ((image.height() as f64 * scale).round() as u32).max(1);
        DynamicImage::ImageRgba8(image::imageops::thumbnail(image, width, height)).to_rgb8()
    } else {
        DynamicImage::ImageRgba8(image.clone()).to_rgb8()
    };

    let mut encoded = Vec::with_capacity(256 * 1024);
    JpegEncoder::new_with_quality(&mut encoded, SCREEN_JPEG_QUALITY)
        .encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            ColorType::Rgb8.into(),
        )
        .map_err(|e| format!("Failed to encode screen frame: {e}"))?;

    Ok(encoded)
}

fn reconnect_delay_seconds(attempt: u32) -> u64 {
    let power = attempt.saturating_sub(1).min(3);
    (1u64 << power).min(RECONNECT_MAX_SECONDS)
}

fn remember_comment(
    seen: &mut HashSet<String>,
    order: &mut VecDeque<String>,
    comment_id: &str,
) -> bool {
    if seen.contains(comment_id) {
        return false;
    }

    seen.insert(comment_id.to_string());
    order.push_back(comment_id.to_string());

    while order.len() > MAX_SEEN_COMMENTS {
        if let Some(old) = order.pop_front() {
            seen.remove(&old);
        }
    }

    true
}

async fn replay_after<S>(
    sink: &mut S,
    history: &SharedEventHistory,
    after_seq: u64,
) -> Result<(), String>
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

    for event in replay {
        send_host_event(sink, &event).await?;
    }

    Ok(())
}

async fn send_host_event<S>(sink: &mut S, event: &SequencedHostEvent) -> Result<(), String>
where
    S: futures_util::Sink<Message> + Unpin,
    S::Error: std::fmt::Display,
{
    send_json(
        sink,
        &json!({
            "type": "host_event",
            "seq": event.seq,
            "event": &event.event,
        }),
    )
    .await
}

async fn send_json<S>(sink: &mut S, value: &Value) -> Result<(), String>
where
    S: futures_util::Sink<Message> + Unpin,
    S::Error: std::fmt::Display,
{
    let encoded =
        serde_json::to_string(value).map_err(|e| format!("Relay JSON encode failed: {e}"))?;

    sink.send(Message::Text(encoded.into()))
        .await
        .map_err(|e| format!("Relay send failed: {e}"))
}
