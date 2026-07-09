use crate::error::{CoreError, CoreResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BastionAction {
    Local { command: String },
    Remote { command: String },
    Sync {
        local_path: String,
        remote_path: String,
    },
}

#[derive(Debug, Clone)]
pub struct ParsedScenario {
    pub name: Option<String>,
    pub steps: Vec<BastionAction>,
}

/// Reads a `.bastion` script: one action per line, prefix before `:`.
pub fn parse(content: &str) -> CoreResult<ParsedScenario> {
    let mut name = None;
    let mut steps = Vec::new();

    for (line_no, raw) in content.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('#') {
            if name.is_none() {
                let title = line.trim_start_matches('#').trim();
                if !title.is_empty() {
                    name = Some(title.to_string());
                }
            }
            continue;
        }

        let (action, payload) = split_action(line).ok_or_else(|| {
            CoreError::Other(format!(
                "line {}: expected 'local:', 'remote:', or 'sync:'",
                line_no + 1
            ))
        })?;

        let step = match action {
            "local" => BastionAction::Local {
                command: payload.to_string(),
            },
            "remote" => BastionAction::Remote {
                command: payload.to_string(),
            },
            "sync" => {
                let (local_path, remote_path) = parse_sync_paths(payload).ok_or_else(|| {
                    CoreError::Other(format!(
                        "line {}: sync expects 'local -> remote', got '{payload}'",
                        line_no + 1
                    ))
                })?;
                BastionAction::Sync {
                    local_path,
                    remote_path,
                }
            }
            other => {
                return Err(CoreError::Other(format!(
                    "line {}: unknown action '{other}'",
                    line_no + 1
                )));
            }
        };

        steps.push(step);
    }

    if steps.is_empty() {
        return Err(CoreError::Other("scenario has no steps".into()));
    }

    Ok(ParsedScenario { name, steps })
}

fn split_action(line: &str) -> Option<(&str, &str)> {
    let (action, rest) = line.split_once(':')?;
    let action = action.trim();
    let payload = rest.trim();
    if action.is_empty() || payload.is_empty() {
        return None;
    }
    Some((action, payload))
}

fn parse_sync_paths(payload: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = payload.split("->").collect();
    if parts.len() != 2 {
        return None;
    }
    let local = parts[0].trim().to_string();
    let remote = parts[1].trim().to_string();
    if local.is_empty() || remote.is_empty() {
        return None;
    }
    Some((local, remote))
}

pub fn action_label(action: &BastionAction) -> String {
    match action {
        BastionAction::Local { command } => format!("local: {command}"),
        BastionAction::Remote { command } => format!("remote: {command}"),
        BastionAction::Sync {
            local_path,
            remote_path,
        } => format!("sync: {local_path} -> {remote_path}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mixed_steps() {
        let script = r#"# Обновление ноды
local: echo "Начинаем сборку..."
local: npm run build
sync: ./dist -> /var/www/my-site
remote: cd /var/www/my-site
remote: pm2 restart app
"#;

        let parsed = parse(script).unwrap();
        assert_eq!(parsed.name.as_deref(), Some("Обновление ноды"));
        assert_eq!(parsed.steps.len(), 5);
        assert!(matches!(
            &parsed.steps[0],
            BastionAction::Local { command } if command.contains("echo")
        ));
        assert!(matches!(
            &parsed.steps[2],
            BastionAction::Sync { local_path, remote_path }
                if local_path == "./dist" && remote_path == "/var/www/my-site"
        ));
    }

    #[test]
    fn rejects_unknown_action() {
        let err = parse("deploy: something").unwrap_err();
        assert!(err.to_string().contains("unknown action"));
    }

    #[test]
    fn rejects_bad_sync() {
        let err = parse("sync: ./dist /var/www").unwrap_err();
        assert!(err.to_string().contains("sync expects"));
    }
}
