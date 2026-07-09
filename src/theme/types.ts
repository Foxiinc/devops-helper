export interface ThemeColors {
  bg: string;
  surface: string;
  surface2: string;
  sidebar: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentHover: string;
  accentMuted: string;
  success: string;
  danger: string;
  terminalBg: string;
  terminalFg: string;
  terminalCursor: string;
  scrollbarThumb: string;
  scrollbarTrack: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
}

export interface CustomThemeOverrides {
  accent: string;
  background: string;
  surface: string;
  text: string;
  terminalBg: string;
  terminalFg: string;
}

export interface ThemeSettings {
  presetId: string;
  custom: CustomThemeOverrides;
}

export const DEFAULT_CUSTOM: CustomThemeOverrides = {
  accent: "#38bdf8",
  background: "#0f172a",
  surface: "#1e293b",
  text: "#e2e8f0",
  terminalBg: "#0f172a",
  terminalFg: "#e2e8f0",
};

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  presetId: "midnight",
  custom: { ...DEFAULT_CUSTOM },
};
