import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { applyTheme, presetToCustom, resolveThemeColors } from "../theme/applyTheme";
import { loadUiState, persistUiState } from "../state/persist";
import type { ThemeColors } from "../theme/types";
import {
  DEFAULT_THEME_SETTINGS,
  type CustomThemeOverrides,
  type ThemeSettings,
} from "../theme/types";

interface ThemeContextValue {
  settings: ThemeSettings;
  colors: ThemeColors;
  setPreset: (presetId: string) => void;
  setCustom: (patch: Partial<CustomThemeOverrides>) => void;
  useCustomPreset: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialSettings,
}: {
  children: ReactNode;
  initialSettings?: ThemeSettings;
}) {
  const [settings, setSettings] = useState<ThemeSettings>(() => {
    return initialSettings ?? loadUiState().theme ?? DEFAULT_THEME_SETTINGS;
  });

  const colors = useMemo(() => resolveThemeColors(settings), [settings]);

  useEffect(() => {
    applyTheme(settings);
  }, [settings]);

  const persistTheme = useCallback((next: ThemeSettings) => {
    setSettings(next);
    void persistUiState({ ...loadUiState(), theme: next });
  }, []);

  const setPreset = useCallback(
    (presetId: string) => {
      persistTheme({
        presetId,
        custom: presetToCustom(presetId),
      });
    },
    [persistTheme],
  );

  const setCustom = useCallback(
    (patch: Partial<CustomThemeOverrides>) => {
      persistTheme({
        presetId: "custom",
        custom: { ...settings.custom, ...patch },
      });
    },
    [persistTheme, settings.custom],
  );

  const useCustomPreset = useCallback(() => {
    persistTheme({
      presetId: "custom",
      custom: settings.custom,
    });
  }, [persistTheme, settings.custom]);

  const value = useMemo(
    () => ({ settings, colors, setPreset, setCustom, useCustomPreset }),
    [settings, colors, setPreset, setCustom, useCustomPreset],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
