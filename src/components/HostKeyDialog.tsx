import type { HostKeyPrompt } from "../types";
import { api } from "../api";

interface HostKeyDialogProps {
  prompt: HostKeyPrompt;
  onDone: () => void;
}

export function HostKeyDialog({ prompt, onDone }: HostKeyDialogProps) {
  const trust = async () => {
    try {
      await api.trustHostKey(prompt);
    } finally {
      onDone();
    }
  };

  const reject = async () => {
    try {
      await api.rejectHostKey(prompt.prompt_id);
    } finally {
      onDone();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bb-panel w-full max-w-lg rounded-xl p-6 shadow-2xl">
        <h2 className="bb-accent text-lg font-semibold">Unknown host key</h2>
        <p className="bb-text mt-2 text-sm">
          Connect to{" "}
          <span className="bb-code font-mono">
            {prompt.host}:{prompt.port}
          </span>
          ?
        </p>
        <div className="bb-card mt-4 space-y-2 rounded-lg p-3 font-mono text-xs">
          <div>
            <span className="bb-muted">Type: </span>
            {prompt.key_type}
          </div>
          <div className="break-all">
            <span className="bb-muted">Fingerprint: </span>
            {prompt.fingerprint}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button className="btn-secondary" onClick={reject}>
            Reject
          </button>
          <button className="btn-primary" onClick={trust}>
            Trust & Connect
          </button>
        </div>
      </div>
    </div>
  );
}
