import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Server, SyncPreview, SyncProgress } from "../../types";
import { api } from "../../api";
import { useUi } from "../../context/UiContext";
import { formatBackendError, needsPasswordPrompt } from "../../utils/backendError";
import { withServerPassword } from "../../utils/serverAccess";
import { DirectionToggle } from "./DirectionToggle";
import { SyncPreviewList } from "./SyncPreviewList";
import {
  PRESET_IGNORE,
  type PresetIgnoreKey,
  buildIgnorePatterns,
  suggestSyncName,
} from "./syncUtils";

export interface SyncDraft {
  serverId: string;
  localPath: string;
  remotePath: string;
  direction?: "push" | "pull";
  name?: string;
}

interface SyncSetupSheetProps {
  servers: Server[];
  draft: SyncDraft;
  onClose: () => void;
  onSaved?: () => void;
}

const DEFAULT_PRESETS: Record<PresetIgnoreKey, boolean> = {
  node_modules: true,
  git: true,
  target: true,
  dist: false,
};

export function SyncSetupSheet({ servers, draft, onClose, onSaved }: SyncSetupSheetProps) {
  const { toast, confirm, prompt } = useUi();
  const server = useMemo(
    () => servers.find((s) => s.id === draft.serverId),
    [servers, draft.serverId],
  );

  const [name, setName] = useState("");
  const [serverId, setServerId] = useState(draft.serverId);
  const [localPath, setLocalPath] = useState(draft.localPath);
  const [remotePath, setRemotePath] = useState(draft.remotePath);
  const [direction, setDirection] = useState<"push" | "pull">(draft.direction ?? "push");
  const [presets, setPresets] = useState(DEFAULT_PRESETS);
  const [useGitignore, setUseGitignore] = useState(true);
  const [extraIgnore, setExtraIgnore] = useState("");
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [running, setRunning] = useState(false);
  const [savedPairId, setSavedPairId] = useState<string | null>(null);

  useEffect(() => {
    const label = draft.name ?? (server ? suggestSyncName(draft.localPath, server.name) : "");
    setName(label);
  }, [draft, server]);

  useEffect(() => {
    const unlisten = listen<SyncProgress>("sync-progress", (e) => setProgress(e.payload));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const draftInput = () => ({
    server_id: serverId,
    local_path: localPath,
    remote_path: remotePath,
    direction,
    ignore_patterns: buildIgnorePatterns(presets, extraIgnore),
    use_gitignore: useGitignore,
  });

  const analyze = async (password?: string) => {
    if (!serverId || !localPath || !remotePath) {
      toast.warning("Fill in server and both paths");
      return;
    }
    setAnalyzing(true);
    setPreview(null);
    setProgress(null);
    try {
      const result = await api.previewSyncDraft(draftInput(), password);
      setPreview(result);
      toast.success(`Analysis: ${result.total_files} files`);
    } catch (err) {
      if (server && needsPasswordPrompt(err, server.auth_type)) {
        await withServerPassword(server, { toast, prompt, confirm }, analyze);
        return;
      }
      toast.error(formatBackendError(err));
    } finally {
      setAnalyzing(false);
    }
  };

  const savePair = async (): Promise<string | null> => {
    if (!name.trim()) {
      toast.warning("Enter a pair name");
      return null;
    }
    if (!serverId) {
      toast.warning("Select a server");
      return null;
    }
    try {
      const record = await api.createSyncPair({
        name: name.trim(),
        server_id: serverId,
        local_path: localPath,
        remote_path: remotePath,
        direction,
        ignore_patterns: buildIgnorePatterns(presets, extraIgnore),
        use_gitignore: useGitignore,
      });
      setSavedPairId(record.id);
      toast.success("Sync pair saved");
      onSaved?.();
      return record.id;
    } catch (err) {
      toast.error(formatBackendError(err));
      return null;
    }
  };

  const runSync = async (pairId: string, password?: string) => {
    setRunning(true);
    setProgress(null);
    try {
      const result = await api.runSync(pairId, false, password);
      setPreview(result);
      toast.success(`Sync complete: ${result.total_files} files`);
    } catch (err) {
      if (server && needsPasswordPrompt(err, server.auth_type)) {
        await withServerPassword(server, { toast, prompt, confirm }, (pw) => runSync(pairId, pw));
        return;
      }
      toast.error(formatBackendError(err));
    } finally {
      setRunning(false);
    }
  };

  const saveAndRun = async () => {
    const ok = await confirm({
      title: "Run sync",
      message: preview
        ? `Transfer ${preview.total_files} item(s) (${direction})?`
        : "Save pair and run sync without preview?",
      confirmLabel: "Go",
    });
    if (!ok) return;

    const pairId = savedPairId ?? (await savePair());
    if (!pairId) return;
    await runSync(pairId);
  };

  const busy = analyzing || running;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div
        className="bb-surface bb-border flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
        role="dialog"
        aria-labelledby="sync-setup-title"
      >
        <div className="bb-border flex shrink-0 items-start justify-between gap-4 border-b px-6 py-4">
          <div>
            <h2 id="sync-setup-title" className="bb-page-title text-lg">
              Sync setup
            </h2>
            <p className="bb-muted mt-1 text-sm">Compare by mtime + size, transfer only changes</p>
          </div>
          <button type="button" className="bb-muted text-2xl leading-none hover:text-[var(--bb-text)]" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <input
            className="input w-full"
            placeholder="Pair name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <select
            className="input w-full"
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
          >
            <option value="">Select server…</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="bb-muted text-xs">Local path</label>
              <input
                className="input mt-1 w-full font-mono text-xs"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
              />
            </div>
            <div>
              <label className="bb-muted text-xs">Remote path</label>
              <input
                className="input mt-1 w-full font-mono text-xs"
                value={remotePath}
                onChange={(e) => setRemotePath(e.target.value)}
              />
            </div>
          </div>

          <DirectionToggle
            direction={direction}
            localPath={localPath}
            remotePath={remotePath}
            onChange={setDirection}
          />

          <div className="bb-card rounded-xl p-4">
            <p className="bb-text text-sm font-medium">Ignore patterns</p>
            <div className="mt-3 flex flex-wrap gap-3">
              {(Object.keys(PRESET_IGNORE) as PresetIgnoreKey[]).map((key) => (
                <label key={key} className="bb-muted flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={presets[key]}
                    onChange={(e) => setPresets((p) => ({ ...p, [key]: e.target.checked }))}
                  />
                  {PRESET_IGNORE[key]}
                </label>
              ))}
              <label className="bb-muted flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useGitignore}
                  onChange={(e) => setUseGitignore(e.target.checked)}
                />
                Use .gitignore
              </label>
            </div>
            <textarea
              className="input mt-3 min-h-[4rem] w-full font-mono text-xs"
              placeholder="Extra patterns (one per line)"
              value={extraIgnore}
              onChange={(e) => setExtraIgnore(e.target.value)}
            />
          </div>

          <SyncPreviewList preview={preview} loading={analyzing} />

          {progress && (
            <div className="bb-card rounded-lg p-3 text-sm">
              <p className="bb-muted truncate font-mono text-xs">
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
        </div>

        <div className="bb-border flex shrink-0 flex-wrap gap-2 border-t px-6 py-4">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void analyze()}>
            {analyzing ? "Analyzing…" : "Analyze"}
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void savePair()}>
            Save pair
          </button>
          <button
            type="button"
            className="btn-primary ml-auto"
            disabled={busy || !serverId}
            onClick={() => void saveAndRun()}
          >
            {running ? "Syncing…" : "Save & run"}
          </button>
        </div>
      </div>
    </div>
  );
}
