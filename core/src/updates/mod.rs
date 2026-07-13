pub mod apt;
pub mod distro;
pub mod dnf;
pub mod osv;
pub mod types;
pub mod upgrade;

pub use distro::{OsInfo, PackageManager};
pub use osv::OsvClient;
pub use types::{CveInfo, PackageUpdate, UpdatesReport};
pub use upgrade::{run_upgrade, UpgradeResult};

use crate::db::{Database, Server};
use crate::error::CoreResult;
use crate::session::SessionManager;

pub struct UpdatesChecker;

impl UpdatesChecker {
    pub async fn fetch_updates(
        sessions: &SessionManager,
        server: &Server,
        password: Option<String>,
        private_key_pem: Option<Vec<u8>>,
        known_fingerprint: Option<String>,
    ) -> CoreResult<UpdatesReport> {
        checker::check_updates(
            sessions,
            server,
            password,
            private_key_pem,
            known_fingerprint,
        )
        .await
    }

    pub async fn check_with_db(
        sessions: &SessionManager,
        db: &Database,
        server: &Server,
        include_cve: bool,
    ) -> CoreResult<UpdatesReport> {
        let (password, private_key_pem, known_fingerprint) =
            SessionManager::prepare_exec_credentials(db, server, None)?;
        let mut report = Self::fetch_updates(
            sessions,
            server,
            password,
            private_key_pem,
            known_fingerprint,
        )
        .await?;

        if include_cve && !report.packages.is_empty() {
            let client = OsvClient::new()?;
            let ecosystem = report.os.osv_ecosystem.clone();
            let pending =
                OsvClient::apply_cache(db, &ecosystem, &mut report.packages)?;
            if !pending.is_empty() {
                let fetched = client.fetch_pending(&ecosystem, pending).await?;
                OsvClient::save_results(db, &ecosystem, &fetched, &mut report.packages)?;
            }
        }

        Ok(report)
    }

    pub async fn run_upgrade_for_server(
        sessions: &SessionManager,
        db: &Database,
        server: &Server,
        packages: Option<Vec<String>>,
    ) -> CoreResult<UpgradeResult> {
        let (password, private_key_pem, known_fingerprint) =
            SessionManager::prepare_exec_credentials(db, server, None)?;
        run_upgrade(
            sessions,
            server,
            packages,
            password,
            private_key_pem,
            known_fingerprint,
        )
        .await
    }
}

mod checker {
    use chrono::Utc;

    use crate::db::Server;
    use crate::error::{CoreError, CoreResult};
    use crate::session::SessionManager;
    use crate::updates::apt::parse_apt_upgradable;
    use crate::updates::distro::{parse_os_release, PackageManager};
    use crate::updates::dnf::parse_dnf_check_update;
    use crate::updates::types::UpdatesReport;

    const OS_RELEASE_CMD: &str = "cat /etc/os-release 2>/dev/null";
    const APT_CMD: &str = "apt list --upgradable 2>/dev/null";
    const DNF_CMD: &str =
        "dnf check-update -q 2>/dev/null || dnf check-update 2>/dev/null | grep -v '^$'";

    pub async fn check_updates(
        sessions: &SessionManager,
        server: &Server,
        password: Option<String>,
        private_key_pem: Option<Vec<u8>>,
        known_fingerprint: Option<String>,
    ) -> CoreResult<UpdatesReport> {
        let (os_out, _) = sessions
            .exec_command(
                server,
                OS_RELEASE_CMD,
                password.clone(),
                private_key_pem.clone(),
                known_fingerprint.clone(),
            )
            .await?;

        let os = parse_os_release(&os_out)?;

        let update_cmd = match os.package_manager {
            PackageManager::Apt => APT_CMD,
            PackageManager::Dnf => DNF_CMD,
            PackageManager::Unknown => {
                return Err(CoreError::Other(format!(
                    "unsupported package manager for OS `{}`",
                    os.id
                )));
            }
        };

        let (updates_out, code) = sessions
            .exec_command(
                server,
                update_cmd,
                password,
                private_key_pem,
                known_fingerprint,
            )
            .await?;

        let mut packages = match os.package_manager {
            PackageManager::Apt => parse_apt_upgradable(&updates_out)?,
            PackageManager::Dnf => {
                if code != 0 && code != 100 {
                    return Err(CoreError::Other(format!(
                        "dnf check-update failed (exit {code}): {}",
                        updates_out.trim()
                    )));
                }
                parse_dnf_check_update(&updates_out)?
            }
            PackageManager::Unknown => Vec::new(),
        };

        if packages.is_empty() && code != 0 && os.package_manager == PackageManager::Apt {
            return Err(CoreError::Other(format!(
                "apt list --upgradable failed (exit {code}): {}",
                updates_out.trim()
            )));
        }

        if os.package_manager == PackageManager::Dnf {
            for pkg in &mut packages {
                if pkg.installed.is_empty() {
                    pkg.installed = pkg.available.clone();
                }
            }
        }

        Ok(UpdatesReport {
            os,
            packages,
            checked_at: Utc::now(),
        })
    }
}
