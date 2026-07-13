use std::path::Path;
use std::sync::Arc;

use russh::keys::{PrivateKey, PrivateKeyWithHashAlg, PublicKey};
use russh::client;
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use crate::db::{AuthType, Database, Server};
use crate::error::{CoreError, CoreResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferResult {
    pub files_transferred: usize,
    pub dirs_created: usize,
}

pub struct SftpBrowser {
    sftp: Arc<Mutex<SftpSession>>,
}

struct SftpClientHandler;

impl client::Handler for SftpClientHandler {
    type Error = CoreError;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

impl SftpBrowser {
    pub fn prepare_connection(
        db: &Database,
        server: &Server,
        password_override: Option<&str>,
    ) -> CoreResult<(Option<String>, Option<Vec<u8>>)> {
        let password = if server.auth_type == AuthType::Password {
            if let Some(password) = password_override.filter(|p| !p.is_empty()) {
                Some(password.to_string())
            } else {
                db.get_server_password(&server.id)?
            }
        } else {
            None
        };

        let private_key_pem = if server.auth_type == AuthType::Key {
            server
                .key_id
                .as_ref()
                .map(|key_id| db.get_key_private_pem(key_id))
                .transpose()?
        } else {
            None
        };

        Ok((password, private_key_pem))
    }

    pub async fn connect(
        server: &Server,
        password: Option<String>,
        private_key_pem: Option<Vec<u8>>,
    ) -> CoreResult<Self> {
        let config = Arc::new(client::Config::default());
        let mut handle = client::connect(
            config,
            (server.host.as_str(), server.port),
            SftpClientHandler,
        )
        .await?;

        match server.auth_type {
            AuthType::Password => {
                let password = password.ok_or_else(|| CoreError::Other("password required".into()))?;
                let auth = handle.authenticate_password(&server.username, &password).await?;
                if !auth.success() {
                    return Err(CoreError::AuthFailed);
                }
            }
            AuthType::Key => {
                let pem = private_key_pem.ok_or_else(|| CoreError::Other("key required".into()))?;
                let key_pair = PrivateKey::from_openssh(&pem)
                    .map_err(|e| CoreError::Other(e.to_string()))?;
                let auth = handle
                    .authenticate_publickey(
                        &server.username,
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
        channel.request_subsystem(true, "sftp").await?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| CoreError::Sftp(e.to_string()))?;

        Ok(Self {
            sftp: Arc::new(Mutex::new(sftp)),
        })
    }

    pub async fn list_dir(&self, path: &str) -> CoreResult<Vec<RemoteEntry>> {
        let sftp = self.sftp.lock().await;
        let mut read_dir = sftp
            .read_dir(path)
            .await
            .map_err(|e| CoreError::Sftp(e.to_string()))?;

        let mut entries = Vec::new();
        for entry in read_dir {
            let name = entry.file_name();
            let metadata = entry.metadata();
            let full_path = entry.path();
            entries.push(RemoteEntry {
                name,
                path: full_path,
                is_dir: metadata.is_dir(),
                size: metadata.size.unwrap_or(0),
                modified: metadata.mtime.map(i64::from),
            });
        }

        entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
        Ok(entries)
    }

    pub async fn download_file(&self, remote: &str, local: &Path) -> CoreResult<()> {
        let sftp = self.sftp.lock().await;
        let data = sftp
            .read(remote)
            .await
            .map_err(|e| CoreError::Sftp(e.to_string()))?;

        if let Some(parent) = local.parent() {
            std::fs::create_dir_all(parent)?;
        }

        tokio::fs::write(local, data).await?;
        Ok(())
    }

    pub async fn upload_file(&self, local: &Path, remote: &str) -> CoreResult<()> {
        let data = tokio::fs::read(local).await?;
        let sftp = self.sftp.lock().await;
        ensure_remote_parents(&sftp, remote).await?;
        let mut file = sftp
            .create(remote)
            .await
            .map_err(|e| CoreError::Sftp(e.to_string()))?;
        file.write_all(&data)
            .await
            .map_err(|e| CoreError::Sftp(e.to_string()))?;
        Ok(())
    }

    pub async fn download_dir(&self, remote: &str, local: &Path) -> CoreResult<TransferResult> {
        let mut result = TransferResult {
            files_transferred: 0,
            dirs_created: 0,
        };
        std::fs::create_dir_all(local)?;
        result.dirs_created += 1;

        let mut stack = vec![(remote.to_string(), local.to_path_buf())];
        while let Some((remote_dir, local_dir)) = stack.pop() {
            for entry in self.list_dir(&remote_dir).await? {
                if entry.name == "." || entry.name == ".." {
                    continue;
                }
                let local_path = local_dir.join(&entry.name);
                if entry.is_dir {
                    std::fs::create_dir_all(&local_path)?;
                    result.dirs_created += 1;
                    stack.push((entry.path, local_path));
                } else {
                    self.download_file(&entry.path, &local_path).await?;
                    result.files_transferred += 1;
                }
            }
        }

        Ok(result)
    }

    pub async fn upload_dir(&self, local: &Path, remote: &str) -> CoreResult<TransferResult> {
        let mut result = TransferResult {
            files_transferred: 0,
            dirs_created: 0,
        };
        self.ensure_dir_tree(remote).await?;
        result.dirs_created += 1;

        let mut stack = vec![(local.to_path_buf(), remote.to_string())];
        while let Some((local_dir, remote_dir)) = stack.pop() {
            for entry in std::fs::read_dir(&local_dir)? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_string();
                let remote_path = join_remote(&remote_dir, &name);
                let metadata = entry.metadata()?;
                if metadata.is_dir() {
                    self.ensure_dir_tree(&remote_path).await?;
                    result.dirs_created += 1;
                    stack.push((entry.path(), remote_path));
                } else {
                    self.upload_file(&entry.path(), &remote_path).await?;
                    result.files_transferred += 1;
                }
            }
        }

        Ok(result)
    }

    pub async fn ensure_dir_tree(&self, path: &str) -> CoreResult<()> {
        let sftp = self.sftp.lock().await;
        ensure_remote_dir_chain(&sftp, path).await
    }

    pub async fn ensure_dir(&self, path: &str) -> CoreResult<()> {
        self.ensure_dir_tree(path).await
    }
}

async fn ensure_remote_parents(
    sftp: &SftpSession,
    remote_path: &str,
) -> CoreResult<()> {
    let normalized = remote_path.replace('\\', "/");
    let Some(parent) = normalized.rsplit_once('/') else {
        return Ok(());
    };
    let parent = parent.0;
    if parent.is_empty() {
        return Ok(());
    }
    ensure_remote_dir_chain(sftp, parent).await
}

async fn ensure_remote_dir_chain(
    sftp: &SftpSession,
    remote_path: &str,
) -> CoreResult<()> {
    let normalized = remote_path.replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    if trimmed.is_empty() || trimmed == "/" {
        return Ok(());
    }

    let mut current = String::new();
    for segment in trimmed.split('/') {
        if segment.is_empty() {
            current = "/".to_string();
            continue;
        }
        if current.is_empty() {
            current = segment.to_string();
        } else if current.ends_with('/') {
            current.push_str(segment);
        } else {
            current.push('/');
            current.push_str(segment);
        }
        let _ = sftp.create_dir(&current).await;
    }
    Ok(())
}

fn join_remote(base: &str, name: &str) -> String {
    if base.ends_with('/') {
        format!("{base}{name}")
    } else {
        format!("{base}/{name}")
    }
}

pub async fn list_local_dir(path: &Path) -> CoreResult<Vec<RemoteEntry>> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        let name = entry.file_name().to_string_lossy().to_string();
        entries.push(RemoteEntry {
            name: name.clone(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified: metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64),
        });
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}

pub struct SftpConnectionPool {
    browsers: Mutex<std::collections::HashMap<String, Arc<SftpBrowser>>>,
}

impl SftpConnectionPool {
    pub fn new() -> Self {
        Self {
            browsers: Mutex::new(std::collections::HashMap::new()),
        }
    }

    pub async fn get_or_connect(
        &self,
        server_id: &str,
        server: &Server,
        password: Option<String>,
        private_key_pem: Option<Vec<u8>>,
    ) -> CoreResult<Arc<SftpBrowser>> {
        {
            let browsers = self.browsers.lock().await;
            if let Some(browser) = browsers.get(server_id) {
                return Ok(browser.clone());
            }
        }

        let browser = Arc::new(SftpBrowser::connect(server, password, private_key_pem).await?);

        let mut browsers = self.browsers.lock().await;
        Ok(browsers
            .entry(server_id.to_string())
            .or_insert(browser)
            .clone())
    }
}
