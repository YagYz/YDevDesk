import { invoke } from "@tauri-apps/api/core";
import type {
  AgentApplyResult,
  AgentEnvironmentStatus,
  AgentInstallResult,
  AgentMarkdownFile,
  AgentPreview,
  AgentSetupStatus,
  AgentStatus,
  DeviceFlowPollResult,
  DeviceFlowStart,
  HomelabConfig,
  KnowledgeEntry,
  KnowledgeSettings,
  KnowledgeStatus,
  InstalledPlugin,
  SessionPrefs,
  SyncPullResult,
  SyncPushResult,
  SyncStatusInfo,
  ThemeManifest,
  UpdateCheckResult,
  UsageAnalytics,
} from "../types";

export const api = {
  loadConfig: () => invoke<HomelabConfig>("load_homelab_config"),
  saveConfig: (cfg: HomelabConfig) => invoke<void>("save_homelab_config", { cfg }),
  agentStatus: () => invoke<AgentStatus>("get_agent_status"),
  listAgentMarkdowns: (projectRoots?: string[]) =>
    invoke<AgentMarkdownFile[]>("list_agent_markdowns", { projectRoots: projectRoots ?? [] }),
  readMarkdownFile: (path: string, projectRoots?: string[]) =>
    invoke<string>("read_markdown_file", { path, projectRoots: projectRoots ?? [] }),
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
  knowledgeGetSettings: () => invoke<KnowledgeSettings>("knowledge_get_settings"),
  knowledgeSaveSettings: (settings: KnowledgeSettings) => invoke<void>("knowledge_save_settings", { settings }),
  knowledgeList: (service?: string, search?: string, tag?: string, limit?: number) =>
    invoke<KnowledgeEntry[]>("knowledge_list", { service, search, tag, limit }),
  knowledgeTags: () => invoke<[string, number][]>("knowledge_tags"),
  knowledgeStatus: () => invoke<KnowledgeStatus>("knowledge_status"),
  knowledgeAdd: (service: string, title: string, summary: string) =>
    invoke<unknown>("knowledge_add", { service, title, summary }),
  agentSetupStatus: () => invoke<AgentSetupStatus[]>("agent_setup_status"),
  agentSetupPreview: (agents: string[]) => invoke<AgentPreview[]>("agent_setup_preview", { agents }),
  agentSetupApply: (agents: string[]) => invoke<AgentApplyResult[]>("agent_setup_apply", { agents }),
  agentSetupRemove: (agents: string[]) => invoke<AgentApplyResult[]>("agent_setup_remove", { agents }),
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
  enableClaudeQuotaHook: () => invoke<string>("enable_claude_quota_hook"),
  syncStartAuth: () => invoke<DeviceFlowStart>("github_device_flow_start"),
  syncPollAuth: (deviceCode: string) => invoke<DeviceFlowPollResult>("github_device_flow_poll", { deviceCode }),
  syncStatus: () => invoke<SyncStatusInfo>("github_sync_status"),
  syncGetKey: () => invoke<string | null>("github_get_sync_key"),
  syncSetKey: (key: string) => invoke<void>("github_set_sync_key", { key }),
  syncDisconnect: () => invoke<void>("github_sync_disconnect"),
  syncPull: () => invoke<SyncPullResult>("github_sync_pull"),
  syncPush: (payloadJson: string) => invoke<SyncPushResult>("github_sync_push", { payloadJson }),
  deleteAgentSession: (agent: string, sessionId: string) =>
    invoke<string>("delete_agent_session", { agent, sessionId }),
  listInstalledPlugins: () => invoke<InstalledPlugin[]>("list_installed_plugins"),
  readPluginEntry: (pluginId: string) => invoke<string>("read_plugin_entry", { pluginId }),
  removePlugin: (pluginId: string) => invoke<void>("remove_plugin", { pluginId }),
  createSamplePlugin: () => invoke<InstalledPlugin>("create_sample_plugin"),
  openPluginsDir: () => invoke<string>("open_plugins_dir"),
  listThemes: () => invoke<ThemeManifest[]>("list_themes"),
  removeTheme: (themeId: string) => invoke<void>("remove_theme", { themeId }),
  createSampleTheme: () => invoke<ThemeManifest>("create_sample_theme"),
  openThemesDir: () => invoke<string>("open_themes_dir"),
};
