use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use getrandom::getrandom;
use rusqlite::Connection;
use russh::keys::PublicKey;
use sha2::{Digest, Sha256};

use crate::error::{CoreError, CoreResult};

const KEYRING_SERVICE: &str = "brisk-bastion";
const KEYRING_USER: &str = "master-key";
const MASTER_KEY_FILENAME: &str = "master.key";
const NONCE_LEN: usize = 12;
/// AES-GCM: nonce + at least one byte + 16-byte auth tag
const MIN_ENCRYPTED_LEN: usize = NONCE_LEN + 1 + 16;

pub struct CryptoVault;

impl CryptoVault {
    /// Loads or creates the master key. The key file next to the DB is the source of truth;
    /// Windows Credential Manager is used only for migration / backup.
    ///
    /// Returns `(key, credentials_reset_required)`. The second flag is true when a new key was
    /// created while the database already holds encrypted secrets (old key was lost).
    pub fn ensure_master_key(db_path: &Path) -> CoreResult<([u8; 32], bool)> {
        let key_path = master_key_path(db_path);

        if let Ok(key) = read_master_key_file(&key_path) {
            return Ok((key, false));
        }

        if let Ok(key) = read_master_key_keyring() {
            write_master_key_file(&key_path, &key)?;
            return Ok((key, false));
        }

        let reset_required = db_has_encrypted_secrets(db_path)?;
        if reset_required {
            log::warn!(
                "master encryption key missing but encrypted credentials exist — \
                 creating a new key; re-enter server passwords and re-import SSH keys"
            );
        }

        let key = generate_master_key()?;
        write_master_key_file(&key_path, &key)?;
        let _ = store_master_key_keyring(&key);
        Ok((key, reset_required))
    }

    pub fn encrypt(plaintext: &[u8], master_key: &[u8; 32]) -> CoreResult<Vec<u8>> {
        let cipher = Aes256Gcm::new_from_slice(master_key)
            .map_err(|e| CoreError::Crypto(e.to_string()))?;

        let mut nonce_bytes = [0u8; NONCE_LEN];
        getrandom(&mut nonce_bytes).map_err(|e| CoreError::Crypto(e.to_string()))?;
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| CoreError::Crypto(e.to_string()))?;

        let mut output = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        output.extend_from_slice(&nonce_bytes);
        output.extend_from_slice(&ciphertext);
        Ok(output)
    }

    pub fn decrypt(payload: &[u8], master_key: &[u8; 32]) -> CoreResult<Vec<u8>> {
        if payload.len() <= NONCE_LEN {
            return Err(CoreError::Crypto("ciphertext too short".into()));
        }

        let cipher = Aes256Gcm::new_from_slice(master_key)
            .map_err(|e| CoreError::Crypto(e.to_string()))?;

        let (nonce_bytes, ciphertext) = payload.split_at(NONCE_LEN);
        let nonce = Nonce::from_slice(nonce_bytes);

        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| CoreError::Crypto("aead decrypt failed".into()))
    }

    /// Decrypts a stored secret, accepting legacy plaintext blobs and re-encrypting later.
    pub fn decode_secret(
        payload: &[u8],
        master_key: &[u8; 32],
        kind: &str,
    ) -> CoreResult<(Vec<u8>, bool)> {
        if payload.starts_with(b"-----BEGIN") {
            return Ok((payload.to_vec(), true));
        }

        match Self::decrypt(payload, master_key) {
            Ok(bytes) => Ok((bytes, false)),
            Err(CoreError::Crypto(_)) if Self::looks_like_legacy_plaintext(payload) => {
                Ok((payload.to_vec(), true))
            }
            Err(_) => Err(CoreError::Crypto(format!(
                "stored {kind} cannot be decrypted — the app encryption key may have changed. \
                 Edit the server and re-enter the password, or delete and re-import the SSH key."
            ))),
        }
    }

    fn looks_like_legacy_plaintext(payload: &[u8]) -> bool {
        payload.len() < MIN_ENCRYPTED_LEN
            && std::str::from_utf8(payload)
                .map(|text| {
                    !text.is_empty()
                        && text.len() < 512
                        && text.chars().all(|c| !c.is_control())
                })
                .unwrap_or(false)
    }
}

fn master_key_path(db_path: &Path) -> std::path::PathBuf {
    db_path
        .parent()
        .map(|dir| dir.join(MASTER_KEY_FILENAME))
        .unwrap_or_else(|| Path::new(MASTER_KEY_FILENAME).to_path_buf())
}

fn generate_master_key() -> CoreResult<[u8; 32]> {
    let mut key = [0u8; 32];
    getrandom(&mut key).map_err(|e| CoreError::Crypto(e.to_string()))?;
    Ok(key)
}

fn read_master_key_file(path: &Path) -> CoreResult<[u8; 32]> {
    let data = std::fs::read(path).map_err(|e| CoreError::Crypto(e.to_string()))?;
    if data.len() != 32 {
        return Err(CoreError::Crypto("invalid master.key length".into()));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&data);
    Ok(key)
}

fn write_master_key_file(path: &Path, key: &[u8; 32]) -> CoreResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, key)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn read_master_key_keyring() -> CoreResult<[u8; 32]> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| CoreError::Keyring(e.to_string()))?;

    match entry.get_password() {
        Ok(existing) => decode_master_key_encoded(&existing),
        Err(keyring::Error::NoEntry) => Err(CoreError::Keyring("no entry".into())),
        Err(err) => Err(CoreError::Keyring(err.to_string())),
    }
}

fn store_master_key_keyring(key: &[u8; 32]) -> CoreResult<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| CoreError::Keyring(e.to_string()))?;
    entry
        .set_password(&encode_master_key(key))
        .map_err(|e| CoreError::Keyring(e.to_string()))
}

fn encode_master_key(key: &[u8; 32]) -> String {
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, key)
}

fn decode_master_key_encoded(encoded: &str) -> CoreResult<[u8; 32]> {
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
        .map_err(|e| CoreError::Crypto(e.to_string()))?;

    if bytes.len() != 32 {
        return Err(CoreError::Crypto("invalid master key length".into()));
    }

    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}

fn db_has_encrypted_secrets(db_path: &Path) -> CoreResult<bool> {
    let conn = Connection::open(db_path)?;
    let server_passwords: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM servers WHERE encrypted_password IS NOT NULL AND length(encrypted_password) > 0",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let ssh_keys: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ssh_keys WHERE length(encrypted_private_key) > 0",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    Ok(server_passwords > 0 || ssh_keys > 0)
}

pub fn fingerprint_public_key(public_key: &PublicKey) -> String {
    let encoded = public_key.to_openssh().unwrap_or_default();
    let digest = Sha256::digest(encoded.as_bytes());
    format!(
        "SHA256:{}",
        base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            digest
        )
        .trim_end_matches('=')
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db_path(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("bb-crypto-{name}-{nanos}.db"))
    }

    #[test]
    fn creates_and_reuses_master_key_file() {
        let db_path = temp_db_path("reuse");
        let (key1, reset1) = CryptoVault::ensure_master_key(&db_path).unwrap();
        let (key2, reset2) = CryptoVault::ensure_master_key(&db_path).unwrap();
        assert_eq!(key1, key2);
        assert!(!reset1);
        assert!(!reset2);
        let _ = std::fs::remove_file(master_key_path(&db_path));
        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn creates_recovery_key_when_secrets_exist_without_master_key() {
        let db_path = temp_db_path("guard");
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE servers (encrypted_password BLOB);
                 INSERT INTO servers (encrypted_password) VALUES (x'deadbeef');",
            )
            .unwrap();
        }

        let (key, reset_required) = CryptoVault::ensure_master_key(&db_path).unwrap();
        assert!(reset_required);
        assert_eq!(key.len(), 32);

        let _ = std::fs::remove_file(master_key_path(&db_path));
        let _ = std::fs::remove_file(&db_path);
    }
}
