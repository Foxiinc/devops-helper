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
import { formatBackendError } from "../utils/backendError";
import { loadUiState, patchUiState } from "../state/persist";

interface MonitorPanelProps {
  servers: Server[];
}

type MonitorMode = "host" | "docker";

const REFRESH_MS = 5000;

export function MonitorPanel({ servers }: MonitorPanelProps) {
  const { toast, prompt } = useUi();
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
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    patchUiState({ monitorServerId: selectedServer });
  }, [selectedServer]);

  const refresh = useCallback(async () => {
    if (!selectedServer) return;
    setLoading(true);
    try {
      if (mode === "host") {
        setProcesses(await api.refreshProcesses(selectedServer));
      } else {
        setContainers(await api.listDockerContainers(selectedServer));
      }
    } catch (err) {
      toast.error(formatBackendError(err));
    } finally {
      setLoading(false);
    }
  }, [mode, selectedServer, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh || !selectedServer) return;
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, refresh, selectedServer]);

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
            placeholder="Filter name / user…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={mode === "docker"}
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
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!selectedServer && (
          <p className="bb-muted text-center text-sm">Select a server to monitor</p>
        )}

        {selectedServer && mode === "host" && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bb-muted border-b border-[var(--bb-border)] text-xs uppercase">
                <th className="py-2 pr-2">PID</th>
                <th className="py-2 pr-2">User</th>
                <th className="py-2 pr-2">CPU%</th>
                <th className="py-2 pr-2">MEM%</th>
                <th className="py-2 pr-2">Command</th>
                <th className="py-2">Trust</th>
              </tr>
            </thead>
            <tbody>
              {filteredProcesses.map((p) => {
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
            </tbody>
          </table>
        )}

        {selectedServer && mode === "docker" && (
          <div className="space-y-2">
            {containers.length === 0 && !loading && (
              <p className="bb-muted text-sm">No containers or Docker unavailable</p>
            )}
            {containers.map((c) => (
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
