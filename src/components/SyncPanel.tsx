import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Server, SyncPairRecord, SyncPreview, SyncProgress } from "../types";
import { api } from "../api";
import { useUi } from "../context/UiContext";
import { loadUiState, patchSyncFormState } from "../state/persist";

interface SyncPanelProps {
  servers: Server[];
}

export function SyncPanel({ servers }: SyncPanelProps) {
  const { toast, confirm } = useUi();
  const savedForm = loadUiState().syncForm;
  const [pairs, setPairs] = useState<SyncPairRecord[]>([]);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [form, setForm] = useState({
    name: "",
    server_id: savedForm.server_id,
    local_path: savedForm.local_path,
    remote_path: savedForm.remote_path,
    direction: savedForm.direction,
  });

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
    patchSyncFormState({
      server_id: form.server_id,
      local_path: form.local_path,
      remote_path: form.remote_path,
      direction: form.direction,
    });
  }, [form.server_id, form.local_path, form.remote_path, form.direction]);

  const create = async () => {
    await api.createSyncPair(form);
    setForm({ ...form, name: "" });
    toast.success("Sync pair saved");
    await load();
  };

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
    toast.info("Computing diff...");
    const result = await api.runSync(id, true);
    setPreview(result);
    toast.success(`Dry run: ${result.total_files} files to sync`);
  };

  const run = async (id: string) => {
    toast.info("Syncing...");
    setProgress(null);
    const result = await api.runSync(id, false);
    setPreview(result);
    toast.success(`Sync complete: ${result.total_files} files processed`);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="bb-page-title">Sync (rsync-like)</h2>
      <p className="bb-muted mt-1 text-sm">Compare by mtime + size, transfer only changes</p>

      <div className="bb-card mt-6 grid gap-3 rounded-lg p-4 md:grid-cols-2">
        <input
          className="input"
          placeholder="Pair name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <select
          className="input"
          value={form.server_id}
          onChange={(e) => setForm({ ...form, server_id: e.target.value })}
        >
          <option value="">Server...</option>
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          className="input"
          placeholder="Local path"
          value={form.local_path}
          onChange={(e) => setForm({ ...form, local_path: e.target.value })}
        />
        <input
          className="input"
          placeholder="Remote path"
          value={form.remote_path}
          onChange={(e) => setForm({ ...form, remote_path: e.target.value })}
        />
        <select
          className="input"
          value={form.direction}
          onChange={(e) => setForm({ ...form, direction: e.target.value })}
        >
          <option value="push">Push (local → remote)</option>
          <option value="pull">Pull (remote → local)</option>
        </select>
        <button className="btn-primary" onClick={create}>
          Save sync pair
        </button>
      </div>

      {progress && (
        <div className="bb-card mt-4 rounded-lg p-3 text-sm">
          <p>
            {progress.completed}/{progress.total}: {progress.current_file}
          </p>
          <div className="bb-progress-track mt-2 h-2">
            <div
              className="bb-progress-bar"
              style={{
                width: progress.total
                  ? `${(progress.completed / progress.total) * 100}%`
                  : "0%",
              }}
            />
          </div>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {pairs.map((pair) => (
          <div key={pair.id} className="bb-card rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="bb-text font-medium">{pair.name}</p>
                <p className="bb-muted mt-1 text-xs">
                  {pair.direction}: {pair.local_path} ↔ {pair.remote_path}
                </p>
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary text-xs" onClick={() => dryRun(pair.id)}>
                  Dry run
                </button>
                <button className="btn-primary text-xs" onClick={() => run(pair.id)}>
                  Sync
                </button>
                <button
                  className="btn-secondary text-xs text-[var(--bb-danger)]"
                  onClick={() => remove(pair.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {preview && preview.items.length > 0 && (
        <div className="mt-6">
          <h3 className="bb-text text-sm font-semibold">Preview ({preview.total_files})</h3>
          <div className="bb-panel mt-2 max-h-64 overflow-y-auto">
            {preview.items.map((item, i) => (
              <div
                key={i}
                className="bb-border bb-text flex gap-3 border-b px-3 py-2 font-mono text-xs last:border-b-0"
              >
                <span className="bb-accent shrink-0">{item.action}</span>
                <span className="flex-1 truncate">{item.path}</span>
                <span className="bb-muted shrink-0">{item.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
