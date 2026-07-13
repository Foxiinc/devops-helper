mod ignore;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::db::SyncPairRecord;
use crate::error::CoreResult;
use crate::sftp::{SftpBrowser, SftpConnectionPool};

use self::ignore::IgnoreRules;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SyncDirection {
    Push,
    Pull,
}

impl SyncDirection {
    pub fn from_str(value: &str) -> Self {
        match value {
            "pull" => SyncDirection::Pull,
            _ => SyncDirection::Push,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            SyncDirection::Push => "push",
            SyncDirection::Pull => "pull",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncOptions {
    #[serde(default)]
    pub ignore_patterns: Vec<String>,
    #[serde(default)]
    pub use_gitignore: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPair {
    pub id: String,
    pub name: String,
    pub server_id: String,
    pub local_path: String,
    pub remote_path: String,
    pub direction: SyncDirection,
    #[serde(default)]
    pub options: SyncOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPreviewItem {
    pub path: String,
    pub action: String,
    pub reason: String,
    #[serde(default)]
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPreview {
    pub items: Vec<SyncPreviewItem>,
    pub total_files: usize,
    #[serde(default)]
    pub skipped_count: usize,
    #[serde(default)]
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncProgress {
    pub current_file: String,
    pub completed: usize,
    pub total: usize,
    pub bytes_transferred: u64,
}

#[derive(Debug, Clone)]
struct LocalFileInfo {
    path: PathBuf,
    relative: String,
    size: u64,
    modified: i64,
}

#[derive(Debug, Clone)]
struct RemoteFileInfo {
    path: String,
    relative: String,
    size: u64,
    modified: i64,
}

pub struct SyncEngine;

impl SyncEngine {
    pub fn from_record(record: &SyncPairRecord) -> SyncPair {
        SyncPair {
            id: record.id.clone(),
            name: record.name.clone(),
            server_id: record.server_id.clone(),
            local_path: record.local_path.clone(),
            remote_path: record.remote_path.clone(),
            direction: SyncDirection::from_str(&record.direction),
            options: SyncOptions {
                ignore_patterns: record.ignore_patterns.clone(),
                use_gitignore: record.use_gitignore,
            },
        }
    }

    pub async fn preview(
        pool: &SftpConnectionPool,
        pair: &SyncPair,
        server: &crate::db::Server,
        password: Option<String>,
        private_key_pem: Option<Vec<u8>>,
    ) -> CoreResult<SyncPreview> {
        let base = Path::new(&pair.local_path);
        let ignore = IgnoreRules::build(
            base,
            &pair.options.ignore_patterns,
            pair.options.use_gitignore,
        );

        let (local_files, skipped_count) = collect_local_files(base, &ignore)?;
        let browser = pool
            .get_or_connect(&pair.server_id, server, password, private_key_pem)
            .await?;
        let remote_files = collect_remote_files(&browser, &pair.remote_path).await?;

        let items = match pair.direction {
            SyncDirection::Push => diff_push(&local_files, &remote_files),
            SyncDirection::Pull => diff_pull(&local_files, &remote_files),
        };

        let total_bytes = items.iter().map(|i| i.size_bytes).sum();
        let total = items.len();
        Ok(SyncPreview {
            items,
            total_files: total,
            skipped_count,
            total_bytes,
        })
    }

    pub async fn run<F>(
        pool: &SftpConnectionPool,
        pair: &SyncPair,
        server: &crate::db::Server,
        password: Option<String>,
        private_key_pem: Option<Vec<u8>>,
        dry_run: bool,
        mut on_progress: F,
    ) -> CoreResult<SyncPreview>
    where
        F: FnMut(SyncProgress) + Send,
    {
        let preview =
            Self::preview(pool, pair, server, password.clone(), private_key_pem.clone()).await?;
        if dry_run {
            return Ok(preview);
        }

        let browser = pool
            .get_or_connect(&pair.server_id, server, password, private_key_pem)
            .await?;
        let total = preview.items.len();

        for (index, item) in preview.items.iter().enumerate() {
            on_progress(SyncProgress {
                current_file: item.path.clone(),
                completed: index,
                total,
                bytes_transferred: item.size_bytes,
            });

            match (pair.direction.clone(), item.action.as_str()) {
                (SyncDirection::Push, "upload") => {
                    let local = PathBuf::from(&pair.local_path).join(&item.path);
                    let remote = join_remote(&pair.remote_path, &item.path);
                    if local.is_dir() {
                        ensure_remote_dir(&browser, &remote).await?;
                    } else {
                        browser.upload_file(&local, &remote).await?;
                    }
                }
                (SyncDirection::Pull, "download") => {
                    let local = PathBuf::from(&pair.local_path).join(&item.path);
                    let remote = join_remote(&pair.remote_path, &item.path);
                    if item.reason.contains("directory") {
                        std::fs::create_dir_all(&local)?;
                    } else {
                        browser.download_file(&remote, &local).await?;
                    }
                }
                _ => {}
            }
        }

        on_progress(SyncProgress {
            current_file: "done".into(),
            completed: total,
            total,
            bytes_transferred: preview.total_bytes,
        });

        Ok(preview)
    }
}

fn collect_local_files(base: &Path, ignore: &IgnoreRules) -> CoreResult<(Vec<LocalFileInfo>, usize)> {
    let mut files = Vec::new();
    let mut skipped = 0;
    if !base.exists() {
        return Ok((files, skipped));
    }

    walk_local(base, base, ignore, &mut files, &mut skipped)?;
    Ok((files, skipped))
}

fn walk_local(
    base: &Path,
    current: &Path,
    ignore: &IgnoreRules,
    out: &mut Vec<LocalFileInfo>,
    skipped: &mut usize,
) -> CoreResult<()> {
    for entry in std::fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let relative = path
            .strip_prefix(base)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");

        if ignore.is_ignored(&relative) {
            *skipped += 1;
            if entry.metadata()?.is_dir() {
                continue;
            }
            continue;
        }

        let metadata = entry.metadata()?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        if metadata.is_dir() {
            out.push(LocalFileInfo {
                path: path.clone(),
                relative: format!("{relative}/"),
                size: 0,
                modified,
            });
            walk_local(base, &path, ignore, out, skipped)?;
        } else {
            out.push(LocalFileInfo {
                path,
                relative,
                size: metadata.len(),
                modified,
            });
        }
    }
    Ok(())
}

async fn collect_remote_files(browser: &SftpBrowser, base: &str) -> CoreResult<Vec<RemoteFileInfo>> {
    let mut files = Vec::new();
    let mut stack = vec![base.to_string()];

    while let Some(current) = stack.pop() {
        let entries = browser.list_dir(&current).await?;
        for entry in entries {
            if entry.name == "." || entry.name == ".." {
                continue;
            }

            let relative = entry
                .path
                .strip_prefix(base.trim_end_matches('/'))
                .unwrap_or(&entry.path)
                .trim_start_matches('/')
                .to_string();

            if entry.is_dir {
                files.push(RemoteFileInfo {
                    path: entry.path.clone(),
                    relative: format!("{relative}/"),
                    size: 0,
                    modified: entry.modified.unwrap_or(0),
                });
                stack.push(entry.path);
            } else {
                files.push(RemoteFileInfo {
                    path: entry.path.clone(),
                    relative,
                    size: entry.size,
                    modified: entry.modified.unwrap_or(0),
                });
            }
        }
    }

    Ok(files)
}

fn diff_push(local: &[LocalFileInfo], remote: &[RemoteFileInfo]) -> Vec<SyncPreviewItem> {
    let mut items = Vec::new();

    for lf in local {
        let rf = remote.iter().find(|r| r.relative == lf.relative);
        match rf {
            None => items.push(SyncPreviewItem {
                path: lf.relative.clone(),
                action: "upload".into(),
                reason: if lf.path.is_dir() {
                    "new directory".into()
                } else {
                    "new file".into()
                },
                size_bytes: lf.size,
            }),
            Some(rf) if !lf.path.is_dir() && (lf.size != rf.size || lf.modified > rf.modified) => {
                items.push(SyncPreviewItem {
                    path: lf.relative.clone(),
                    action: "upload".into(),
                    reason: format!(
                        "changed (local mtime {} > remote {})",
                        lf.modified, rf.modified
                    ),
                    size_bytes: lf.size,
                });
            }
            _ => {}
        }
    }

    items
}

fn diff_pull(local: &[LocalFileInfo], remote: &[RemoteFileInfo]) -> Vec<SyncPreviewItem> {
    let mut items = Vec::new();

    for rf in remote {
        let lf = local.iter().find(|l| l.relative == rf.relative);
        match lf {
            None => items.push(SyncPreviewItem {
                path: rf.relative.clone(),
                action: "download".into(),
                reason: if rf.relative.ends_with('/') {
                    "new directory".into()
                } else {
                    "new file".into()
                },
                size_bytes: rf.size,
            }),
            Some(lf) if !rf.relative.ends_with('/') && (lf.size != rf.size || rf.modified > lf.modified)
            => {
                items.push(SyncPreviewItem {
                    path: rf.relative.clone(),
                    action: "download".into(),
                    reason: format!(
                        "changed (remote mtime {} > local {})",
                        rf.modified, lf.modified
                    ),
                    size_bytes: rf.size,
                });
            }
            _ => {}
        }
    }

    items
}

async fn ensure_remote_dir(browser: &SftpBrowser, path: &str) -> CoreResult<()> {
    browser.ensure_dir(path).await
}

fn join_remote(base: &str, relative: &str) -> String {
    let base = base.trim_end_matches('/');
    let relative = relative.trim_start_matches('/');
    if relative.is_empty() {
        base.to_string()
    } else {
        format!("{base}/{relative}")
    }
}
