import { invoke } from "@tauri-apps/api/core";
import type { TabId } from "../types";
import {
  DEFAULT_NAV_PREFS,
  resolveActiveView,
  type NavPreferences,
} from "../config/nav";
import {
  DEFAULT_THEME_SETTINGS,
  type ThemeSettings,
} from "../theme/types";

const STORAGE_KEY = "brisk-bastion-ui-v1";

export interface PersistedTerminalTab {
  serverId: string;
  title: string;
}

export interface SftpUiState {
  serverId: string;
  localPath: string;
  remotePath: string;
}

export interface SyncFormUiState {
  server_id: string;
  local_path: string;
  remote_path: string;
  direction: string;
}

export interface AppUiState {
  activeView: TabId;
  terminalTabs: PersistedTerminalTab[];
  activeServerId?: string;
  sftp: SftpUiState;
  syncForm: SyncFormUiState;
  scenariosServerId: string;
  monitorServerId: string;
  updatesServerId: string;
  theme: ThemeSettings;
  navPrefs: NavPreferences;
  collapsedFolders: string[];
}

const DEFAULT_STATE: AppUiState = {
  activeView: "terminal",
  terminalTabs: [],
  sftp: {
    serverId: "",
    localPath: "C:\\Users",
    remotePath: "/home",
  },
  syncForm: {
    server_id: "",
    local_path: "C:\\Users",
    remote_path: "/home",
    direction: "push",
  },
  scenariosServerId: "",
  monitorServerId: "",
  updatesServerId: "",
  theme: { ...DEFAULT_THEME_SETTINGS },
  navPrefs: { ...DEFAULT_NAV_PREFS },
  collapsedFolders: [],
};

function migrateActiveView(view: unknown): TabId {
  if (view === "keys") return "settings";
  if (
    view === "terminal" ||
    view === "settings" ||
    view === "files" ||
    view === "sync" ||
    view === "scenarios" ||
    view === "monitor" ||
    view === "updates"
  ) {
    return view;
  }
  return "terminal";
}

function mergeState(parsed: Partial<AppUiState> & { activeView?: unknown }): AppUiState {
  const navPrefs: NavPreferences = {
    ...DEFAULT_NAV_PREFS,
    ...parsed.navPrefs,
    layout:
      parsed.navPrefs?.layout === "topbar" || parsed.navPrefs?.layout === "sidebar"
        ? parsed.navPrefs.layout
        : DEFAULT_NAV_PREFS.layout,
  };
  return {
    ...DEFAULT_STATE,
    ...parsed,
    activeView: resolveActiveView(migrateActiveView(parsed.activeView), navPrefs),
    sftp: { ...DEFAULT_STATE.sftp, ...parsed.sftp },
    syncForm: { ...DEFAULT_STATE.syncForm, ...parsed.syncForm },
    terminalTabs: parsed.terminalTabs ?? [],
    theme: {
      ...DEFAULT_THEME_SETTINGS,
      ...parsed.theme,
      custom: {
        ...DEFAULT_THEME_SETTINGS.custom,
        ...parsed.theme?.custom,
      },
    },
    navPrefs,
    collapsedFolders: parsed.collapsedFolders ?? [],
  };
}

export function loadUiState(): AppUiState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    return mergeState(JSON.parse(raw) as Partial<AppUiState>);
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/** Load from disk (Tauri) with localStorage fallback. */
export async function hydrateUiState(): Promise<AppUiState> {
  try {
    const raw = await invoke<string>("load_ui_state");
    if (raw.trim()) {
      const state = mergeState(JSON.parse(raw) as Partial<AppUiState>);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return state;
    }
  } catch {
    // not in Tauri or file missing
  }
  return loadUiState();
}

export async function persistUiState(state: AppUiState): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
  try {
    await invoke("save_ui_state", { state: JSON.stringify(state) });
  } catch {
    // ignore outside Tauri
  }
}

export function patchUiState(patch: Partial<AppUiState>): AppUiState {
  const next = { ...loadUiState(), ...patch };
  void persistUiState(next);
  return next;
}

export function patchSftpState(patch: Partial<SftpUiState>): void {
  const current = loadUiState();
  void persistUiState({
    ...current,
    sftp: { ...current.sftp, ...patch },
  });
}

export function patchSyncFormState(patch: Partial<SyncFormUiState>): void {
  const current = loadUiState();
  void persistUiState({
    ...current,
    syncForm: { ...current.syncForm, ...patch },
  });
}
