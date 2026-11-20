import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/tauri";
import { deriveConfig, getProjectRoots, normalizeSettings } from "../lib/settings";
import { applyTheme, DEFAULT_THEME_ID } from "../lib/themes";
import type { AppSettings, HomelabConfig, InstalledPlugin, ThemeManifest } from "../types";

const DEFAULT_CONFIG: HomelabConfig = {
  ydevhub_url: "",
  ydevhub_key: "",
  ynetmon_url: "",
  ynetmon_key: "",
};

export type SettingsContextValue = {
  config: HomelabConfig;
  settings: AppSettings;
  projectRoots: string[];
  configLoaded: boolean;
  plugins: InstalledPlugin[];
  refreshPlugins: () => Promise<void>;
  themes: ThemeManifest[];
  refreshThemes: () => Promise<void>;
  saveSettings: (next: AppSettings) => Promise<void>;
  /** İç kullanım: Sync sonrası ayarları yerel state'e yansıtır. */
  setSettingsDirect: (next: AppSettings) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings yalnızca SettingsProvider içinde kullanılabilir");
  return ctx;
}

export function SettingsProvider({
  children,
  onSettingsSaved,
}: {
  children: ReactNode;
  onSettingsSaved?: (next: AppSettings) => void;
}) {
  const [settings, setSettings] = useState<AppSettings>(() => normalizeSettings(null, DEFAULT_CONFIG, ""));
  const [configLoaded, setConfigLoaded] = useState(false);
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [themes, setThemes] = useState<ThemeManifest[]>([]);
  const onSavedRef = useRef(onSettingsSaved);
  onSavedRef.current = onSettingsSaved;

  const refreshPlugins = useCallback(async () => {
    try {
      const list = await api.listInstalledPlugins();
      setPlugins(list);
    } catch {
      /* sessiz */
    }
  }, []);

  const refreshThemes = useCallback(async () => {
    try {
      const list = await api.listThemes();
      setThemes(list);
    } catch {
      /* sessiz */
    }
  }, []);

  useEffect(() => {
    Promise.all([api.loadAppSettings(), api.loadConfig(), api.defaultProjectsRoot()])
      .then(([saved, cfg, root]) => setSettings(normalizeSettings(saved, cfg, root)))
      .catch(console.error)
      .finally(() => setConfigLoaded(true));
    void refreshPlugins();
    void refreshThemes();
  }, [refreshPlugins, refreshThemes]);

  // Seçili temayı CSS değişkenlerine ve xterm terminallerine uygula
  useEffect(() => {
    if (themes.length === 0) return;
    const targetId = settings.theme_id || DEFAULT_THEME_ID;
    const found = themes.find((t) => t.id === targetId) ?? themes.find((t) => t.id === DEFAULT_THEME_ID) ?? themes[0];
    applyTheme(found);
  }, [themes, settings.theme_id]);

  const config = useMemo(() => deriveConfig(settings.connections), [settings.connections]);
  const projectRoots = useMemo(() => getProjectRoots(settings.connections), [settings.connections]);

  const saveSettings = useCallback(async (next: AppSettings) => {
    await api.saveAppSettings(next);
    await api.saveConfig(deriveConfig(next.connections));
    setSettings(next);
    onSavedRef.current?.(next);
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      config,
      settings,
      projectRoots,
      configLoaded,
      plugins,
      refreshPlugins,
      themes,
      refreshThemes,
      saveSettings,
      setSettingsDirect: setSettings,
    }),
    [config, settings, projectRoots, configLoaded, plugins, refreshPlugins, themes, refreshThemes, saveSettings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
