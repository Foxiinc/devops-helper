mod commands;
mod state;

use std::sync::Arc;

use brisk_bastion_core::session::SessionEvent;
use state::AppState;
use tauri::{Emitter, Manager};

/// Stop WebView2 from stealing Ctrl+Shift+C (element picker) so xterm can copy.
#[cfg(windows)]
fn prevent_default_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_prevent_default::PlatformOptions;

    #[cfg(debug_assertions)]
    {
        use tauri_plugin_prevent_default::Flags;

        tauri_plugin_prevent_default::Builder::new()
            .with_flags(Flags::debug())
            .platform(PlatformOptions::new().browser_accelerator_keys(false))
            .build()
    }
    #[cfg(not(debug_assertions))]
    {
        tauri_plugin_prevent_default::Builder::new()
            .platform(PlatformOptions::new().browser_accelerator_keys(false))
            .build()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    #[cfg(windows)]
    let builder = builder.plugin(prevent_default_plugin());

    builder
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir).ok();

            let mut app_state = AppState::new(data_dir).expect("failed to initialize app state");

            let (event_tx, mut event_rx) = tokio::sync::mpsc::unbounded_channel::<SessionEvent>();
            app_state.set_event_sender(event_tx);

            let app_state = Arc::new(app_state);
            let app_handle = app.handle().clone();
            let state_for_events = app_state.clone();

            tauri::async_runtime::spawn(async move {
                while let Some(event) = event_rx.recv().await {
                    match &event {
                        SessionEvent::Output { session_id, data } => {
                            let encoded = base64::Engine::encode(
                                &base64::engine::general_purpose::STANDARD,
                                data,
                            );
                            let _ = app_handle.emit(
                                "terminal-output",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "data": encoded,
                                }),
                            );
                        }
                        SessionEvent::Closed {
                            session_id,
                            exit_code,
                        } => {
                            let _ = app_handle.emit(
                                "terminal-closed",
                                serde_json::json!({
                                    "sessionId": session_id,
                                    "exitCode": exit_code,
                                }),
                            );
                            let _ = state_for_events.sessions.close(session_id).await;
                        }
                        SessionEvent::HostKeyPrompt(prompt) => {
                            let _ = app_handle.emit("host-key-prompt", prompt);
                        }
                    }
                }
            });

            app.manage(app_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_servers,
            commands::get_server,
            commands::check_server_credentials,
            commands::get_vault_status,
            commands::dismiss_vault_notice,
            commands::log_action,
            commands::get_activity_log_path,
            commands::read_activity_log,
            commands::create_server,
            commands::update_server,
            commands::delete_server,
            commands::list_server_folders,
            commands::create_server_folder,
            commands::rename_server_folder,
            commands::delete_server_folder,
            commands::list_known_hosts,
            commands::trust_host_key,
            commands::reject_host_key,
            commands::connect_session,
            commands::close_session,
            commands::send_terminal_input,
            commands::resize_terminal,
            commands::list_active_sessions,
            commands::list_keys,
            commands::generate_key,
            commands::import_keys_from_ssh_dir,
            commands::import_key_from_path,
            commands::delete_key,
            commands::copy_id_to_server,
            commands::list_local_dir,
            commands::list_remote_dir,
            commands::upload_file,
            commands::download_file,
            commands::upload_dir,
            commands::download_dir,
            commands::list_sync_pairs,
            commands::create_sync_pair,
            commands::delete_sync_pair,
            commands::preview_sync,
            commands::preview_sync_draft,
            commands::run_sync,
            commands::list_scenarios,
            commands::create_scenario,
            commands::delete_scenario,
            commands::run_scenario,
            commands::load_ui_state,
            commands::save_ui_state,
            commands::list_processes,
            commands::refresh_processes,
            commands::verify_process_trust,
            commands::list_docker_containers,
            commands::list_docker_container_processes,
            commands::list_trusted_binaries,
            commands::create_trusted_binary,
            commands::update_trusted_binary,
            commands::delete_trusted_binary,
            commands::check_updates,
            commands::run_updates,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
