import type { TabId } from "../types";

export interface NavItem {
  id: TabId;
  label: string;
  icon: string;
  /** Always shown — cannot be hidden in settings */
  pinned?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "terminal", label: "Terminal", icon: "▸", pinned: true },
  { id: "monitor", label: "Monitor", icon: "📊" },
  { id: "updates", label: "Updates", icon: "⬆" },
  { id: "files", label: "Files", icon: "📁" },
  { id: "sync", label: "Sync", icon: "⇄" },
  { id: "scenarios", label: "Scenarios", icon: "⚡" },
  { id: "settings", label: "Settings", icon: "⚙", pinned: true },
];

export type NavLayout = "sidebar" | "topbar";

export interface NavPreferences {
  layout: NavLayout;
  monitor: boolean;
  updates: boolean;
  files: boolean;
  sync: boolean;
  scenarios: boolean;
}

export const DEFAULT_NAV_PREFS: NavPreferences = {
  layout: "sidebar",
  monitor: true,
  updates: true,
  files: true,
  sync: true,
  scenarios: true,
};

export type SessionTabLayout = "top" | "none";

/** Sidebar nav → tabs on top of terminal; topbar nav → sessions in server sidebar */
export function sessionLayoutForNav(layout: NavLayout): SessionTabLayout {
  return layout === "topbar" ? "none" : "top";
}

export function visibleNavItems(prefs: NavPreferences): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.pinned) return true;
    if (item.id === "monitor") return prefs.monitor;
    if (item.id === "updates") return prefs.updates;
    if (item.id === "files") return prefs.files;
    if (item.id === "sync") return prefs.sync;
    if (item.id === "scenarios") return prefs.scenarios;
    return true;
  });
}

export function isViewAvailable(view: TabId, prefs: NavPreferences): boolean {
  return visibleNavItems(prefs).some((item) => item.id === view);
}

export function resolveActiveView(view: TabId, prefs: NavPreferences): TabId {
  return isViewAvailable(view, prefs) ? view : "terminal";
}
