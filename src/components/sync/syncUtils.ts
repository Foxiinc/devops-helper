import type { SyncPreview, SyncPreviewItem } from "../../types";

export function formatSyncBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function previewItemIcon(item: SyncPreviewItem): string {
  if (item.action === "upload" && item.reason.includes("new")) return "🟢";
  if (item.action === "download" && item.reason.includes("new")) return "🟢";
  if (item.reason.includes("changed")) return "🟡";
  if (item.action === "delete") return "🔴";
  return "⚪";
}

export function previewItemLabel(item: SyncPreviewItem): string {
  if (item.action === "upload") {
    return item.reason.includes("new") ? "add" : "update";
  }
  if (item.action === "download") {
    return item.reason.includes("new") ? "fetch" : "update";
  }
  return item.action;
}

export function suggestSyncName(localPath: string, serverName: string): string {
  const normalized = localPath.replace(/[/\\]+$/, "");
  const base = normalized.split(/[/\\]/).pop() ?? "project";
  return `${base} → ${serverName}`;
}

export const PRESET_IGNORE = {
  node_modules: "node_modules",
  git: ".git",
  target: "target",
  dist: "dist",
} as const;

export type PresetIgnoreKey = keyof typeof PRESET_IGNORE;

export function buildIgnorePatterns(
  presets: Record<PresetIgnoreKey, boolean>,
  extraLines = "",
): string[] {
  const patterns: string[] = [];
  for (const key of Object.keys(PRESET_IGNORE) as PresetIgnoreKey[]) {
    if (presets[key]) patterns.push(PRESET_IGNORE[key]);
  }
  for (const line of extraLines.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) patterns.push(trimmed);
  }
  return patterns;
}

export function previewSummary(preview: SyncPreview): string {
  const parts = [`${preview.total_files} to sync`];
  const totalBytes = preview.total_bytes ?? 0;
  const skipped = preview.skipped_count ?? 0;
  if (totalBytes > 0) {
    parts.push(formatSyncBytes(totalBytes));
  }
  if (skipped > 0) {
    parts.push(`${skipped} skipped`);
  }
  return parts.join(" · ");
}
