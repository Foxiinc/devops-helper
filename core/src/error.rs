use thiserror::Error;

pub type CoreResult<T> = Result<T, CoreError>;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("ssh error: {0}")]
    Ssh(#[from] russh::Error),

    #[error("sftp error: {0}")]
    Sftp(String),

    #[error("crypto error: {0}")]
    Crypto(String),

    #[error("keyring error: {0}")]
    Keyring(String),

    #[error("session not found: {0}")]
    SessionNotFound(String),

    #[error("server not found: {0}")]
    ServerNotFound(String),

    #[error("key not found: {0}")]
    KeyNotFound(String),

    #[error("scenario not found: {0}")]
    ScenarioNotFound(String),

    #[error("sync pair not found: {0}")]
    SyncPairNotFound(String),

    #[error("authentication failed")]
    AuthFailed,

    #[error("host key rejected")]
    HostKeyRejected,

    #[error("host key verification timed out")]
    HostKeyTimeout,

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("yaml error: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("{0}")]
    Other(String),
}

impl From<anyhow::Error> for CoreError {
    fn from(value: anyhow::Error) -> Self {
        CoreError::Other(value.to_string())
    }
}
