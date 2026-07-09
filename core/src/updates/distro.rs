use serde::{Deserialize, Serialize};

use crate::error::{CoreError, CoreResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PackageManager {
    Apt,
    Dnf,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsInfo {
    pub id: String,
    pub version_id: String,
    pub pretty_name: String,
    pub package_manager: PackageManager,
    pub osv_ecosystem: String,
}

pub fn parse_os_release(content: &str) -> CoreResult<OsInfo> {
    let mut id = String::new();
    let mut version_id = String::new();
    let mut pretty_name = String::new();

    for line in content.lines() {
        let line = line.trim();
        if line.starts_with("ID=") {
            id = unquote(line.trim_start_matches("ID="));
        } else if line.starts_with("VERSION_ID=") {
            version_id = unquote(line.trim_start_matches("VERSION_ID="));
        } else if line.starts_with("PRETTY_NAME=") {
            pretty_name = unquote(line.trim_start_matches("PRETTY_NAME="));
        }
    }

    if id.is_empty() {
        return Err(CoreError::Other("could not detect OS from /etc/os-release".into()));
    }

    let package_manager = match id.as_str() {
        "debian" | "ubuntu" | "linuxmint" | "pop" => PackageManager::Apt,
        "fedora" | "rhel" | "centos" | "rocky" | "almalinux" => PackageManager::Dnf,
        _ => PackageManager::Unknown,
    };

    let osv_ecosystem = osv_ecosystem_for(&id, &version_id);

    Ok(OsInfo {
        id,
        version_id,
        pretty_name,
        package_manager,
        osv_ecosystem,
    })
}

fn unquote(value: &str) -> String {
    value.trim().trim_matches('"').to_string()
}

fn osv_ecosystem_for(id: &str, version_id: &str) -> String {
    match id {
        "debian" => format!("Debian:{version_id}"),
        "ubuntu" => {
            if version_id.ends_with(".04") {
                format!("Ubuntu:{version_id}:LTS")
            } else {
                format!("Ubuntu:{version_id}")
            }
        }
        "fedora" => format!("Fedora:{version_id}"),
        other => format!("{other}:{version_id}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ubuntu_os_release() {
        let content = r#"PRETTY_NAME="Ubuntu 22.04.5 LTS"
ID=ubuntu
VERSION_ID="22.04"
"#;
        let info = parse_os_release(content).unwrap();
        assert_eq!(info.id, "ubuntu");
        assert_eq!(info.osv_ecosystem, "Ubuntu:22.04:LTS");
        assert_eq!(info.package_manager, PackageManager::Apt);
    }
}
