import { invoke } from "@tauri-apps/api/core";
import type {
  HostKeyPrompt,
  RemoteEntry,
  ScenarioRecord,
  ScenarioRunResult,
  Server,
  ServerFolder,
  ServerInput,
  SessionSummary,
  StoredKey,
  SyncPairRecord,
  SyncPreview,
  ProcessInfo,
  ProcessTrustInfo,
  TrustedBinary,
  DockerContainer,
  ContainerProcess,
  UpdatesReport,
} from "./types";

export const api = {
  listServers: () => invoke<Server[]>("list_servers"),
  getServer: (id: string) => invoke<Server>("get_server", { id }),
  createServer: (input: ServerInput) => invoke<Server>("create_server", { input }),
  updateServer: (id: string, input: ServerInput) =>
    invoke<Server>("update_server", { id, input }),
  deleteServer: (id: string) => invoke<void>("delete_server", { id }),

  listServerFolders: () => invoke<ServerFolder[]>("list_server_folders"),
  createServerFolder: (name: string) =>
    invoke<ServerFolder>("create_server_folder", { name }),
  renameServerFolder: (id: string, name: string) =>
    invoke<ServerFolder>("rename_server_folder", { id, name }),
  deleteServerFolder: (id: string) => invoke<void>("delete_server_folder", { id }),

  trustHostKey: (prompt: HostKeyPrompt) =>
    invoke("trust_host_key", {
      promptId: prompt.prompt_id,
      host: prompt.host,
      port: prompt.port,
      keyType: prompt.key_type,
      fingerprint: prompt.fingerprint,
      publicKey: prompt.public_key,
    }),
  rejectHostKey: (promptId: string) =>
    invoke<void>("reject_host_key", { promptId }),

  connectSession: (serverId: string, cols: number, rows: number) =>
    invoke<SessionSummary>("connect_session", { serverId, cols, rows }),
  closeSession: (sessionId: string) =>
    invoke<void>("close_session", { sessionId }),
  sendTerminalInput: (sessionId: string, data: string) =>
    invoke<void>("send_terminal_input", { sessionId, data }),
  resizeTerminal: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("resize_terminal", { sessionId, cols, rows }),
  listActiveSessions: () => invoke<SessionSummary[]>("list_active_sessions"),

  listKeys: () => invoke<StoredKey[]>("list_keys"),
  generateKey: (name: string, comment?: string) =>
    invoke<StoredKey>("generate_key", { name, comment }),
  importKeysFromSshDir: () => invoke<StoredKey[]>("import_keys_from_ssh_dir"),
  importKeyFromPath: (path: string, name?: string) =>
    invoke<StoredKey>("import_key_from_path", { path, name }),
  deleteKey: (id: string) => invoke<void>("delete_key", { id }),
  copyIdToServer: (serverId: string, keyId: string) =>
    invoke<string>("copy_id_to_server", { serverId, keyId }),

  listLocalDir: (path: string) => invoke<RemoteEntry[]>("list_local_dir", { path }),
  listRemoteDir: (serverId: string, path: string) =>
    invoke<RemoteEntry[]>("list_remote_dir", { serverId, path }),
  uploadFile: (serverId: string, localPath: string, remotePath: string) =>
    invoke<void>("upload_file", { serverId, localPath, remotePath }),
  downloadFile: (serverId: string, remotePath: string, localPath: string) =>
    invoke<void>("download_file", { serverId, remotePath, localPath }),

  listSyncPairs: () => invoke<SyncPairRecord[]>("list_sync_pairs"),
  createSyncPair: (input: {
    name: string;
    server_id: string;
    local_path: string;
    remote_path: string;
    direction: string;
  }) => invoke<SyncPairRecord>("create_sync_pair", { input }),
  deleteSyncPair: (id: string) => invoke<void>("delete_sync_pair", { id }),
  previewSync: (pairId: string) => invoke<SyncPreview>("preview_sync", { pairId }),
  runSync: (pairId: string, dryRun: boolean) =>
    invoke<SyncPreview>("run_sync", { pairId, dryRun }),

  listScenarios: () => invoke<ScenarioRecord[]>("list_scenarios"),
  createScenario: (input: {
    name: string;
    description?: string;
    steps_yaml: string;
  }) => invoke<ScenarioRecord>("create_scenario", { input }),
  deleteScenario: (id: string) => invoke<void>("delete_scenario", { id }),
  runScenario: (scenarioId: string, serverId: string) =>
    invoke<{ result: ScenarioRunResult }>("run_scenario", { scenarioId, serverId }),

  listProcesses: (serverId: string) =>
    invoke<ProcessInfo[]>("list_processes", { serverId }),
  refreshProcesses: (serverId: string) =>
    invoke<ProcessInfo[]>("refresh_processes", { serverId }),
  verifyProcessTrust: (serverId: string, pid: number) =>
    invoke<ProcessTrustInfo>("verify_process_trust", { serverId, pid }),
  listDockerContainers: (serverId: string) =>
    invoke<DockerContainer[]>("list_docker_containers", { serverId }),
  listDockerContainerProcesses: (serverId: string, container: string) =>
    invoke<ContainerProcess[]>("list_docker_container_processes", {
      serverId,
      container,
    }),
  listTrustedBinaries: () => invoke<TrustedBinary[]>("list_trusted_binaries"),
  createTrustedBinary: (sha256: string, label: string, notes?: string) =>
    invoke<TrustedBinary>("create_trusted_binary", { sha256, label, notes }),
  deleteTrustedBinary: (id: string) => invoke<void>("delete_trusted_binary", { id }),

  checkUpdates: (serverId: string, includeCve = false) =>
    invoke<UpdatesReport>("check_updates", { serverId, includeCve }),
};
