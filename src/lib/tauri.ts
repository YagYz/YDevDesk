import { invoke } from "@tauri-apps/api/core";
import type {
  AgentEnvironmentStatus,
  AgentInstallResult,
  AgentMarkdownFile,
  AgentStatus,
  DeviceFlowPollResult,
  DeviceFlowStart,
  HomelabConfig,
  SessionPrefs,
  SyncPullResult,
  SyncPushResult,
  SyncStatusInfo,
  UpdateCheckResult,
  UsageAnalytics,
} from "../types";

export const api = {
  loadConfig: () => invoke<HomelabConfig>("load_homelab_config"),
  saveConfig: (cfg: HomelabConfig) => invoke<void>("save_homelab_config", { cfg }),
  agentStatus: () => invoke<AgentStatus>("get_agent_status"),
  listAgentMarkdowns: () => invoke<AgentMarkdownFile[]>("list_agent_markdowns"),
  readMarkdownFile: (path: string) => invoke<string>("read_markdown_file", { path }),
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
  gitProjects: (root: string) => invoke<string[]>("list_git_projects", { root }),
  gitStatus: (root: string, project: string) => invoke<any>("get_git_status", { root, project }),
  loadAppSettings: () => invoke<any | null>("load_app_settings"),
  saveAppSettings: (settings: unknown) => invoke<void>("save_app_settings", { settings }),
  loadSessionPrefs: () => invoke<SessionPrefs>("load_session_prefs"),
  saveSessionPrefs: (prefs: SessionPrefs) => invoke<void>("save_session_prefs", { prefs }),
  defaultProjectsRoot: () => invoke<string>("default_projects_root"),
  appVersion: () => invoke<string>("get_app_version"),
  checkUpdate: () => invoke<UpdateCheckResult>("check_app_update"),
  installUpdate: (assetUrl: string) => invoke<string>("install_app_update", { assetUrl }),
  checkAgentEnvironment: () => invoke<AgentEnvironmentStatus>("check_agent_environment"),
  installAgentCli: (agentId: string, forceUpdate = false) =>
    invoke<AgentInstallResult>("install_agent_cli", { agentId, forceUpdate }),
  windowClose: () => invoke<void>("app_window_close"),
  windowMinimize: () => invoke<void>("app_window_minimize"),
  windowToggleMaximize: () => invoke<void>("app_window_toggle_maximize"),
  usageAnalytics: () => invoke<UsageAnalytics>("get_usage_analytics"),
  enableAgyQuotaHook: () => invoke<string>("enable_agy_quota_hook"),
  syncStartAuth: () => invoke<DeviceFlowStart>("github_device_flow_start"),
  syncPollAuth: (deviceCode: string) => invoke<DeviceFlowPollResult>("github_device_flow_poll", { deviceCode }),
  syncStatus: () => invoke<SyncStatusInfo>("github_sync_status"),
  syncGetKey: () => invoke<string | null>("github_get_sync_key"),
  syncSetKey: (key: string) => invoke<void>("github_set_sync_key", { key }),
  syncDisconnect: () => invoke<void>("github_sync_disconnect"),
  syncPull: () => invoke<SyncPullResult>("github_sync_pull"),
  syncPush: (payloadJson: string) => invoke<SyncPushResult>("github_sync_push", { payloadJson }),
};
