import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Server, SyncPairRecord, SyncPreview, SyncProgress } from "../types";
import { api } from "../api";
import { useUi } from "../context/UiContext";
import { SyncPreviewList } from "./sync/SyncPreviewList";
import { SyncSetupSheet, type SyncDraft } from "./sync/SyncSetupSheet";
import { previewSummary } from "./sync/syncUtils";

interface SyncPanelProps {
  servers: Server[];
  setupDraft: SyncDraft | null;
  onClearSetupDraft: () => void;
}

export function SyncPanel({ servers, setupDraft, onClearSetupDraft }: SyncPanelProps) {
  const { toast, confirm } = useUi();
  const [pairs, setPairs] = useState<SyncPairRecord[]>([]);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = async () => {
    setPairs(await api.listSyncPairs());
  };

  useEffect(() => {
    void load();
    const unlisten = listen<SyncProgress>("sync-progress", (e) => setProgress(e.payload));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (setupDraft) setShowNew(true);
  }, [setupDraft]);

  const remove = async (id: string) => {
    const ok = await confirm({
      title: "Delete sync pair",
      message: "This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await api.deleteSyncPair(id);
    toast.info("Sync pair deleted");
    await load();
  };

  const dryRun = async (id: string) => {
    setAnalyzingId(id);
    setPreview(null);
    try {
      toast.info("Computing diff…");
      const result = await api.runSync(id, true);
      setPreview(result);
      toast.success(previewSummary(result));
    } catch (err) {
      toast.error(String(err));
    } finally {
      setAnalyzingId(null);
    }
  };

  const run = async (id: string) => {
    const ok = await confirm({
      title: "Run sync",
      message: "Transfer changed files now?",
      confirmLabel: "Sync",
    });
    if (!ok) return;

    setRunningId(id);
    setProgress(null);
    try {
      toast.info("Syncing…");
      const result = await api.runSync(id, false);
      setPreview(result);
      toast.success(`Done: ${result.total_files} files`);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setRunningId(null);
    }
  };

  const closeSetup = () => {
    setShowNew(false);
    onClearSetupDraft();
  };

  const emptyDraft: SyncDraft = {
    serverId: "",
    localPath: "C:\\Users",
    remotePath: "/home",
    direction: "push",
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="bb-page-title">Sync</h2>
          <p className="bb-muted mt-1 text-sm">
            rsync-like diff (mtime + size). Create pairs from Files or here.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowNew(true)}>
          + New sync pair
        </button>
      </div>

      {progress && (
        <div className="bb-card mt-6 rounded-lg p-3 text-sm">
          <p className="bb-muted truncate font-mono text-xs">
            {progress.completed}/{progress.total}: {progress.current_file}
          </p>
          <div className="bb-progress-track mt-2 h-2">
            <div
              className="bb-progress-bar"
              style={{
                width: progress.total ? `${(progress.completed / progress.total) * 100}%` : "0%",
              }}
            />
          </div>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {pairs.length === 0 && (
          <div className="bb-card bb-muted rounded-xl p-8 text-center text-sm">
            No saved pairs yet. Open <strong>Files</strong>, browse to your project folders, and
            click <strong>Sync this folder</strong>.
          </div>
        )}
        {pairs.map((pair) => {
          const server = servers.find((s) => s.id === pair.server_id);
          return (
            <div key={pair.id} className="bb-card rounded-xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="bb-text font-medium">{pair.name}</p>
                  <p className="bb-muted mt-1 text-xs">
                    {pair.direction === "pull" ? "Pull" : "Push"}
                    {server ? ` · ${server.name}` : ""}
                  </p>
                  <p className="bb-muted mt-2 truncate font-mono text-xs" title={pair.local_path}>
                    {pair.local_path}
                  </p>
                  <p className="bb-muted truncate font-mono text-xs" title={pair.remote_path}>
                    ↔ {pair.remote_path}
                  </p>
                  {(pair.ignore_patterns?.length ?? 0) > 0 && (
                    <p className="bb-muted mt-2 text-xs">
                      Ignore: {pair.ignore_patterns?.join(", ")}
                      {pair.use_gitignore ? " + .gitignore" : ""}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    disabled={analyzingId === pair.id || runningId === pair.id}
                    onClick={() => void dryRun(pair.id)}
                  >
                    {analyzingId === pair.id ? "Analyzing…" : "Analyze"}
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    disabled={analyzingId === pair.id || runningId === pair.id}
                    onClick={() => void run(pair.id)}
                  >
                    {runningId === pair.id ? "Syncing…" : "Run"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs text-[var(--bb-danger)]"
                    onClick={() => void remove(pair.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {preview && (
        <div className="mt-6">
          <h3 className="bb-text mb-2 text-sm font-semibold">Last analysis</h3>
          <SyncPreviewList preview={preview} />
        </div>
      )}

      {showNew && (
        <SyncSetupSheet
          servers={servers}
          draft={setupDraft ?? emptyDraft}
          onClose={closeSetup}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
}
