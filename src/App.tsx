import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./api";
import type { HostKeyPrompt, Server, ServerFolder, StoredKey, TabId, TerminalTab } from "./types";
import { hydrateUiState, loadUiState, persistUiState } from "./state/persist";
import { ThemeProvider } from "./context/ThemeContext";
import { UiProvider } from "./context/UiContext";
import { DEFAULT_THEME_SETTINGS, type ThemeSettings } from "./theme/types";
import {
  DEFAULT_NAV_PREFS,
  isViewAvailable,
  resolveActiveView,
  sessionLayoutForNav,
  type NavPreferences,
} from "./config/nav";
import { Sidebar } from "./components/Sidebar";
import { MainNav } from "./components/MainNav";
import { TerminalPanel } from "./components/TerminalPanel";
import { HostKeyDialog } from "./components/HostKeyDialog";
import { SettingsPanel } from "./components/SettingsPanel";
import { SftpPanel } from "./components/SftpPanel";
import { SyncPanel } from "./components/SyncPanel";
import { ScenariosPanel } from "./components/ScenariosPanel";
import { MonitorPanel } from "./components/MonitorPanel";
import { UpdatesPanel } from "./components/UpdatesPanel";
import { useUi } from "./context/UiContext";
import { formatBackendError } from "./utils/backendError";

function AppShell() {
  const { toast } = useUi();
  const [hydrated, setHydrated] = useState(false);
  const [initialTheme, setInitialTheme] = useState<ThemeSettings>(DEFAULT_THEME_SETTINGS);
  const restoredSessions = useRef(false);
  const persistReady = useRef(false);
  const tabsToRestore = useRef<{ serverId: string; title: string }[]>([]);
  const activeServerToRestore = useRef<string | undefined>(undefined);

  const [activeView, setActiveView] = useState<TabId>("terminal");
  const [navPrefs, setNavPrefs] = useState<NavPreferences>(DEFAULT_NAV_PREFS);
  const [servers, setServers] = useState<Server[]>([]);
  const [folders, setFolders] = useState<ServerFolder[]>([]);
  const [keys, setKeys] = useState<StoredKey[]>([]);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [hostKeyPrompt, setHostKeyPrompt] = useState<HostKeyPrompt | null>(null);
  const [restoringSessions, setRestoringSessions] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    let serverList: Server[] = [];

    try {
      serverList = await api.listServers();
      setServers(serverList);
    } catch (err) {
      toast.error(`Failed to load servers: ${err}`);
    }

    try {
      setFolders(await api.listServerFolders());
    } catch (err) {
      setFolders([]);
      toast.warning(`Folders unavailable — ${formatBackendError(err)}`);
    }

    try {
      setKeys(await api.listKeys());
    } catch (err) {
      toast.error(`Failed to load keys: ${err}`);
    }

    return serverList;
  }, [toast]);

  const navigate = useCallback(
    (view: TabId) => {
      if (isViewAvailable(view, navPrefs)) {
        setActiveView(view);
      }
    },
    [navPrefs],
  );

  const updateNavPrefs = useCallback((next: NavPreferences) => {
    setNavPrefs(next);
    setActiveView((current) => resolveActiveView(current, next));
  }, []);

  useEffect(() => {
    void hydrateUiState().then((state) => {
      tabsToRestore.current = state.terminalTabs;
      activeServerToRestore.current = state.activeServerId;
      setNavPrefs(state.navPrefs);
      setActiveView(state.activeView);
      setInitialTheme(state.theme);
      if (state.terminalTabs.length > 0) {
        setRestoringSessions(true);
      } else {
        persistReady.current = true;
      }
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    void refresh();
    const unlisten = listen<HostKeyPrompt>("host-key-prompt", (event) => {
      setHostKeyPrompt(event.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refresh]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (!persistReady.current) return;
        event.preventDefault();
        const activeServerId = terminalTabs.find(
          (t) => t.sessionId === activeSessionId,
        )?.serverId;
        await persistUiState({
          ...loadUiState(),
          activeView,
          navPrefs,
          terminalTabs: terminalTabs.map(({ serverId, title }) => ({
            serverId,
            title,
          })),
          activeServerId,
        });
        await getCurrentWindow().destroy();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [activeView, navPrefs, terminalTabs, activeSessionId]);

  useEffect(() => {
    if (!hydrated || restoredSessions.current) return;

    const persisted = tabsToRestore.current;
    if (persisted.length === 0) {
      restoredSessions.current = true;
      persistReady.current = true;
      setRestoringSessions(false);
      return;
    }
    if (servers.length === 0) return;

    restoredSessions.current = true;

    void (async () => {
      const restored: TerminalTab[] = [];
      let failed = 0;

      for (const tab of persisted) {
        const server = servers.find((s) => s.id === tab.serverId);
        if (!server) {
          failed += 1;
          continue;
        }
        try {
          const session = await api.connectSession(server.id, 120, 30);
          restored.push({
            sessionId: session.id,
            serverId: server.id,
            title: tab.title,
          });
        } catch {
          failed += 1;
        }
      }

      setTerminalTabs(restored);
      const active =
        restored.find((t) => t.serverId === activeServerToRestore.current) ??
        restored[0];
      setActiveSessionId(active?.sessionId);

      if (restored.length > 0) {
        setActiveView("terminal");
      }

      if (failed > 0 && restored.length === 0) {
        setRestoreStatus(
          "Could not reconnect saved sessions — use Connect in the sidebar.",
        );
      } else if (failed > 0) {
        setRestoreStatus(
          `Reconnected ${restored.length} of ${persisted.length} sessions.`,
        );
      }

      setRestoringSessions(false);
      persistReady.current = true;
    })();
  }, [servers, hydrated]);

  useEffect(() => {
    if (!persistReady.current) return;

    const activeServerId = terminalTabs.find(
      (t) => t.sessionId === activeSessionId,
    )?.serverId;

    void persistUiState({
      ...loadUiState(),
      activeView,
      navPrefs,
      terminalTabs: terminalTabs.map(({ serverId, title }) => ({
        serverId,
        title,
      })),
      activeServerId,
    });
  }, [activeView, navPrefs, terminalTabs, activeSessionId]);

  const handleConnect = async (server: Server) => {
    const existing = terminalTabs.find((t) => t.serverId === server.id);
    if (existing) {
      setActiveSessionId(existing.sessionId);
      setActiveView("terminal");
      return;
    }

    setActiveView("terminal");
    setRestoreStatus(null);
    try {
      const session = await api.connectSession(server.id, 120, 30);
      const title = `${server.name} (${server.username}@${server.host})`;
      setTerminalTabs((prev) => [
        ...prev,
        { sessionId: session.id, serverId: server.id, title },
      ]);
      setActiveSessionId(session.id);
    } catch (err) {
      toast.error(formatBackendError(err));
    }
  };

  const closeTab = useCallback(async (sessionId: string) => {
    await api.closeSession(sessionId);
    setTerminalTabs((prev) => {
      const remaining = prev.filter((t) => t.sessionId !== sessionId);
      setActiveSessionId((active) =>
        active === sessionId ? remaining[0]?.sessionId : active,
      );
      return remaining;
    });
  }, []);

  const selectTab = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setActiveView("terminal");
  }, []);

  if (!hydrated) {
    return (
      <div className="bb-bg bb-muted flex h-screen items-center justify-center">
        Loading…
      </div>
    );
  }

  const topbarLayout = navPrefs.layout === "topbar";
  const sessionLayout = sessionLayoutForNav(navPrefs.layout);

  const panels = (
    <>
      <div
        className={`absolute inset-0 overflow-hidden ${activeView === "terminal" ? "z-10" : "hidden"}`}
      >
        <TerminalPanel
          tabs={terminalTabs}
          activeSessionId={activeSessionId}
          panelVisible={activeView === "terminal"}
          sessionLayout={sessionLayout}
          restoring={restoringSessions}
          restoreStatus={restoreStatus}
          onSelectTab={selectTab}
          onCloseTab={closeTab}
        />
      </div>
      <div
        className={`absolute inset-0 overflow-hidden ${activeView === "files" ? "z-10" : "hidden"}`}
      >
        <SftpPanel servers={servers} />
      </div>
      <div
        className={`absolute inset-0 overflow-y-auto ${activeView === "sync" ? "z-10" : "hidden"}`}
      >
        <SyncPanel servers={servers} />
      </div>
      <div
        className={`absolute inset-0 overflow-hidden ${activeView === "monitor" ? "z-10" : "hidden"}`}
      >
        <MonitorPanel servers={servers} />
      </div>
      <div
        className={`absolute inset-0 overflow-hidden ${activeView === "updates" ? "z-10" : "hidden"}`}
      >
        <UpdatesPanel servers={servers} />
      </div>
      <div
        className={`absolute inset-0 overflow-y-auto ${activeView === "scenarios" ? "z-10" : "hidden"}`}
      >
        <ScenariosPanel servers={servers} />
      </div>
      <div
        className={`absolute inset-0 overflow-hidden ${activeView === "settings" ? "z-10" : "hidden"}`}
      >
        <SettingsPanel
          servers={servers}
          navPrefs={navPrefs}
          onNavPrefsChange={updateNavPrefs}
        />
      </div>
    </>
  );

  return (
    <ThemeProvider initialSettings={initialTheme}>
      <div className="bb-bg flex h-screen">
        <Sidebar
          servers={servers}
          folders={folders}
          keys={keys}
          showNav={!topbarLayout}
          showSessions={topbarLayout}
          tabs={terminalTabs}
          activeSessionId={activeSessionId}
          activeView={activeView}
          navPrefs={navPrefs}
          onNavigate={navigate}
          onRefresh={refresh}
          onConnect={handleConnect}
          onSelectSession={selectTab}
          onCloseSession={closeTab}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {topbarLayout && (
            <MainNav
              activeView={activeView}
              navPrefs={navPrefs}
              sessionCount={terminalTabs.length}
              onNavigate={navigate}
            />
          )}
          <div className="relative min-h-0 flex-1 overflow-hidden">{panels}</div>
        </main>

        {hostKeyPrompt && (
          <HostKeyDialog prompt={hostKeyPrompt} onDone={() => setHostKeyPrompt(null)} />
        )}
      </div>
    </ThemeProvider>
  );
}

function App() {
  return (
    <UiProvider>
      <AppShell />
    </UiProvider>
  );
}

export default App;
