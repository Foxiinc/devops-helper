pub mod bastion;
pub mod presets;

use std::time::Duration;

use serde::Serialize;

use crate::db::{Database, Server};
use crate::error::CoreResult;
use crate::session::SessionManager;
use crate::sftp::SftpConnectionPool;
use crate::sync::{SyncDirection, SyncEngine, SyncOptions, SyncPair};

pub use bastion::{action_label, parse, BastionAction, ParsedScenario};

const STEP_TIMEOUT_SECS: u64 = 120;

#[derive(Debug, Clone)]
pub struct Scenario {
    pub name: String,
    pub description: Option<String>,
    pub steps: Vec<BastionAction>,
}

impl Scenario {
    pub fn from_bastion(content: &str) -> CoreResult<Self> {
        let parsed = parse(content)?;
        Ok(Self {
            name: parsed
                .name
                .unwrap_or_else(|| "Untitled scenario".to_string()),
            description: None,
            steps: parsed.steps,
        })
    }

    pub fn from_bastion_with_meta(content: &str, name: &str, description: Option<&str>) -> CoreResult<Self> {
        let mut scenario = Self::from_bastion(content)?;
        scenario.name = name.to_string();
        scenario.description = description.map(str::to_string);
        Ok(scenario)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct StepResult {
    pub step_name: String,
    pub command: String,
    pub exit_code: u32,
    pub output: String,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScenarioRunResult {
    pub scenario_name: String,
    pub steps: Vec<StepResult>,
    pub overall_success: bool,
}

pub struct ScenarioRunner;

impl ScenarioRunner {
    pub async fn run<F>(
        sessions: &SessionManager,
        pool: &SftpConnectionPool,
        server: &Server,
        scenario: &Scenario,
        password: Option<String>,
        private_key_pem: Option<Vec<u8>>,
        known_fingerprint: Option<String>,
        mut on_step: F,
    ) -> CoreResult<ScenarioRunResult>
    where
        F: FnMut(StepResult),
    {
        let mut results = Vec::new();
        let mut overall_success = true;

        for step in &scenario.steps {
            let label = action_label(step);
            let step_result = match step {
                BastionAction::Local { command } => {
                    run_local_step(command, &label).await
                }
                BastionAction::Remote { command } => {
                    run_remote_step(
                        sessions,
                        server,
                        command,
                        &label,
                        password.clone(),
                        private_key_pem.clone(),
                        known_fingerprint.clone(),
                    )
                    .await
                }
                BastionAction::Sync {
                    local_path,
                    remote_path,
                } => {
                    run_sync_step(
                        pool,
                        server,
                        local_path,
                        remote_path,
                        &label,
                        password.clone(),
                        private_key_pem.clone(),
                    )
                    .await
                }
            };

            if !step_result.success {
                overall_success = false;
            }

            on_step(step_result.clone());
            results.push(step_result);

            if !results.last().map(|r| r.success).unwrap_or(false) {
                break;
            }
        }

        Ok(ScenarioRunResult {
            scenario_name: scenario.name.clone(),
            steps: results,
            overall_success,
        })
    }

    pub fn load_from_db(db: &Database, id: &str) -> CoreResult<Scenario> {
        let record = db.get_scenario(id)?;
        Scenario::from_bastion_with_meta(
            &record.steps_yaml,
            &record.name,
            record.description.as_deref(),
        )
    }
}

async fn run_local_step(command: &str, label: &str) -> StepResult {
    let command = command.to_string();
    let label = label.to_string();

    let result = tokio::time::timeout(
        Duration::from_secs(STEP_TIMEOUT_SECS),
        tokio::task::spawn_blocking(move || run_local_command(&command)),
    )
    .await;

    match result {
        Ok(Ok(Ok((output, code)))) => StepResult {
            step_name: label.clone(),
            command: label,
            exit_code: code,
            output,
            success: code == 0,
        },
        Ok(Ok(Err(err))) => StepResult {
            step_name: label.clone(),
            command: label,
            exit_code: 255,
            output: err.to_string(),
            success: false,
        },
        Ok(Err(join_err)) => StepResult {
            step_name: label.clone(),
            command: label,
            exit_code: 255,
            output: join_err.to_string(),
            success: false,
        },
        Err(_) => StepResult {
            step_name: label.clone(),
            command: label,
            exit_code: 124,
            output: format!("timed out after {STEP_TIMEOUT_SECS}s"),
            success: false,
        },
    }
}

fn run_local_command(command: &str) -> CoreResult<(String, u32)> {
    #[cfg(windows)]
    let output = std::process::Command::new("cmd")
        .args(["/C", command])
        .output()?;

    #[cfg(not(windows))]
    let output = std::process::Command::new("sh")
        .args(["-c", command])
        .output()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = if stderr.is_empty() {
        stdout.into_owned()
    } else if stdout.is_empty() {
        stderr.into_owned()
    } else {
        format!("{stdout}{stderr}")
    };

    Ok((combined, output.status.code().unwrap_or(1) as u32))
}

async fn run_remote_step(
    sessions: &SessionManager,
    server: &Server,
    command: &str,
    label: &str,
    password: Option<String>,
    private_key_pem: Option<Vec<u8>>,
    known_fingerprint: Option<String>,
) -> StepResult {
    let command = command.to_string();
    let label = label.to_string();

    let result = tokio::time::timeout(
        Duration::from_secs(STEP_TIMEOUT_SECS),
        sessions.exec_command(
            server,
            &command,
            password,
            private_key_pem,
            known_fingerprint,
        ),
    )
    .await;

    match result {
        Ok(Ok((output, exit_code))) => StepResult {
            step_name: label.clone(),
            command: label,
            exit_code,
            output,
            success: exit_code == 0,
        },
        Ok(Err(err)) => StepResult {
            step_name: label.clone(),
            command: label,
            exit_code: 255,
            output: err.to_string(),
            success: false,
        },
        Err(_) => StepResult {
            step_name: label.clone(),
            command: label,
            exit_code: 124,
            output: format!("timed out after {STEP_TIMEOUT_SECS}s"),
            success: false,
        },
    }
}

async fn run_sync_step(
    pool: &SftpConnectionPool,
    server: &Server,
    local_path: &str,
    remote_path: &str,
    label: &str,
    password: Option<String>,
    private_key_pem: Option<Vec<u8>>,
) -> StepResult {
    let pair = SyncPair {
        id: uuid::Uuid::new_v4().to_string(),
        name: "bastion-sync".into(),
        server_id: server.id.clone(),
        local_path: local_path.to_string(),
        remote_path: remote_path.to_string(),
        direction: SyncDirection::Push,
        options: SyncOptions::default(),
    };

    match SyncEngine::run(
        pool,
        &pair,
        server,
        password,
        private_key_pem,
        false,
        |_| {},
    )
    .await
    {
        Ok(preview) => {
            let summary = preview
                .items
                .iter()
                .map(|item| format!("{} ({})", item.path, item.reason))
                .collect::<Vec<_>>()
                .join("\n");
            StepResult {
                step_name: label.to_string(),
                command: label.to_string(),
                exit_code: 0,
                output: if summary.is_empty() {
                    "nothing to sync".into()
                } else {
                    format!("synced {} file(s):\n{summary}", preview.total_files)
                },
                success: true,
            }
        }
        Err(err) => StepResult {
            step_name: label.to_string(),
            command: label.to_string(),
            exit_code: 255,
            output: err.to_string(),
            success: false,
        },
    }
}
