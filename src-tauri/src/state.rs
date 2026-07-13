use std::path::PathBuf;
use std::sync::Mutex;

use brisk_bastion_core::audit::AuditLog;
use brisk_bastion_core::db::Database;
use brisk_bastion_core::session::{SessionEvent, SessionManager};
use brisk_bastion_core::sftp::SftpConnectionPool;
use brisk_bastion_core::CoreResult;
use tokio::sync::mpsc;

pub struct AppState {
    pub db: Mutex<Database>,
    pub audit: AuditLog,
    pub sessions: SessionManager,
    pub sftp_pool: SftpConnectionPool,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> CoreResult<Self> {
        let db_path = data_dir.join("brisk-bastion.db");
        let (tx, _rx) = mpsc::unbounded_channel();
        Ok(Self {
            db: Mutex::new(Database::open(&db_path)?),
            audit: AuditLog::new(&data_dir)?,
            sessions: SessionManager::new(tx),
            sftp_pool: SftpConnectionPool::new(),
        })
    }

    pub fn set_event_sender(&mut self, tx: mpsc::UnboundedSender<SessionEvent>) {
        self.sessions = SessionManager::new(tx);
    }
}
