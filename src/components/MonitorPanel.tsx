import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ContainerProcess,
  DockerContainer,
  ProcessInfo,
  ProcessTrustInfo,
  Server,
} from "../types";
import { api } from "../api";
import { useUi } from "../context/UiContext";
import { formatBackendError, needsPasswordPrompt } from "../utils/backendError";
import { withServerPassword } from "../utils/serverAccess";
import { loadUiState, patchUiState } from "../state/persist";

interface MonitorPanelProps {
  servers: Server[];
}

type MonitorMode = "host" | "docker";
type HostSortKey = "pid" | "user" | "cpu_percent" | "mem_percent" | "command";
type DockerSortKey = "name" | "cpu_percent" | "mem_percent" | "status";
type SortDir = "asc" | "desc";

const REFRESH_MS = 5000;

function sortDirLabel(active: boolean, dir: SortDir) {
  if (!active) return " ↕";
  return dir === "asc" ? " ↑" : " ↓";
}

function SortableHeader({
  label,
  active,
  dir,
  onClick,
  className = "",
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  className?: string;
}) {
  return (
    <th className={`py-2 pr-2 ${className}`}>
      <button
        type="button"
        className={`bb-muted inline-flex items-center gap-0.5 text-xs uppercase tracking-wide hover:text-[var(--bb-text)] ${
          active ? "text-[var(--bb-text)]" : ""
        }`}
        onClick={onClick}
      >
        {label}
        <span className="font-mono text-[10px] opacity-70">{sortDirLabel(active, dir)}</span>
      </button>
    </th>
  );
}

export function MonitorPanel({ servers }: MonitorPanelProps) {
  const { toast, prompt, confirm } = useUi();
  const [selectedServer, setSelectedServer] = useState(
    () => loadUiState().monitorServerId ?? "",
  );
  const [mode, setMode] = useState<MonitorMode>("host");
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [containerProcs, setContainerProcs] = useState<Record<string, ContainerProcess[]>>({});
  const [trustMap, setTrustMap] = useState<Record<number, ProcessTrustInfo>>({});
  const [filter, setFilter] = useState("");
  const [hostSort, setHostSort] = useState<{ key: HostSortKey; dir: SortDir }>({
    key: "cpu_percent",
    dir: "desc",
  });
  const [dockerSort, setDockerSort] = useState<{ key: DockerSortKey; dir: SortDir }>({
    key: "cpu_percent",
    dir: "desc",
  });
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const [authBlocked, setAuthBlocked] = useState(false);

  const server = useMemo(
    () => servers.find((s) => s.id === selectedServer),
    [servers, selectedServer],
  );

  useEffect(() => {
    patchUiState({ monitorServerId: selectedServer });
    setAuthBlocked(false);
  }, [selectedServer]);

  const fetchData = useCallback(
    async (password?: string) => {
      if (!selectedServer) return null;
      if (mode === "host") {
        return api.refreshProcesses(selectedServer, password);
      }
      return api.listDockerContainers(selectedServer, password);
    },
    [mode, selectedServer],
  );

  const refresh = useCallback(async () => {
    if (!selectedServer || !server) return;
    setLoading(true);
    try {
      const data = await fetchData();
      if (!data) return;
      if (mode === "host") {
        setProcesses(data as ProcessInfo[]);
      } else {
        setContainers(data as DockerContainer[]);
      }
      setAuthBlocked(false);
    } catch (err) {
      if (needsPasswordPrompt(err, server.auth_type)) {
        setAuthBlocked(true);
        return;
      }
      toast.error(formatBackendError(err));
    } finally {
      setLoading(false);
    }
  }, [fetchData, mode, selectedServer, server, toast]);

  const unlockWithPassword = async () => {
    if (!server) return;
    setLoading(true);
    try {
      const data = await withServerPassword(server, { toast, prompt, confirm }, fetchData);
      if (!data) return;
      if (mode === "host") {
        setProcesses(data as ProcessInfo[]);
      } else {
        setContainers(data as DockerContainer[]);
      }
      setAuthBlocked(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh || !selectedServer || authBlocked) return;
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, authBlocked, refresh, selectedServer]);

  const filteredProcesses = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return processes;
    return processes.filter(
      (p) =>
        p.comm.toLowerCase().includes(q) ||
        p.user.toLowerCase().includes(q) ||
        p.cmdline.toLowerCase().includes(q) ||
        String(p.pid).includes(q),
    );
  }, [filter, processes]);

  const filteredContainers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return containers;
    return containers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.image.toLowerCase().includes(q) ||
        c.status.toLowerCase().includes(q),
    );
  }, [containers, filter]);

  const sortedProcesses = useMemo(() => {
    const list = [...filteredProcesses];
    const { key, dir } = hostSort;
    const mul = dir === "asc" ? 1 : -1;

    list.sort((a, b) => {
      switch (key) {
        case "pid":
          return (a.pid - b.pid) * mul;
        case "cpu_percent":
          return (a.cpu_percent - b.cpu_percent) * mul;
        case "mem_percent":
          return (a.mem_percent - b.mem_percent) * mul;
        case "user":
          return a.user.localeCompare(b.user, undefined, { sensitivity: "base" }) * mul;
        case "command": {
          const left = (a.cmdline || a.comm).toLowerCase();
          const right = (b.cmdline || b.comm).toLowerCase();
          return left.localeCompare(right) * mul;
        }
        default:
          return 0;
      }
    });

    return list;
  }, [filteredProcesses, hostSort]);

  const sortedContainers = useMemo(() => {
    const list = [...filteredContainers];
    const { key, dir } = dockerSort;
    const mul = dir === "asc" ? 1 : -1;

    list.sort((a, b) => {
      switch (key) {
        case "name":
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) * mul;
        case "cpu_percent":
          return (a.cpu_percent - b.cpu_percent) * mul;
        case "mem_percent":
          return (a.mem_percent - b.mem_percent) * mul;
        case "status":
          return a.status.localeCompare(b.status, undefined, { sensitivity: "base" }) * mul;
        default:
          return 0;
      }
    });

    return list;
  }, [filteredContainers, dockerSort]);

  const toggleHostSort = (key: HostSortKey) => {
    setHostSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : {
            key,
            dir: key === "cpu_percent" || key === "mem_percent" ? "desc" : "asc",
          },
    );
  };

  const toggleDockerSort = (key: DockerSortKey) => {
    setDockerSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : {
            key,
            dir: key === "cpu_percent" || key === "mem_percent" ? "desc" : "asc",
          },
    );
  };

  const verifyTrust = async (pid: number) => {
    if (!selectedServer) return;
    try {
      const info = await api.verifyProcessTrust(selectedServer, pid);
      setTrustMap((prev) => ({ ...prev, [pid]: info }));
      if (info.trusted) {
        toast.success(`Trusted: ${info.label}`);
      } else {
        toast.info("Binary not in trust registry");
      }
    } catch (err) {
      toast.error(formatBackendError(err));
    }
  };

  const addToRegistry = async (info: ProcessTrustInfo) => {
    const label = await prompt({
      title: "Add to trust registry",
      placeholder: "Publisher / label",
      defaultValue: info.label ?? "",
      confirmLabel: "Add",
    });
    if (!label) return;
    try {
      await api.createTrustedBinary(info.sha256, label);
      toast.success(`Added "${label}" to registry`);
      setTrustMap((prev) => ({
        ...prev,
        [info.pid]: { ...info, trusted: true, label },
      }));
    } catch (err) {
      toast.error(String(err));
    }
  };

  const toggleContainer = async (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

    if (!selectedServer || containerProcs[name]) return;

    try {
      const procs = await api.listDockerContainerProcesses(selectedServer, name);
      setContainerProcs((prev) => ({ ...prev, [name]: procs }));
    } catch (err) {
      toast.error(formatBackendError(err));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="bb-border shrink-0 border-b px-6 py-4">
        <h2 className="bb-page-title">Monitor</h2>
        <p className="bb-muted mt-1 text-sm">Host processes and Docker containers</p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            className="input max-w-xs"
            value={selectedServer}
            onChange={(e) => setSelectedServer(e.target.value)}
          >
            <option value="">Select server…</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <div className="flex rounded-lg border border-[var(--bb-border)] p-0.5">
            {(["host", "docker"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`rounded-md px-3 py-1 text-sm capitalize ${
                  mode === m ? "btn-primary py-1" : "bb-muted"
                }`}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
          </div>

          <input
            className="input max-w-xs"
            placeholder={mode === "host" ? "Filter name / user…" : "Filter container…"}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />

          <label className="bb-muted flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh (5s)
          </label>

          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={!selectedServer || loading}
            onClick={() => void refresh()}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {authBlocked && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <span>Stored password cannot be decrypted — enter it again to continue.</span>
            <button
              type="button"
              className="btn-primary px-2 py-1 text-xs"
              onClick={() => void unlockWithPassword()}
            >
              Enter password
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!selectedServer && (
          <p className="bb-muted text-center text-sm">Select a server to monitor</p>
        )}

        {selectedServer && mode === "host" && (
          <>
            <p className="bb-muted mb-2 text-xs">
              {sortedProcesses.length} process{sortedProcesses.length === 1 ? "" : "es"}
              {filter.trim() && processes.length !== sortedProcesses.length
                ? ` (filtered from ${processes.length})`
                : ""}
            </p>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--bb-border)]">
                  <SortableHeader
                    label="PID"
                    active={hostSort.key === "pid"}
                    dir={hostSort.dir}
                    onClick={() => toggleHostSort("pid")}
                  />
                  <SortableHeader
                    label="User"
                    active={hostSort.key === "user"}
                    dir={hostSort.dir}
                    onClick={() => toggleHostSort("user")}
                  />
                  <SortableHeader
                    label="CPU%"
                    active={hostSort.key === "cpu_percent"}
                    dir={hostSort.dir}
                    onClick={() => toggleHostSort("cpu_percent")}
                  />
                  <SortableHeader
                    label="MEM%"
                    active={hostSort.key === "mem_percent"}
                    dir={hostSort.dir}
                    onClick={() => toggleHostSort("mem_percent")}
                  />
                  <SortableHeader
                    label="Command"
                    active={hostSort.key === "command"}
                    dir={hostSort.dir}
                    onClick={() => toggleHostSort("command")}
                  />
                  <th className="bb-muted py-2 text-xs uppercase">Trust</th>
                </tr>
              </thead>
              <tbody>
                {sortedProcesses.map((p) => {
                const trust = trustMap[p.pid];
                return (
                  <tr
                    key={p.pid}
                    className="border-b border-[var(--bb-border)]/50 hover:bg-[color-mix(in_srgb,var(--bb-surface-2)_80%,transparent)]"
                  >
                    <td className="py-1.5 pr-2 font-mono">{p.pid}</td>
                    <td className="py-1.5 pr-2">{p.user}</td>
                    <td className="py-1.5 pr-2">{p.cpu_percent.toFixed(1)}</td>
                    <td className="py-1.5 pr-2">{p.mem_percent.toFixed(1)}</td>
                    <td className="max-w-md truncate py-1.5 pr-2" title={p.cmdline || p.comm}>
                      {p.cmdline || p.comm}
                    </td>
                    <td className="py-1.5">
                      <div className="flex gap-1">
                        {trust?.trusted && (
                          <span className="text-emerald-400" title={trust.label}>
                            🛡 {trust.label}
                          </span>
                        )}
                        <button
                          type="button"
                          className="btn-secondary px-2 py-0.5 text-xs"
                          onClick={() => void verifyTrust(p.pid)}
                        >
                          Verify
                        </button>
                        {trust && !trust.trusted && (
                          <button
                            type="button"
                            className="btn-primary px-2 py-0.5 text-xs"
                            onClick={() => void addToRegistry(trust)}
                          >
                            Add
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sortedProcesses.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="bb-muted py-6 text-center text-sm">
                    No matching processes
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </>
        )}

        {selectedServer && mode === "docker" && (
          <div className="space-y-2">
            <div className="bb-muted mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span>
                {sortedContainers.length} container{sortedContainers.length === 1 ? "" : "s"}
                {filter.trim() && containers.length !== sortedContainers.length
                  ? ` (filtered from ${containers.length})`
                  : ""}
              </span>
              <span className="opacity-60">·</span>
              <span>Sort:</span>
              {(
                [
                  ["name", "Name"],
                  ["cpu_percent", "CPU"],
                  ["mem_percent", "MEM"],
                  ["status", "Status"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`rounded px-1.5 py-0.5 ${
                    dockerSort.key === key
                      ? "bg-[color-mix(in_srgb,var(--bb-accent)_20%,transparent)] text-[var(--bb-text)]"
                      : "hover:text-[var(--bb-text)]"
                  }`}
                  onClick={() => toggleDockerSort(key)}
                >
                  {label}
                  {sortDirLabel(dockerSort.key === key, dockerSort.dir)}
                </button>
              ))}
            </div>
            {sortedContainers.length === 0 && !loading && (
              <p className="bb-muted text-sm">No containers or Docker unavailable</p>
            )}
            {sortedContainers.map((c) => (
              <div key={c.id} className="bb-card rounded-lg p-3">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 text-left"
                  onClick={() => void toggleContainer(c.name)}
                >
                  <span className="bb-muted">{expanded.has(c.name) ? "▾" : "▸"}</span>
                  <span className="font-medium">🐳 {c.name}</span>
                  <span className="bb-muted text-xs">{c.image}</span>
                  <span className="bb-muted ml-auto text-xs">{c.status}</span>
                  <span className="text-xs">
                    CPU {c.cpu_percent.toFixed(1)}% · {c.mem_usage} ({c.mem_percent.toFixed(1)}%)
                  </span>
                </button>
                {expanded.has(c.name) && (
                  <ul className="mt-2 space-y-1 pl-6 text-xs">
                    {(containerProcs[c.name] ?? []).map((proc) => (
                      <li key={proc.pid} className="bb-muted font-mono">
                        {proc.pid} {proc.user} — {proc.command}
                      </li>
                    ))}
                    {expanded.has(c.name) && !containerProcs[c.name] && (
                      <li className="bb-muted">Loading processes…</li>
                    )}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
