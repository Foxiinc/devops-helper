use crate::error::{CoreError, CoreResult};
use crate::updates::types::PackageUpdate;

pub fn parse_dnf_check_update(output: &str) -> CoreResult<Vec<PackageUpdate>> {
    let mut packages = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("Last metadata") || line.starts_with("Security:") {
            continue;
        }

        // name.arch  available  repo
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }

        let name = parts[0]
            .split('.')
            .next()
            .unwrap_or(parts[0])
            .to_string();
        let available = parts[1].to_string();

        packages.push(PackageUpdate {
            name,
            installed: String::new(),
            available,
            size: None,
            cves: Vec::new(),
            max_severity: None,
        });
    }

    Ok(packages)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dnf_output() {
        let output = "Last metadata expiration check: 0:00:01 ago\n\
            openssl.x86_64    1:3.2.2-1.fc41    updates\n\
            curl.x86_64       8.9.1-2.fc41      updates\n";
        let list = parse_dnf_check_update(output).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "openssl");
    }
}
