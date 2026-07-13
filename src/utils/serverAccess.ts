import { api } from "../api";
import type { Server } from "../types";
import { formatBackendError, needsPasswordPrompt } from "./backendError";
import { serverToInput } from "./connectServer";

interface AccessUi {
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

export async function withServerPassword<T>(
  server: Server,
  ui: AccessUi,
  run: (password?: string) => Promise<T>,
): Promise<T | null> {
  try {
    return await run();
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
    confirmLabel: "Continue",
  });
  if (!password) return null;

  try {
    const result = await run(password);

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

    return result;
  } catch (err) {
    ui.toast.error(formatBackendError(err));
    return null;
  }
}
