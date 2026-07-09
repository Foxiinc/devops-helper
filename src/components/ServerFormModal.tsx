import type { Server, ServerFolder, StoredKey } from "../types";
import { ServerForm } from "./ServerForm";

interface ServerFormModalProps {
  server?: Server;
  keys: StoredKey[];
  folders: ServerFolder[];
  defaultFolderId?: string;
  onClose: () => void;
  onSaved: () => void;
}

export function ServerFormModal({
  server,
  keys,
  folders,
  defaultFolderId,
  onClose,
  onSaved,
}: ServerFormModalProps) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="bb-panel w-full max-w-md rounded-xl p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <ServerForm
          server={server}
          keys={keys}
          folders={folders}
          defaultFolderId={defaultFolderId}
          modal
          onSave={() => {
            onSaved();
            onClose();
          }}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
