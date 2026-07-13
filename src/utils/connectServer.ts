import { api } from "../api";
import type { Server, ServerInput, SessionSummary } from "../types";
import { formatBackendError, needsPasswordPrompt } from "./backendError";

export function serverToInput(server: Server, password?: string): ServerInput {
  return {
    name: server.name,
    host: server.host,
    port: server.port,
    username: server.username,
    auth_type: server.auth_type,
    key_id: server.key_id,
    folder_id: server.folder_id,
    password,
  };
}

interface ConnectUi {
  toast: {
    error: (message: string) => void;
    success: (message: string) => void;
  };
  prompt: (options: {
    title: string;
    message?: string;
    placeholder?: string;
    secret?: boolean;
    confirmLabel?: string;
  }) => Promise<string | null>;
  confirm: (options: {
    title: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }) => Promise<boolean>;
}

export async function connectWithCredentials(
  server: Server,
  ui: ConnectUi,
  cols = 120,
  rows = 30,
): Promise<SessionSummary | null> {
  try {
    return await api.connectSession(server.id, cols, rows);
  } catch (err) {
    if (!needsPasswordPrompt(err, server.auth_type)) {
      ui.toast.error(formatBackendError(err));
      return null;
    }
  }

  const password = await ui.prompt({
    title: `Sign in — ${server.name}`,
    message: `${server.username}@${server.host}:${server.port}`,
    placeholder: "Password",
    secret: true,
    confirmLabel: "Connect",
  });
  if (!password) return null;

  try {
    const session = await api.connectSession(server.id, cols, rows, password);

    const save = await ui.confirm({
      title: "Save password?",
      message: "Encrypt and store for future connections on this PC.",
      confirmLabel: "Save",
      cancelLabel: "Not now",
    });
    if (save) {
      await api.updateServer(server.id, serverToInput(server, password));
      ui.toast.success("Password saved");
    }

    return session;
  } catch (err) {
    ui.toast.error(formatBackendError(err));
    return null;
  }
}
