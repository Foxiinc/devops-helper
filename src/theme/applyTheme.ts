import { getPreset } from "./presets";
import type { CustomThemeOverrides, ThemeColors, ThemeSettings } from "./types";
import { DEFAULT_CUSTOM } from "./types";

function blendCustom(base: ThemeColors, custom: CustomThemeOverrides): ThemeColors {
  return {
    ...base,
    bg: custom.background,
    surface: custom.surface,
    surface2: adjustBrightness(custom.surface, -8),
    sidebar: custom.surface,
    text: custom.text,
    muted: adjustBrightness(custom.text, 40),
    accent: custom.accent,
    accentHover: adjustBrightness(custom.accent, -15),
    accentMuted: mixAlpha(custom.accent, 0.15),
    terminalBg: custom.terminalBg,
    terminalFg: custom.terminalFg,
    terminalCursor: custom.accent,
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

function adjustBrightness(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + amount, g + amount, b + amount);
}

function mixAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  const bg = [15, 23, 42];
  return rgbToHex(
    r * alpha + bg[0] * (1 - alpha),
    g * alpha + bg[1] * (1 - alpha),
    b * alpha + bg[2] * (1 - alpha),
  );
}

export function resolveThemeColors(settings: ThemeSettings): ThemeColors {
  if (settings.presetId === "custom") {
    const base = getPreset("midnight")!.colors;
    return blendCustom(base, settings.custom);
  }
  const preset = getPreset(settings.presetId) ?? getPreset("midnight")!;
  return preset.colors;
}

export function applyTheme(settings: ThemeSettings): ThemeColors {
  const colors = resolveThemeColors(settings);
  const root = document.documentElement;

  root.dataset.theme = settings.presetId;
  root.style.setProperty("--bb-bg", colors.bg);
  root.style.setProperty("--bb-surface", colors.surface);
  root.style.setProperty("--bb-surface-2", colors.surface2);
  root.style.setProperty("--bb-sidebar", colors.sidebar);
  root.style.setProperty("--bb-border", colors.border);
  root.style.setProperty("--bb-text", colors.text);
  root.style.setProperty("--bb-muted", colors.muted);
  root.style.setProperty("--bb-accent", colors.accent);
  root.style.setProperty("--bb-accent-hover", colors.accentHover);
  root.style.setProperty("--bb-accent-muted", colors.accentMuted);
  root.style.setProperty("--bb-success", colors.success);
  root.style.setProperty("--bb-danger", colors.danger);
  root.style.setProperty("--bb-terminal-bg", colors.terminalBg);
  root.style.setProperty("--bb-terminal-fg", colors.terminalFg);
  root.style.setProperty("--bb-terminal-cursor", colors.terminalCursor);
  root.style.setProperty("--bb-scrollbar-thumb", colors.scrollbarThumb);
  root.style.setProperty("--bb-scrollbar-track", colors.scrollbarTrack);

  return colors;
}

export function presetToCustom(presetId: string): CustomThemeOverrides {
  const preset = getPreset(presetId);
  if (!preset) return { ...DEFAULT_CUSTOM };
  const c = preset.colors;
  return {
    accent: c.accent,
    background: c.bg,
    surface: c.surface2,
    text: c.text,
    terminalBg: c.terminalBg,
    terminalFg: c.terminalFg,
  };
}
