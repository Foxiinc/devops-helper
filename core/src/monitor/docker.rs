use serde::{Deserialize, Serialize};

use crate::db::{Database, Server};
use crate::error::{CoreError, CoreResult};
use crate::session::SessionManager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub cpu_percent: f64,
    pub mem_usage: String,
    pub mem_percent: f64,
    #[serde(default)]
    pub processes: Vec<ContainerProcess>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerProcess {
    pub pid: u32,
    pub user: String,
    pub command: String,
}

const DOCKER_PS_CMD: &str =
    "docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}' 2>&1";

const DOCKER_STATS_CMD: &str =
    "docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}' 2>&1";

pub struct DockerMonitor;

impl DockerMonitor {
    pub async fn list_containers(
        sessions: &SessionManager,
        server: &Server,
        password: Option<String>,
        private_key_pem: Option<Vec<u8>>,
        known_fingerprint: Option<String>,
    ) -> CoreResult<Vec<DockerContainer>> {
        let (ps_out, ps_code) = sessions
            .exec_command(
                server,
                DOCKER_PS_CMD,
                password.clone(),
                private_key_pem.clone(),
                known_fingerprint.clone(),
            )
            .await?;

        if ps_code != 0 {
            return Err(map_docker_error(&ps_out));
        }

        let (stats_out, stats_code) = sessions
            .exec_command(
                server,
                DOCKER_STATS_CMD,
                password,
                private_key_pem,
                known_fingerprint,
            )
            .await?;

        let stats = if stats_code == 0 {
            parse_stats(&stats_out)
        } else {
            std::collections::HashMap::new()
        };

        parse_ps(&ps_out, &stats)
    }

    pub async fn list_containers_for_server(
        sessions: &SessionManager,
        db: &Database,
        server: &Server,
    ) -> CoreResult<Vec<DockerContainer>> {
        let (password, private_key_pem, known_fingerprint) =
            SessionManager::prepare_exec_credentials(db, server)?;
        Self::list_containers(
            sessions,
            server,
            password,
            private_key_pem,
            known_fingerprint,
        )
        .await
    }

    pub async fn list_container_processes(
        sessions: &SessionManager,
        server: &Server,
        container: &str,
        password: Option<String>,
        private_key_pem: Option<Vec<u8>>,
        known_fingerprint: Option<String>,
    ) -> CoreResult<Vec<ContainerProcess>> {
        let command = format!("docker top {container} -o pid,user,cmd 2>&1");

        let (output, code) = sessions
            .exec_command(
                server,
                &command,
                password,
                private_key_pem,
                known_fingerprint,
            )
            .await?;

        if code != 0 {
            return Err(map_docker_error(&output));
        }

        parse_docker_top(&output)
    }

    pub async fn list_container_processes_for_server(
        sessions: &SessionManager,
        db: &Database,
        server: &Server,
        container: &str,
    ) -> CoreResult<Vec<ContainerProcess>> {
        let (password, private_key_pem, known_fingerprint) =
            SessionManager::prepare_exec_credentials(db, server)?;
        Self::list_container_processes(
            sessions,
            server,
            container,
            password,
            private_key_pem,
            known_fingerprint,
        )
        .await
    }
}

fn map_docker_error(output: &str) -> CoreError {
    let lower = output.to_lowercase();
    if lower.contains("command not found") || lower.contains("not found") && lower.contains("docker")
    {
        CoreError::Other("Docker is not installed on this server".into())
    } else if lower.contains("permission denied") || lower.contains("cannot connect to the docker daemon")
    {
        CoreError::Other(
            "Docker permission denied — add the SSH user to the `docker` group or run as root".into(),
        )
    } else {
        CoreError::Other(format!("docker error: {}", output.trim()))
    }
}

fn parse_ps(
    output: &str,
    stats: &std::collections::HashMap<String, (f64, String, f64)>,
) -> CoreResult<Vec<DockerContainer>> {
    let mut containers = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.splitn(4, '|').collect();
        if parts.len() < 4 {
            continue;
        }

        let name = parts[1].trim().trim_start_matches('/').to_string();
        let (cpu, mem_usage, mem_pct) = stats
            .get(&name)
            .cloned()
            .unwrap_or((0.0, "-".into(), 0.0));

        containers.push(DockerContainer {
            id: parts[0].trim().to_string(),
            name,
            image: parts[2].trim().to_string(),
            status: parts[3].trim().to_string(),
            cpu_percent: cpu,
            mem_usage,
            mem_percent: mem_pct,
            processes: Vec::new(),
        });
    }

    Ok(containers)
}

fn parse_stats(output: &str) -> std::collections::HashMap<String, (f64, String, f64)> {
    let mut map = std::collections::HashMap::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.splitn(4, '|').collect();
        if parts.len() < 4 {
            continue;
        }

        let name = parts[0].trim().trim_start_matches('/').to_string();
        let cpu = parts[1].trim().trim_end_matches('%').parse().unwrap_or(0.0);
        let mem_pct = parts[3].trim().trim_end_matches('%').parse().unwrap_or(0.0);

        map.insert(
            name,
            (cpu, parts[2].trim().to_string(), mem_pct),
        );
    }

    map
}

fn parse_docker_top(output: &str) -> CoreResult<Vec<ContainerProcess>> {
    let mut lines = output.lines();
    let _header = lines.next();

    let mut processes = Vec::new();
    for line in lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.splitn(3, char::is_whitespace).collect();
        if parts.len() < 3 {
            continue;
        }

        let pid: u32 = parts[0].parse().unwrap_or(0);
        if pid == 0 {
            continue;
        }

        processes.push(ContainerProcess {
            pid,
            user: parts[1].to_string(),
            command: parts[2..].join(" "),
        });
    }

    Ok(processes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_docker_ps_and_stats() {
        let ps = "abc123|web|nginx:latest|Up 2 hours\n";
        let stats = "web|1.50%|128MiB / 8GiB|1.60%\n";
        let map = parse_stats(stats);
        let list = parse_ps(ps, &map).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "web");
        assert!((list[0].cpu_percent - 1.5).abs() < 0.01);
    }
}
