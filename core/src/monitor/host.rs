use serde::{Deserialize, Serialize};

use crate::db::{Database, Server};
use crate::error::{CoreError, CoreResult};
use crate::session::SessionManager;

const LIST_PROCESSES_CMD: &str = r#"ps -eo pid=,user=,pcpu=,pmem=,comm= --sort=-pcpu 2>/dev/null | head -300 | while read -r pid user cpu mem comm; do
  [ -z "$pid" ] && continue
  cmd=$(tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null | head -c 512)
  printf '%s|%s|%s|%s|%s|%s\n' "$pid" "$user" "$cpu" "$mem" "$comm" "$cmd"
done"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub user: String,
    pub cpu_percent: f64,
    pub mem_percent: f64,
    pub comm: String,
    pub cmdline: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trust_label: Option<String>,
}

pub struct HostMonitor;

impl HostMonitor {
    pub async fn list_processes(
        sessions: &SessionManager,
        server: &Server,
        password: Option<String>,
        private_key_pem: Option<Vec<u8>>,
        known_fingerprint: Option<String>,
    ) -> CoreResult<Vec<ProcessInfo>> {
        let (output, code) = sessions
            .exec_command(
                server,
                LIST_PROCESSES_CMD,
                password,
                private_key_pem,
                known_fingerprint,
            )
            .await?;

        if code != 0 && output.trim().is_empty() {
            return Err(CoreError::Other(format!(
                "failed to list processes (exit {code})"
            )));
        }

        parse_process_output(&output)
    }

    pub async fn list_processes_for_server(
        sessions: &SessionManager,
        db: &Database,
        server: &Server,
    ) -> CoreResult<Vec<ProcessInfo>> {
        let (password, private_key_pem, known_fingerprint) =
            SessionManager::prepare_exec_credentials(db, server)?;
        Self::list_processes(
            sessions,
            server,
            password,
            private_key_pem,
            known_fingerprint,
        )
        .await
    }
}

pub fn parse_process_output(output: &str) -> CoreResult<Vec<ProcessInfo>> {
    let mut processes = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.splitn(6, '|').collect();
        if parts.len() < 5 {
            continue;
        }

        let pid: u32 = parts[0]
            .trim()
            .parse()
            .map_err(|_| CoreError::Other(format!("invalid pid: {}", parts[0])))?;
        let cpu: f64 = parts[2].trim().parse().unwrap_or(0.0);
        let mem: f64 = parts[3].trim().parse().unwrap_or(0.0);
        let cmdline = parts.get(5).unwrap_or(&"").trim().to_string();

        processes.push(ProcessInfo {
            pid,
            user: parts[1].trim().to_string(),
            cpu_percent: cpu,
            mem_percent: mem,
            comm: parts[4].trim().to_string(),
            cmdline,
            binary_sha256: None,
            trust_label: None,
        });
    }

    Ok(processes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pipe_delimited_ps_output() {
        let output = "1234|root|12.5|3.2|nginx|nginx: master process\n5678|www-data|1.0|0.5|nginx|nginx: worker process\n";
        let list = parse_process_output(output).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].pid, 1234);
        assert_eq!(list[0].comm, "nginx");
        assert!(list[0].cmdline.contains("master"));
    }
}
