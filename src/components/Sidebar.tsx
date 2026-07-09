import { useState } from "react";
import type { Server, ServerFolder, StoredKey, TabId, TerminalTab } from "../types";
import { visibleNavItems, type NavPreferences } from "../config/nav";
import { ServerList } from "./ServerList";

interface SidebarProps {
  servers: Server[];
  folders: ServerFolder[];
  keys: StoredKey[];
  showNav: boolean;
  showSessions: boolean;
  tabs: TerminalTab[];
  activeSessionId?: string;
  activeView: TabId;
  navPrefs: NavPreferences;
  onNavigate: (view: TabId) => void;
  onRefresh: () => void;
  onConnect: (server: Server) => Promise<void>;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
}

export function Sidebar({
  servers,
  folders,
  keys,
  showNav,
  showSessions,
  tabs,
  activeSessionId,
  activeView,
  navPrefs,
  onNavigate,
  onRefresh,
  onConnect,
  onSelectSession,
  onCloseSession,
}: SidebarProps) {
  const [connecting, setConnecting] = useState<string | null>(null);

  const connect = async (server: Server) => {
    setConnecting(server.id);
    try {
      await onConnect(server);
    } finally {
      setConnecting(null);
    }
  };

  const navItems = visibleNavItems(navPrefs);

  return (
    <aside className="bb-sidebar bb-border flex w-56 shrink-0 flex-col border-r">
      <div className="bb-border border-b p-3">
        <h1 className="bb-accent text-base font-bold">BriskBastion</h1>
        <p className="bb-muted mt-0.5 text-xs">SSH terminal & automation</p>
      </div>

      <nav className={`bb-border space-y-0.5 border-b p-2 ${showNav ? "" : "hidden"}`}>
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
              activeView === item.id ? "sidebar-nav-active" : "sidebar-nav-item"
            }`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="w-5 shrink-0 text-center text-xs opacity-80">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.id === "terminal" && tabs.length > 0 && (
              <span className="badge-count rounded-full px-1.5 text-xs">{tabs.length}</span>
            )}
          </button>
        ))}
      </nav>

      {showSessions && tabs.length > 0 && (
        <div className="bb-border max-h-40 shrink-0 overflow-y-auto border-b">
          <p className="bb-muted bb-border sticky top-0 border-b bg-[var(--bb-sidebar)] px-3 py-1.5 text-xs font-semibold uppercase">
            Sessions
          </p>
          {tabs.map((tab) => {
            const active = activeSessionId === tab.sessionId;
            return (
              <div
                key={tab.sessionId}
                className={`group flex items-center gap-1 text-sm ${
                  active ? "session-sidebar-active" : "session-sidebar-item"
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate px-3 py-1.5 text-left"
                  onClick={() => onSelectSession(tab.sessionId)}
                  title={tab.title}
                >
                  {tab.title}
                </button>
                <button
                  type="button"
                  className="bb-muted shrink-0 px-2 py-1.5 opacity-0 hover:text-[var(--bb-danger)] group-hover:opacity-100"
                  onClick={() => onCloseSession(tab.sessionId)}
                  title="Close session"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      <ServerList
        servers={servers}
        folders={folders}
        keys={keys}
        connecting={connecting}
        onRefresh={onRefresh}
        onConnect={connect}
      />
    </aside>
  );
}
