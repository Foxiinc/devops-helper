import { useEffect, useState } from "react";
import type { RemoteEntry, Server } from "../types";
import { api } from "../api";
import { useUi } from "../context/UiContext";
import { loadUiState, patchSftpState } from "../state/persist";

interface SftpPanelProps {
  servers: Server[];
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

export function SftpPanel({ servers }: SftpPanelProps) {
  const { toast } = useUi();
  const saved = loadUiState().sftp;

  const [serverId, setServerId] = useState(saved.serverId);
  const [localPath, setLocalPath] = useState(saved.localPath);
  const [remotePath, setRemotePath] = useState(saved.remotePath);
  const [localEntries, setLocalEntries] = useState<RemoteEntry[]>([]);
  const [remoteEntries, setRemoteEntries] = useState<RemoteEntry[]>([]);
  const [selectedLocal, setSelectedLocal] = useState<RemoteEntry | null>(null);
  const [selectedRemote, setSelectedRemote] = useState<RemoteEntry | null>(null);
  const [loading, setLoading] = useState(false);

  const loadLocal = async (path: string) => {
    try {
      setLocalEntries(await api.listLocalDir(path));
      setLocalPath(path);
      setSelectedLocal(null);
    } catch (err) {
      toast.error(String(err));
    }
  };

  const loadRemote = async (path: string) => {
    if (!serverId) return;
    try {
      setRemoteEntries(await api.listRemoteDir(serverId, path));
      setRemotePath(path);
      setSelectedRemote(null);
    } catch (err) {
      toast.error(String(err));
    }
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

  const refresh = async () => {
    setLoading(true);
    await Promise.all([
      loadLocal(localPath),
      serverId ? loadRemote(remotePath) : Promise.resolve(),
    ]);
    setLoading(false);
  };

  const upload = async () => {
    if (!selectedLocal || !serverId || selectedLocal.is_dir) return;
    const remoteFile = remotePath.endsWith("/")
      ? `${remotePath}${selectedLocal.name}`
      : `${remotePath}/${selectedLocal.name}`;
    toast.info(`Uploading ${selectedLocal.name}...`);
    try {
      await api.uploadFile(serverId, selectedLocal.path, remoteFile);
      toast.success(`Uploaded ${selectedLocal.name}`);
      await loadRemote(remotePath);
    } catch (err) {
      toast.error(String(err));
    }
  };

  const download = async () => {
    if (!selectedRemote || !serverId || selectedRemote.is_dir) return;
    const localFile = `${localPath}\\${selectedRemote.name}`;
    toast.info(`Downloading ${selectedRemote.name}...`);
    try {
      await api.downloadFile(serverId, selectedRemote.path, localFile);
      toast.success(`Downloaded to ${localFile}`);
      await loadLocal(localPath);
    } catch (err) {
      toast.error(String(err));
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
    <div className="flex-1 overflow-y-auto">
      {canGoUp && (
        <button
          type="button"
          className="bb-text bb-row-hover bb-border flex w-full items-center gap-2 border-b px-3 py-1.5 text-left text-sm"
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
          className={`bb-text bb-row-hover flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
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
    </div>
  );

  const goLocalUp = () => {
    const parent = parentLocalPath(localPath);
    if (parent) void loadLocal(parent);
  };

  const goRemoteUp = () => {
    const parent = parentRemotePath(remotePath);
    if (parent) void loadRemote(parent);
  };

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
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
        <button className="btn-secondary" onClick={refresh} disabled={loading}>
          Refresh
        </button>
        <button className="btn-primary" onClick={upload} disabled={!selectedLocal || !serverId}>
          Upload →
        </button>
        <button className="btn-primary" onClick={download} disabled={!selectedRemote || !serverId}>
          ← Download
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
        <div className="bb-panel flex flex-col">
          <div className="bb-border border-b p-2">
            <p className="bb-muted text-xs">Local (Windows)</p>
            <input
              className="input mt-1 font-mono text-xs"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadLocal(localPath)}
            />
          </div>
          {renderEntries(
            localEntries,
            selectedLocal,
            setSelectedLocal,
            (e) => loadLocal(e.path),
            parentLocalPath(localPath) !== null,
            goLocalUp,
          )}
        </div>

        <div className="bb-panel flex flex-col">
          <div className="bb-border border-b p-2">
            <p className="bb-muted text-xs">Remote (SFTP)</p>
            <input
              className="input mt-1 font-mono text-xs"
              value={remotePath}
              onChange={(e) => setRemotePath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadRemote(remotePath)}
              disabled={!serverId}
            />
          </div>
          {serverId ? (
            renderEntries(
              remoteEntries,
              selectedRemote,
              setSelectedRemote,
              (e) => loadRemote(e.path),
              parentRemotePath(remotePath) !== null,
              goRemoteUp,
            )
          ) : (
            <p className="bb-muted p-4 text-sm">Select a server to browse remote files</p>
          )}
        </div>
      </div>
    </div>
  );
}
