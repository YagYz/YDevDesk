import type { AppSettings, CommandItem, Connection, ConnectionType, HomelabConfig, NotificationSettings, TerminalPreset } from "../types";

export type ConnectionField = { key: "url" | "key" | "path"; label: string; secret?: boolean; placeholder?: string };

/** Bağlantı tipleri. Yeni bir tip eklemek için buraya bir kayıt eklemek yeterli. */
export const CONNECTION_TYPES: Record<ConnectionType, { label: string; hint: string; fields: ConnectionField[] }> = {
  ydevhub: {
    label: "YDevHub",
    hint: "Görev, not ve bilgi ağı sunucusu",
    fields: [
      { key: "url", label: "URL", placeholder: "http://host:3080" },
      { key: "key", label: "API anahtarı", secret: true },
    ],
  },
  ynetmon: {
    label: "YNetMon",
    hint: "Ağ izleme servisi",
    fields: [
      { key: "url", label: "URL", placeholder: "http://host:8765" },
      { key: "key", label: "API anahtarı", secret: true },
    ],
  },
  "projects-root": {
    label: "Proje dizini",
    hint: "Git depolarının bulunduğu klasör",
    fields: [{ key: "path", label: "Dizin", placeholder: "~/Projects" }],
  },
};

export const DEFAULT_QUICK_ACTIONS: CommandItem[] = [
  { id: "git-status", title: "git status", cmd: "git status -s" },
  { id: "git-diff", title: "git diff --stat", cmd: "git diff --stat" },
];

export const DEFAULT_TERMINAL_PRESETS: TerminalPreset[] = [
  { id: "shell", title: "Terminal", description: "Yerel kabuk oturumu", kind: "shell" },
  { id: "claude", title: "Claude Code", description: "Anthropic Claude CLI ajanı", initCmd: "claude", kind: "agent" },
  { id: "claude-danger", title: "Claude (Bypass)", description: "Onaysız tam yetkili mod", initCmd: "claude --dangerously-skip-permissions", kind: "agent" },
  { id: "agy", title: "Antigravity (AGY)", description: "Google Antigravity CLI", initCmd: "agy", kind: "agent" },
  { id: "codex", title: "OpenAI Codex", description: "OpenAI Codex CLI ajanı", initCmd: "codex", kind: "agent" },
  { id: "codex-full", title: "Codex (Full Access)", description: "Bypass & tam yetkili mod", initCmd: "codex --full-access", kind: "agent" },
];

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  enabled: true,
  agent_done: true,
  quota_low: true,
  service_down: true,
  quota_threshold: 20,
};

export const newId = () => Math.random().toString(36).slice(2, 10);

export function deriveConfig(connections: Connection[]): HomelabConfig {
  const hub = connections.find((c) => c.type === "ydevhub");
  const mon = connections.find((c) => c.type === "ynetmon");
  return {
    ydevhub_url: hub?.url ?? "",
    ydevhub_key: hub?.key ?? "",
    ynetmon_url: mon?.url ?? "",
    ynetmon_key: mon?.key ?? "",
  };
}

export function hasConnection(settings: AppSettings, type?: ConnectionType): boolean {
  if (!type) return true;
  return settings.connections.some((c) => {
    if (c.type !== type) return false;
    return type === "projects-root" ? !!c.path : !!c.url;
  });
}

/** Kayıtlı ayarları (veya ilk kurulumda mevcut CLI yapılandırmasını) eksiksiz bir AppSettings'e çevirir. */
export function normalizeSettings(saved: any, cfg: HomelabConfig, projectsRoot: string): AppSettings {
  if (saved && Array.isArray(saved.connections)) {
    return {
      connections: saved.connections,
      disabled_modules: Array.isArray(saved.disabled_modules) ? saved.disabled_modules : [],
      quick_actions: Array.isArray(saved.quick_actions) ? saved.quick_actions : DEFAULT_QUICK_ACTIONS,
      terminal_presets: Array.isArray(saved.terminal_presets) ? saved.terminal_presets : DEFAULT_TERMINAL_PRESETS,
      notifications: { ...DEFAULT_NOTIFICATIONS, ...(saved.notifications ?? {}) },
    };
  }
  const connections: Connection[] = [];
  if (cfg.ydevhub_url) connections.push({ id: newId(), name: "YDevHub", type: "ydevhub", url: cfg.ydevhub_url, key: cfg.ydevhub_key });
  if (cfg.ynetmon_url) connections.push({ id: newId(), name: "YNetMon", type: "ynetmon", url: cfg.ynetmon_url, key: cfg.ynetmon_key });
  if (projectsRoot) connections.push({ id: newId(), name: "Projeler", type: "projects-root", path: projectsRoot });
  return { connections, disabled_modules: [], quick_actions: DEFAULT_QUICK_ACTIONS, terminal_presets: DEFAULT_TERMINAL_PRESETS, notifications: DEFAULT_NOTIFICATIONS };
}
