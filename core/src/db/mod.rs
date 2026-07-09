use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::crypto::CryptoVault;
use crate::error::{CoreError, CoreResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AuthType {
    Password,
    Key,
}

impl AuthType {
    fn as_str(&self) -> &'static str {
        match self {
            AuthType::Password => "password",
            AuthType::Key => "key",
        }
    }

    fn from_str(value: &str) -> CoreResult<Self> {
        match value {
            "password" => Ok(AuthType::Password),
            "key" => Ok(AuthType::Key),
            other => Err(CoreError::Other(format!("unknown auth type: {other}"))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerFolder {
    pub id: String,
    pub name: String,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Server {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInput {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub password: Option<String>,
    pub key_id: Option<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnownHost {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub fingerprint: String,
    pub public_key: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredKey {
    pub id: String,
    pub name: String,
    pub public_key: String,
    pub comment: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPairRecord {
    pub id: String,
    pub name: String,
    pub server_id: String,
    pub local_path: String,
    pub remote_path: String,
    pub direction: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioRecord {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub steps_yaml: String,
    pub is_preset: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustedBinary {
    pub id: String,
    pub sha256: String,
    pub label: String,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub struct Database {
    conn: Connection,
    master_key: [u8; 32],
}

impl Database {
    pub fn open(path: impl AsRef<std::path::Path>) -> CoreResult<Self> {
        let conn = Connection::open(path)?;
        let master_key = CryptoVault::ensure_master_key()?;
        let db = Self { conn, master_key };
        db.migrate()?;
        db.seed_presets()?;
        Ok(db)
    }

    fn migrate(&self) -> CoreResult<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS servers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL DEFAULT 22,
                username TEXT NOT NULL,
                auth_type TEXT NOT NULL,
                encrypted_password BLOB,
                key_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS known_hosts (
                id TEXT PRIMARY KEY,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                key_type TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                public_key TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(host, port)
            );

            CREATE TABLE IF NOT EXISTS ssh_keys (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                public_key TEXT NOT NULL,
                encrypted_private_key BLOB NOT NULL,
                comment TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sync_pairs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                server_id TEXT NOT NULL,
                local_path TEXT NOT NULL,
                remote_path TEXT NOT NULL,
                direction TEXT NOT NULL DEFAULT 'push',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS scenarios (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                steps_yaml TEXT NOT NULL,
                is_preset INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS server_folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS trusted_binaries (
                id TEXT PRIMARY KEY,
                sha256 TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                notes TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS osv_cache (
                cache_key TEXT PRIMARY KEY,
                response_json TEXT NOT NULL,
                fetched_at TEXT NOT NULL
            );
            ",
        )?;
        self.ensure_column("servers", "folder_id", "TEXT")?;
        self.repair_schema()?;
        Ok(())
    }

    fn repair_schema(&self) -> CoreResult<()> {
        // Drop stale folder references after folder deletes or partial migrations
        self.conn.execute(
            "UPDATE servers SET folder_id = NULL
             WHERE folder_id IS NOT NULL
               AND folder_id NOT IN (SELECT id FROM server_folders)",
            [],
        )?;
        Ok(())
    }

    fn ensure_column(&self, table: &str, column: &str, definition: &str) -> CoreResult<()> {
        let mut stmt = self.conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let cols = stmt.query_map([], |row| row.get::<_, String>(1))?;
        let exists = cols.filter_map(|r| r.ok()).any(|name| name == column);
        if !exists {
            self.conn.execute(
                &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
                [],
            )?;
        }
        Ok(())
    }

    fn seed_presets(&self) -> CoreResult<()> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM scenarios WHERE is_preset = 1", [], |row| {
                row.get(0)
            })?;

        if count > 0 {
            return Ok(());
        }

        for (name, description, script) in crate::scenarios::presets::default_presets() {
            self.create_scenario(&name, description.as_deref(), &script, true)?;
        }

        Ok(())
    }

    pub fn list_servers(&self) -> CoreResult<Vec<Server>> {
        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.name, s.host, s.port, s.username, s.auth_type, s.key_id, s.folder_id, s.created_at, s.updated_at
             FROM servers s
             LEFT JOIN server_folders f ON f.id = s.folder_id
             ORDER BY COALESCE(f.sort_order, 999999), COALESCE(f.name, ''), s.name",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(Server {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get(3)?,
                username: row.get(4)?,
                auth_type: AuthType::from_str(&row.get::<_, String>(5)?).unwrap(),
                key_id: row.get(6)?,
                folder_id: row.get(7)?,
                created_at: parse_dt(row.get(8)?),
                updated_at: parse_dt(row.get(9)?),
            })
        })?;

        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    pub fn list_server_folders(&self) -> CoreResult<Vec<ServerFolder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, sort_order, created_at FROM server_folders ORDER BY sort_order, name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ServerFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                created_at: parse_dt(row.get(3)?),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    pub fn create_server_folder(&self, name: &str) -> CoreResult<ServerFolder> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let sort_order: i32 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM server_folders",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        self.conn.execute(
            "INSERT INTO server_folders (id, name, sort_order, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, sort_order, now.to_rfc3339()],
        )?;

        Ok(ServerFolder {
            id,
            name: name.to_string(),
            sort_order,
            created_at: now,
        })
    }

    pub fn rename_server_folder(&self, id: &str, name: &str) -> CoreResult<ServerFolder> {
        self.conn.execute(
            "UPDATE server_folders SET name = ?2 WHERE id = ?1",
            params![id, name],
        )?;
        self.get_server_folder(id)
    }

    pub fn delete_server_folder(&self, id: &str) -> CoreResult<()> {
        self.conn.execute(
            "UPDATE servers SET folder_id = NULL WHERE folder_id = ?1",
            params![id],
        )?;
        self.conn
            .execute("DELETE FROM server_folders WHERE id = ?1", params![id])?;
        Ok(())
    }

    fn get_server_folder(&self, id: &str) -> CoreResult<ServerFolder> {
        self.conn
            .query_row(
                "SELECT id, name, sort_order, created_at FROM server_folders WHERE id = ?1",
                params![id],
                |row| {
                    Ok(ServerFolder {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        sort_order: row.get(2)?,
                        created_at: parse_dt(row.get(3)?),
                    })
                },
            )
            .map_err(|_| CoreError::Other(format!("folder not found: {id}")))
    }

    pub fn get_server(&self, id: &str) -> CoreResult<Server> {
        self.conn
            .query_row(
                "SELECT id, name, host, port, username, auth_type, key_id, folder_id, created_at, updated_at FROM servers WHERE id = ?1",
                params![id],
                |row| {
                    Ok(Server {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        host: row.get(2)?,
                        port: row.get(3)?,
                        username: row.get(4)?,
                        auth_type: AuthType::from_str(&row.get::<_, String>(5)?).unwrap(),
                        key_id: row.get(6)?,
                        folder_id: row.get(7)?,
                        created_at: parse_dt(row.get(8)?),
                        updated_at: parse_dt(row.get(9)?),
                    })
                },
            )
            .map_err(|_| CoreError::ServerNotFound(id.to_string()))
    }

    pub fn get_server_password(&self, id: &str) -> CoreResult<Option<String>> {
        let blob: Option<Vec<u8>> = self.conn.query_row(
            "SELECT encrypted_password FROM servers WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;

        match blob {
            Some(data) => {
                let (decrypted, needs_reencrypt) =
                    CryptoVault::decode_secret(&data, &self.master_key, "server password")?;
                if needs_reencrypt {
                    let encrypted = CryptoVault::encrypt(&decrypted, &self.master_key)?;
                    self.conn.execute(
                        "UPDATE servers SET encrypted_password = ?2 WHERE id = ?1",
                        params![id, encrypted],
                    )?;
                }
                Ok(Some(String::from_utf8(decrypted).map_err(|e| {
                    CoreError::Crypto(e.to_string())
                })?))
            }
            None => Ok(None),
        }
    }

    pub fn create_server(&self, input: &ServerInput) -> CoreResult<Server> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let encrypted_password = match (&input.auth_type, &input.password) {
            (AuthType::Password, Some(password)) => {
                Some(CryptoVault::encrypt(password.as_bytes(), &self.master_key)?)
            }
            _ => None,
        };

        self.conn.execute(
            "INSERT INTO servers (id, name, host, port, username, auth_type, encrypted_password, key_id, folder_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                id,
                input.name,
                input.host,
                input.port,
                input.username,
                input.auth_type.as_str(),
                encrypted_password,
                input.key_id,
                input.folder_id,
                now.to_rfc3339(),
                now.to_rfc3339(),
            ],
        )?;

        Ok(Server {
            id,
            name: input.name.clone(),
            host: input.host.clone(),
            port: input.port,
            username: input.username.clone(),
            auth_type: input.auth_type.clone(),
            key_id: input.key_id.clone(),
            folder_id: input.folder_id.clone(),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn update_server(&self, id: &str, input: &ServerInput) -> CoreResult<Server> {
        let _ = self.get_server(id)?;
        let now = Utc::now();
        let encrypted_password = match (&input.auth_type, &input.password) {
            (AuthType::Password, Some(password)) if !password.is_empty() => {
                Some(CryptoVault::encrypt(password.as_bytes(), &self.master_key)?)
            }
            (AuthType::Password, None) => self
                .conn
                .query_row(
                    "SELECT encrypted_password FROM servers WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .ok(),
            _ => None,
        };

        self.conn.execute(
            "UPDATE servers SET name = ?2, host = ?3, port = ?4, username = ?5, auth_type = ?6,
             encrypted_password = ?7, key_id = ?8, folder_id = ?9, updated_at = ?10 WHERE id = ?1",
            params![
                id,
                input.name,
                input.host,
                input.port,
                input.username,
                input.auth_type.as_str(),
                encrypted_password,
                input.key_id,
                input.folder_id,
                now.to_rfc3339(),
            ],
        )?;

        self.get_server(id)
    }

    pub fn delete_server(&self, id: &str) -> CoreResult<()> {
        self.conn
            .execute("DELETE FROM servers WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_known_host(&self, host: &str, port: u16) -> CoreResult<Option<KnownHost>> {
        let result = self.conn.query_row(
            "SELECT id, host, port, key_type, fingerprint, public_key, created_at FROM known_hosts WHERE host = ?1 AND port = ?2",
            params![host, port],
            |row| {
                Ok(KnownHost {
                    id: row.get(0)?,
                    host: row.get(1)?,
                    port: row.get(2)?,
                    key_type: row.get(3)?,
                    fingerprint: row.get(4)?,
                    public_key: row.get(5)?,
                    created_at: parse_dt(row.get(6)?),
                })
            },
        );

        match result {
            Ok(host) => Ok(Some(host)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(CoreError::from(err)),
        }
    }

    pub fn trust_known_host(
        &self,
        host: &str,
        port: u16,
        key_type: &str,
        fingerprint: &str,
        public_key: &str,
    ) -> CoreResult<KnownHost> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();

        self.conn.execute(
            "INSERT INTO known_hosts (id, host, port, key_type, fingerprint, public_key, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(host, port) DO UPDATE SET
                key_type = excluded.key_type,
                fingerprint = excluded.fingerprint,
                public_key = excluded.public_key",
            params![id, host, port, key_type, fingerprint, public_key, now.to_rfc3339()],
        )?;

        self.get_known_host(host, port)?
            .ok_or_else(|| CoreError::Other("failed to save known host".into()))
    }

    pub fn delete_known_host(&self, id: &str) -> CoreResult<()> {
        self.conn
            .execute("DELETE FROM known_hosts WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_known_hosts(&self) -> CoreResult<Vec<KnownHost>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, host, port, key_type, fingerprint, public_key, created_at FROM known_hosts ORDER BY host",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(KnownHost {
                id: row.get(0)?,
                host: row.get(1)?,
                port: row.get(2)?,
                key_type: row.get(3)?,
                fingerprint: row.get(4)?,
                public_key: row.get(5)?,
                created_at: parse_dt(row.get(6)?),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    pub fn store_key(
        &self,
        name: &str,
        public_key: &str,
        private_key_pem: &[u8],
        comment: Option<&str>,
    ) -> CoreResult<StoredKey> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let encrypted = CryptoVault::encrypt(private_key_pem, &self.master_key)?;

        self.conn.execute(
            "INSERT INTO ssh_keys (id, name, public_key, encrypted_private_key, comment, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, name, public_key, encrypted, comment, now.to_rfc3339()],
        )?;

        Ok(StoredKey {
            id,
            name: name.to_string(),
            public_key: public_key.to_string(),
            comment: comment.map(str::to_string),
            created_at: now,
        })
    }

    pub fn list_keys(&self) -> CoreResult<Vec<StoredKey>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, public_key, comment, created_at FROM ssh_keys ORDER BY name")?;
        let rows = stmt.query_map([], |row| {
            Ok(StoredKey {
                id: row.get(0)?,
                name: row.get(1)?,
                public_key: row.get(2)?,
                comment: row.get(3)?,
                created_at: parse_dt(row.get(4)?),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    pub fn get_key_private_pem(&self, id: &str) -> CoreResult<Vec<u8>> {
        let blob: Vec<u8> = self
            .conn
            .query_row(
                "SELECT encrypted_private_key FROM ssh_keys WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|_| CoreError::KeyNotFound(id.to_string()))?;

        let (bytes, needs_reencrypt) =
            CryptoVault::decode_secret(&blob, &self.master_key, "SSH private key")?;
        if needs_reencrypt {
            let encrypted = CryptoVault::encrypt(&bytes, &self.master_key)?;
            self.conn
                .execute(
                    "UPDATE ssh_keys SET encrypted_private_key = ?2 WHERE id = ?1",
                    params![id, encrypted],
                )?;
        }
        Ok(bytes)
    }

    pub fn delete_key(&self, id: &str) -> CoreResult<()> {
        self.conn
            .execute("DELETE FROM ssh_keys WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn create_sync_pair(
        &self,
        name: &str,
        server_id: &str,
        local_path: &str,
        remote_path: &str,
        direction: &str,
    ) -> CoreResult<SyncPairRecord> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        self.conn.execute(
            "INSERT INTO sync_pairs (id, name, server_id, local_path, remote_path, direction, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, name, server_id, local_path, remote_path, direction, now.to_rfc3339()],
        )?;

        Ok(SyncPairRecord {
            id,
            name: name.to_string(),
            server_id: server_id.to_string(),
            local_path: local_path.to_string(),
            remote_path: remote_path.to_string(),
            direction: direction.to_string(),
            created_at: now,
        })
    }

    pub fn list_sync_pairs(&self) -> CoreResult<Vec<SyncPairRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, server_id, local_path, remote_path, direction, created_at FROM sync_pairs ORDER BY name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SyncPairRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                server_id: row.get(2)?,
                local_path: row.get(3)?,
                remote_path: row.get(4)?,
                direction: row.get(5)?,
                created_at: parse_dt(row.get(6)?),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    pub fn get_sync_pair(&self, id: &str) -> CoreResult<SyncPairRecord> {
        self.conn
            .query_row(
                "SELECT id, name, server_id, local_path, remote_path, direction, created_at FROM sync_pairs WHERE id = ?1",
                params![id],
                |row| {
                    Ok(SyncPairRecord {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        server_id: row.get(2)?,
                        local_path: row.get(3)?,
                        remote_path: row.get(4)?,
                        direction: row.get(5)?,
                        created_at: parse_dt(row.get(6)?),
                    })
                },
            )
            .map_err(|_| CoreError::SyncPairNotFound(id.to_string()))
    }

    pub fn delete_sync_pair(&self, id: &str) -> CoreResult<()> {
        self.conn
            .execute("DELETE FROM sync_pairs WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn create_scenario(
        &self,
        name: &str,
        description: Option<&str>,
        steps_yaml: &str,
        is_preset: bool,
    ) -> CoreResult<ScenarioRecord> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        self.conn.execute(
            "INSERT INTO scenarios (id, name, description, steps_yaml, is_preset, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                name,
                description,
                steps_yaml,
                if is_preset { 1 } else { 0 },
                now.to_rfc3339()
            ],
        )?;

        Ok(ScenarioRecord {
            id,
            name: name.to_string(),
            description: description.map(str::to_string),
            steps_yaml: steps_yaml.to_string(),
            is_preset,
            created_at: now,
        })
    }

    pub fn list_scenarios(&self) -> CoreResult<Vec<ScenarioRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, description, steps_yaml, is_preset, created_at FROM scenarios ORDER BY is_preset DESC, name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ScenarioRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                steps_yaml: row.get(3)?,
                is_preset: row.get::<_, i64>(4)? != 0,
                created_at: parse_dt(row.get(5)?),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    pub fn get_scenario(&self, id: &str) -> CoreResult<ScenarioRecord> {
        self.conn
            .query_row(
                "SELECT id, name, description, steps_yaml, is_preset, created_at FROM scenarios WHERE id = ?1",
                params![id],
                |row| {
                    Ok(ScenarioRecord {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        description: row.get(2)?,
                        steps_yaml: row.get(3)?,
                        is_preset: row.get::<_, i64>(4)? != 0,
                        created_at: parse_dt(row.get(5)?),
                    })
                },
            )
            .map_err(|_| CoreError::ScenarioNotFound(id.to_string()))
    }

    pub fn delete_scenario(&self, id: &str) -> CoreResult<()> {
        self.conn
            .execute("DELETE FROM scenarios WHERE id = ?1 AND is_preset = 0", params![id])?;
        Ok(())
    }

    pub fn list_trusted_binaries(&self) -> CoreResult<Vec<TrustedBinary>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, sha256, label, notes, created_at FROM trusted_binaries ORDER BY label",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TrustedBinary {
                id: row.get(0)?,
                sha256: row.get(1)?,
                label: row.get(2)?,
                notes: row.get(3)?,
                created_at: parse_dt(row.get(4)?),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    pub fn find_trusted_binary(&self, sha256: &str) -> CoreResult<Option<TrustedBinary>> {
        let result = self.conn.query_row(
            "SELECT id, sha256, label, notes, created_at FROM trusted_binaries WHERE sha256 = ?1",
            params![sha256.to_lowercase()],
            |row| {
                Ok(TrustedBinary {
                    id: row.get(0)?,
                    sha256: row.get(1)?,
                    label: row.get(2)?,
                    notes: row.get(3)?,
                    created_at: parse_dt(row.get(4)?),
                })
            },
        );

        match result {
            Ok(record) => Ok(Some(record)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(CoreError::from(err)),
        }
    }

    pub fn create_trusted_binary(
        &self,
        sha256: &str,
        label: &str,
        notes: Option<&str>,
    ) -> CoreResult<TrustedBinary> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let hash = sha256.to_lowercase();

        self.conn.execute(
            "INSERT INTO trusted_binaries (id, sha256, label, notes, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, hash, label, notes, now.to_rfc3339()],
        )?;

        Ok(TrustedBinary {
            id,
            sha256: hash,
            label: label.to_string(),
            notes: notes.map(str::to_string),
            created_at: now,
        })
    }

    pub fn update_trusted_binary(
        &self,
        id: &str,
        label: &str,
        notes: Option<&str>,
    ) -> CoreResult<TrustedBinary> {
        self.conn.execute(
            "UPDATE trusted_binaries SET label = ?2, notes = ?3 WHERE id = ?1",
            params![id, label, notes],
        )?;

        self.conn
            .query_row(
                "SELECT id, sha256, label, notes, created_at FROM trusted_binaries WHERE id = ?1",
                params![id],
                |row| {
                    Ok(TrustedBinary {
                        id: row.get(0)?,
                        sha256: row.get(1)?,
                        label: row.get(2)?,
                        notes: row.get(3)?,
                        created_at: parse_dt(row.get(4)?),
                    })
                },
            )
            .map_err(|_| CoreError::Other(format!("trusted binary not found: {id}")))
    }

    pub fn delete_trusted_binary(&self, id: &str) -> CoreResult<()> {
        self.conn
            .execute("DELETE FROM trusted_binaries WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_osv_cache(&self, cache_key: &str) -> CoreResult<Option<(String, DateTime<Utc>)>> {
        let result = self.conn.query_row(
            "SELECT response_json, fetched_at FROM osv_cache WHERE cache_key = ?1",
            params![cache_key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    parse_dt(row.get::<_, String>(1)?),
                ))
            },
        );

        match result {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(CoreError::from(err)),
        }
    }

    pub fn set_osv_cache(&self, cache_key: &str, response_json: &str) -> CoreResult<()> {
        self.conn.execute(
            "INSERT INTO osv_cache (cache_key, response_json, fetched_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(cache_key) DO UPDATE SET response_json = ?2, fetched_at = ?3",
            params![cache_key, response_json, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn delete_osv_cache(&self, cache_key: &str) -> CoreResult<()> {
        self.conn
            .execute("DELETE FROM osv_cache WHERE cache_key = ?1", params![cache_key])?;
        Ok(())
    }
}

fn parse_dt(value: String) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(&value)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn migrates_legacy_db_without_folder_columns() {
        let dir = std::env::temp_dir().join(format!("bb-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.db");

        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE servers (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    host TEXT NOT NULL,
                    port INTEGER NOT NULL DEFAULT 22,
                    username TEXT NOT NULL,
                    auth_type TEXT NOT NULL,
                    encrypted_password BLOB,
                    key_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO servers (id, name, host, port, username, auth_type, created_at, updated_at)
                 VALUES ('s1', 'legacy', '127.0.0.1', 22, 'root', 'password', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
        }

        let db = Database::open(&path).unwrap();
        let servers = db.list_servers().unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "legacy");
        assert!(servers[0].folder_id.is_none());
        assert!(db.list_server_folders().unwrap().is_empty());

        let _ = fs::remove_dir_all(&dir);
    }
}
