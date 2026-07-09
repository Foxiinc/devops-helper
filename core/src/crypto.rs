use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use getrandom::getrandom;
use russh::keys::PublicKey;
use sha2::{Digest, Sha256};

use crate::error::{CoreError, CoreResult};

const KEYRING_SERVICE: &str = "brisk-bastion";
const KEYRING_USER: &str = "master-key";
const NONCE_LEN: usize = 12;
/// AES-GCM: nonce + at least one byte + 16-byte auth tag
const MIN_ENCRYPTED_LEN: usize = NONCE_LEN + 1 + 16;

pub struct CryptoVault;

impl CryptoVault {
    pub fn ensure_master_key() -> CoreResult<[u8; 32]> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .map_err(|e| CoreError::Keyring(e.to_string()))?;

        match entry.get_password() {
            Ok(existing) => decode_master_key(&existing),
            Err(keyring::Error::NoEntry) => {
                let mut key = [0u8; 32];
                getrandom(&mut key).map_err(|e| CoreError::Crypto(e.to_string()))?;
                let encoded = encode_master_key(&key);
                entry
                    .set_password(&encoded)
                    .map_err(|e| CoreError::Keyring(e.to_string()))?;
                Ok(key)
            }
            Err(err) => Err(CoreError::Keyring(err.to_string())),
        }
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

fn encode_master_key(key: &[u8; 32]) -> String {
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, key)
}

fn decode_master_key(encoded: &str) -> CoreResult<[u8; 32]> {
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
        .map_err(|e| CoreError::Crypto(e.to_string()))?;

    if bytes.len() != 32 {
        return Err(CoreError::Crypto("invalid master key length".into()));
    }

    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
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
