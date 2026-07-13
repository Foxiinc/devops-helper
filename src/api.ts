import { invoke as rawInvoke } from "@tauri-apps/api/core";
import type {
  HostKeyPrompt,
  RemoteEntry,
  TransferResult,
  ScenarioRecord,
  ScenarioRunResult,
  Server,
  ServerFolder,
  ServerInput,
  SessionSummary,
  StoredKey,
  SyncPairRecord,
  SyncPreview,
  SyncDraftInput,
  ProcessInfo,
  ProcessTrustInfo,
  TrustedBinary,
  DockerContainer,
  ContainerProcess,
  UpdatesReport,
  UpgradeResult,
  AuditEntry,
} from "./types";

const SKIP_AUDIT = new Set([
  "send_terminal_input",
  "resize_terminal",
  "read_activity_log",
  "log_action",
  "list_servers",
  "list_active_sessions",
]);

const REDACT_KEYS = new Set(["password", "privateKey", "private_key_pem"]);

function sanitizeValue(key: string, value: unknown): unknown {
  if (REDACT_KEYS.has(key)) {
    return "***";
  }
  if (key === "input" && value && typeof value === "object") {
    const obj = { ...(value as Record<string, unknown>) };
    if ("password" in obj) obj.password = "***";
    return obj;
  }
  if (key === "data" && typeof value === "string" && value.length > 80) {
    return `<${value.length} bytes>`;
  }
  return value;
}

function sanitizeArgs(args?: Record<string, unknown>): string {
  if (!args) return "";
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = sanitizeValue(key, value);
  }
  try {
    return JSON.stringify(out);
  } catch {
    return String(args);
  }
}

function serverIdFromArgs(args?: Record<string, unknown>): string | undefined {
  if (!args) return undefined;
  if (typeof args.serverId === "string") return args.serverId;
  if (typeof args.server_id === "string") return args.server_id;
  if (args.input && typeof args.input === "object") {
    const input = args.input as Record<string, unknown>;
    if (typeof input.server_id === "string") return input.server_id;
  }
  return undefined;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!SKIP_AUDIT.has(cmd)) {
    void rawInvoke("log_action", {
      action: cmd,
      detail: sanitizeArgs(args) || undefined,
      serverId: serverIdFromArgs(args),
    }).catch(() => {});
  }
  return rawInvoke<T>(cmd, args);
}

/** Log UI-only actions (navigation, hotkeys, etc.) */
export function logUiAction(action: string, detail?: string, serverId?: string) {
  void rawInvoke("log_action", { action, detail, serverId }).catch(() => {});
}

export const api = {
  listServers: () => invoke<Server[]>("list_servers"),
  getServer: (id: string) => invoke<Server>("get_server", { id }),
  checkServerCredentials: (serverId: string) =>
    invoke<{ ok: boolean; kind: string; message?: string }>("check_server_credentials", {
      serverId,
    }),
  getVaultStatus: () => invoke<boolean>("get_vault_status"),
  dismissVaultNotice: () => invoke<void>("dismiss_vault_notice"),
  getActivityLogPath: () => invoke<string>("get_activity_log_path"),
  readActivityLog: (limit = 200) => invoke<AuditEntry[]>("read_activity_log", { limit }),
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

  connectSession: (serverId: string, cols: number, rows: number, password?: string) =>
    invoke<SessionSummary>("connect_session", { serverId, cols, rows, password }),
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
  listRemoteDir: (serverId: string, path: string, password?: string) =>
    invoke<RemoteEntry[]>("list_remote_dir", { serverId, path, password }),
  uploadFile: (serverId: string, localPath: string, remotePath: string, password?: string) =>
    invoke<void>("upload_file", { serverId, localPath, remotePath, password }),
  downloadFile: (serverId: string, remotePath: string, localPath: string, password?: string) =>
    invoke<void>("download_file", { serverId, remotePath, localPath, password }),
  uploadDir: (serverId: string, localPath: string, remotePath: string, password?: string) =>
    invoke<TransferResult>("upload_dir", { serverId, localPath, remotePath, password }),
  downloadDir: (serverId: string, remotePath: string, localPath: string, password?: string) =>
    invoke<TransferResult>("download_dir", { serverId, remotePath, localPath, password }),

  listSyncPairs: () => invoke<SyncPairRecord[]>("list_sync_pairs"),
  createSyncPair: (input: {
    name: string;
    server_id: string;
    local_path: string;
    remote_path: string;
    direction: string;
    ignore_patterns?: string[];
    use_gitignore?: boolean;
  }) => invoke<SyncPairRecord>("create_sync_pair", { input }),
  deleteSyncPair: (id: string) => invoke<void>("delete_sync_pair", { id }),
  previewSync: (pairId: string) => invoke<SyncPreview>("preview_sync", { pairId }),
  previewSyncDraft: (input: SyncDraftInput, password?: string) =>
    invoke<SyncPreview>("preview_sync_draft", { input, password }),
  runSync: (pairId: string, dryRun: boolean, password?: string) =>
    invoke<SyncPreview>("run_sync", { pairId, dryRun, password }),

  listScenarios: () => invoke<ScenarioRecord[]>("list_scenarios"),
  createScenario: (input: {
    name: string;
    description?: string;
    steps_yaml: string;
  }) => invoke<ScenarioRecord>("create_scenario", { input }),
  deleteScenario: (id: string) => invoke<void>("delete_scenario", { id }),
  runScenario: (scenarioId: string, serverId: string) =>
    invoke<{ result: ScenarioRunResult }>("run_scenario", { scenarioId, serverId }),

  listProcesses: (serverId: string, password?: string) =>
    invoke<ProcessInfo[]>("list_processes", { serverId, password }),
  refreshProcesses: (serverId: string, password?: string) =>
    invoke<ProcessInfo[]>("refresh_processes", { serverId, password }),
  verifyProcessTrust: (serverId: string, pid: number, password?: string) =>
    invoke<ProcessTrustInfo>("verify_process_trust", { serverId, pid, password }),
  listDockerContainers: (serverId: string, password?: string) =>
    invoke<DockerContainer[]>("list_docker_containers", { serverId, password }),
  listDockerContainerProcesses: (serverId: string, container: string, password?: string) =>
    invoke<ContainerProcess[]>("list_docker_container_processes", {
      serverId,
      container,
      password,
    }),
  listTrustedBinaries: () => invoke<TrustedBinary[]>("list_trusted_binaries"),
  createTrustedBinary: (sha256: string, label: string, notes?: string) =>
    invoke<TrustedBinary>("create_trusted_binary", { sha256, label, notes }),
  deleteTrustedBinary: (id: string) => invoke<void>("delete_trusted_binary", { id }),

  checkUpdates: (serverId: string, includeCve = false, password?: string) =>
    invoke<UpdatesReport>("check_updates", { serverId, includeCve, password }),
  runUpdates: (serverId: string, packages?: string[], password?: string) =>
    invoke<UpgradeResult>("run_updates", { serverId, packages, password }),
};
