use serde::{Deserialize, Serialize};

use crate::db::{Database, Server};
use crate::error::{CoreError, CoreResult};
use crate::session::SessionManager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessTrustInfo {
    pub pid: u32,
    pub sha256: String,
    pub trusted: bool,
    pub label: Option<String>,
    pub notes: Option<String>,
}

pub struct TrustService;

impl TrustService {
    pub async fn binary_sha256(
        sessions: &SessionManager,
        server: &Server,
        pid: u32,
        password: Option<String>,
        private_key_pem: Option<Vec<u8>>,
        known_fingerprint: Option<String>,
    ) -> CoreResult<String> {
        let command = format!(
            "exe=$(readlink -f /proc/{pid}/exe 2>/dev/null); \
             if [ -n \"$exe\" ] && [ -r \"$exe\" ]; then sha256sum \"$exe\" | awk '{{print $1}}'; fi"
        );

        let (output, code) = sessions
            .exec_command(
                server,
                &command,
                password,
                private_key_pem,
                known_fingerprint,
            )
            .await?;

        let hash = output.trim().to_lowercase();
        if code != 0 || hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(CoreError::Other(format!(
                "could not compute binary hash for PID {pid} (exit {code})"
            )));
        }

        Ok(hash)
    }

    pub async fn verify_process(
        sessions: &SessionManager,
        db: &Database,
        server: &Server,
        pid: u32,
    ) -> CoreResult<ProcessTrustInfo> {
        let (password, private_key_pem, known_fingerprint) =
            SessionManager::prepare_exec_credentials(db, server, None)?;
        let sha256 = Self::binary_sha256(
            sessions,
            server,
            pid,
            password,
            private_key_pem,
            known_fingerprint,
        )
        .await?;
        let trusted = db.find_trusted_binary(&sha256)?;

        Ok(ProcessTrustInfo {
            pid,
            sha256,
            trusted: trusted.is_some(),
            label: trusted.as_ref().map(|t| t.label.clone()),
            notes: trusted.and_then(|t| t.notes),
        })
    }
}
