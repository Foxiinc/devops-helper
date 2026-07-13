import { useCallback, useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { AuditEntry } from "../types";
import { api, logUiAction } from "../api";

const SHORTCUTS = [
  { keys: "Ctrl+Shift+C", action: "Copy terminal selection" },
  { keys: "Ctrl+Shift+V", action: "Paste into terminal" },
  { keys: "Ctrl+Insert", action: "Copy terminal selection (Windows Terminal style)" },
  { keys: "Shift+Insert", action: "Paste into terminal (Windows Terminal style)" },
];

export function ActivityLogSection() {
  const [logPath, setLogPath] = useState("");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setLogPath(await api.getActivityLogPath());
      setEntries(await api.readActivityLog(150));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openLogFolder = async () => {
    if (!logPath) return;
    try {
      await revealItemInDir(logPath);
      logUiAction("ui.open_activity_log", logPath);
    } catch {
      // ignore
    }
  };

  return (
    <>
      <section>
        <h3 className="bb-text text-sm font-semibold uppercase tracking-wide">
          Keyboard shortcuts
        </h3>
        <p className="bb-muted mt-1 text-sm">Terminal — selection must be highlighted first for copy</p>
        <div className="bb-card mt-4 overflow-hidden rounded-xl">
          <table className="w-full text-left text-sm">
            <tbody>
              {SHORTCUTS.map((row) => (
                <tr key={row.keys} className="bb-border border-b last:border-b-0">
                  <td className="px-4 py-2 font-mono text-xs">{row.keys}</td>
                  <td className="bb-muted px-4 py-2">{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="bb-text text-sm font-semibold uppercase tracking-wide">
              Activity log
            </h3>
            <p className="bb-muted mt-1 text-sm">
              All API calls and UI actions (passwords redacted)
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary text-sm" onClick={() => void refresh()} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
            <button type="button" className="btn-secondary text-sm" onClick={() => void openLogFolder()} disabled={!logPath}>
              Open log file
            </button>
          </div>
        </div>
        {logPath && (
          <p className="bb-muted mt-2 break-all font-mono text-xs">{logPath}</p>
        )}
        <div className="bb-card mt-3 max-h-64 overflow-y-auto rounded-xl p-2 font-mono text-xs">
          {entries.length === 0 && (
            <p className="bb-muted p-2">No entries yet</p>
          )}
          {[...entries].reverse().map((entry, i) => (
            <div key={`${entry.ts}-${i}`} className="bb-border border-b px-2 py-1.5 last:border-b-0">
              <div className="flex flex-wrap gap-2">
                <span className="bb-muted">{new Date(entry.ts).toLocaleString()}</span>
                <span className="bb-accent">{entry.action}</span>
                {entry.server_id && (
                  <span className="bb-muted">server:{entry.server_id.slice(0, 8)}…</span>
                )}
              </div>
              {entry.detail && (
                <p className="bb-muted mt-0.5 break-all">{entry.detail}</p>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
