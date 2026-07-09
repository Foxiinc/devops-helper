import type { TabId } from "../types";
import { visibleNavItems, type NavPreferences } from "../config/nav";

interface MainNavProps {
  activeView: TabId;
  navPrefs: NavPreferences;
  sessionCount: number;
  onNavigate: (view: TabId) => void;
}

export function MainNav({ activeView, navPrefs, sessionCount, onNavigate }: MainNavProps) {
  const items = visibleNavItems(navPrefs);

  return (
    <nav className="bb-surface bb-border flex shrink-0 border-b">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium transition-colors ${
            activeView === item.id ? "nav-tab-active" : "nav-tab"
          }`}
          onClick={() => onNavigate(item.id)}
        >
          <span className="text-xs opacity-80">{item.icon}</span>
          {item.label}
          {item.id === "terminal" && sessionCount > 0 && (
            <span className="badge-count ml-1 rounded-full px-1.5 text-xs">{sessionCount}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
