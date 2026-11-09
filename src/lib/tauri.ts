import { invoke } from "@tauri-apps/api/core";
import type { AgentStatus, HomelabConfig } from "../types";

export const api = {
  loadConfig: () => invoke<HomelabConfig>("load_homelab_config"),
  saveConfig: (cfg: HomelabConfig) => invoke<void>("save_homelab_config", { cfg }),
  agentStatus: () => invoke<AgentStatus>("get_agent_status"),
  notes: (cfg: HomelabConfig) =>
    invoke<any>("fetch_homelab_notes", { url: cfg.ydevhub_url, key: cfg.ydevhub_key }),
  knowledge: (cfg: HomelabConfig) =>
    invoke<any>("fetch_homelab_knowledge", { url: cfg.ydevhub_url, key: cfg.ydevhub_key }),
  ynetmon: (cfg: HomelabConfig) =>
    invoke<any>("fetch_ynetmon_summary", { url: cfg.ynetmon_url, key: cfg.ynetmon_key }),
  createNote: (cfg: HomelabConfig, content: string) =>
    invoke<any>("create_homelab_note", { url: cfg.ydevhub_url, key: cfg.ydevhub_key, content }),
  createKnowledge: (cfg: HomelabConfig, serviceTag: string, title: string, summary: string) =>
    invoke<any>("create_homelab_knowledge", {
      url: cfg.ydevhub_url,
      key: cfg.ydevhub_key,
      serviceTag,
      title,
      summary,
    }),
  tasks: (cfg: HomelabConfig) =>
    invoke<any>("fetch_homelab_tasks", { url: cfg.ydevhub_url, key: cfg.ydevhub_key }),
  createTask: (cfg: HomelabConfig, title: string, priority: string) =>
    invoke<any>("create_homelab_task", { url: cfg.ydevhub_url, key: cfg.ydevhub_key, title, priority }),
  completeTask: (cfg: HomelabConfig, id: number) =>
    invoke<any>("complete_homelab_task", { url: cfg.ydevhub_url, key: cfg.ydevhub_key, id }),
  windowClose: () => invoke<void>("app_window_close"),
  windowMinimize: () => invoke<void>("app_window_minimize"),
  windowToggleMaximize: () => invoke<void>("app_window_toggle_maximize"),
};
