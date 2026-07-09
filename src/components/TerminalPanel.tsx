import { TerminalView } from "./TerminalView";
import type { SessionTabLayout } from "../config/nav";
import type { TerminalTab } from "../types";

interface TerminalPanelProps {
  tabs: TerminalTab[];
  activeSessionId?: string;
  panelVisible: boolean;
  sessionLayout: SessionTabLayout;
  restoring: boolean;
  restoreStatus: string | null;
  onSelectTab: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
}

export function TerminalPanel({
  tabs,
  activeSessionId,
  panelVisible,
  sessionLayout,
  restoring,
  restoreStatus,
  onSelectTab,
  onCloseTab,
}: TerminalPanelProps) {
  return (
    <div className="bb-terminal-bg flex h-full flex-col">
      {sessionLayout === "top" && tabs.length > 0 && (
        <div className="bb-surface bb-border flex shrink-0 gap-0.5 overflow-x-auto border-b px-2 pt-2">
          {tabs.map((tab) => {
            const active = activeSessionId === tab.sessionId;
            return (
              <div
                key={tab.sessionId}
                className={`group flex max-w-xs items-center rounded-t border border-b-0 text-sm ${
                  active ? "session-tab-active" : "session-tab"
                }`}
              >
                <button
                  type="button"
                  className="truncate px-3 py-1.5 text-left"
                  onClick={() => onSelectTab(tab.sessionId)}
                  title={tab.title}
                >
                  {tab.title}
                </button>
                <button
                  type="button"
                  className="bb-muted shrink-0 px-2 py-1.5 hover:text-[var(--bb-danger)]"
                  onClick={() => onCloseTab(tab.sessionId)}
                  title="Close session"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {restoreStatus && (
        <p className="bb-banner-warn shrink-0 px-4 py-2 text-xs">{restoreStatus}</p>
      )}

      <div className="relative min-h-0 flex-1">
        {tabs.length === 0 && !restoring ? (
          <div className="bb-muted flex h-full items-center justify-center">
            <div className="text-center">
              <p className="bb-text text-lg">No active sessions</p>
              <p className="mt-2 text-sm">Select a server in the sidebar and click Connect</p>
            </div>
          </div>
        ) : (
          <>
            {tabs.map((tab) => (
              <TerminalView
                key={tab.sessionId}
                sessionId={tab.sessionId}
                active={activeSessionId === tab.sessionId}
                panelVisible={panelVisible}
                onSessionClosed={onCloseTab}
              />
            ))}
            {restoring && (
              <div className="bb-overlay bb-muted absolute inset-0 z-20 flex items-center justify-center">
                <p className="text-sm">Restoring sessions…</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
