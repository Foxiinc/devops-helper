import { useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { THEME_PRESETS } from "../theme/presets";
import type { CustomThemeOverrides } from "../theme/types";
import { NAV_ITEMS, type NavPreferences } from "../config/nav";
import { KeysPanel } from "./KeysPanel";
import type { Server } from "../types";

interface SettingsPanelProps {
  servers: Server[];
  navPrefs: NavPreferences;
  onNavPrefsChange: (prefs: NavPreferences) => void;
}

type SettingsSection = "appearance" | "interface" | "keys";

const CUSTOM_FIELDS: {
  key: keyof CustomThemeOverrides;
  label: string;
}[] = [
  { key: "accent", label: "Accent" },
  { key: "background", label: "Background" },
  { key: "surface", label: "Surface / cards" },
  { key: "text", label: "Text" },
  { key: "terminalBg", label: "Terminal background" },
  { key: "terminalFg", label: "Terminal text" },
];

const TOGGLEABLE_NAV = NAV_ITEMS.filter((item) => !item.pinned);

type ToggleableNavKey = "monitor" | "updates" | "files" | "sync" | "scenarios";

const NAV_LAYOUT_OPTIONS: {
  id: NavPreferences["layout"];
  title: string;
  description: string;
}[] = [
  {
    id: "sidebar",
    title: "Sidebar navigation",
    description: "Modules in the left sidebar · session tabs on top of terminal",
  },
  {
    id: "topbar",
    title: "Top bar navigation",
    description: "Modules as tabs on top · sessions above servers in sidebar · full-width terminal",
  },
];

export function SettingsPanel({
  servers,
  navPrefs,
  onNavPrefsChange,
}: SettingsPanelProps) {
  const { settings, setPreset, setCustom, useCustomPreset } = useTheme();
  const [section, setSection] = useState<SettingsSection>("appearance");

  const toggleNav = (id: ToggleableNavKey) => {
    onNavPrefsChange({ ...navPrefs, [id]: !navPrefs[id] });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="bb-border shrink-0 border-b px-6 pt-6">
        <h2 className="bb-page-title">Settings</h2>
        <p className="bb-muted mt-1 text-sm">Appearance, navigation, SSH keys</p>
        <div className="mt-4 flex gap-1">
          {(
            [
              ["appearance", "Appearance"],
              ["interface", "Navigation"],
              ["keys", "SSH Keys"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded-t px-4 py-2 text-sm font-medium transition-colors ${
                section === id
                  ? "bb-accent bb-surface-2 border bb-border border-b-0"
                  : "bb-muted hover:text-[var(--bb-text)]"
              }`}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {section === "appearance" && (
          <div className="space-y-8 p-6">
            <section>
              <h3 className="bb-text text-sm font-semibold uppercase tracking-wide">
                Theme presets
              </h3>
              <p className="bb-muted mt-1 text-sm">
                Six built-in styles — click to apply instantly
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {THEME_PRESETS.map((preset) => {
                  const active = settings.presetId === preset.id;
                  const c = preset.colors;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`bb-card rounded-xl p-4 text-left transition ring-2 ${
                        active
                          ? "ring-[var(--bb-accent)]"
                          : "ring-transparent hover:ring-[var(--bb-border)]"
                      }`}
                      onClick={() => setPreset(preset.id)}
                    >
                      <div className="flex gap-2">
                        {[c.bg, c.surface2, c.accent, c.terminalBg].map((color, i) => (
                          <span
                            key={i}
                            className="h-8 w-8 rounded-md border border-black/10"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                      <p className="bb-text mt-3 font-medium">{preset.name}</p>
                      <p className="bb-muted mt-0.5 text-xs">{preset.description}</p>
                      {active && (
                        <span className="bb-accent mt-2 inline-block text-xs font-medium">
                          Active
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="bb-text text-sm font-semibold uppercase tracking-wide">
                    Custom theme
                  </h3>
                  <p className="bb-muted mt-1 text-sm">
                    Fine-tune colors — switches to custom preset
                  </p>
                </div>
                <button type="button" className="btn-secondary text-xs" onClick={useCustomPreset}>
                  Use custom
                </button>
              </div>
              <div className="bb-card mt-4 grid gap-4 rounded-xl p-4 sm:grid-cols-2 lg:grid-cols-3">
                {CUSTOM_FIELDS.map(({ key, label }) => (
                  <label key={key} className="block">
                    <span className="bb-muted text-xs font-medium">{label}</span>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="color"
                        value={settings.custom[key]}
                        onChange={(e) => setCustom({ [key]: e.target.value })}
                        className="h-9 w-12 cursor-pointer rounded border-0 bg-transparent p-0"
                      />
                      <input
                        type="text"
                        className="input font-mono text-xs uppercase"
                        value={settings.custom[key]}
                        onChange={(e) => setCustom({ [key]: e.target.value })}
                        spellCheck={false}
                      />
                    </div>
                  </label>
                ))}
              </div>
              {settings.presetId === "custom" && (
                <p className="bb-success mt-2 text-xs">Custom theme is active</p>
              )}
            </section>
          </div>
        )}

        {section === "interface" && (
          <div className="space-y-6 p-6">
            <section>
              <h3 className="bb-text text-sm font-semibold uppercase tracking-wide">
                Navigation style
              </h3>
              <p className="bb-muted mt-1 text-sm">
                Choose where main sections live and how terminal sessions are shown
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {NAV_LAYOUT_OPTIONS.map((option) => {
                  const active = navPrefs.layout === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={`bb-card rounded-xl p-4 text-left transition ring-2 ${
                        active
                          ? "ring-[var(--bb-accent)]"
                          : "ring-transparent hover:ring-[var(--bb-border)]"
                      }`}
                      onClick={() => onNavPrefsChange({ ...navPrefs, layout: option.id })}
                    >
                      <p className="bb-text font-medium">{option.title}</p>
                      <p className="bb-muted mt-1 text-xs">{option.description}</p>
                      {active && (
                        <span className="bb-accent mt-2 inline-block text-xs font-medium">
                          Active
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <h3 className="bb-text text-sm font-semibold uppercase tracking-wide">
                Visible modules
              </h3>
              <p className="bb-muted mt-1 text-sm">
                Terminal and Settings are always shown. Other sections can be hidden.
              </p>
              <div className="bb-card mt-4 space-y-2 rounded-xl p-4">
                {TOGGLEABLE_NAV.map((item) => {
                  const key = item.id as ToggleableNavKey;
                  const checked = navPrefs[key];
                  return (
                    <label
                      key={item.id}
                      className="bb-row-hover flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleNav(key)}
                        className="h-4 w-4 accent-[var(--bb-accent)]"
                      />
                      <span className="w-5 text-center text-xs opacity-80">{item.icon}</span>
                      <span className="bb-text flex-1 text-sm font-medium">{item.label}</span>
                    </label>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {section === "keys" && <KeysPanel servers={servers} embedded />}
      </div>
    </div>
  );
}
