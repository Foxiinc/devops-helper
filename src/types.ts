export type AuthType = "password" | "key";

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: AuthType;
  key_id?: string;
  folder_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ServerFolder {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface ServerInput {
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: AuthType;
  password?: string;
  key_id?: string;
  folder_id?: string;
}

export interface SessionSummary {
  id: string;
  server_id?: string;
  host: string;
  username: string;
}

export interface HostKeyPrompt {
  prompt_id: string;
  host: string;
  port: number;
  fingerprint: string;
  key_type: string;
  public_key: string;
}

export interface StoredKey {
  id: string;
  name: string;
  public_key: string;
  comment?: string;
  created_at: string;
}

export interface RemoteEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified?: number;
}

export interface TransferResult {
  files_transferred: number;
  dirs_created: number;
}

export interface AuditEntry {
  ts: string;
  action: string;
  detail: string;
  server_id?: string;
}

export interface SyncPairRecord {
  id: string;
  name: string;
  server_id: string;
  local_path: string;
  remote_path: string;
  direction: string;
  ignore_patterns?: string[];
  use_gitignore?: boolean;
  created_at: string;
}

export interface SyncPreviewItem {
  path: string;
  action: string;
  reason: string;
  size_bytes?: number;
}

export interface SyncPreview {
  items: SyncPreviewItem[];
  total_files: number;
  skipped_count?: number;
  total_bytes?: number;
}

export interface SyncDraftInput {
  server_id: string;
  local_path: string;
  remote_path: string;
  direction: string;
  ignore_patterns?: string[];
  use_gitignore?: boolean;
}

export interface SyncProgress {
  current_file: string;
  completed: number;
  total: number;
  bytes_transferred: number;
}

export interface ScenarioRecord {
  id: string;
  name: string;
  description?: string;
  steps_yaml: string;
  is_preset: boolean;
  created_at: string;
}

export interface StepResult {
  step_name: string;
  command: string;
  exit_code: number;
  output: string;
  success: boolean;
}

export interface ScenarioRunResult {
  scenario_name: string;
  steps: StepResult[];
  overall_success: boolean;
}

export type TabId = "terminal" | "settings" | "files" | "sync" | "scenarios" | "monitor" | "updates";

export interface TerminalTab {
  sessionId: string;
  serverId: string;
  title: string;
}

export interface ProcessInfo {
  pid: number;
  user: string;
  cpu_percent: number;
  mem_percent: number;
  comm: string;
  cmdline: string;
  binary_sha256?: string;
  trust_label?: string;
}

export interface ProcessTrustInfo {
  pid: number;
  sha256: string;
  trusted: boolean;
  label?: string;
  notes?: string;
}

export interface TrustedBinary {
  id: string;
  sha256: string;
  label: string;
  notes?: string;
  created_at: string;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  cpu_percent: number;
  mem_usage: string;
  mem_percent: number;
  processes: ContainerProcess[];
}

export interface ContainerProcess {
  pid: number;
  user: string;
  command: string;
}

export interface CveInfo {
  id: string;
  severity?: string;
  summary?: string;
}

export interface PackageUpdate {
  name: string;
  installed: string;
  available: string;
  size?: string;
  cves: CveInfo[];
  max_severity?: string;
}

export interface OsInfo {
  id: string;
  version_id: string;
  pretty_name: string;
  package_manager: string;
  osv_ecosystem: string;
}

export interface UpdatesReport {
  os: OsInfo;
  packages: PackageUpdate[];
  checked_at: string;
}

export interface UpgradeResult {
  success: boolean;
  exit_code: number;
  output: string;
  package_manager: string;
}
