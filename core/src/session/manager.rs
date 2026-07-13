use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use russh::keys::{PrivateKey, PrivateKeyWithHashAlg, PublicKey};
use russh::{client, ChannelMsg};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};
use uuid::Uuid;

use crate::crypto::fingerprint_public_key;
use crate::db::{AuthType, Database, Server};
use crate::error::{CoreError, CoreResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub password: Option<String>,
    pub private_key_pem: Option<Vec<u8>>,
    pub term: String,
    pub cols: u32,
    pub rows: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionSummary {
    pub id: String,
    pub server_id: Option<String>,
    pub host: String,
    pub username: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HostKeyPrompt {
    pub prompt_id: String,
    pub host: String,
    pub port: u16,
    pub fingerprint: String,
    pub key_type: String,
    pub public_key: String,
}

#[derive(Debug, Clone)]
pub enum SessionEvent {
    Output { session_id: String, data: Vec<u8> },
    Closed { session_id: String, exit_code: Option<u32> },
    HostKeyPrompt(HostKeyPrompt),
}

struct SessionClientHandler {
    host: String,
    port: u16,
    known_fingerprint: Option<String>,
    event_tx: mpsc::UnboundedSender<SessionEvent>,
    host_key_responses: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
}

impl client::Handler for SessionClientHandler {
    type Error = CoreError;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = fingerprint_public_key(server_public_key);

        if let Some(known) = &self.known_fingerprint {
            if known == &fingerprint {
                return Ok(true);
            }
            return Err(CoreError::Other(format!(
                "host key mismatch: expected {known}, got {fingerprint}"
            )));
        }

        let public_key = server_public_key
            .to_openssh()
            .map_err(|e| CoreError::Other(e.to_string()))?;
        let key_type = format!("{:?}", server_public_key.algorithm());

        let prompt_id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();

        {
            let mut responses = self.host_key_responses.lock().await;
            responses.insert(prompt_id.clone(), tx);
        }

        let prompt = HostKeyPrompt {
            prompt_id: prompt_id.clone(),
            host: self.host.clone(),
            port: self.port,
            fingerprint,
            key_type,
            public_key,
        };

        self.event_tx
            .send(SessionEvent::HostKeyPrompt(prompt))
            .map_err(|_| CoreError::Other("event channel closed".into()))?;

        match tokio::time::timeout(Duration::from_secs(120), rx).await {
            Ok(Ok(accepted)) => Ok(accepted),
            Ok(Err(_)) => Err(CoreError::HostKeyRejected),
            Err(_) => Err(CoreError::HostKeyTimeout),
        }
    }
}

struct ActiveSession {
    input_tx: mpsc::UnboundedSender<Vec<u8>>,
    resize_tx: mpsc::UnboundedSender<(u32, u32)>,
    handle: client::Handle<SessionClientHandler>,
    server_id: Option<String>,
    host: String,
    username: String,
}

pub struct SessionManager {
    sessions: Arc<RwLock<HashMap<String, ActiveSession>>>,
    host_key_responses: Arc<Mutex<HashMap<String, oneshot::Sender<bool>>>>,
    event_tx: mpsc::UnboundedSender<SessionEvent>,
}

impl SessionManager {
    pub fn new(event_tx: mpsc::UnboundedSender<SessionEvent>) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            host_key_responses: Arc::new(Mutex::new(HashMap::new())),
            event_tx,
        }
    }

    pub fn prepare_server_connection(
        db: &Database,
        server: &Server,
        cols: u32,
        rows: u32,
        password_override: Option<&str>,
    ) -> CoreResult<(SessionConfig, String, Option<String>)> {
        let password = Self::resolve_password(db, server, password_override)?;
        let private_key_pem = Self::resolve_private_key(db, server, None)?;

        let config = SessionConfig {
            host: server.host.clone(),
            port: server.port,
            username: server.username.clone(),
            auth_type: server.auth_type.clone(),
            password,
            private_key_pem,
            term: "xterm-256color".into(),
            cols,
            rows,
        };

        let known_fingerprint = db
            .get_known_host(&config.host, config.port)?
            .map(|h| h.fingerprint);

        Ok((config, server.id.clone(), known_fingerprint))
    }

    pub fn prepare_exec_credentials(
        db: &Database,
        server: &Server,
        password_override: Option<&str>,
    ) -> CoreResult<(Option<String>, Option<Vec<u8>>, Option<String>)> {
        let password = Self::resolve_password(db, server, password_override)?;
        let private_key_pem = Self::resolve_private_key(db, server, None)?;

        let known_fingerprint = db
            .get_known_host(&server.host, server.port)?
            .map(|h| h.fingerprint);

        Ok((password, private_key_pem, known_fingerprint))
    }

    fn resolve_password(
        db: &Database,
        server: &Server,
        password_override: Option<&str>,
    ) -> CoreResult<Option<String>> {
        if server.auth_type != AuthType::Password {
            return Ok(None);
        }
        if let Some(password) = password_override.filter(|p| !p.is_empty()) {
            return Ok(Some(password.to_string()));
        }
        db.get_server_password(&server.id)
    }

    fn resolve_private_key(
        db: &Database,
        server: &Server,
        pem_override: Option<Vec<u8>>,
    ) -> CoreResult<Option<Vec<u8>>> {
        if server.auth_type != AuthType::Key {
            return Ok(None);
        }
        if let Some(pem) = pem_override {
            return Ok(Some(pem));
        }
        server
            .key_id
            .as_ref()
            .map(|key_id| db.get_key_private_pem(key_id))
            .transpose()
    }

    pub async fn connect_with_server(
        &self,
        db: &Database,
        server: &Server,
        cols: u32,
        rows: u32,
    ) -> CoreResult<SessionSummary> {
        let (config, server_id, known_fingerprint) =
            Self::prepare_server_connection(db, server, cols, rows, None)?;
        self.connect(config, Some(server_id), known_fingerprint).await
    }

    pub async fn connect(
        &self,
        config: SessionConfig,
        server_id: Option<String>,
        known_fingerprint: Option<String>,
    ) -> CoreResult<SessionSummary> {
        let session_id = Uuid::new_v4().to_string();

        let handler = SessionClientHandler {
            host: config.host.clone(),
            port: config.port,
            known_fingerprint,
            event_tx: self.event_tx.clone(),
            host_key_responses: self.host_key_responses.clone(),
        };

        let ssh_config = Arc::new(client::Config {
            inactivity_timeout: Some(Duration::from_secs(300)),
            keepalive_interval: Some(Duration::from_secs(30)),
            ..Default::default()
        });

        let mut handle = client::connect(
            ssh_config,
            (config.host.as_str(), config.port),
            handler,
        )
        .await?;

        match config.auth_type {
            AuthType::Password => {
                let password = config
                    .password
                    .ok_or(CoreError::PasswordRequired)?;
                let auth = handle.authenticate_password(&config.username, &password).await?;
                if !auth.success() {
                    return Err(CoreError::AuthFailed);
                }
            }
            AuthType::Key => {
                let pem = config
                    .private_key_pem
                    .ok_or(CoreError::PrivateKeyRequired)?;
                let key_pair = PrivateKey::from_openssh(&pem)
                    .map_err(|e| CoreError::Other(e.to_string()))?;
                let auth = handle
                    .authenticate_publickey(
                        &config.username,
                        PrivateKeyWithHashAlg::new(
                            Arc::new(key_pair),
                            handle.best_supported_rsa_hash().await?.flatten(),
                        ),
                    )
                    .await?;
                if !auth.success() {
                    return Err(CoreError::AuthFailed);
                }
            }
        }

        let mut channel = handle.channel_open_session().await?;
        channel
            .request_pty(
                false,
                &config.term,
                config.cols,
                config.rows,
                0,
                0,
                &[],
            )
            .await?;
        channel.request_shell(true).await?;

        let (input_tx, mut input_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (resize_tx, mut resize_rx) = mpsc::unbounded_channel::<(u32, u32)>();

        let event_tx = self.event_tx.clone();
        let sid = session_id.clone();

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    Some(data) = input_rx.recv() => {
                        if channel.data(&data[..]).await.is_err() {
                            break;
                        }
                    }
                    Some((cols, rows)) = resize_rx.recv() => {
                        let _ = channel.window_change(cols, rows, 0, 0).await;
                    }
                    msg = channel.wait() => {
                        match msg {
                            Some(ChannelMsg::Data { data }) => {
                                let _ = event_tx.send(SessionEvent::Output {
                                    session_id: sid.clone(),
                                    data: data.to_vec(),
                                });
                            }
                            Some(ChannelMsg::ExitStatus { exit_status }) => {
                                let _ = event_tx.send(SessionEvent::Closed {
                                    session_id: sid.clone(),
                                    exit_code: Some(exit_status),
                                });
                                break;
                            }
                            Some(ChannelMsg::Eof) | None => {
                                let _ = event_tx.send(SessionEvent::Closed {
                                    session_id: sid.clone(),
                                    exit_code: None,
                                });
                                break;
                            }
                            _ => {}
                        }
                    }
                }
            }
        });

        let summary = SessionSummary {
            id: session_id.clone(),
            server_id: server_id.clone(),
            host: config.host.clone(),
            username: config.username.clone(),
        };

        self.sessions.write().await.insert(
            session_id,
            ActiveSession {
                input_tx,
                resize_tx,
                handle,
                server_id,
                host: config.host,
                username: config.username,
            },
        );

        Ok(summary)
    }

    pub async fn respond_host_key(&self, prompt_id: &str, accept: bool) -> CoreResult<()> {
        let sender = {
            let mut responses = self.host_key_responses.lock().await;
            responses.remove(prompt_id)
        };

        if let Some(tx) = sender {
            tx.send(accept)
                .map_err(|_| CoreError::Other("host key response failed".into()))?;
            Ok(())
        } else {
            Err(CoreError::Other("unknown host key prompt".into()))
        }
    }

    pub async fn send_input(&self, session_id: &str, data: &[u8]) -> CoreResult<()> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| CoreError::SessionNotFound(session_id.to_string()))?;
        session
            .input_tx
            .send(data.to_vec())
            .map_err(|_| CoreError::Other("session input channel closed".into()))?;
        Ok(())
    }

    pub async fn resize(&self, session_id: &str, cols: u32, rows: u32) -> CoreResult<()> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| CoreError::SessionNotFound(session_id.to_string()))?;
        session
            .resize_tx
            .send((cols, rows))
            .map_err(|_| CoreError::Other("session resize channel closed".into()))?;
        Ok(())
    }

    pub async fn close(&self, session_id: &str) -> CoreResult<()> {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.remove(session_id) {
            let _ = session
                .handle
                .disconnect(russh::Disconnect::ByApplication, "", "")
                .await;
        }
        Ok(())
    }

    pub async fn list_sessions(&self) -> Vec<SessionSummary> {
        let sessions = self.sessions.read().await;
        sessions
            .iter()
            .map(|(id, s)| SessionSummary {
                id: id.clone(),
                server_id: s.server_id.clone(),
                host: s.host.clone(),
                username: s.username.clone(),
            })
            .collect()
    }

    pub async fn exec_command(
        &self,
        server: &Server,
        command: &str,
        password: Option<String>,
        private_key_pem: Option<Vec<u8>>,
        known_fingerprint: Option<String>,
    ) -> CoreResult<(String, u32)> {
        let config = SessionConfig {
            host: server.host.clone(),
            port: server.port,
            username: server.username.clone(),
            auth_type: server.auth_type.clone(),
            password,
            private_key_pem,
            term: "dumb".into(),
            cols: 80,
            rows: 24,
        };

        let handler = SessionClientHandler {
            host: config.host.clone(),
            port: config.port,
            known_fingerprint,
            event_tx: self.event_tx.clone(),
            host_key_responses: self.host_key_responses.clone(),
        };

        let ssh_config = Arc::new(client::Config::default());
        let mut handle = client::connect(
            ssh_config,
            (config.host.as_str(), config.port),
            handler,
        )
        .await?;

        match config.auth_type {
            AuthType::Password => {
                let password = config.password.ok_or(CoreError::PasswordRequired)?;
                let auth = handle.authenticate_password(&config.username, &password).await?;
                if !auth.success() {
                    return Err(CoreError::AuthFailed);
                }
            }
            AuthType::Key => {
                let pem = config.private_key_pem.ok_or(CoreError::PrivateKeyRequired)?;
                let key_pair = PrivateKey::from_openssh(&pem)
                    .map_err(|e| CoreError::Other(e.to_string()))?;
                let auth = handle
                    .authenticate_publickey(
                        &config.username,
                        PrivateKeyWithHashAlg::new(
                            Arc::new(key_pair),
                            handle.best_supported_rsa_hash().await?.flatten(),
                        ),
                    )
                    .await?;
                if !auth.success() {
                    return Err(CoreError::AuthFailed);
                }
            }
        }

        let mut channel = handle.channel_open_session().await?;
        channel.exec(true, command).await?;

        let mut output = Vec::new();
        let mut exit_code = 0u32;

        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                    output.extend_from_slice(&data);
                }
                ChannelMsg::ExitStatus { exit_status } => {
                    exit_code = exit_status;
                    break;
                }
                ChannelMsg::Eof => {}
                _ => {}
            }
        }

        // Drain any trailing data after EOF before disconnect
        while let Ok(Some(msg)) =
            tokio::time::timeout(Duration::from_millis(100), channel.wait()).await
        {
            match msg {
                ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                    output.extend_from_slice(&data);
                }
                ChannelMsg::ExitStatus { exit_status } => {
                    exit_code = exit_status;
                    break;
                }
                _ => {}
            }
        }

        let _ = handle
            .disconnect(russh::Disconnect::ByApplication, "", "")
            .await;

        Ok((String::from_utf8_lossy(&output).to_string(), exit_code))
    }
}

pub type SessionHandle = SessionSummary;
