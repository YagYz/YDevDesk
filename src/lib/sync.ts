import type {
  ActiveAgentSession,
  AgentUsageTotals,
  AppSettings,
  CommandItem,
  DailyUsagePoint,
  DeviceTelemetrySnapshot,
  NotificationSettings,
  RemoteSessionSummary,
  SessionPrefs,
  SyncPreferences,
  TerminalPreset,
  UsageAnalytics,
  UsageWindowSummary,
} from "../types";
import type { SavedWorkspace } from "./workspaces";

export type SyncSection<T> = {
  updatedAt: number;
  deviceId: string;
  data: T;
};

export type SyncPayload = {
  version: 1;
  quick_actions?: SyncSection<CommandItem[]>;
  terminal_presets?: SyncSection<TerminalPreset[]>;
  disabled_modules?: SyncSection<string[]>;
  notifications?: SyncSection<NotificationSettings>;
  workspaces?: SyncSection<SavedWorkspace[]>;
  session_prefs?: SyncSection<SessionPrefs>;
  layout?: SyncSection<unknown>;
  device_snapshots?: Record<string, DeviceTelemetrySnapshot>;
};

const SYNC_PREFS_KEY = "ydevdesk_sync_prefs_v1";
const LOCAL_PAYLOAD_KEY = "ydevdesk_sync_local_meta_v1";

export function loadSyncPreferences(): SyncPreferences {
  try {
    const raw = localStorage.getItem(SYNC_PREFS_KEY);
    if (!raw) return { sync_layout: false };
    const parsed = JSON.parse(raw);
    return { sync_layout: Boolean(parsed?.sync_layout) };
  } catch {
    return { sync_layout: false };
  }
}

export function saveSyncPreferences(prefs: SyncPreferences): void {
  try {
    localStorage.setItem(SYNC_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
}

export function loadLocalSyncPayload(): SyncPayload {
  try {
    const raw = localStorage.getItem(LOCAL_PAYLOAD_KEY);
    if (!raw) return { version: 1 };
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1) return parsed as SyncPayload;
    return { version: 1 };
  } catch {
    return { version: 1 };
  }
}

export function saveLocalSyncPayload(payload: SyncPayload): void {
  try {
    localStorage.setItem(LOCAL_PAYLOAD_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

export function maskSessionId(id: string): string {
  const s = (id || "").trim();
  if (s.length <= 8) return s ? `${s.slice(0, 2)}***` : "***";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export function buildDeviceSnapshot(
  deviceId: string,
  deviceName: string,
  usage: UsageAnalytics,
  sessions: ActiveAgentSession[],
): DeviceTelemetrySnapshot {
  const now = Date.now();
  const recent_sessions: RemoteSessionSummary[] = sessions.slice(0, 20).map((s) => ({
    session_id: s.session_id,
    masked_id: maskSessionId(s.full_session_id || s.session_id),
    agent: s.agent,
    title: s.title,
    model: s.model,
    updated_at: now - (s.updated_ago_secs || 0) * 1000,
    device_id: deviceId,
    device_name: deviceName,
  }));

  return {
    device_id: deviceId,
    device_name: deviceName,
    updated_at: now,
    usage,
    recent_sessions,
  };
}

function pickNewer<T>(a?: SyncSection<T>, b?: SyncSection<T>): SyncSection<T> | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.updatedAt > a.updatedAt ? b : a;
}

export function mergeSyncPayloads(local: SyncPayload, remote: SyncPayload): SyncPayload {
  const mergedSnapshots: Record<string, DeviceTelemetrySnapshot> = {
    ...(local.device_snapshots ?? {}),
  };
  for (const [devId, snap] of Object.entries(remote.device_snapshots ?? {})) {
    const existing = mergedSnapshots[devId];
    if (!existing || snap.updated_at > existing.updated_at) {
      mergedSnapshots[devId] = snap;
    }
  }

  return {
    version: 1,
    quick_actions: pickNewer(local.quick_actions, remote.quick_actions),
    terminal_presets: pickNewer(local.terminal_presets, remote.terminal_presets),
    disabled_modules: pickNewer(local.disabled_modules, remote.disabled_modules),
    notifications: pickNewer(local.notifications, remote.notifications),
    workspaces: pickNewer(local.workspaces, remote.workspaces),
    session_prefs: pickNewer(local.session_prefs, remote.session_prefs),
    layout: pickNewer(local.layout, remote.layout),
    device_snapshots: mergedSnapshots,
  };
}

export function applySyncedSettings(current: AppSettings, payload: SyncPayload): AppSettings {
  return {
    connections: current.connections, // Cihaza özel proje yolları ve API anahtarları korunur
    quick_actions: payload.quick_actions?.data ?? current.quick_actions,
    terminal_presets: payload.terminal_presets?.data ?? current.terminal_presets,
    disabled_modules: payload.disabled_modules?.data ?? current.disabled_modules,
    notifications: payload.notifications?.data ?? current.notifications,
  };
}

function mergeUsageWindow(windows: UsageWindowSummary[]): UsageWindowSummary {
  const base = windows[0];
  const byAgentMap = new Map<string, AgentUsageTotals>();
  const dailyMap = new Map<string, DailyUsagePoint>();

  let total_input_tokens = 0;
  let total_output_tokens = 0;
  let total_cache_tokens = 0;
  let total_cost_usd = 0;

  for (const w of windows) {
    total_input_tokens += w.total_input_tokens;
    total_output_tokens += w.total_output_tokens;
    total_cache_tokens += w.total_cache_tokens;
    total_cost_usd += w.total_cost_usd;

    for (const a of w.by_agent) {
      const cur = byAgentMap.get(a.agent) ?? {
        agent: a.agent,
        input_tokens: 0,
        output_tokens: 0,
        cache_tokens: 0,
        cost_usd: 0,
        estimated: a.estimated,
      };
      cur.input_tokens += a.input_tokens;
      cur.output_tokens += a.output_tokens;
      cur.cache_tokens += a.cache_tokens;
      cur.cost_usd += a.cost_usd;
      cur.estimated = cur.estimated || a.estimated;
      byAgentMap.set(a.agent, cur);
    }

    for (const d of w.daily) {
      const cur = dailyMap.get(d.date) ?? {
        date: d.date,
        agy_tokens: 0,
        claude_tokens: 0,
        codex_tokens: 0,
        agy_cost: 0,
        claude_cost: 0,
        codex_cost: 0,
      };
      cur.agy_tokens += d.agy_tokens;
      cur.claude_tokens += d.claude_tokens;
      cur.codex_tokens += d.codex_tokens;
      cur.agy_cost += d.agy_cost;
      cur.claude_cost += d.claude_cost;
      cur.codex_cost += d.codex_cost;
      dailyMap.set(d.date, cur);
    }
  }

  return {
    days: base.days,
    total_input_tokens,
    total_output_tokens,
    total_cache_tokens,
    total_cost_usd,
    by_agent: Array.from(byAgentMap.values()),
    daily: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function aggregateUsageAnalytics(
  localUsage: UsageAnalytics,
  snapshots: Record<string, DeviceTelemetrySnapshot> | undefined,
  currentDeviceId: string,
): UsageAnalytics {
  if (!snapshots) return localUsage;
  const others = Object.values(snapshots).filter((s) => s.device_id !== currentDeviceId && s.usage);
  if (others.length === 0) return localUsage;

  const all = [localUsage, ...others.map((o) => o.usage)];
  return {
    windows: {
      d1: mergeUsageWindow(all.map((u) => u.windows.d1)),
      d7: mergeUsageWindow(all.map((u) => u.windows.d7)),
      d30: mergeUsageWindow(all.map((u) => u.windows.d30)),
    },
    agy_quota_configured: localUsage.agy_quota_configured,
    codex_quota_5h_remaining: localUsage.codex_quota_5h_remaining,
    codex_quota_weekly_remaining: localUsage.codex_quota_weekly_remaining,
  };
}
