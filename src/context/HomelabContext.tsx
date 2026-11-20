import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/tauri";
import { useVisibilityPoll } from "../lib/useVisibilityPoll";
import { useSettings } from "./SettingsContext";
import type { HubStatus, Knowledge, NetworkData, Note } from "../types";

export const INITIAL_NET: NetworkData = {
  rx_bps: 0,
  tx_bps: 0,
  active_conns: 0,
  devices: 0,
  db_packets: 0,
  status: "unconfigured",
};

export type HomelabContextValue = {
  network: NetworkData;
  bandwidth: number[];
  notes: Note[];
  knowledge: Knowledge[];
  hubStatus: HubStatus;
  hubError: string;
  refreshHub: () => Promise<void>;
  addNote: (content: string) => Promise<void>;
  addKnowledge: (title: string, summary: string) => Promise<void>;
  /** NetworkPanel açıkken 1.5sn, kapalıyken 5sn polling kullanır. */
  setNetworkFastMode: (active: boolean) => void;
};

const HomelabContext = createContext<HomelabContextValue | null>(null);

export function useHomelab(): HomelabContextValue {
  const ctx = useContext(HomelabContext);
  if (!ctx) throw new Error("useHomelab yalnızca HomelabProvider içinde kullanılabilir");
  return ctx;
}

export function HomelabProvider({ children }: { children: ReactNode }) {
  const { config, configLoaded } = useSettings();
  const [network, setNetwork] = useState<NetworkData>(INITIAL_NET);
  const [bandwidth, setBandwidth] = useState<number[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [hubStatus, setHubStatus] = useState<HubStatus>("unconfigured");
  const [hubError, setHubError] = useState("");
  const [networkFastMode, setNetworkFastMode] = useState(false);

  const configRef = useRef(config);
  configRef.current = config;

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

  useVisibilityPoll(refreshHub, 60_000, configLoaded);

  const netConfigured = configLoaded && Boolean(config.ynetmon_url && config.ynetmon_key);
  useEffect(() => {
    if (!configLoaded) return;
    if (!netConfigured) {
      setNetwork(INITIAL_NET);
      setBandwidth([]);
    } else {
      setNetwork((p) => ({ ...p, status: "connecting" }));
    }
  }, [configLoaded, netConfigured]);

  useVisibilityPoll(
    async () => {
      try {
        const d = await api.ynetmon(configRef.current);
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
        setNetwork((p) => ({ ...p, status: "offline" }));
      }
    },
    networkFastMode ? 1500 : 5000,
    netConfigured,
  );

  const addNote = useCallback(
    async (content: string) => {
      await api.createNote(configRef.current, content);
      await refreshHub();
    },
    [refreshHub],
  );

  const addKnowledge = useCallback(
    async (title: string, summary: string) => {
      await api.createKnowledge(configRef.current, "ydevdesk", title, summary);
      await refreshHub();
    },
    [refreshHub],
  );

  const value = useMemo<HomelabContextValue>(
    () => ({
      network,
      bandwidth,
      notes,
      knowledge,
      hubStatus,
      hubError,
      refreshHub,
      addNote,
      addKnowledge,
      setNetworkFastMode,
    }),
    [network, bandwidth, notes, knowledge, hubStatus, hubError, refreshHub, addNote, addKnowledge],
  );

  return <HomelabContext.Provider value={value}>{children}</HomelabContext.Provider>;
}
