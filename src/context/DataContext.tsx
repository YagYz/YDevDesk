import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/tauri";
import { notify } from "../lib/notify";
import { useNotifications } from "../lib/useNotifications";
import { SettingsProvider, useSettings } from "./SettingsContext";
import { AgentProvider, useAgent } from "./AgentContext";
import { HomelabProvider, useHomelab } from "./HomelabContext";
import {
  aggregateUsageAnalytics,
  applySyncedSettings,
  buildDeviceSnapshot,
  loadLocalSyncPayload,
  loadSyncPreferences,
  mergeSyncPayloads,
  saveLocalSyncPayload,
  saveSyncPreferences,
  type SyncPayload,
} from "../lib/sync";
import {
  decryptSyncPayload,
  encryptSyncPayload,
  generateSyncKey,
  isEncryptedEnvelope,
} from "../lib/syncCrypto";
import { loadWorkspaces, WORKSPACES_KEY } from "../lib/workspaces";
import { LAYOUT_KEY } from "../lib/layout";
import type {
  AgentMarkdownFile,
  AgentStatus,
  AppSettings,
  DeviceTelemetrySnapshot,
  HomelabConfig,
  HubStatus,
  Knowledge,
  NetworkData,
  Note,
  SyncPreferences,
  SyncStatusInfo,
  UpdateCheckResult,
  UsageAnalytics,
} from "../types";

export { useSettings } from "./SettingsContext";
export { useAgent } from "./AgentContext";
export { useHomelab } from "./HomelabContext";

type DataContextValue = {
  config: HomelabConfig;
  settings: AppSettings;
  projectRoots: string[];
  saveSettings: (s: AppSettings) => Promise<void>;
  agent: AgentStatus;
  markdowns: AgentMarkdownFile[];
  refreshMarkdowns: () => Promise<void>;
  network: NetworkData;
  bandwidth: number[];
  notes: Note[];
  knowledge: Knowledge[];
  hubStatus: HubStatus;
  hubError: string;
  refreshHub: () => Promise<void>;
  addNote: (content: string) => Promise<void>;
  addKnowledge: (title: string, summary: string) => Promise<void>;
  availableUpdate: UpdateCheckResult | null;
  dismissUpdate: () => void;
  usage: UsageAnalytics | null;
  combinedUsage: UsageAnalytics | null;
  refreshUsage: () => Promise<void>;
  syncStatus: SyncStatusInfo | null;
  syncPrefs: SyncPreferences;
  updateSyncPrefs: (next: SyncPreferences) => void;
  syncing: boolean;
  needsSyncKey: boolean;
  lastSyncedAt: number | null;
  syncError: string;
  remoteSnapshots: Record<string, DeviceTelemetrySnapshot>;
  syncedSessionPrefsVersion: number;
  refreshSyncStatus: () => Promise<SyncStatusInfo | null>;
  syncNow: (forcePush?: boolean) => Promise<void>;
  submitSyncKey: (key: string) => Promise<void>;
  markSectionDirty: (section: "workspaces" | "session_prefs" | "layout") => void;
};

const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData yalnızca DataProvider içinde kullanılabilir");
  return ctx;
}

export function DataProvider({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <AgentProvider>
        <HomelabProvider>
          <DataSyncLayer>{children}</DataSyncLayer>
        </HomelabProvider>
      </AgentProvider>
    </SettingsProvider>
  );
}

function DataSyncLayer({ children }: { children: ReactNode }) {
  const { config, settings, projectRoots, configLoaded, saveSettings: baseSaveSettings, setSettingsDirect: setSettings } = useSettings();
  const { agent, usage, markdowns, refreshUsage, refreshMarkdowns } = useAgent();
  const { network, bandwidth, notes, knowledge, hubStatus, hubError, refreshHub, addNote } = useHomelab();

  const [syncStatus, setSyncStatus] = useState<SyncStatusInfo | null>(null);
  const [syncPrefs, setSyncPrefsState] = useState<SyncPreferences>(() => loadSyncPreferences());
  const [syncing, setSyncing] = useState(false);
  const [needsSyncKey, setNeedsSyncKey] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState("");
  const [remoteSnapshots, setRemoteSnapshots] = useState<Record<string, DeviceTelemetrySnapshot>>(() => {
    return loadLocalSyncPayload().device_snapshots ?? {};
  });
  const [syncedSessionPrefsVersion, setSyncedSessionPrefsVersion] = useState(0);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const usageRef = useRef(usage);
  usageRef.current = usage;
  const syncStatusRef = useRef(syncStatus);
  syncStatusRef.current = syncStatus;
  const syncPrefsRef = useRef(syncPrefs);
  syncPrefsRef.current = syncPrefs;
  const syncBusyRef = useRef(false);
  const pushTimerRef = useRef<number | null>(null);
  const lastFocusSyncRef = useRef(0);

  const saveSettings = useCallback(async (next: AppSettings) => {
    await baseSaveSettings(next);

    const st = syncStatusRef.current;
    if (st?.connected) {
      const now = Date.now();
      const local = loadLocalSyncPayload();
      local.quick_actions = { updatedAt: now, deviceId: st.device_id, data: next.quick_actions };
      local.terminal_presets = { updatedAt: now, deviceId: st.device_id, data: next.terminal_presets };
      local.disabled_modules = { updatedAt: now, deviceId: st.device_id, data: next.disabled_modules };
      local.notifications = { updatedAt: now, deviceId: st.device_id, data: next.notifications };
      saveLocalSyncPayload(local);
      if (pushTimerRef.current) window.clearTimeout(pushTimerRef.current);
      pushTimerRef.current = window.setTimeout(() => {
        void syncNowRef.current(true);
      }, 2500);
    }
  }, [baseSaveSettings]);

  useNotifications({ agent, hubStatus, network }, settings.notifications, configLoaded);

  const [availableUpdate, setAvailableUpdate] = useState<UpdateCheckResult | null>(null);
  const notifiedUpdateRef = useRef<string | null>(null);
  const dismissedUpdateRef = useRef<string | null>(null);
  const notifRef = useRef(settings.notifications);
  notifRef.current = settings.notifications;

  useEffect(() => {
    if (!configLoaded) return;
    let alive = true;
    const runCheck = () => {
      api
        .checkUpdate()
        .then((info) => {
          if (!alive || !info.has_update) return;
          if (dismissedUpdateRef.current === info.latest_version) return;
          if (!notifRef.current.app_update) return;
          setAvailableUpdate(info);
          if (notifRef.current.enabled && notifiedUpdateRef.current !== info.latest_version) {
            notifiedUpdateRef.current = info.latest_version;
            notify(
              "YDevDesk Güncellemesi Hazır",
              `v${info.latest_version} yayınlandı. Uygulama içinden güncelleyebilirsin.`,
            );
          }
        })
        .catch(() => {});
    };
    const startTimer = window.setTimeout(runCheck, 4000);
    const interval = window.setInterval(runCheck, 30 * 60 * 1000);
    return () => {
      alive = false;
      window.clearTimeout(startTimer);
      window.clearInterval(interval);
    };
  }, [configLoaded]);

  // Bilgi Ağı kaydı yerel/hub servisine knowledge_add üzerinden gider (hub zorunlu değil).
  const addKnowledge = useCallback(async (title: string, summary: string) => {
    await api.knowledgeAdd("ydevdesk", title, summary);
  }, []);

  const refreshSyncStatus = useCallback(async () => {
    try {
      const st = await api.syncStatus();
      syncStatusRef.current = st;
      setSyncStatus(st);
      return st;
    } catch {
      return null;
    }
  }, []);

  const updateSyncPrefs = useCallback((next: SyncPreferences) => {
    saveSyncPreferences(next);
    setSyncPrefsState(next);
  }, []);

  const syncNow = useCallback(async (forcePush = false) => {
    let st = syncStatusRef.current;
    if (!st?.connected) {
      st = await refreshSyncStatus();
    }
    if (!st?.connected || syncBusyRef.current) return;
    syncBusyRef.current = true;
    setSyncing(true);
    try {
      let syncKey = await api.syncGetKey();
      const pull = await api.syncPull();
      const local = loadLocalSyncPayload();
      const curSettings = settingsRef.current;
      const now = Date.now();

      // İlk kez yerel bölümler doldurulmamışsa mevcut durumu baz al
      if (!local.quick_actions) local.quick_actions = { updatedAt: 0, deviceId: st.device_id, data: curSettings.quick_actions };
      if (!local.terminal_presets) local.terminal_presets = { updatedAt: 0, deviceId: st.device_id, data: curSettings.terminal_presets };
      if (!local.disabled_modules) local.disabled_modules = { updatedAt: 0, deviceId: st.device_id, data: curSettings.disabled_modules };
      if (!local.notifications) local.notifications = { updatedAt: 0, deviceId: st.device_id, data: curSettings.notifications };
      if (!local.workspaces) local.workspaces = { updatedAt: 0, deviceId: st.device_id, data: loadWorkspaces() };
      if (!local.session_prefs) {
        try {
          const sp = await api.loadSessionPrefs();
          local.session_prefs = { updatedAt: 0, deviceId: st.device_id, data: sp };
        } catch {
          // ignore
        }
      }

      if (usageRef.current) {
        local.device_snapshots = {
          ...(local.device_snapshots ?? {}),
          [st.device_id]: buildDeviceSnapshot(st.device_id, st.device_name, usageRef.current, agentRef.current.sessions),
        };
      }

      let merged: SyncPayload = local;
      let shouldPush = forcePush || !pull.gist_id;

      if (pull.changed && pull.payload_json) {
        if (isEncryptedEnvelope(pull.payload_json) && !syncKey) {
          setNeedsSyncKey(true);
          setSyncError("");
          return;
        }
        try {
          const { payload: remote } = await decryptSyncPayload(pull.payload_json, syncKey);
          setNeedsSyncKey(false);
          if (remote && remote.version === 1) {
            merged = mergeSyncPayloads(local, remote);

            // Uzaktan daha yeni ayar geldiyse uygula
            const remoteWonSettings =
              (remote.quick_actions?.updatedAt ?? 0) > (local.quick_actions?.updatedAt ?? 0) ||
              (remote.terminal_presets?.updatedAt ?? 0) > (local.terminal_presets?.updatedAt ?? 0) ||
              (remote.disabled_modules?.updatedAt ?? 0) > (local.disabled_modules?.updatedAt ?? 0) ||
              (remote.notifications?.updatedAt ?? 0) > (local.notifications?.updatedAt ?? 0);

            if (remoteWonSettings) {
              const nextSettings = applySyncedSettings(curSettings, merged);
              await api.saveAppSettings(nextSettings);
              setSettings(nextSettings);
            }

            if ((remote.workspaces?.updatedAt ?? 0) > (local.workspaces?.updatedAt ?? 0) && merged.workspaces) {
              localStorage.setItem(WORKSPACES_KEY, JSON.stringify(merged.workspaces.data));
            }

            if ((remote.session_prefs?.updatedAt ?? 0) > (local.session_prefs?.updatedAt ?? 0) && merged.session_prefs) {
              await api.saveSessionPrefs(merged.session_prefs.data);
              setSyncedSessionPrefsVersion((v) => v + 1);
            }

            if (
              syncPrefsRef.current.sync_layout &&
              (remote.layout?.updatedAt ?? 0) > (local.layout?.updatedAt ?? 0) &&
              merged.layout?.data
            ) {
              localStorage.setItem(LAYOUT_KEY, JSON.stringify(merged.layout.data));
            }

            // Yerel cihaz snapshot'ımız veya yerel bir bölümümüz remote'tan yeniyse push gerekir
            if (
              (local.quick_actions?.updatedAt ?? 0) > (remote.quick_actions?.updatedAt ?? 0) ||
              (local.terminal_presets?.updatedAt ?? 0) > (remote.terminal_presets?.updatedAt ?? 0) ||
              (local.disabled_modules?.updatedAt ?? 0) > (remote.disabled_modules?.updatedAt ?? 0) ||
              (local.notifications?.updatedAt ?? 0) > (remote.notifications?.updatedAt ?? 0) ||
              (local.workspaces?.updatedAt ?? 0) > (remote.workspaces?.updatedAt ?? 0) ||
              (local.session_prefs?.updatedAt ?? 0) > (remote.session_prefs?.updatedAt ?? 0) ||
              Boolean(usageRef.current)
            ) {
              shouldPush = true;
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("Sync anahtarı")) {
            setNeedsSyncKey(true);
            throw err;
          }
          shouldPush = true;
        }
      } else if (usageRef.current) {
        // Değişiklik yoksa bile kendi güncel token/oturum snapshot'ımızı periyodik push edebiliriz
        shouldPush = forcePush || !pull.gist_id || now - (lastSyncedAt ?? 0) > 45_000;
      }

      if (shouldPush) {
        if (!syncKey) {
          syncKey = generateSyncKey();
          await api.syncSetKey(syncKey);
          await refreshSyncStatus();
        }
        const encryptedPayload = await encryptSyncPayload(merged, syncKey);
        await api.syncPush(encryptedPayload);
      }

      saveLocalSyncPayload(merged);
      setRemoteSnapshots(merged.device_snapshots ?? {});
      setLastSyncedAt(now);
      setSyncError("");
    } catch (e) {
      setSyncError(String(e));
    } finally {
      syncBusyRef.current = false;
      setSyncing(false);
    }
  }, [lastSyncedAt]);

  const syncNowRef = useRef(syncNow);
  syncNowRef.current = syncNow;

  const submitSyncKey = useCallback(
    async (key: string) => {
      await api.syncSetKey(key);
      setNeedsSyncKey(false);
      await refreshSyncStatus();
      await syncNowRef.current(false);
    },
    [refreshSyncStatus],
  );

  const markSectionDirty = useCallback((section: "workspaces" | "session_prefs" | "layout") => {
    const st = syncStatusRef.current;
    if (!st?.connected) return;
    if (section === "layout" && !syncPrefsRef.current.sync_layout) return;

    const now = Date.now();
    const local = loadLocalSyncPayload();

    const applyAndSchedule = async () => {
      if (section === "workspaces") {
        local.workspaces = { updatedAt: now, deviceId: st.device_id, data: loadWorkspaces() };
      } else if (section === "session_prefs") {
        const sp = await api.loadSessionPrefs();
        local.session_prefs = { updatedAt: now, deviceId: st.device_id, data: sp };
      } else if (section === "layout") {
        const raw = localStorage.getItem(LAYOUT_KEY);
        if (raw) {
          local.layout = { updatedAt: now, deviceId: st.device_id, data: JSON.parse(raw) };
        }
      }
      saveLocalSyncPayload(local);
      if (pushTimerRef.current) window.clearTimeout(pushTimerRef.current);
      pushTimerRef.current = window.setTimeout(() => {
        void syncNowRef.current(true);
      }, 2500);
    };

    void applyAndSchedule();
  }, []);

  // Açılışta sync durumunu yükle ve bağlıysa 30 sn + focus döngüsünü başlat
  useEffect(() => {
    if (!configLoaded) return;
    void refreshSyncStatus().then((st) => {
      if (st?.connected) {
        window.setTimeout(() => void syncNowRef.current(false), 1500);
      }
    });
  }, [configLoaded, refreshSyncStatus]);

  useEffect(() => {
    if (!syncStatus?.connected) return;
    const interval = window.setInterval(() => {
      void syncNowRef.current(false);
    }, 30_000);
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusSyncRef.current > 10_000) {
        lastFocusSyncRef.current = now;
        void syncNowRef.current(false);
      }
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [syncStatus?.connected]);

  const combinedUsage = useMemo(() => {
    if (!usage) return null;
    return aggregateUsageAnalytics(usage, remoteSnapshots, syncStatus?.device_id ?? "");
  }, [usage, remoteSnapshots, syncStatus?.device_id]);

  const dismissUpdate = useCallback(() => {
    if (availableUpdate) {
      dismissedUpdateRef.current = availableUpdate.latest_version;
    }
    setAvailableUpdate(null);
  }, [availableUpdate]);

  const value = useMemo<DataContextValue>(
    () => ({
      config,
      settings,
      projectRoots,
      saveSettings,
      agent,
      markdowns,
      refreshMarkdowns,
      network,
      bandwidth,
      notes,
      knowledge,
      hubStatus,
      hubError,
      refreshHub,
      addNote,
      addKnowledge,
      availableUpdate,
      dismissUpdate,
      usage,
      combinedUsage,
      refreshUsage,
      syncStatus,
      syncPrefs,
      updateSyncPrefs,
      syncing,
      needsSyncKey,
      lastSyncedAt,
      syncError,
      remoteSnapshots,
      syncedSessionPrefsVersion,
      refreshSyncStatus,
      syncNow,
      submitSyncKey,
      markSectionDirty,
    }),
    [config, settings, projectRoots, saveSettings, agent, markdowns, refreshMarkdowns, network, bandwidth, notes, knowledge, hubStatus, hubError, refreshHub, addNote, addKnowledge, availableUpdate, dismissUpdate, usage, combinedUsage, refreshUsage, syncStatus, syncPrefs, updateSyncPrefs, syncing, needsSyncKey, lastSyncedAt, syncError, remoteSnapshots, syncedSessionPrefsVersion, refreshSyncStatus, syncNow, submitSyncKey, markSectionDirty],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
