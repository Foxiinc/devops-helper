use serde::{Deserialize, Serialize};

use crate::db::Server;
use crate::error::{CoreError, CoreResult};
use crate::session::SessionManager;
use crate::updates::distro::{parse_os_release, PackageManager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpgradeResult {
    pub success: bool,
    pub exit_code: u32,
    pub output: String,
    pub package_manager: PackageManager,
}

const OS_RELEASE_CMD: &str = "cat /etc/os-release 2>/dev/null";

pub async fn run_upgrade(
    sessions: &SessionManager,
    server: &Server,
    packages: Option<Vec<String>>,
    password: Option<String>,
    private_key_pem: Option<Vec<u8>>,
    known_fingerprint: Option<String>,
) -> CoreResult<UpgradeResult> {
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
    let package_manager = os.package_manager.clone();
    let command = build_upgrade_command(package_manager.clone(), packages.as_deref())?;

    let (output, exit_code) = sessions
        .exec_command(
            server,
            &command,
            password,
            private_key_pem,
            known_fingerprint,
        )
        .await?;

    Ok(UpgradeResult {
        success: exit_code == 0,
        exit_code,
        output,
        package_manager,
    })
}

fn build_upgrade_command(
    pm: PackageManager,
    packages: Option<&[String]>,
) -> CoreResult<String> {
    match pm {
        PackageManager::Apt => {
            let base = "export DEBIAN_FRONTEND=noninteractive && apt-get update -qq";
            match packages {
                None | Some([]) => Ok(format!("{base} && apt-get upgrade -y")),
                Some(names) => {
                    for name in names {
                        validate_pkg_name(name)?;
                    }
                    Ok(format!(
                        "{base} && apt-get install -y {}",
                        names.join(" ")
                    ))
                }
            }
        }
        PackageManager::Dnf => match packages {
            None | Some([]) => Ok("dnf upgrade -y".into()),
            Some(names) => {
                for name in names {
                    validate_pkg_name(name)?;
                }
                Ok(format!("dnf upgrade -y {}", names.join(" ")))
            }
        },
        PackageManager::Unknown => Err(CoreError::Other(
            "unsupported package manager for upgrades".into(),
        )),
    }
}

fn validate_pkg_name(name: &str) -> CoreResult<()> {
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.' | ':' | '_'))
    {
        return Err(CoreError::Other(format!("invalid package name: {name}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apt_upgrade_all_command() {
        let cmd = build_upgrade_command(PackageManager::Apt, None).unwrap();
        assert!(cmd.contains("apt-get upgrade -y"));
    }

    #[test]
    fn apt_upgrade_packages_command() {
        let pkgs = vec!["nginx".into(), "curl".into()];
        let cmd = build_upgrade_command(PackageManager::Apt, Some(&pkgs)).unwrap();
        assert!(cmd.contains("apt-get install -y nginx curl"));
    }

    #[test]
    fn rejects_invalid_package_names() {
        assert!(build_upgrade_command(PackageManager::Apt, Some(&["bad;rm".into()])).is_err());
    }
}
