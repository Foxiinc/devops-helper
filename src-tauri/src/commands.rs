use std::sync::Arc;

use brisk_bastion_core::db::{
    KnownHost, ScenarioRecord, Server, ServerFolder, ServerInput, StoredKey, SyncPairRecord,
};
use brisk_bastion_core::keys::KeyVault;
use brisk_bastion_core::scenarios::{Scenario, ScenarioRunResult, ScenarioRunner, StepResult};
use brisk_bastion_core::session::{SessionManager, SessionSummary};
use brisk_bastion_core::sftp::{list_local_dir as core_list_local_dir, RemoteEntry, SftpBrowser};
use brisk_bastion_core::sync::{SyncEngine, SyncPreview, SyncProgress};
use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::state::AppState;

type SharedState<'a> = State<'a, Arc<AppState>>;

fn db_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn audit(
    state: &Arc<AppState>,
    action: &str,
    detail: impl AsRef<str>,
    server_id: Option<&str>,
) {
    state.audit.record(action, detail, server_id);
}

#[tauri::command]
pub fn log_action(
    state: SharedState<'_>,
    action: String,
    detail: Option<String>,
    server_id: Option<String>,
) -> Result<(), String> {
    audit(
        state.inner(),
        &action,
        detail.unwrap_or_default(),
        server_id.as_deref(),
    );
    Ok(())
}

#[tauri::command]
pub fn get_activity_log_path(state: SharedState<'_>) -> Result<String, String> {
    Ok(state
        .audit
        .path()
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
pub fn read_activity_log(
    state: SharedState<'_>,
    limit: Option<usize>,
) -> Result<Vec<brisk_bastion_core::audit::AuditEntry>, String> {
    state
        .audit
        .read_recent(limit.unwrap_or(200))
        .map_err(db_err)
}

#[tauri::command]
pub async fn list_servers(state: SharedState<'_>) -> Result<Vec<Server>, String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .list_servers()
        .map_err(db_err)
}

#[tauri::command]
pub async fn get_server(state: SharedState<'_>, id: String) -> Result<Server, String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .get_server(&id)
        .map_err(db_err)
}

#[tauri::command]
pub fn get_vault_status(state: SharedState<'_>) -> Result<bool, String> {
    Ok(state
        .db
        .lock()
        .map_err(db_err)?
        .credentials_reset_required())
}

#[tauri::command]
pub fn dismiss_vault_notice(state: SharedState<'_>) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .dismiss_credentials_reset_notice();
    Ok(())
}

#[tauri::command]
pub fn check_server_credentials(
    state: SharedState<'_>,
    server_id: String,
) -> Result<brisk_bastion_core::db::CredentialCheck, String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .check_server_credentials(&server_id)
        .map_err(db_err)
}

#[tauri::command]
pub async fn create_server(
    state: SharedState<'_>,
    input: ServerInput,
) -> Result<Server, String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .create_server(&input)
        .map_err(db_err)
}

#[tauri::command]
pub async fn update_server(
    state: SharedState<'_>,
    id: String,
    input: ServerInput,
) -> Result<Server, String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .update_server(&id, &input)
        .map_err(db_err)
}

#[tauri::command]
pub async fn delete_server(state: SharedState<'_>, id: String) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .delete_server(&id)
        .map_err(db_err)
}

#[tauri::command]
pub async fn list_server_folders(state: SharedState<'_>) -> Result<Vec<ServerFolder>, String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .list_server_folders()
        .map_err(db_err)
}

#[tauri::command]
pub async fn create_server_folder(
    state: SharedState<'_>,
    name: String,
) -> Result<ServerFolder, String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .create_server_folder(&name)
        .map_err(db_err)
}

#[tauri::command]
pub async fn rename_server_folder(
    state: SharedState<'_>,
    id: String,
    name: String,
) -> Result<ServerFolder, String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .rename_server_folder(&id, &name)
        .map_err(db_err)
}

#[tauri::command]
pub async fn delete_server_folder(state: SharedState<'_>, id: String) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .delete_server_folder(&id)
        .map_err(db_err)
}

#[tauri::command]
pub async fn list_known_hosts(state: SharedState<'_>) -> Result<Vec<KnownHost>, String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .list_known_hosts()
        .map_err(db_err)
}

#[tauri::command]
pub async fn trust_host_key(
    state: SharedState<'_>,
    prompt_id: String,
    host: String,
    port: u16,
    key_type: String,
    fingerprint: String,
    public_key: String,
) -> Result<KnownHost, String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .trust_known_host(&host, port, &key_type, &fingerprint, &public_key)
        .map_err(db_err)?;

    state
        .sessions
        .respond_host_key(&prompt_id, true)
        .await
        .map_err(db_err)?;

    state
        .db
        .lock()
        .map_err(db_err)?
        .get_known_host(&host, port)
        .map_err(db_err)?
        .ok_or_else(|| "known host not saved".to_string())
}

#[tauri::command]
pub async fn reject_host_key(state: SharedState<'_>, prompt_id: String) -> Result<(), String> {
    state
        .sessions
        .respond_host_key(&prompt_id, false)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn connect_session(
    state: SharedState<'_>,
    server_id: String,
    cols: u32,
    rows: u32,
    password: Option<String>,
) -> Result<SessionSummary, String> {
    let (config, sid, known_fingerprint) = {
        let db = state.db.lock().map_err(db_err)?;
        let server = db.get_server(&server_id).map_err(db_err)?;
        SessionManager::prepare_server_connection(
            &db,
            &server,
            cols,
            rows,
            password.as_deref(),
        )
        .map_err(db_err)?
    };

    state
        .sessions
        .connect(config, Some(sid), known_fingerprint)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn close_session(state: SharedState<'_>, session_id: String) -> Result<(), String> {
    state
        .sessions
        .close(&session_id)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn send_terminal_input(
    state: SharedState<'_>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data)
        .map_err(db_err)?;
    state
        .sessions
        .send_input(&session_id, &bytes)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn resize_terminal(
    state: SharedState<'_>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    state
        .sessions
        .resize(&session_id, cols, rows)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn list_active_sessions(
    state: SharedState<'_>,
) -> Result<Vec<SessionSummary>, String> {
    Ok(state.sessions.list_sessions().await)
}

#[tauri::command]
pub async fn list_keys(state: SharedState<'_>) -> Result<Vec<StoredKey>, String> {
    state.db.lock().map_err(db_err)?.list_keys().map_err(db_err)
}

#[tauri::command]
pub async fn generate_key(
    state: SharedState<'_>,
    name: String,
    comment: Option<String>,
) -> Result<StoredKey, String> {
    let db = state.db.lock().map_err(db_err)?;
    KeyVault::generate_key(&db, &name, comment.as_deref()).map_err(db_err)
}

#[tauri::command]
pub async fn import_keys_from_ssh_dir(state: SharedState<'_>) -> Result<Vec<StoredKey>, String> {
    let db = state.db.lock().map_err(db_err)?;
    KeyVault::import_from_ssh_dir(&db).map_err(db_err)
}

#[tauri::command]
pub async fn import_key_from_path(
    state: SharedState<'_>,
    path: String,
    name: Option<String>,
) -> Result<StoredKey, String> {
    let db = state.db.lock().map_err(db_err)?;
    KeyVault::import_from_path(
        &db,
        std::path::Path::new(&path),
        name.as_deref(),
    )
    .map_err(db_err)
}

#[tauri::command]
pub async fn delete_key(state: SharedState<'_>, id: String) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .delete_key(&id)
        .map_err(db_err)
}

#[tauri::command]
pub async fn copy_id_to_server(
    state: SharedState<'_>,
    server_id: String,
    key_id: String,
) -> Result<String, String> {
    let (server, pubkey_line, password, private_key_pem, known_fingerprint) = {
        let db = state.db.lock().map_err(db_err)?;
        let server = db.get_server(&server_id).map_err(db_err)?;
        let key = db
            .list_keys()
            .map_err(db_err)?
            .into_iter()
            .find(|k| k.id == key_id)
            .ok_or_else(|| format!("key not found: {key_id}"))?;
        let (password, private_key_pem, known_fingerprint) =
            SessionManager::prepare_exec_credentials(&db, &server, None).map_err(db_err)?;
        (server, key.public_key.trim().to_string(), password, private_key_pem, known_fingerprint)
    };

    KeyVault::copy_id_to_server(
        &state.sessions,
        &server,
        &pubkey_line,
        password,
        private_key_pem,
        known_fingerprint,
    )
    .await
    .map_err(db_err)
}

#[tauri::command]
pub async fn list_local_dir(path: String) -> Result<Vec<RemoteEntry>, String> {
    core_list_local_dir(std::path::Path::new(&path))
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn list_remote_dir(
    state: SharedState<'_>,
    server_id: String,
    path: String,
    password: Option<String>,
) -> Result<Vec<RemoteEntry>, String> {
    let (server, password, private_key_pem) = {
        let db = state.db.lock().map_err(db_err)?;
        let server = db.get_server(&server_id).map_err(db_err)?;
        let (password, private_key_pem) =
            SftpBrowser::prepare_connection(&db, &server, password.as_deref()).map_err(db_err)?;
        (server, password, private_key_pem)
    };

    let browser = state
        .sftp_pool
        .get_or_connect(&server_id, &server, password, private_key_pem)
        .await
        .map_err(db_err)?;

    browser.list_dir(&path).await.map_err(db_err)
}

#[tauri::command]
pub async fn upload_file(
    state: SharedState<'_>,
    server_id: String,
    local_path: String,
    remote_path: String,
    password: Option<String>,
) -> Result<(), String> {
    let (server, password, private_key_pem) = {
        let db = state.db.lock().map_err(db_err)?;
        let server = db.get_server(&server_id).map_err(db_err)?;
        let (password, private_key_pem) =
            SftpBrowser::prepare_connection(&db, &server, password.as_deref()).map_err(db_err)?;
        (server, password, private_key_pem)
    };

    let browser = state
        .sftp_pool
        .get_or_connect(&server_id, &server, password, private_key_pem)
        .await
        .map_err(db_err)?;

    browser
        .upload_file(std::path::Path::new(&local_path), &remote_path)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn download_file(
    state: SharedState<'_>,
    server_id: String,
    remote_path: String,
    local_path: String,
    password: Option<String>,
) -> Result<(), String> {
    let (server, password, private_key_pem) = {
        let db = state.db.lock().map_err(db_err)?;
        let server = db.get_server(&server_id).map_err(db_err)?;
        let (password, private_key_pem) =
            SftpBrowser::prepare_connection(&db, &server, password.as_deref()).map_err(db_err)?;
        (server, password, private_key_pem)
    };

    let browser = state
        .sftp_pool
        .get_or_connect(&server_id, &server, password, private_key_pem)
        .await
        .map_err(db_err)?;

    browser
        .download_file(&remote_path, std::path::Path::new(&local_path))
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn download_dir(
    state: SharedState<'_>,
    server_id: String,
    remote_path: String,
    local_path: String,
    password: Option<String>,
) -> Result<brisk_bastion_core::sftp::TransferResult, String> {
    let (server, password, private_key_pem) = {
        let db = state.db.lock().map_err(db_err)?;
        let server = db.get_server(&server_id).map_err(db_err)?;
        let (password, private_key_pem) =
            SftpBrowser::prepare_connection(&db, &server, password.as_deref()).map_err(db_err)?;
        (server, password, private_key_pem)
    };

    let browser = state
        .sftp_pool
        .get_or_connect(&server_id, &server, password, private_key_pem)
        .await
        .map_err(db_err)?;

    browser
        .download_dir(&remote_path, std::path::Path::new(&local_path))
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn upload_dir(
    state: SharedState<'_>,
    server_id: String,
    local_path: String,
    remote_path: String,
    password: Option<String>,
) -> Result<brisk_bastion_core::sftp::TransferResult, String> {
    let (server, password, private_key_pem) = {
        let db = state.db.lock().map_err(db_err)?;
        let server = db.get_server(&server_id).map_err(db_err)?;
        let (password, private_key_pem) =
            SftpBrowser::prepare_connection(&db, &server, password.as_deref()).map_err(db_err)?;
        (server, password, private_key_pem)
    };

    let browser = state
        .sftp_pool
        .get_or_connect(&server_id, &server, password, private_key_pem)
        .await
        .map_err(db_err)?;

    browser
        .upload_dir(std::path::Path::new(&local_path), &remote_path)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn list_sync_pairs(state: SharedState<'_>) -> Result<Vec<SyncPairRecord>, String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .list_sync_pairs()
        .map_err(db_err)
}

#[derive(Debug, serde::Deserialize)]
pub struct CreateSyncPairInput {
    pub name: String,
    pub server_id: String,
    pub local_path: String,
    pub remote_path: String,
    pub direction: String,
    #[serde(default)]
    pub ignore_patterns: Vec<String>,
    #[serde(default)]
    pub use_gitignore: bool,
}

#[derive(Debug, serde::Deserialize)]
pub struct SyncDraftInput {
    pub server_id: String,
    pub local_path: String,
    pub remote_path: String,
    pub direction: String,
    #[serde(default)]
    pub ignore_patterns: Vec<String>,
    #[serde(default)]
    pub use_gitignore: bool,
}

#[tauri::command]
pub async fn create_sync_pair(
    state: SharedState<'_>,
    input: CreateSyncPairInput,
) -> Result<SyncPairRecord, String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .create_sync_pair(
            &input.name,
            &input.server_id,
            &input.local_path,
            &input.remote_path,
            &input.direction,
            &input.ignore_patterns,
            input.use_gitignore,
        )
        .map_err(db_err)
}

#[tauri::command]
pub async fn preview_sync_draft(
    state: SharedState<'_>,
    input: SyncDraftInput,
    password: Option<String>,
) -> Result<brisk_bastion_core::sync::SyncPreview, String> {
    use brisk_bastion_core::sync::{SyncDirection, SyncEngine, SyncOptions, SyncPair};

    let (server, password, private_key_pem) = {
        let db = state.db.lock().map_err(db_err)?;
        let server = db.get_server(&input.server_id).map_err(db_err)?;
        let (password, private_key_pem) =
            SftpBrowser::prepare_connection(&db, &server, password.as_deref()).map_err(db_err)?;
        (server, password, private_key_pem)
    };

    let pair = SyncPair {
        id: String::new(),
        name: String::new(),
        server_id: input.server_id,
        local_path: input.local_path,
        remote_path: input.remote_path,
        direction: SyncDirection::from_str(&input.direction),
        options: SyncOptions {
            ignore_patterns: input.ignore_patterns,
            use_gitignore: input.use_gitignore,
        },
    };

    SyncEngine::preview(&state.sftp_pool, &pair, &server, password, private_key_pem)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn delete_sync_pair(state: SharedState<'_>, id: String) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .delete_sync_pair(&id)
        .map_err(db_err)
}

#[tauri::command]
pub async fn preview_sync(state: SharedState<'_>, pair_id: String) -> Result<SyncPreview, String> {
    let (pair, server, password, private_key_pem) = {
        let db = state.db.lock().map_err(db_err)?;
        let record = db.get_sync_pair(&pair_id).map_err(db_err)?;
        let pair = SyncEngine::from_record(&record);
        let server = db.get_server(&pair.server_id).map_err(db_err)?;
        let (password, private_key_pem) =
            SftpBrowser::prepare_connection(&db, &server, None).map_err(db_err)?;
        (pair, server, password, private_key_pem)
    };

    SyncEngine::preview(&state.sftp_pool, &pair, &server, password, private_key_pem)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn run_sync(
    app: AppHandle,
    state: SharedState<'_>,
    pair_id: String,
    dry_run: bool,
    password: Option<String>,
) -> Result<SyncPreview, String> {
    let (pair, server, password, private_key_pem) = {
        let db = state.db.lock().map_err(db_err)?;
        let record = db.get_sync_pair(&pair_id).map_err(db_err)?;
        let pair = SyncEngine::from_record(&record);
        let server = db.get_server(&pair.server_id).map_err(db_err)?;
        let (password, private_key_pem) =
            SftpBrowser::prepare_connection(&db, &server, password.as_deref()).map_err(db_err)?;
        (pair, server, password, private_key_pem)
    };

    SyncEngine::run(
        &state.sftp_pool,
        &pair,
        &server,
        password,
        private_key_pem,
        dry_run,
        |progress: SyncProgress| {
            let _ = app.emit("sync-progress", &progress);
        },
    )
    .await
    .map_err(db_err)
}

#[tauri::command]
pub async fn list_scenarios(state: SharedState<'_>) -> Result<Vec<ScenarioRecord>, String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .list_scenarios()
        .map_err(db_err)
}

#[derive(Debug, serde::Deserialize)]
pub struct CreateScenarioInput {
    pub name: String,
    pub description: Option<String>,
    pub steps_yaml: String,
}

#[tauri::command]
pub async fn create_scenario(
    state: SharedState<'_>,
    input: CreateScenarioInput,
) -> Result<ScenarioRecord, String> {
    Scenario::from_bastion(&input.steps_yaml).map_err(db_err)?;
    state
        .db
        .lock()
        .map_err(db_err)?
        .create_scenario(
            &input.name,
            input.description.as_deref(),
            &input.steps_yaml,
            false,
        )
        .map_err(db_err)
}

#[tauri::command]
pub async fn delete_scenario(state: SharedState<'_>, id: String) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .delete_scenario(&id)
        .map_err(db_err)
}

#[derive(Debug, serde::Serialize)]
pub struct ScenarioRunResponse {
    pub result: ScenarioRunResult,
}

#[tauri::command]
pub async fn run_scenario(
    app: AppHandle,
    state: SharedState<'_>,
    scenario_id: String,
    server_id: String,
) -> Result<ScenarioRunResponse, String> {
    let (scenario, server, password, private_key_pem, known_fingerprint) = {
        let db = state.db.lock().map_err(db_err)?;
        let scenario = ScenarioRunner::load_from_db(&db, &scenario_id).map_err(db_err)?;
        let server = db.get_server(&server_id).map_err(db_err)?;
        let (password, private_key_pem, known_fingerprint) =
            SessionManager::prepare_exec_credentials(&db, &server, None).map_err(db_err)?;
        (scenario, server, password, private_key_pem, known_fingerprint)
    };

    let result = ScenarioRunner::run(
        &state.sessions,
        &state.sftp_pool,
        &server,
        &scenario,
        password,
        private_key_pem,
        known_fingerprint,
        |step: StepResult| {
            let _ = app.emit("scenario-step", &step);
        },
    )
    .await
    .map_err(db_err)?;

    Ok(ScenarioRunResponse { result })
}

fn ui_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("ui-state.json"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_ui_state(app: AppHandle) -> Result<String, String> {
    let path = ui_state_path(&app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_ui_state(app: AppHandle, state: String) -> Result<(), String> {
    let path = ui_state_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, state).map_err(|e| e.to_string())
}

// --- Monitor ---

macro_rules! with_server_creds {
    ($state:expr, $server_id:expr, $password:expr, |$server:ident, $pass:ident, $pem:ident, $fp:ident| $body:expr) => {{
        let ($server, $pass, $pem, $fp) = {
            let db = $state.db.lock().map_err(db_err)?;
            let server = db.get_server(&$server_id).map_err(db_err)?;
            let (password, private_key_pem, known_fingerprint) =
                SessionManager::prepare_exec_credentials(&db, &server, $password.as_deref())
                    .map_err(db_err)?;
            (server, password, private_key_pem, known_fingerprint)
        };
        $body
    }};
}

#[tauri::command]
pub async fn list_processes(
    state: SharedState<'_>,
    server_id: String,
    password: Option<String>,
) -> Result<Vec<brisk_bastion_core::monitor::ProcessInfo>, String> {
    with_server_creds!(state, server_id, password, |server, password, pem, fp| {
        brisk_bastion_core::monitor::HostMonitor::list_processes(
            &state.sessions,
            &server,
            password,
            pem,
            fp,
        )
        .await
        .map_err(db_err)
    })
}

#[tauri::command]
pub async fn refresh_processes(
    state: SharedState<'_>,
    server_id: String,
    password: Option<String>,
) -> Result<Vec<brisk_bastion_core::monitor::ProcessInfo>, String> {
    list_processes(state, server_id, password).await
}

#[tauri::command]
pub async fn verify_process_trust(
    state: SharedState<'_>,
    server_id: String,
    pid: u32,
    password: Option<String>,
) -> Result<brisk_bastion_core::monitor::ProcessTrustInfo, String> {
    let sha256 = with_server_creds!(state, server_id, password, |server, password, pem, fp| {
        brisk_bastion_core::monitor::TrustService::binary_sha256(
            &state.sessions,
            &server,
            pid,
            password,
            pem,
            fp,
        )
        .await
        .map_err(db_err)
    })?;

    let trusted = state
        .db
        .lock()
        .map_err(db_err)?
        .find_trusted_binary(&sha256)
        .map_err(db_err)?;

    Ok(brisk_bastion_core::monitor::ProcessTrustInfo {
        pid,
        sha256,
        trusted: trusted.is_some(),
        label: trusted.as_ref().map(|t| t.label.clone()),
        notes: trusted.and_then(|t| t.notes),
    })
}

#[tauri::command]
pub async fn list_docker_containers(
    state: SharedState<'_>,
    server_id: String,
    password: Option<String>,
) -> Result<Vec<brisk_bastion_core::monitor::DockerContainer>, String> {
    with_server_creds!(state, server_id, password, |server, password, pem, fp| {
        brisk_bastion_core::monitor::DockerMonitor::list_containers(
            &state.sessions,
            &server,
            password,
            pem,
            fp,
        )
        .await
        .map_err(db_err)
    })
}

#[tauri::command]
pub async fn list_docker_container_processes(
    state: SharedState<'_>,
    server_id: String,
    container: String,
    password: Option<String>,
) -> Result<Vec<brisk_bastion_core::monitor::ContainerProcess>, String> {
    with_server_creds!(state, server_id, password, |server, password, pem, fp| {
        brisk_bastion_core::monitor::DockerMonitor::list_container_processes(
            &state.sessions,
            &server,
            &container,
            password,
            pem,
            fp,
        )
        .await
        .map_err(db_err)
    })
}

#[tauri::command]
pub fn list_trusted_binaries(
    state: SharedState<'_>,
) -> Result<Vec<brisk_bastion_core::db::TrustedBinary>, String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .list_trusted_binaries()
        .map_err(db_err)
}

#[tauri::command]
pub fn create_trusted_binary(
    state: SharedState<'_>,
    sha256: String,
    label: String,
    notes: Option<String>,
) -> Result<brisk_bastion_core::db::TrustedBinary, String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .create_trusted_binary(&sha256, &label, notes.as_deref())
        .map_err(db_err)
}

#[tauri::command]
pub fn update_trusted_binary(
    state: SharedState<'_>,
    id: String,
    label: String,
    notes: Option<String>,
) -> Result<brisk_bastion_core::db::TrustedBinary, String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .update_trusted_binary(&id, &label, notes.as_deref())
        .map_err(db_err)
}

#[tauri::command]
pub fn delete_trusted_binary(state: SharedState<'_>, id: String) -> Result<(), String> {
    state
        .db
        .lock()
        .map_err(db_err)?
        .delete_trusted_binary(&id)
        .map_err(db_err)
}

// --- Updates ---

#[tauri::command]
pub async fn check_updates(
    state: SharedState<'_>,
    server_id: String,
    include_cve: Option<bool>,
    password: Option<String>,
) -> Result<brisk_bastion_core::updates::UpdatesReport, String> {
    let (server, password, pem, fp) = {
        let db = state.db.lock().map_err(db_err)?;
        let server = db.get_server(&server_id).map_err(db_err)?;
        let (password, private_key_pem, known_fingerprint) =
            SessionManager::prepare_exec_credentials(&db, &server, password.as_deref())
                .map_err(db_err)?;
        (server, password, private_key_pem, known_fingerprint)
    };

    let mut report = brisk_bastion_core::updates::UpdatesChecker::fetch_updates(
        &state.sessions,
        &server,
        password,
        pem,
        fp,
    )
    .await
    .map_err(db_err)?;

    if include_cve.unwrap_or(false) && !report.packages.is_empty() {
        let client = brisk_bastion_core::updates::OsvClient::new().map_err(db_err)?;
        let ecosystem = report.os.osv_ecosystem.clone();
        let pending = {
            let db = state.db.lock().map_err(db_err)?;
            brisk_bastion_core::updates::OsvClient::apply_cache(
                &db,
                &ecosystem,
                &mut report.packages,
            )
            .map_err(db_err)?
        };
        if !pending.is_empty() {
            let fetched = client.fetch_pending(&ecosystem, pending).await.map_err(db_err)?;
            let db = state.db.lock().map_err(db_err)?;
            brisk_bastion_core::updates::OsvClient::save_results(
                &db,
                &ecosystem,
                &fetched,
                &mut report.packages,
            )
            .map_err(db_err)?;
        }
    }

    Ok(report)
}

#[tauri::command]
pub async fn run_updates(
    state: SharedState<'_>,
    server_id: String,
    packages: Option<Vec<String>>,
    password: Option<String>,
) -> Result<brisk_bastion_core::updates::UpgradeResult, String> {
    let (server, password, pem, fp) = {
        let db = state.db.lock().map_err(db_err)?;
        let server = db.get_server(&server_id).map_err(db_err)?;
        let (password, private_key_pem, known_fingerprint) =
            SessionManager::prepare_exec_credentials(&db, &server, password.as_deref())
                .map_err(db_err)?;
        (server, password, private_key_pem, known_fingerprint)
    };

    brisk_bastion_core::updates::run_upgrade(
        &state.sessions,
        &server,
        packages,
        password,
        pem,
        fp,
    )
    .await
    .map_err(db_err)
}
