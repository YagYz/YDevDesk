import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/tauri";
import { notify } from "../lib/notify";
import { useNotifications } from "../lib/useNotifications";
import { deriveConfig, normalizeSettings } from "../lib/settings";
import type {
  AgentStatus,
  AppSettings,
  HomelabConfig,
  HubStatus,
  Knowledge,
  NetworkData,
  Note,
  UpdateCheckResult,
  UsageAnalytics,
} from "../types";

const DEFAULT_CONFIG: HomelabConfig = {
  ydevhub_url: "",
  ydevhub_key: "",
  ynetmon_url: "",
  ynetmon_key: "",
};

const INITIAL_AGENT: AgentStatus = {
  model: "AGY",
  used_percentage: 0,
  session_cost: 0,
  total_input_tokens: 0,
  total_output_tokens: 0,
  mode: "CAVEMAN",
  agent_state: "idle",
  active_sessions_count: 0,
  quota_5h_percent: 100,
  quota_weekly_percent: 100,
  tools_per_minute: 0,
  marquee_text: "YDevDesk hazır.",
  ticker_squares: [],
  file_heat: [],
  sessions: [],
  subagents: [],
  recent_tools: [],
};

const INITIAL_NET: NetworkData = {
  rx_bps: 0,
  tx_bps: 0,
  active_conns: 0,
  devices: 0,
  db_packets: 0,
  status: "unconfigured",
};

type DataContextValue = {
  config: HomelabConfig;
  settings: AppSettings;
  saveSettings: (s: AppSettings) => Promise<void>;
  agent: AgentStatus;
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
  refreshUsage: () => Promise<void>;
};

const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData yalnızca DataProvider içinde kullanılabilir");
  return ctx;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => normalizeSettings(null, DEFAULT_CONFIG, ""));
  const config = useMemo(() => deriveConfig(settings.connections), [settings.connections]);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [agent, setAgent] = useState<AgentStatus>(INITIAL_AGENT);
  const [network, setNetwork] = useState<NetworkData>(INITIAL_NET);
  const [bandwidth, setBandwidth] = useState<number[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [hubStatus, setHubStatus] = useState<HubStatus>("unconfigured");
  const [hubError, setHubError] = useState("");
  const [usage, setUsage] = useState<UsageAnalytics | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  // Yapılandırmayı ilk açılışta oku
  useEffect(() => {
    Promise.all([api.loadAppSettings(), api.loadConfig(), api.defaultProjectsRoot()])
      .then(([saved, cfg, root]) => setSettings(normalizeSettings(saved, cfg, root)))
      .catch(console.error)
      .finally(() => setConfigLoaded(true));
  }, []);

  const refreshHub = useCallback(async () => {
    const cfg = configRef.current;
    if (!cfg.ydevhub_url || !cfg.ydevhub_key) {
      setHubStatus("unconfigured");
      setNotes([]);
      setKnowledge([]);
      return;
    }
    setHubStatus((s) => (s === "ok" ? s : "loading"));
    try {
      const [n, k] = await Promise.all([api.notes(cfg), api.knowledge(cfg)]);
      setNotes(n?.success ? (n.notes ?? []) : []);
      setKnowledge(
        k?.success
          ? (k.knowledge ?? []).map((x: any) => ({
              ...x,
              linked_topics: Array.isArray(x.linked_topics) ? x.linked_topics : [],
            }))
          : [],
      );
      setHubStatus("ok");
      setHubError("");
    } catch (e) {
      setHubStatus("error");
      setHubError(String(e));
    }
  }, []);

  // YDevHub verisi: yapılandırma değişince ve 60 sn'de bir
  useEffect(() => {
    if (!configLoaded) return;
    refreshHub();
    const id = setInterval(refreshHub, 60_000);
    return () => clearInterval(id);
  }, [configLoaded, config.ydevhub_url, config.ydevhub_key, refreshHub]);

  // Ajan telemetrisi (yerel): 2 sn
  useEffect(() => {
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const s = await api.agentStatus();
        if (alive) setAgent(s);
      } catch (e) {
        console.error("Ajan durumu alınamadı:", e);
      } finally {
        busy = false;
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const refreshUsage = useCallback(async () => {
    try {
      const data = await api.usageAnalytics();
      setUsage(data);
    } catch (e) {
      console.error("Kullanım analitiği alınamadı:", e);
    }
  }, []);

  // Token, maliyet & kota analitiği: açılışta ve 30 sn'de bir
  useEffect(() => {
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const data = await api.usageAnalytics();
        if (alive) setUsage(data);
      } catch (e) {
        console.error("Kullanım analitiği alınamadı:", e);
      } finally {
        busy = false;
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // YNetMon canlı ağ: 1.5 sn
  useEffect(() => {
    if (!configLoaded) return;
    if (!config.ynetmon_url || !config.ynetmon_key) {
      setNetwork(INITIAL_NET);
      setBandwidth([]);
      return;
    }
    let alive = true;
    let busy = false;
    setNetwork((p) => ({ ...p, status: "connecting" }));
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const d = await api.ynetmon(config);
        if (!alive) return;
        if (d && d.service === "YNetMon") {
          const rx = Number(d.rx_bps || 0);
          const tx = Number(d.tx_bps || 0);
          setBandwidth((p) => [...p, rx + tx].slice(-40));
          setNetwork({
            rx_bps: rx,
            tx_bps: tx,
            active_conns: Number(d.active_connections || 0),
            devices: Number(d.storage?.devices_count || 0),
            db_packets: Number(d.storage?.packets_count || 0),
            status: "live",
          });
        } else {
          setNetwork((p) => ({ ...p, status: "offline" }));
        }
      } catch {
        if (alive) setNetwork((p) => ({ ...p, status: "offline" }));
      } finally {
        busy = false;
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded, config.ynetmon_url, config.ynetmon_key]);

  const saveSettings = useCallback(async (next: AppSettings) => {
    await api.saveAppSettings(next);
    // ydev CLI ile paylaşılan yapılandırma dosyasını da güncel tut
    await api.saveConfig(deriveConfig(next.connections));
    setSettings(next);
  }, []);

  const addNote = useCallback(
    async (content: string) => {
      await api.createNote(configRef.current, content);
      await refreshHub();
    },
    [refreshHub],
  );

  const addKnowledge = useCallback(
    async (title: string, summary: string) => {
      await api.createKnowledge(configRef.current, "YDevDesk", title, summary);
      await refreshHub();
    },
    [refreshHub],
  );

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
      saveSettings,
      agent,
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
      refreshUsage,
    }),
    [config, settings, saveSettings, agent, network, bandwidth, notes, knowledge, hubStatus, hubError, refreshHub, addNote, addKnowledge, availableUpdate, dismissUpdate, usage, refreshUsage],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
