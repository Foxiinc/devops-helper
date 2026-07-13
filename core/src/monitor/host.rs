use serde::{Deserialize, Serialize};

use crate::db::{Database, Server};
use crate::error::{CoreError, CoreResult};
use crate::session::SessionManager;

/// Single remote command — awk only, no shell loops/printf (avoids quoting/% issues over SSH exec).
const LIST_PROCESSES_CMD: &str = r#"ps -eo pid=,user=,pcpu=,pmem=,comm= --sort=-pcpu 2>/dev/null | head -300 | awk '
$1 ~ /^[0-9]+$/ {
  pid=$1; user=$2; cpu=$3; mem=$4; comm=$5;
  cmd=comm;
  path="/proc/" pid "/cmdline";
  if ((getline raw < path) > 0) {
    gsub(/\000/, " ", raw);
    if (length(raw) > 0) cmd=raw;
  }
  close(path);
  print pid "|" user "|" cpu "|" mem "|" comm "|" cmd;
}'"#;

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

        Ok(parse_process_output(&output))
    }

    pub async fn list_processes_for_server(
        sessions: &SessionManager,
        db: &Database,
        server: &Server,
    ) -> CoreResult<Vec<ProcessInfo>> {
        let (password, private_key_pem, known_fingerprint) =
            SessionManager::prepare_exec_credentials(db, server, None)?;
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

pub fn parse_process_output(output: &str) -> Vec<ProcessInfo> {
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

        let Ok(pid) = parts[0].trim().parse::<u32>() else {
            continue;
        };
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

    processes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pipe_delimited_ps_output() {
        let output = "1234|root|12.5|3.2|nginx|nginx: master process\n5678|www-data|1.0|0.5|nginx|nginx: worker process\n";
        let list = parse_process_output(output);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].pid, 1234);
        assert_eq!(list[0].comm, "nginx");
        assert!(list[0].cmdline.contains("master"));
    }

    #[test]
    fn skips_garbage_lines() {
        let output = "printf '%s|broken|line\n1234|root|1|2|bash|bash\n";
        let list = parse_process_output(output);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].pid, 1234);
    }
}
