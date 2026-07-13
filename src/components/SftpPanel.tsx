import { useEffect, useMemo, useState } from "react";
import type { RemoteEntry, Server } from "../types";
import { api } from "../api";
import { useUi } from "../context/UiContext";
import { formatBackendError, needsPasswordPrompt } from "../utils/backendError";
import { withServerPassword } from "../utils/serverAccess";
import { loadUiState, patchSftpState } from "../state/persist";

interface SftpPanelProps {
  servers: Server[];
  onOpenSyncSetup?: (draft: {
    serverId: string;
    localPath: string;
    remotePath: string;
    direction?: "push" | "pull";
  }) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parentLocalPath(path: string): string | null {
  const normalized = path.replace(/[/\\]+$/, "");
  const match = normalized.match(/^(.*)[/\\][^/\\]+$/);
  if (!match) return null;
  const parent = match[1];
  if (/^[A-Za-z]:$/i.test(parent)) return `${parent}\\`;
  return parent || null;
}

function parentRemotePath(path: string): string | null {
  const normalized = path.replace(/\/+$/, "") || "/";
  if (normalized === "/") return null;
  const idx = normalized.lastIndexOf("/");
  return idx <= 0 ? "/" : normalized.slice(0, idx);
}

function joinRemote(base: string, name: string): string {
  if (base.endsWith("/")) return `${base}${name}`;
  return `${base}/${name}`;
}

export function SftpPanel({ servers, onOpenSyncSetup }: SftpPanelProps) {
  const { toast, prompt, confirm } = useUi();
  const saved = loadUiState().sftp;

  const [serverId, setServerId] = useState(saved.serverId);
  const [localPath, setLocalPath] = useState(saved.localPath);
  const [remotePath, setRemotePath] = useState(saved.remotePath);
  const [localEntries, setLocalEntries] = useState<RemoteEntry[]>([]);
  const [remoteEntries, setRemoteEntries] = useState<RemoteEntry[]>([]);
  const [selectedLocal, setSelectedLocal] = useState<RemoteEntry | null>(null);
  const [selectedRemote, setSelectedRemote] = useState<RemoteEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [authBlocked, setAuthBlocked] = useState(false);

  const server = useMemo(
    () => servers.find((s) => s.id === serverId),
    [servers, serverId],
  );

  const loadLocal = async (path: string) => {
    try {
      setLocalEntries(await api.listLocalDir(path));
      setLocalPath(path);
      setSelectedLocal(null);
    } catch (err) {
      toast.error(formatBackendError(err));
    }
  };

  const loadRemote = async (path: string, password?: string) => {
    if (!serverId || !server) return;
    try {
      setRemoteEntries(await api.listRemoteDir(serverId, path, password));
      setRemotePath(path);
      setSelectedRemote(null);
      setAuthBlocked(false);
    } catch (err) {
      if (needsPasswordPrompt(err, server.auth_type)) {
        setAuthBlocked(true);
        return;
      }
      toast.error(formatBackendError(err));
    }
  };

  const unlockRemote = async (path: string) => {
    if (!server) return;
    await withServerPassword(server, { toast, prompt, confirm }, (password) =>
      api.listRemoteDir(serverId, path, password).then((entries) => {
        setRemoteEntries(entries);
        setRemotePath(path);
        setSelectedRemote(null);
        setAuthBlocked(false);
      }),
    );
  };

  useEffect(() => {
    void loadLocal(localPath);
  }, []);

  useEffect(() => {
    patchSftpState({ serverId, localPath, remotePath });
  }, [serverId, localPath, remotePath]);

  useEffect(() => {
    if (serverId) void loadRemote(remotePath);
  }, [serverId]);

  useEffect(() => {
    setAuthBlocked(false);
  }, [serverId]);

  const refresh = async () => {
    setLoading(true);
    await Promise.all([
      loadLocal(localPath),
      serverId ? loadRemote(remotePath) : Promise.resolve(),
    ]);
    setLoading(false);
  };

  const upload = async () => {
    if (!selectedLocal || !serverId || !server) return;
    const remoteTarget = joinRemote(remotePath, selectedLocal.name);

    setTransferring(true);
    const label = selectedLocal.is_dir ? selectedLocal.name : selectedLocal.name;
    toast.info(
      selectedLocal.is_dir
        ? `Uploading folder ${label}…`
        : `Uploading ${label}…`,
    );

    const doUpload = async (password?: string) => {
      if (selectedLocal.is_dir) {
        const result = await api.uploadDir(
          serverId,
          selectedLocal.path,
          remoteTarget,
          password,
        );
        toast.success(
          `Uploaded folder ${label} (${result.files_transferred} files, ${result.dirs_created} dirs)`,
        );
      } else {
        await api.uploadFile(serverId, selectedLocal.path, remoteTarget, password);
        toast.success(`Uploaded ${label}`);
      }
      await loadRemote(remotePath, password);
    };

    try {
      await doUpload();
    } catch (err) {
      if (needsPasswordPrompt(err, server.auth_type)) {
        await withServerPassword(server, { toast, prompt, confirm }, doUpload);
      } else {
        toast.error(formatBackendError(err));
      }
    } finally {
      setTransferring(false);
    }
  };

  const download = async () => {
    if (!selectedRemote || !serverId || !server) return;
    const localTarget = `${localPath}\\${selectedRemote.name}`;

    setTransferring(true);
    toast.info(
      selectedRemote.is_dir
        ? `Downloading folder ${selectedRemote.name}…`
        : `Downloading ${selectedRemote.name}…`,
    );

    const doDownload = async (password?: string) => {
      if (selectedRemote.is_dir) {
        const result = await api.downloadDir(
          serverId,
          selectedRemote.path,
          localTarget,
          password,
        );
        toast.success(
          `Downloaded folder ${selectedRemote.name} (${result.files_transferred} files, ${result.dirs_created} dirs)`,
        );
      } else {
        await api.downloadFile(serverId, selectedRemote.path, localTarget, password);
        toast.success(`Downloaded to ${localTarget}`);
      }
      await loadLocal(localPath);
    };

    try {
      await doDownload();
    } catch (err) {
      if (needsPasswordPrompt(err, server.auth_type)) {
        await withServerPassword(server, { toast, prompt, confirm }, doDownload);
      } else {
        toast.error(formatBackendError(err));
      }
    } finally {
      setTransferring(false);
    }
  };

  const renderEntries = (
    entries: RemoteEntry[],
    selected: RemoteEntry | null,
    onSelect: (e: RemoteEntry) => void,
    onNavigate: (e: RemoteEntry) => void,
    canGoUp: boolean,
    onGoUp: () => void,
  ) => (
    <>
      {canGoUp && (
        <button
          type="button"
          className="bb-text bb-row-hover bb-border flex w-full shrink-0 items-center gap-2 border-b px-3 py-1.5 text-left text-sm"
          onClick={onGoUp}
          onDoubleClick={onGoUp}
        >
          <span>📁</span>
          <span className="flex-1 font-medium">..</span>
        </button>
      )}
      {entries.map((entry) => (
        <button
          type="button"
          key={entry.path}
          className={`bb-text bb-row-hover flex w-full shrink-0 items-center gap-2 px-3 py-1.5 text-left text-sm ${
            selected?.path === entry.path ? "bb-row-selected" : ""
          }`}
          onClick={() => onSelect(entry)}
          onDoubleClick={() => entry.is_dir && onNavigate(entry)}
        >
          <span>{entry.is_dir ? "📁" : "📄"}</span>
          <span className="flex-1 truncate">{entry.name}</span>
          {!entry.is_dir && (
            <span className="bb-muted text-xs">{formatSize(entry.size)}</span>
          )}
        </button>
      ))}
    </>
  );

  const goLocalUp = () => {
    const parent = parentLocalPath(localPath);
    if (parent) void loadLocal(parent);
  };

  const goRemoteUp = () => {
    const parent = parentRemotePath(remotePath);
    if (parent) void loadRemote(parent);
  };

  const busy = loading || transferring;
  const uploadLabel = selectedLocal?.is_dir ? "Upload folder →" : "Upload →";
  const downloadLabel = selectedRemote?.is_dir ? "← Download folder" : "← Download";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-4">
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3">
        <h2 className="bb-page-title">File Transfer</h2>
        <select
          className="input max-w-xs"
          value={serverId}
          onChange={(e) => setServerId(e.target.value)}
        >
          <option value="">Select server...</option>
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="btn-secondary" onClick={() => void refresh()} disabled={busy}>
          Refresh
        </button>
        <button
          className="btn-primary"
          onClick={() => void upload()}
          disabled={!selectedLocal || !serverId || busy}
        >
          {uploadLabel}
        </button>
        <button
          className="btn-primary"
          onClick={() => void download()}
          disabled={!selectedRemote || !serverId || busy}
        >
          {downloadLabel}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={!serverId || busy}
          onClick={() =>
            onOpenSyncSetup?.({
              serverId,
              localPath,
              remotePath,
              direction: "push",
            })
          }
          title="Create sync pair from current folder paths"
        >
          ⟳ Sync this folder
        </button>
      </div>

      {authBlocked && (
        <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <span>Stored password cannot be decrypted — enter it again to browse remote files.</span>
          <button
            type="button"
            className="btn-primary px-2 py-1 text-xs"
            onClick={() => void unlockRemote(remotePath)}
          >
            Enter password
          </button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 overflow-hidden">
        <div className="bb-panel flex min-h-0 flex-col overflow-hidden">
          <div className="bb-border shrink-0 border-b p-2">
            <p className="bb-muted text-xs">Local (Windows)</p>
            <input
              className="input mt-1 font-mono text-xs"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void loadLocal(localPath)}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {renderEntries(
              localEntries,
              selectedLocal,
              setSelectedLocal,
              (e) => void loadLocal(e.path),
              parentLocalPath(localPath) !== null,
              goLocalUp,
            )}
          </div>
        </div>

        <div className="bb-panel flex min-h-0 flex-col overflow-hidden">
          <div className="bb-border shrink-0 border-b p-2">
            <p className="bb-muted text-xs">Remote (SFTP)</p>
            <input
              className="input mt-1 font-mono text-xs"
              value={remotePath}
              onChange={(e) => setRemotePath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void loadRemote(remotePath)}
              disabled={!serverId}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {serverId ? (
              renderEntries(
                remoteEntries,
                selectedRemote,
                setSelectedRemote,
                (e) => void loadRemote(e.path),
                parentRemotePath(remotePath) !== null,
                goRemoteUp,
              )
            ) : (
              <p className="bb-muted p-4 text-sm">Select a server to browse remote files</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
