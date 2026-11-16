export type HomelabConfig = {
  ydevhub_url: string;
  ydevhub_key: string;
  ynetmon_url: string;
  ynetmon_key: string;
};

export type Note = {
  id: number;
  content: string;
  is_done: boolean;
  priority: string;
  date: string;
};

export type Task = {
  id: number;
  title: string;
  description?: string;
  status: string;
  priority: string;
  due_date?: string | null;
};

export type Knowledge = {
  id: number;
  service_tag: string;
  title: string;
  summary: string;
  linked_topics: string[];
};

export type AgentKind = "agy" | "claude" | "codex";

export type ActiveAgentSession = {
  session_id: string;
  full_session_id: string;
  agent: AgentKind | string;
  title: string;
  cwd?: string | null;
  is_active: boolean;
  model: string;
  last_tool: string;
  updated_ago_secs: number;
  subagent_count?: number;
};

export type SessionPrefs = {
  pinned: Record<string, boolean>;
  aliases: Record<string, string>;
};

export type SubagentInfo = {
  name: string;
  role: string;
  status: string;
};

export type FileHeatItem = {
  name: string;
  count: number;
};

export type RecentToolCall = {
  name: string;
  timestamp: string;
  detail: string;
};

export type AgentStatus = {
  model: string;
  used_percentage: number;
  session_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
  mode: string;
  agent_state: string;
  active_sessions_count: number;
  quota_5h_percent: number;
  quota_weekly_percent: number;
  tools_per_minute: number;
  marquee_text: string;
  ticker_squares: string[];
  file_heat: FileHeatItem[];
  sessions: ActiveAgentSession[];
  subagents: SubagentInfo[];
  recent_tools: RecentToolCall[];
};

export type NetworkData = {
  rx_bps: number;
  tx_bps: number;
  active_conns: number;
  devices: number;
  db_packets: number;
  status: "unconfigured" | "connecting" | "live" | "offline";
};

export type HubStatus = "unconfigured" | "loading" | "ok" | "error";

export type TerminalParams = {
  initCmd?: string;
  kind?: "shell" | "agent" | "server";
};

export type ConnectionType = "ydevhub" | "ynetmon" | "projects-root";

export type Connection = {
  id: string;
  name: string;
  type: ConnectionType;
  url?: string;
  key?: string;
  path?: string;
};

export type CommandItem = { id: string; title: string; cmd: string };

export type TerminalPreset = {
  id: string;
  title: string;
  description: string;
  initCmd?: string;
  kind: "shell" | "agent" | "server";
};

export type NotificationSettings = {
  enabled: boolean;
  sound_enabled: boolean;
  sound_preset?: "notify" | "notify2";
  agent_done: boolean;
  quota_low: boolean;
  service_down: boolean;
  app_update: boolean;
  quota_threshold: number;
};

export type AppSettings = {
  notifications: NotificationSettings;
  connections: Connection[];
  disabled_modules: string[];
  quick_actions: CommandItem[];
  terminal_presets: TerminalPreset[];
};

export type UpdateCheckResult = {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_name: string;
  release_notes: string;
  html_url: string;
  asset_name: string;
  asset_url: string;
};

export type AgentCliInfo = {
  id: string;
  name: string;
  binary: string;
  npm_package?: string | null;
  is_installed: boolean;
  version?: string | null;
  path?: string | null;
  description: string;
  install_cmd: string;
  bypass_cmd?: string | null;
};

export type AgentEnvironmentStatus = {
  node_installed: boolean;
  node_version?: string | null;
  npm_installed: boolean;
  npm_version?: string | null;
  agents: AgentCliInfo[];
};

export type AgentInstallResult = {
  success: boolean;
  agent_id: string;
  message: string;
  output: string;
};

export type AgentUsageTotals = {
  agent: string;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  cost_usd: number;
  estimated: boolean;
};

export type DailyUsagePoint = {
  date: string;
  agy_tokens: number;
  claude_tokens: number;
  codex_tokens: number;
  agy_cost: number;
  claude_cost: number;
  codex_cost: number;
};

export type UsageWindowSummary = {
  days: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_tokens: number;
  total_cost_usd: number;
  by_agent: AgentUsageTotals[];
  daily: DailyUsagePoint[];
};

export type UsageAnalytics = {
  windows: {
    d1: UsageWindowSummary;
    d7: UsageWindowSummary;
    d30: UsageWindowSummary;
  };
  agy_quota_configured: boolean;
  codex_quota_5h_remaining: number | null;
  codex_quota_weekly_remaining: number | null;
};

export type SyncStatusInfo = {
  connected: boolean;
  login: string;
  gist_id?: string | null;
  device_id: string;
  device_name: string;
  has_sync_key: boolean;
};

export type DeviceFlowStart = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

export type DeviceFlowPollResult = {
  status: "pending" | "slow_down" | "authorized";
  interval?: number | null;
  login?: string | null;
};

export type SyncPullResult = {
  changed: boolean;
  payload_json?: string | null;
  gist_id?: string | null;
};

export type SyncPushResult = {
  gist_id: string;
};

export type RemoteSessionSummary = {
  session_id: string;
  masked_id: string;
  agent: string;
  title: string;
  model: string;
  updated_at: number;
  device_id: string;
  device_name: string;
};

export type DeviceTelemetrySnapshot = {
  device_id: string;
  device_name: string;
  updated_at: number;
  usage: UsageAnalytics;
  recent_sessions: RemoteSessionSummary[];
};

export type SyncPreferences = {
  sync_layout: boolean;
};
