import { useEffect, useState } from "react";
import type { Server, ServerFolder, ServerInput, StoredKey } from "../types";
import { api } from "../api";
import { useUi } from "../context/UiContext";
import { formatBackendError } from "../utils/backendError";

interface ServerFormProps {
  server?: Server;
  keys: StoredKey[];
  folders: ServerFolder[];
  defaultFolderId?: string;
  modal?: boolean;
  onSave: () => void;
  onCancel: () => void;
}

const emptyForm: ServerInput = {
  name: "",
  host: "",
  port: 22,
  username: "root",
  auth_type: "password",
  password: "",
  key_id: undefined,
  folder_id: undefined,
};

export function ServerForm({
  server,
  keys,
  folders,
  defaultFolderId,
  modal,
  onSave,
  onCancel,
}: ServerFormProps) {
  const { toast } = useUi();
  const [form, setForm] = useState<ServerInput>(
    server
      ? {
          name: server.name,
          host: server.host,
          port: server.port,
          username: server.username,
          auth_type: server.auth_type,
          key_id: server.key_id,
          folder_id: server.folder_id,
        }
      : { ...emptyForm, folder_id: defaultFolderId },
  );
  const [saving, setSaving] = useState(false);
  const [credentialWarning, setCredentialWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!server) {
      setCredentialWarning(null);
      return;
    }
    void api.checkServerCredentials(server.id).then((check) => {
      if (!check.ok && check.message) {
        setCredentialWarning(formatBackendError(check.message));
      } else {
        setCredentialWarning(null);
      }
    });
  }, [server]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !server &&
      form.auth_type === "password" &&
      !form.password?.trim()
    ) {
      toast.error("Password is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        folder_id: form.folder_id || undefined,
      };
      if (server) {
        await api.updateServer(server.id, payload);
        toast.success("Server updated");
      } else {
        await api.createServer(payload);
        toast.success("Server added");
      }
      onSave();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className={modal ? "space-y-3" : "bb-card space-y-3 rounded-lg p-4"}
    >
      <h3 className="bb-accent text-sm font-semibold">
        {server ? "Edit server" : "Add server"}
      </h3>
      {credentialWarning && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {credentialWarning}
        </p>
      )}
      <input
        className="input"
        placeholder="Name"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        required
        autoFocus
      />
      <div className="grid grid-cols-3 gap-2">
        <input
          className="input col-span-2"
          placeholder="Host"
          value={form.host}
          onChange={(e) => setForm({ ...form, host: e.target.value })}
          required
        />
        <input
          className="input"
          type="number"
          placeholder="Port"
          value={form.port}
          onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
          required
        />
      </div>
      <input
        className="input"
        placeholder="Username"
        value={form.username}
        onChange={(e) => setForm({ ...form, username: e.target.value })}
        required
      />
      <select
        className="input"
        value={form.folder_id ?? ""}
        onChange={(e) => setForm({ ...form, folder_id: e.target.value || undefined })}
      >
        <option value="">No folder</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      <select
        className="input"
        value={form.auth_type}
        onChange={(e) =>
          setForm({ ...form, auth_type: e.target.value as "password" | "key" })
        }
      >
        <option value="password">Password</option>
        <option value="key">SSH Key</option>
      </select>
      {form.auth_type === "password" ? (
        <input
          className="input"
          type="password"
          placeholder={server ? "Password (required if vault was reset)" : "Password"}
          value={form.password ?? ""}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
      ) : (
        <select
          className="input"
          value={form.key_id ?? ""}
          onChange={(e) => setForm({ ...form, key_id: e.target.value || undefined })}
          required
        >
          <option value="">Select key...</option>
          {keys.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
      )}
      <div className="flex gap-2 pt-1">
        <button type="submit" className="btn-primary flex-1" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
