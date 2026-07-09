use crate::error::{CoreError, CoreResult};
use crate::updates::types::PackageUpdate;

pub fn parse_apt_upgradable(output: &str) -> CoreResult<Vec<PackageUpdate>> {
    let mut packages = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("Listing") {
            continue;
        }

        // format: pkg/version arch [upgradable from: old]
        let (name_part, rest) = line
            .split_once('/')
            .ok_or_else(|| CoreError::Other(format!("unexpected apt line: {line}")))?;

        let name = name_part.trim().to_string();
        let mut parts = rest.split_whitespace();
        let available = parts.next().unwrap_or("").to_string();
        let mut installed = available.clone();
        let mut size = None;

        while let Some(token) = parts.next() {
            if token == "from:" {
                if let Some(old) = parts.next() {
                    installed = old.trim_end_matches([' ', ',', ']']).to_string();
                }
            } else if token.ends_with("B") || token.ends_with("kB") || token.ends_with("MB") {
                size = Some(token.to_string());
            }
        }

        packages.push(PackageUpdate {
            name,
            installed,
            available,
            size,
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
    fn parses_apt_list_upgradable() {
        let output = "Listing... Done\n\
            openssl/jammy-updates 3.0.2-0ubuntu1.18 amd64 [upgradable from: 3.0.2-0ubuntu1.15]\n\
            curl/jammy-updates 7.81.0-1ubuntu1.20 amd64 [upgradable from: 7.81.0-1ubuntu1.16]\n";
        let list = parse_apt_upgradable(output).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "openssl");
        assert_eq!(list[0].installed, "3.0.2-0ubuntu1.15");
    }
}
