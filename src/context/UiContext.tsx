import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastVariant = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface AlertOptions {
  title: string;
  message?: string;
}

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Mask input (SSH/server password) */
  secret?: boolean;
}

type ModalState =
  | ({ type: "alert" } & AlertOptions & { resolve: () => void })
  | ({ type: "confirm" } & ConfirmOptions & { resolve: (value: boolean) => void })
  | ({ type: "prompt" } & PromptOptions & { resolve: (value: string | null) => void });

interface UiContextValue {
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
    warning: (message: string) => void;
  };
  alert: (options: AlertOptions) => Promise<void>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const UiContext = createContext<UiContextValue | null>(null);

const TOAST_DURATION_MS = 4500;

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.variant} pointer-events-auto flex items-start gap-3 rounded-lg px-4 py-3 shadow-lg`}
          role="status"
        >
          <p className="min-w-0 flex-1 text-sm leading-snug">{t.message}</p>
          <button
            type="button"
            className="bb-muted shrink-0 text-lg leading-none hover:text-[var(--bb-text)]"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function UiModal({ modal, onClose }: { modal: ModalState; onClose: () => void }) {
  const [value, setValue] = useState(modal.type === "prompt" ? (modal.defaultValue ?? "") : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (modal.type === "prompt") {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [modal]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (modal.type === "confirm") modal.resolve(false);
      else if (modal.type === "prompt") modal.resolve(null);
      else modal.resolve();
      onClose();
    }
    if (e.key === "Enter" && modal.type === "prompt") {
      e.preventDefault();
      modal.resolve(value.trim() || null);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4"
      onKeyDown={handleKeyDown}
      onClick={() => {
        if (modal.type === "confirm") modal.resolve(false);
        else if (modal.type === "prompt") modal.resolve(null);
        else modal.resolve();
        onClose();
      }}
    >
      <div
        className="bb-panel w-full max-w-md rounded-xl p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="bb-text text-lg font-semibold">{modal.title}</h2>
        {modal.message && <p className="bb-muted mt-2 text-sm">{modal.message}</p>}

        {modal.type === "prompt" && (
          <input
            ref={inputRef}
            autoFocus
            type={modal.secret ? "password" : "text"}
            className="input mt-4"
            value={value}
            placeholder={modal.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const trimmed = value.trim();
                if (!trimmed) return;
                modal.resolve(trimmed);
                onClose();
              }
            }}
          />
        )}

        <div className="mt-6 flex justify-end gap-3">
          {modal.type !== "alert" && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if (modal.type === "confirm") modal.resolve(false);
                else modal.resolve(null);
                onClose();
              }}
            >
              {modal.cancelLabel ?? "Cancel"}
            </button>
          )}
          <button
            type="button"
            className={modal.type === "confirm" && modal.danger ? "btn-danger" : "btn-primary"}
            autoFocus={modal.type !== "prompt"}
            disabled={modal.type === "prompt" && !value.trim()}
            onClick={() => {
              if (modal.type === "alert") modal.resolve();
              else if (modal.type === "confirm") modal.resolve(true);
              else {
                const trimmed = value.trim();
                if (!trimmed) return;
                modal.resolve(trimmed);
              }
              onClose();
            }}
          >
            {modal.type === "alert"
              ? "OK"
              : modal.type === "confirm"
                ? (modal.confirmLabel ?? "Confirm")
                : (modal.confirmLabel ?? "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    (message: string, variant: ToastVariant) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev.slice(-4), { id, message, variant }]);
      const timer = setTimeout(() => dismissToast(id), TOAST_DURATION_MS);
      timers.current.set(id, timer);
    },
    [dismissToast],
  );

  const toast = useMemo(
    () => ({
      success: (message: string) => pushToast(message, "success"),
      error: (message: string) => pushToast(message, "error"),
      info: (message: string) => pushToast(message, "info"),
      warning: (message: string) => pushToast(message, "warning"),
    }),
    [pushToast],
  );

  const alert = useCallback(
    (options: AlertOptions) =>
      new Promise<void>((resolve) => {
        setModal({ type: "alert", ...options, resolve });
      }),
    [],
  );

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setModal({ type: "confirm", ...options, resolve });
      }),
    [],
  );

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setModal({ type: "prompt", ...options, resolve });
      }),
    [],
  );

  const closeModal = useCallback(() => setModal(null), []);

  const value = useMemo(
    () => ({ toast, alert, confirm, prompt }),
    [toast, alert, confirm, prompt],
  );

  return (
    <UiContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      {modal && <UiModal modal={modal} onClose={closeModal} />}
    </UiContext.Provider>
  );
}

export function useUi(): UiContextValue {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi must be used within UiProvider");
  return ctx;
}
