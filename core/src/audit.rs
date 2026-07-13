use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::error::CoreResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub ts: String,
    pub action: String,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_id: Option<String>,
}

pub struct AuditLog {
    path: PathBuf,
    lock: Mutex<()>,
}

impl AuditLog {
    pub fn new(data_dir: &Path) -> CoreResult<Self> {
        std::fs::create_dir_all(data_dir)?;
        Ok(Self {
            path: data_dir.join("activity.log"),
            lock: Mutex::new(()),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn record(
        &self,
        action: &str,
        detail: impl AsRef<str>,
        server_id: Option<&str>,
    ) {
        let entry = AuditEntry {
            ts: Utc::now().to_rfc3339(),
            action: action.to_string(),
            detail: detail.as_ref().to_string(),
            server_id: server_id.map(String::from),
        };

        let Ok(line) = serde_json::to_string(&entry) else {
            return;
        };

        let Ok(_guard) = self.lock.lock() else {
            return;
        };

        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
        {
            let _ = writeln!(file, "{line}");
        }
    }

    pub fn read_recent(&self, limit: usize) -> CoreResult<Vec<AuditEntry>> {
        let file = match File::open(&self.path) {
            Ok(file) => file,
            Err(_) => return Ok(Vec::new()),
        };

        let lines: Vec<String> = BufReader::new(file).lines().filter_map(Result::ok).collect();
        let start = lines.len().saturating_sub(limit);
        let mut entries = Vec::new();

        for line in &lines[start..] {
            if let Ok(entry) = serde_json::from_str::<AuditEntry>(line) {
                entries.push(entry);
            }
        }

        Ok(entries)
    }
}
