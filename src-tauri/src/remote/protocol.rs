use serde::{Deserialize, Serialize};

pub const MAX_COMMENT_CHARS: usize = 2_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CommenterCommand {
    Authenticate {
        token: String,
        device_name: Option<String>,
        last_event_seq: Option<u64>,
    },
    CommentSend {
        comment_id: String,
        text: String,
    },
    Ping {
        nonce: Option<String>,
    },
    Disconnect,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HostEvent {
    HostStatus {
        remote_active: bool,
        session_id: String,
    },
    SpeakerPartial {
        speaker: String,
        text: String,
    },
    SpeakerFinal {
        speaker: String,
        text: String,
    },
    AssistantDelta {
        text: String,
    },
    AssistantComplete {
        text: String,
    },
    SessionState {
        state: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SequencedHostEvent {
    pub seq: u64,
    pub event: HostEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Authenticated {
        session_id: String,
        connection_id: String,
        latest_event_seq: u64,
    },
    AuthenticationFailed,
    HostEvent {
        seq: u64,
        event: HostEvent,
    },
    CommentAccepted {
        comment_id: String,
    },
    Pong {
        nonce: Option<String>,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteComment {
    pub id: String,
    pub source: String,
    pub text: String,
    pub device_name: Option<String>,
    #[serde(default = "default_timestamp")]
    pub timestamp: u64,
}

fn default_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
