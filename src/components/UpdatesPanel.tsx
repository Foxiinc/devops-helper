import { useEffect, useMemo, useState } from "react";
import type { PackageUpdate, Server, UpdatesReport } from "../types";
import { api } from "../api";
import { useUi } from "../context/UiContext";
import { formatBackendError } from "../utils/backendError";
import { loadUiState, patchUiState } from "../state/persist";

interface UpdatesPanelProps {
  servers: Server[];
}

function severityBadge(severity?: string) {
  if (!severity) return null;
  const cls =
    severity === "CRITICAL"
      ? "bg-red-500/20 text-red-300"
      : severity === "HIGH"
        ? "bg-orange-500/20 text-orange-300"
        : severity === "MEDIUM"
          ? "bg-amber-500/20 text-amber-300"
          : "bg-slate-500/20 text-slate-300";
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{severity}</span>
  );
}

function cveTooltip(pkg: PackageUpdate) {
  if (pkg.cves.length === 0) return undefined;
  return pkg.cves
    .map((c) => `${c.id}${c.severity ? ` (${c.severity})` : ""}: ${c.summary ?? ""}`)
    .join("\n");
}

export function UpdatesPanel({ servers }: UpdatesPanelProps) {
  const { toast } = useUi();
  const [selectedServer, setSelectedServer] = useState(
    () => loadUiState().updatesServerId ?? "",
  );
  const [report, setReport] = useState<UpdatesReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [includeCve, setIncludeCve] = useState(true);
  const [securityOnly, setSecurityOnly] = useState(false);
  const [minSeverity, setMinSeverity] = useState<"HIGH" | "CRITICAL">("HIGH");

  useEffect(() => {
    patchUiState({ updatesServerId: selectedServer });
  }, [selectedServer]);

  const runCheck = async () => {
    if (!selectedServer) {
      toast.warning("Select a server first");
      return;
    }
    setLoading(true);
    try {
      setReport(await api.checkUpdates(selectedServer, includeCve));
    } catch (err) {
      toast.error(formatBackendError(err));
    } finally {
      setLoading(false);
    }
  };

  const packages = useMemo(() => {
    if (!report) return [];
    let list = report.packages;
    if (securityOnly) {
      list = list.filter((p) => p.cves.length > 0 || p.max_severity);
    }
    if (includeCve) {
      const rank = (s?: string) =>
        s === "CRITICAL" ? 4 : s === "HIGH" ? 3 : s === "MEDIUM" ? 2 : s === "LOW" ? 1 : 0;
      const minRank = rank(minSeverity);
      list = list.filter((p) => rank(p.max_severity) >= minRank || !p.max_severity && !securityOnly);
    }
    return list;
  }, [report, securityOnly, includeCve, minSeverity]);

  return (
    <div className="flex h-full flex-col">
      <div className="bb-border shrink-0 border-b px-6 py-4">
        <h2 className="bb-page-title">Updates</h2>
        <p className="bb-muted mt-1 text-sm">
          Installed vs available packages · CVE hints via OSV (possible match)
        </p>

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

          <label className="bb-muted flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeCve}
              onChange={(e) => setIncludeCve(e.target.checked)}
            />
            Check CVE (OSV)
          </label>

          <label className="bb-muted flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={securityOnly}
              onChange={(e) => setSecurityOnly(e.target.checked)}
            />
            Security only
          </label>

          {includeCve && (
            <select
              className="input w-auto text-sm"
              value={minSeverity}
              onChange={(e) => setMinSeverity(e.target.value as "HIGH" | "CRITICAL")}
            >
              <option value="HIGH">CRITICAL + HIGH</option>
              <option value="CRITICAL">CRITICAL only</option>
            </select>
          )}

          <button
            type="button"
            className="btn-primary text-sm"
            disabled={!selectedServer || loading}
            onClick={() => void runCheck()}
          >
            {loading ? "Checking…" : "Refresh"}
          </button>
        </div>

        {report && (
          <p className="bb-muted mt-2 text-xs">
            {report.os.pretty_name} · {report.os.package_manager} · {report.packages.length}{" "}
            upgradable · checked {new Date(report.checked_at).toLocaleString()}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!report && !loading && (
          <p className="bb-muted text-center text-sm">
            Select a server and press Refresh — run{" "}
            <code className="text-xs">apt-get update</code> on the host first for accurate results
          </p>
        )}

        {report && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bb-muted border-b border-[var(--bb-border)] text-xs uppercase">
                <th className="py-2 pr-2">Package</th>
                <th className="py-2 pr-2">Installed</th>
                <th className="py-2 pr-2">Available</th>
                <th className="py-2 pr-2">Size</th>
                <th className="py-2">CVE</th>
              </tr>
            </thead>
            <tbody>
              {packages.map((pkg) => (
                <tr
                  key={pkg.name}
                  className="border-b border-[var(--bb-border)]/50 hover:bg-[color-mix(in_srgb,var(--bb-surface-2)_80%,transparent)]"
                >
                  <td className="py-1.5 pr-2 font-medium">{pkg.name}</td>
                  <td className="py-1.5 pr-2 font-mono text-xs">{pkg.installed || "—"}</td>
                  <td className="py-1.5 pr-2 font-mono text-xs">{pkg.available}</td>
                  <td className="bb-muted py-1.5 pr-2 text-xs">{pkg.size ?? "—"}</td>
                  <td className="py-1.5" title={cveTooltip(pkg)}>
                    {severityBadge(pkg.max_severity)}
                    {pkg.cves.length > 0 && (
                      <span className="bb-muted ml-1 text-xs">
                        {pkg.cves.length} CVE{pkg.cves.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {packages.length === 0 && (
                <tr>
                  <td colSpan={5} className="bb-muted py-8 text-center">
                    No matching updates
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
