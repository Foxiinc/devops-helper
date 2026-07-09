import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ScenarioRecord, Server, StepResult } from "../types";
import { api } from "../api";
import { useUi } from "../context/UiContext";
import { loadUiState, patchUiState } from "../state/persist";

interface ScenariosPanelProps {
  servers: Server[];
}

const DEFAULT_BASTION = `# Deploy my site
local: echo "Starting build..."
local: npm run build

sync: ./dist -> /var/www/my-site

remote: cd /var/www/my-site
remote: pm2 restart app
`;

export function ScenariosPanel({ servers }: ScenariosPanelProps) {
  const { toast, confirm } = useUi();
  const [scenarios, setScenarios] = useState<ScenarioRecord[]>([]);
  const [selectedServer, setSelectedServer] = useState(
    () => loadUiState().scenariosServerId,
  );
  const [running, setRunning] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [script, setScript] = useState(DEFAULT_BASTION);

  const load = async () => {
    setScenarios(await api.listScenarios());
  };

  useEffect(() => {
    void load();
    const unlisten = listen<StepResult>("scenario-step", (e) => {
      setSteps((prev) => [...prev, e.payload]);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    patchUiState({ scenariosServerId: selectedServer });
  }, [selectedServer]);

  const run = async (scenarioId: string) => {
    if (!selectedServer) {
      toast.warning("Select a target server first");
      return;
    }
    setRunning(scenarioId);
    setSteps([]);
    toast.info("Running scenario...");
    try {
      const { result } = await api.runScenario(scenarioId, selectedServer);
      if (result.overall_success) {
        toast.success("Scenario completed successfully");
      } else {
        toast.error("Scenario finished with errors");
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setRunning(null);
    }
  };

  const create = async () => {
    const titleMatch = script.match(/^#\s*(.+)$/m);
    await api.createScenario({
      name: titleMatch?.[1]?.trim() ?? "Custom scenario",
      description: undefined,
      steps_yaml: script,
    });
    setShowCreate(false);
    toast.success("Scenario saved");
    await load();
  };

  const remove = async (id: string, isPreset: boolean) => {
    if (isPreset) return;
    const ok = await confirm({
      title: "Delete scenario",
      message: "This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await api.deleteScenario(id);
    toast.info("Scenario deleted");
    await load();
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="bb-page-title">Scenarios</h2>
        <select
          className="input max-w-xs"
          value={selectedServer}
          onChange={(e) => setSelectedServer(e.target.value)}
        >
          <option value="">Target server...</option>
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="btn-secondary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Cancel" : "+ .bastion script"}
        </button>
      </div>

      {showCreate && (
        <div className="bb-card mt-4 rounded-lg p-4">
          <p className="bb-muted mb-2 text-xs">
            One step per line: <code className="bb-code">local:</code>,{" "}
            <code className="bb-code">remote:</code>,{" "}
            <code className="bb-code">sync: ./src -&gt; /remote/path</code>
          </p>
          <textarea
            className="input h-48 w-full font-mono text-xs"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            spellCheck={false}
          />
          <button className="btn-primary mt-2" onClick={create}>
            Save scenario
          </button>
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {scenarios.map((scenario) => (
          <div key={scenario.id} className="bb-card rounded-lg p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="bb-text font-medium">
                  {scenario.name}
                  {scenario.is_preset && <span className="bb-badge ml-2">preset</span>}
                </p>
                {scenario.description && (
                  <p className="bb-muted mt-1 text-xs">{scenario.description}</p>
                )}
              </div>
              {!scenario.is_preset && (
                <button
                  className="text-xs text-[var(--bb-danger)]"
                  onClick={() => remove(scenario.id, scenario.is_preset)}
                >
                  Delete
                </button>
              )}
            </div>
            <button
              className="btn-primary mt-4 w-full text-sm"
              disabled={running === scenario.id}
              onClick={() => run(scenario.id)}
            >
              {running === scenario.id ? "Running..." : "Run"}
            </button>
          </div>
        ))}
      </div>

      {steps.length > 0 && (
        <div className="mt-6">
          <h3 className="bb-text text-sm font-semibold">Live log</h3>
          <div className="mt-2 space-y-2">
            {steps.map((step, i) => (
              <div
                key={i}
                className={`rounded-lg p-3 ${step.success ? "bb-step-ok" : "bb-step-fail"}`}
              >
                <div className="flex items-center gap-2 text-sm">
                  <span>{step.success ? "✓" : "✗"}</span>
                  <span className="bb-text font-medium font-mono text-xs">{step.step_name}</span>
                  <span className="bb-muted text-xs">exit {step.exit_code}</span>
                </div>
                <pre className="bb-muted mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs">
                  {step.output.trim() ||
                    (step.success
                      ? "Completed with no output (command may be silent when nothing to do)"
                      : "(no output)")}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
