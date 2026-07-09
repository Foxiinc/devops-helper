import { useMemo, useState } from "react";
import type { Server, ServerFolder, ServerInput, StoredKey } from "../types";
import { api } from "../api";
import { useUi } from "../context/UiContext";
import { patchUiState, loadUiState } from "../state/persist";
import { formatBackendError } from "../utils/backendError";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { ServerFormModal } from "./ServerFormModal";

export const UNCATEGORIZED_FOLDER_ID = "__uncategorized__";

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ServerListProps {
  servers: Server[];
  folders: ServerFolder[];
  keys: StoredKey[];
  connecting: string | null;
  onRefresh: () => void;
  onConnect: (server: Server) => Promise<void>;
}

function serverToInput(server: Server, folderId?: string): ServerInput {
  return {
    name: server.name,
    host: server.host,
    port: server.port,
    username: server.username,
    auth_type: server.auth_type,
    key_id: server.key_id,
    folder_id: folderId ?? server.folder_id,
  };
}

function ServerCard({
  server,
  connecting,
  onConnect,
  onContextMenu,
}: {
  server: Server;
  connecting: string | null;
  onConnect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className="rounded-lg border border-transparent px-2 py-2 hover:border-[var(--bb-border)] hover:bg-[color-mix(in_srgb,var(--bb-surface-2)_90%,var(--bb-accent)_10%)]"
      onContextMenu={onContextMenu}
    >
      <div className="min-w-0">
        <p className="bb-text truncate text-sm font-medium">{server.name}</p>
        <p className="bb-muted truncate text-xs">
          {server.username}@{server.host}:{server.port}
        </p>
      </div>
      <button
        type="button"
        className="btn-primary mt-2 w-full py-1 text-xs"
        disabled={connecting === server.id}
        onClick={onConnect}
      >
        {connecting === server.id ? "Connecting..." : "Connect"}
      </button>
    </div>
  );
}

export function ServerList({
  servers,
  folders,
  keys,
  connecting,
  onRefresh,
  onConnect,
}: ServerListProps) {
  const { toast, confirm, prompt } = useUi();
  const [modalServer, setModalServer] = useState<Server | "new" | null>(null);
  const [defaultFolderId, setDefaultFolderId] = useState<string | undefined>();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(loadUiState().collapsedFolders),
  );

  const grouped = useMemo(() => {
    const byFolder = new Map<string | null, Server[]>();
    for (const server of servers) {
      const key = server.folder_id ?? null;
      const list = byFolder.get(key) ?? [];
      list.push(server);
      byFolder.set(key, list);
    }
    return byFolder;
  }, [servers]);

  const openMenu = (e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  const toggleCollapsed = (folderId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      void patchUiState({ collapsedFolders: [...next] });
      return next;
    });
  };

  const createFolder = async () => {
    const name = await prompt({
      title: "New folder",
      placeholder: "Folder name",
      confirmLabel: "Create",
    });
    if (!name) return;
    try {
      await api.createServerFolder(name);
      toast.success(`Folder "${name}" created`);
      onRefresh();
    } catch (err) {
      toast.error(`Could not create folder: ${formatBackendError(err)}`);
    }
  };

  const renameFolder = async (folder: ServerFolder) => {
    const name = await prompt({
      title: "Rename folder",
      defaultValue: folder.name,
      confirmLabel: "Rename",
    });
    if (!name || name === folder.name) return;
    try {
      await api.renameServerFolder(folder.id, name);
      toast.success(`Folder renamed to "${name}"`);
      onRefresh();
    } catch (err) {
      toast.error(String(err));
    }
  };

  const removeFolder = async (folder: ServerFolder) => {
    const ok = await confirm({
      title: "Delete folder",
      message: `Delete "${folder.name}"? Servers will move to Uncategorized.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteServerFolder(folder.id);
      toast.info(`Folder "${folder.name}" deleted`);
      onRefresh();
    } catch (err) {
      toast.error(String(err));
    }
  };

  const removeServer = async (server: Server) => {
    const ok = await confirm({
      title: "Delete server",
      message: `Delete "${server.name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteServer(server.id);
      toast.info("Server deleted");
      onRefresh();
    } catch (err) {
      toast.error(String(err));
    }
  };

  const moveServer = async (server: Server, folderId: string | undefined) => {
    try {
      await api.updateServer(server.id, {
        ...serverToInput(server, folderId),
        folder_id: folderId,
      });
      const label =
        folderId === undefined
          ? "Uncategorized"
          : (folders.find((f) => f.id === folderId)?.name ?? "folder");
      toast.success(`Moved to ${label}`);
      onRefresh();
    } catch (err) {
      toast.error(String(err));
    }
  };

  const serverMenuItems = (server: Server): ContextMenuItem[] => {
    const moveItems: ContextMenuItem[] = [
      {
        label: "Move to → Uncategorized",
        disabled: !server.folder_id,
        onClick: () => void moveServer(server, undefined),
      },
      ...folders.map((folder) => ({
        label: `Move to → ${folder.name}`,
        disabled: server.folder_id === folder.id,
        onClick: () => void moveServer(server, folder.id),
      })),
    ];

    return [
      { label: "Connect", onClick: () => void onConnect(server) },
      { label: "Edit…", onClick: () => setModalServer(server) },
      ...moveItems,
      { label: "Delete", danger: true, onClick: () => void removeServer(server) },
    ];
  };

  const folderMenuItems = (folder: ServerFolder): ContextMenuItem[] => [
    {
      label: "Add server here…",
      onClick: () => {
        setDefaultFolderId(folder.id);
        setModalServer("new");
      },
    },
    { label: "Rename…", onClick: () => void renameFolder(folder) },
    { label: "Delete folder", danger: true, onClick: () => void removeFolder(folder) },
  ];

  const uncategorized = grouped.get(null) ?? [];

  const renderFolderSection = (
    folderId: string,
    title: string,
    list: Server[],
    folder?: ServerFolder,
  ) => {
    const isCollapsed = collapsed.has(folderId);
    return (
      <div key={folderId} className="mb-2">
        <div
          className="bb-row-hover flex items-center gap-1 rounded-lg px-1 py-0.5"
          onContextMenu={
            folder
              ? (e) => openMenu(e, folderMenuItems(folder))
              : undefined
          }
        >
          <button
            type="button"
            className="bb-muted w-5 shrink-0 text-xs"
            onClick={() => toggleCollapsed(folderId)}
          >
            {isCollapsed ? "▸" : "▾"}
          </button>
          <span className="bb-text min-w-0 flex-1 truncate text-xs font-semibold uppercase">
            {title}
          </span>
          <span className="bb-muted text-xs">{list.length}</span>
        </div>
        {!isCollapsed && (
          <div className="mt-0.5 space-y-1 pl-1">
            {list.length === 0 && folder && (
              <p className="bb-muted px-2 py-1 text-xs">Empty — right-click folder to add server</p>
            )}
            {list.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                connecting={connecting}
                onConnect={() => void onConnect(server)}
                onContextMenu={(e) => openMenu(e, serverMenuItems(server))}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  const openAddServer = () => {
    setDefaultFolderId(undefined);
    setModalServer("new");
  };

  return (
    <>
      <div
        className="bb-border flex items-center justify-between border-b px-3 py-1.5"
        onContextMenu={(e) =>
          openMenu(e, [
            { label: "New folder…", onClick: () => void createFolder() },
            { label: "Add server…", onClick: openAddServer },
          ])
        }
      >
        <p className="bb-muted text-xs font-semibold uppercase">Servers</p>
        <div className="flex gap-1">
          <button
            type="button"
            className="btn-secondary px-2 py-0.5 text-xs"
            title="New folder"
            onClick={() => void createFolder()}
          >
            📁
          </button>
          <button
            type="button"
            className="btn-primary px-2 py-0.5 text-xs"
            onClick={openAddServer}
          >
            + Add
          </button>
        </div>
      </div>

      {modalServer !== null && (
        <ServerFormModal
          server={modalServer === "new" ? undefined : modalServer}
          keys={keys}
          folders={folders}
          defaultFolderId={modalServer === "new" ? defaultFolderId : undefined}
          onClose={() => {
            setModalServer(null);
            setDefaultFolderId(undefined);
          }}
          onSaved={onRefresh}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      <div
        className="min-h-0 flex-1 overflow-y-auto p-2"
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            openMenu(e, [
              { label: "New folder…", onClick: () => void createFolder() },
              { label: "Add server…", onClick: openAddServer },
            ]);
          }
        }}
      >
        {servers.length === 0 && folders.length === 0 && (
          <p className="bb-muted px-2 py-4 text-center text-sm">
            No servers yet — right-click here or press + Add
          </p>
        )}

        {folders.map((folder) =>
          renderFolderSection(folder.id, folder.name, grouped.get(folder.id) ?? [], folder),
        )}

        {(uncategorized.length > 0 || (servers.length > 0 && folders.length > 0)) &&
          renderFolderSection(UNCATEGORIZED_FOLDER_ID, "Uncategorized", uncategorized)}
      </div>
    </>
  );
}
