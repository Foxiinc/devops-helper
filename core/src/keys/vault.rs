use std::fs;
use std::path::Path;

use russh::keys::{Algorithm, PrivateKey};
use ssh_key::LineEnding;

use crate::db::{Database, Server, StoredKey};
use crate::error::{CoreError, CoreResult};
use crate::session::SessionManager;

pub struct KeyVault;

impl KeyVault {
    pub fn generate_key(db: &Database, name: &str, comment: Option<&str>) -> CoreResult<StoredKey> {
        let private_key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)
            .map_err(|e| CoreError::Other(e.to_string()))?;
        let public_key = private_key.public_key().to_openssh().map_err(|e| {
            CoreError::Other(e.to_string())
        })?;
        let private_pem = private_key
            .to_openssh(LineEnding::default())
            .map_err(|e| CoreError::Other(e.to_string()))?;

        db.store_key(name, &public_key, private_pem.as_bytes(), comment)
    }

    pub fn import_from_path(db: &Database, path: impl AsRef<Path>, name: Option<&str>) -> CoreResult<StoredKey> {
        let path = path.as_ref();
        let private_pem = fs::read(path)?;
        let private_key = PrivateKey::from_openssh(&private_pem)
            .map_err(|e| CoreError::Other(e.to_string()))?;
        let public_key = private_key.public_key().to_openssh().map_err(|e| {
            CoreError::Other(e.to_string())
        })?;

        let key_name = name
            .map(str::to_string)
            .unwrap_or_else(|| path.file_stem().and_then(|s| s.to_str()).unwrap_or("imported").to_string());

        db.store_key(&key_name, &public_key, &private_pem, None)
    }

    pub fn import_from_ssh_dir(db: &Database) -> CoreResult<Vec<StoredKey>> {
        let ssh_dir = dirs::home_dir()
            .map(|h| h.join(".ssh"))
            .ok_or_else(|| CoreError::Other("home directory not found".into()))?;

        if !ssh_dir.exists() {
            return Ok(Vec::new());
        }

        let mut imported = Vec::new();
        for entry in fs::read_dir(&ssh_dir)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if file_name.ends_with(".pub") || file_name == "known_hosts" || file_name == "config" {
                continue;
            }

            if PrivateKey::from_openssh(&fs::read(&path)?).is_ok() {
                imported.push(Self::import_from_path(db, &path, None)?);
            }
        }

        Ok(imported)
    }

    pub async fn copy_id_to_server(
        sessions: &SessionManager,
        server: &Server,
        pubkey_line: &str,
        password: Option<String>,
        private_key_pem: Option<Vec<u8>>,
        known_fingerprint: Option<String>,
    ) -> CoreResult<String> {
        let command = format!(
            "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qxF '{pubkey_line}' ~/.ssh/authorized_keys || echo '{pubkey_line}' >> ~/.ssh/authorized_keys"
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
        if code != 0 {
            return Err(CoreError::Other(format!(
                "ssh-copy-id failed (exit {code}): {output}"
            )));
        }

        Ok(format!("Public key installed on {}", server.host))
    }
}
