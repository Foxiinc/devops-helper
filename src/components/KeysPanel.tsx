import { useEffect, useState } from "react";
import type { Server, StoredKey } from "../types";
import { api } from "../api";
import { useUi } from "../context/UiContext";

interface KeysPanelProps {
  servers: Server[];
  embedded?: boolean;
}

export function KeysPanel({ servers, embedded }: KeysPanelProps) {
  const { toast, confirm } = useUi();
  const [keys, setKeys] = useState<StoredKey[]>([]);
  const [name, setName] = useState("");
  const [selectedServer, setSelectedServer] = useState("");
  const [selectedKey, setSelectedKey] = useState("");

  const load = async () => {
    setKeys(await api.listKeys());
  };

  useEffect(() => {
    void load();
  }, []);

  const generate = async () => {
    if (!name.trim()) return;
    await api.generateKey(name.trim());
    setName("");
    toast.success("Key generated");
    await load();
  };

  const importFromSsh = async () => {
    const imported = await api.importKeysFromSshDir();
    toast.success(`Imported ${imported.length} keys from ~/.ssh`);
    await load();
  };

  const copyId = async () => {
    if (!selectedServer || !selectedKey) return;
    const msg = await api.copyIdToServer(selectedServer, selectedKey);
    toast.success(msg);
  };

  const copyPubkey = async (pubkey: string) => {
    await navigator.clipboard.writeText(pubkey);
    toast.success("Public key copied to clipboard");
  };

  const remove = async (id: string) => {
    const ok = await confirm({
      title: "Delete key",
      message: "This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await api.deleteKey(id);
    toast.info("Key deleted");
    await load();
  };

  return (
    <div className={`h-full overflow-y-auto ${embedded ? "p-6 pt-4" : "p-6"}`}>
      {!embedded && (
        <>
          <h2 className="bb-accent text-xl font-semibold">SSH Keys</h2>
          <p className="bb-muted mt-1 text-sm">
            Generate, import and deploy keys to servers
          </p>
        </>
      )}

      <div className={`flex flex-wrap gap-2 ${embedded ? "mt-2" : "mt-6"}`}>
        <input
          className="input max-w-xs"
          placeholder="Key name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="button" className="btn-primary" onClick={generate}>
          Generate ED25519
        </button>
        <button type="button" className="btn-secondary" onClick={importFromSsh}>
          Import from ~/.ssh
        </button>
      </div>

      <div className="bb-card mt-6 rounded-xl p-4">
        <h3 className="bb-text text-sm font-semibold">Deploy public key (ssh-copy-id)</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            className="input max-w-xs"
            value={selectedServer}
            onChange={(e) => setSelectedServer(e.target.value)}
          >
            <option value="">Select server...</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            className="input max-w-xs"
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
          >
            <option value="">Select key...</option>
            {keys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn-primary" onClick={copyId}>
            Deploy key
          </button>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {keys.map((key) => (
          <div key={key.id} className="bb-card rounded-xl p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="bb-text font-medium">{key.name}</p>
                <p className="bb-muted mt-1 break-all font-mono text-xs">{key.public_key}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => copyPubkey(key.public_key)}
                >
                  Copy pubkey
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs text-[var(--bb-danger)]"
                  onClick={() => remove(key.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
        {keys.length === 0 && <p className="bb-muted text-sm">No keys stored yet</p>}
      </div>
    </div>
  );
}
