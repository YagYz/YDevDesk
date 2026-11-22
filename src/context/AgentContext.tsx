import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/tauri";
import { useVisibilityPoll } from "../lib/useVisibilityPoll";
import { useSettings } from "./SettingsContext";
import type { AgentMarkdownFile, AgentStatus, UsageAnalytics } from "../types";

export const INITIAL_AGENT: AgentStatus = {
  model: "—",
  used_percentage: 0,
  session_cost: 0,
  total_input_tokens: 0,
  total_output_tokens: 0,
  mode: "NORMAL",
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

export type AgentContextValue = {
  agent: AgentStatus;
  usage: UsageAnalytics | null;
  markdowns: AgentMarkdownFile[];
  refreshUsage: () => Promise<void>;
  refreshMarkdowns: () => Promise<void>;
};

const AgentContext = createContext<AgentContextValue | null>(null);

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgent yalnızca AgentProvider içinde kullanılabilir");
  return ctx;
}

export function AgentProvider({ children }: { children: ReactNode }) {
  const { projectRoots, configLoaded } = useSettings();
  const [agent, setAgent] = useState<AgentStatus>(INITIAL_AGENT);
  const [usage, setUsage] = useState<UsageAnalytics | null>(null);
  const [markdowns, setMarkdowns] = useState<AgentMarkdownFile[]>([]);

  useVisibilityPoll(
    async () => {
      try {
        const s = await api.agentStatus();
        setAgent(s);
      } catch (e) {
        console.error("Ajan durumu alınamadı:", e);
      }
    },
    2000,
    true,
  );

  const refreshMarkdowns = useCallback(async () => {
    try {
      const files = await api.listAgentMarkdowns(projectRoots);
      setMarkdowns(files);
    } catch {
      /* sessiz */
    }
  }, [projectRoots]);

  useVisibilityPoll(refreshMarkdowns, 4000, configLoaded);

  const refreshUsage = useCallback(async () => {
    try {
      const data = await api.usageAnalytics();
      setUsage(data);
    } catch (e) {
      console.error("Kullanım analitiği alınamadı:", e);
    }
  }, []);

  useVisibilityPoll(refreshUsage, 30_000, true);

  const value = useMemo<AgentContextValue>(
    () => ({ agent, usage, markdowns, refreshUsage, refreshMarkdowns }),
    [agent, usage, markdowns, refreshUsage, refreshMarkdowns],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}
