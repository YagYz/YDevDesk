import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bot, Sparkles, Wrench } from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";
import { useData } from "../context/DataContext";
import { api } from "../lib/tauri";
import { formatTokens } from "../lib/format";
import { Bar, Dot, PanelBody, Stat } from "../components/ui";
import type { AgentLiveView, AgentUsageTotals, DailyUsagePoint, UsageWindowSummary } from "../types";

/** Birden fazla ajan aynı anda çalışırken bilgileri bu aralıkla (ms) sırayla gösterilir. */
const ROTATE_MS = 4000;

type WindowKey = "d1" | "d7" | "d30";
type SourceKey = "all" | "agy" | "claude" | "codex";

const WINDOW_OPTIONS: { key: WindowKey; label: string }[] = [
  { key: "d1", label: "1g" },
  { key: "d7", label: "7g" },
  { key: "d30", label: "30g" },
];

const SOURCE_OPTIONS: { key: SourceKey; label: string }[] = [
  { key: "all", label: "Tümü" },
  { key: "agy", label: "AGY" },
  { key: "claude", label: "Claude" },
  { key: "codex", label: "Codex" },
];

const AGENT_META: Record<"agy" | "claude" | "codex", { label: string; color: string }> = {
  agy: { label: "AGY", color: "var(--accent)" },
  claude: { label: "Claude", color: "var(--ok)" },
  codex: { label: "Codex", color: "var(--warn)" },
};

function formatUsd(cost: number, estimated = false): string {
  const prefix = estimated ? "~" : "";
  const formatted = cost >= 10 ? cost.toFixed(2) : cost.toFixed(3);
  return `${prefix}$${formatted}`;
}

function getDailyBreakdown(point: DailyUsagePoint, source: SourceKey) {
  const agyTokens = source === "all" || source === "agy" ? point.agy_tokens : 0;
  const claudeTokens = source === "all" || source === "claude" ? point.claude_tokens : 0;
  const codexTokens = source === "all" || source === "codex" ? point.codex_tokens : 0;
  const agyCost = source === "all" || source === "agy" ? point.agy_cost : 0;
  const claudeCost = source === "all" || source === "claude" ? point.claude_cost : 0;
  const codexCost = source === "all" || source === "codex" ? point.codex_cost : 0;
  return {
    agyTokens,
    claudeTokens,
    codexTokens,
    totalTokens: agyTokens + claudeTokens + codexTokens,
    totalCost: agyCost + claudeCost + codexCost,
  };
}

function summarizeWindow(win: UsageWindowSummary, source: SourceKey) {
  if (source === "all") {
    const estimated = win.by_agent.some(
      (a) => a.estimated && (a.input_tokens > 0 || a.output_tokens > 0 || a.cost_usd > 0),
    );
    return {
      input: win.total_input_tokens,
      output: win.total_output_tokens,
      cost: win.total_cost_usd,
      estimated,
    };
  }
  const match = win.by_agent.find((a) => a.agent.toLowerCase() === source);
  return {
    input: match?.input_tokens ?? 0,
    output: match?.output_tokens ?? 0,
    cost: match?.cost_usd ?? 0,
    estimated: match?.estimated ?? false,
  };
}

function QuotaGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--txt-dim)]">{label}</div>
      {children}
    </div>
  );
}

function EnableRow({ text, button, busy, onClick }: { text: string; button: string; busy: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1.5">
      <span className="text-[11px] text-[var(--txt-muted)]">{text}</span>
      <button
        onClick={onClick}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)]/15 px-2 py-1 text-[11px] font-medium text-[var(--accent)] hover:bg-[var(--accent)]/25 disabled:opacity-50 transition-colors"
      >
        <Sparkles className="w-3 h-3" />
        {busy ? "Açılıyor..." : button}
      </button>
    </div>
  );
}

export default function AgentUsagePanel() {
  const { agent, usage, combinedUsage, remoteSnapshots, syncStatus, refreshUsage } = useData();
  const ws = useWorkspace();
  const [tab, setTab] = useState<"live" | "analytics">("live");
  const [windowKey, setWindowKey] = useState<WindowKey>("d7");
  const [sourceKey, setSourceKey] = useState<SourceKey>("all");
  const [scope, setScope] = useState<"all" | "local">("all");
  const [enablingHook, setEnablingHook] = useState<"agy" | "claude" | null>(null);

  const otherDeviceCount = useMemo(
    () => Object.values(remoteSnapshots).filter((s) => s.device_id !== syncStatus?.device_id).length,
    [remoteSnapshots, syncStatus?.device_id],
  );
  const effectiveUsage = scope === "all" && otherDeviceCount > 0 ? (combinedUsage ?? usage) : usage;

  // Aynı anda birden fazla ajan çalışıyorsa görünümleri sırayla döndür (üzerine gelince durur).
  const views = useMemo(() => [...(agent.agents ?? [])].sort((a, b) => a.agent.localeCompare(b.agent)), [agent.agents]);
  const [rotIdx, setRotIdx] = useState(0);
  const [rotPaused, setRotPaused] = useState(false);
  useEffect(() => {
    if (views.length < 2 || rotPaused) return;
    const id = setInterval(() => setRotIdx((i) => i + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, [views.length, rotPaused]);
  const current: AgentLiveView | null = views.length > 0 ? views[rotIdx % views.length] : null;
  const live = current ?? {
    agent: "",
    model: agent.model,
    state: agent.agent_state,
    used_percentage: agent.used_percentage,
    session_cost: agent.session_cost,
    total_input_tokens: agent.total_input_tokens,
    total_output_tokens: agent.total_output_tokens,
    tools_per_minute: agent.tools_per_minute,
    marquee_text: agent.marquee_text,
  };
  const working = current ? current.state === "working" : agent.agent_state === "working";
  const quotaTone = (p: number) => (p < 15 ? "warn" : "ok");
  const agyConfigured = usage?.agy_quota_configured ?? true;

  const claudeConfigured = usage?.claude_quota_configured ?? false;
  const claude5h = usage?.claude_quota_5h_remaining ?? null;
  const claudeWk = usage?.claude_quota_weekly_remaining ?? null;

  const handleEnableQuota = async (which: "agy" | "claude") => {
    if (enablingHook) return;
    setEnablingHook(which);
    try {
      await (which === "agy" ? api.enableAgyQuotaHook() : api.enableClaudeQuotaHook());
      await refreshUsage();
    } catch (e) {
      console.error(`${which} kota izleme açılamadı:`, e);
    } finally {
      setEnablingHook(null);
    }
  };

  const activeWindow = effectiveUsage?.windows[windowKey] ?? null;

  const summary = useMemo(
    () => (activeWindow ? summarizeWindow(activeWindow, sourceKey) : null),
    [activeWindow, sourceKey],
  );

  const dailyBars = useMemo(() => {
    if (!activeWindow) return [];
    const points = activeWindow.daily.map((pt) => ({
      date: pt.date,
      ...getDailyBreakdown(pt, sourceKey),
    }));
    const maxTokens = Math.max(...points.map((p) => p.totalTokens), 1);
    return points.map((p) => ({
      ...p,
      heightPct: p.totalTokens > 0 ? Math.max(8, Math.round((p.totalTokens / maxTokens) * 100)) : 0,
    }));
  }, [activeWindow, sourceKey]);

  const agentRows = useMemo(() => {
    const byId = new Map<string, AgentUsageTotals>();
    for (const item of activeWindow?.by_agent ?? []) {
      byId.set(item.agent.toLowerCase(), item);
    }
    return (["agy", "claude", "codex"] as const).map((id) => ({
      id,
      meta: AGENT_META[id],
      data: byId.get(id) ?? {
        agent: id,
        input_tokens: 0,
        output_tokens: 0,
        cache_tokens: 0,
        cost_usd: 0,
        estimated: false,
      },
    }));
  }, [activeWindow]);

  return (
    <PanelBody className="space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <Bot className="w-4 h-4 text-[var(--accent)]" />
        <span className="font-semibold truncate">{live.model}</span>
        {current && views.length > 1 && (
          <span className="flex items-center gap-1 shrink-0" title={`${views.length} ajan çalışıyor`}>
            <span className="rounded px-1 text-[10px] font-medium" style={{ color: AGENT_META[current.agent as "agy" | "claude" | "codex"]?.color ?? "var(--txt-muted)" }}>
              {AGENT_META[current.agent as "agy" | "claude" | "codex"]?.label ?? current.agent}
            </span>
            {views.map((v, i) => (
              <span
                key={v.agent}
                className="inline-block w-1 h-1 rounded-full"
                style={{ background: i === rotIdx % views.length ? "var(--accent)" : "var(--txt-dim)" }}
              />
            ))}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-[var(--txt-muted)]">
          <Dot tone={working ? "ok" : "idle"} />
          {working ? "çalışıyor" : "boşta"}
        </span>
        <button
          onClick={ws.openAgentSetup}
          title="Ajan ve CLI kurulum sihirbazını aç"
          className="p-1 rounded-md text-[var(--txt-dim)] hover:text-[var(--accent)] hover:bg-[var(--surface-raised)] transition-colors"
        >
          <Wrench className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-0.5 text-[11px] font-medium">
        <button
          type="button"
          onClick={() => setTab("live")}
          className={`py-1 rounded-md transition-colors cursor-pointer ${
            tab === "live"
              ? "bg-[var(--accent)]/20 text-[var(--accent)]"
              : "text-[var(--txt-dim)] hover:text-[var(--txt-main)]"
          }`}
        >
          Canlı
        </button>
        <button
          type="button"
          onClick={() => setTab("analytics")}
          className={`py-1 rounded-md transition-colors cursor-pointer ${
            tab === "analytics"
              ? "bg-[var(--accent)]/20 text-[var(--accent)]"
              : "text-[var(--txt-dim)] hover:text-[var(--txt-main)]"
          }`}
        >
          Analiz (1g/7g/30g)
        </button>
      </div>

      {tab === "live" && (
        <div onMouseEnter={() => setRotPaused(true)} onMouseLeave={() => setRotPaused(false)} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Girdi" value={formatTokens(live.total_input_tokens)} sub="token" />
            <Stat label="Çıktı" value={formatTokens(live.total_output_tokens)} sub="token" />
            <Stat label="Maliyet" value={`$${live.session_cost.toFixed(3)}`} accent />
            <Stat label="Araç/dk" value={live.tools_per_minute} />
          </div>
          {current && <div className="truncate text-[10px] text-[var(--txt-dim)]" title={live.marquee_text}>{live.marquee_text}</div>}

          <div className="space-y-2.5">
            <Bar label="Bağlam kullanımı" percent={live.used_percentage} tone={live.used_percentage > 85 ? "warn" : "accent"} />

            <QuotaGroup label="AGY">
              {agyConfigured ? (
                <>
                  <Bar label="5 saatlik kota (kalan)" percent={agent.quota_5h_percent} tone={quotaTone(agent.quota_5h_percent)} />
                  <Bar label="Haftalık kota (kalan)" percent={agent.quota_weekly_percent} tone={quotaTone(agent.quota_weekly_percent)} />
                </>
              ) : (
                <EnableRow text="AGY kota izleme kapalı" button="AGY Kota İzlemeyi Aç" busy={enablingHook === "agy"} onClick={() => handleEnableQuota("agy")} />
              )}
            </QuotaGroup>

            <QuotaGroup label="Claude">
              {claudeConfigured ? (
                claude5h != null || claudeWk != null ? (
                  <>
                    {claude5h != null && <Bar label="5 saatlik kota (kalan)" percent={claude5h} tone={quotaTone(claude5h)} />}
                    {claudeWk != null && <Bar label="Haftalık kota (kalan)" percent={claudeWk} tone={quotaTone(claudeWk)} />}
                  </>
                ) : (
                  <div className="text-[11px] text-[var(--txt-dim)] px-0.5">Kota Claude'daki bir sonraki yanıttan sonra görünür (abonelik gerekir).</div>
                )
              ) : (
                <EnableRow text="Claude kota izleme kapalı" button="Claude Kota İzlemeyi Aç" busy={enablingHook === "claude"} onClick={() => handleEnableQuota("claude")} />
              )}
            </QuotaGroup>

            <QuotaGroup label="Codex">
              {usage?.codex_quota_5h_remaining != null || usage?.codex_quota_weekly_remaining != null ? (
                <>
                  {usage?.codex_quota_5h_remaining != null && (
                    <Bar label="5 saatlik kota (kalan)" percent={usage.codex_quota_5h_remaining} tone={quotaTone(usage.codex_quota_5h_remaining)} />
                  )}
                  {usage?.codex_quota_weekly_remaining != null && (
                    <Bar label="Haftalık kota (kalan)" percent={usage.codex_quota_weekly_remaining} tone={quotaTone(usage.codex_quota_weekly_remaining)} />
                  )}
                </>
              ) : (
                <div className="text-[11px] text-[var(--txt-dim)] px-0.5">Codex oturumu bulunamadı; kota ilk oturumdan sonra görünür.</div>
              )}
            </QuotaGroup>
          </div>
        </div>
      )}

      {tab === "analytics" && (
        <div className="space-y-2.5">
        {otherDeviceCount > 0 && (
          <div className="flex items-center justify-between gap-2 text-[10px]">
            <span className="text-[var(--txt-dim)]">{otherDeviceCount + 1} cihaz bağlı</span>
            <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-0.5">
              <button
                type="button"
                onClick={() => setScope("all")}
                className={`px-2 py-0.5 rounded cursor-pointer ${
                  scope === "all" ? "bg-[var(--accent)]/20 text-[var(--accent)] font-medium" : "text-[var(--txt-dim)]"
                }`}
              >
                Tüm Cihazlar
              </button>
              <button
                type="button"
                onClick={() => setScope("local")}
                className={`px-2 py-0.5 rounded cursor-pointer ${
                  scope === "local" ? "bg-[var(--accent)]/20 text-[var(--accent)] font-medium" : "text-[var(--txt-dim)]"
                }`}
              >
                Bu Cihaz
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-0.5">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setWindowKey(opt.key)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  windowKey === opt.key
                    ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                    : "text-[var(--txt-dim)] hover:text-[var(--txt-main)]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-raised)] p-0.5">
            {SOURCE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setSourceKey(opt.key)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  sourceKey === opt.key
                    ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                    : "text-[var(--txt-dim)] hover:text-[var(--txt-main)]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {summary ? (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              <Stat label="Girdi" value={formatTokens(summary.input)} />
              <Stat label="Çıktı" value={formatTokens(summary.output)} />
              <Stat label="Maliyet" value={formatUsd(summary.cost, summary.estimated)} accent />
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-2">
              <div className="flex items-center justify-between text-[10px] text-[var(--txt-dim)] mb-1.5">
                <span>Günlük Token</span>
                <div className="flex items-center gap-2">
                  {(["agy", "claude", "codex"] as const).map((id) => (
                    <span key={id} className="inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: AGENT_META[id].color }} />
                      {AGENT_META[id].label}
                    </span>
                  ))}
                </div>
              </div>

              {dailyBars.length > 0 ? (
                <div className="h-14 flex items-end gap-1">
                  {dailyBars.map((bar) => {
                    const agyPct = bar.totalTokens > 0 ? (bar.agyTokens / bar.totalTokens) * 100 : 0;
                    const claudePct = bar.totalTokens > 0 ? (bar.claudeTokens / bar.totalTokens) * 100 : 0;
                    const codexPct = bar.totalTokens > 0 ? (bar.codexTokens / bar.totalTokens) * 100 : 0;
                    return (
                      <div
                        key={bar.date}
                        title={`${bar.date}: ${formatTokens(bar.totalTokens)} token • ${formatUsd(bar.totalCost)}`}
                        className="flex-1 h-full flex flex-col justify-end group"
                      >
                        {bar.totalTokens > 0 ? (
                          <div
                            className="w-full rounded-t-sm overflow-hidden flex flex-col-reverse opacity-85 group-hover:opacity-100 transition-opacity"
                            style={{ height: `${bar.heightPct}%` }}
                          >
                            {agyPct > 0 && (
                              <div style={{ height: `${agyPct}%`, background: AGENT_META.agy.color }} />
                            )}
                            {claudePct > 0 && (
                              <div style={{ height: `${claudePct}%`, background: AGENT_META.claude.color }} />
                            )}
                            {codexPct > 0 && (
                              <div style={{ height: `${codexPct}%`, background: AGENT_META.codex.color }} />
                            )}
                          </div>
                        ) : (
                          <div className="w-full h-[2px] rounded-full bg-[var(--border)]" />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="h-10 flex items-center justify-center text-[11px] text-[var(--txt-dim)]">
                  Kayıtlı kullanım yok
                </div>
              )}
            </div>

            <div className="space-y-1">
              {agentRows.map(({ id, meta, data }) => (
                <div
                  key={id}
                  className="flex items-center justify-between text-[11px] px-2 py-1 rounded-md border border-[var(--border)] bg-[var(--surface-raised)]/60"
                >
                  <span className="inline-flex items-center gap-1.5 font-medium text-[var(--txt-main)]">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
                    {meta.label}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--txt-muted)]">
                    {formatTokens(data.input_tokens)}↓ / {formatTokens(data.output_tokens)}↑
                  </span>
                  <span className="font-mono text-[11px] text-[var(--accent)]">
                    {formatUsd(data.cost_usd, data.estimated)}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="py-3 text-center text-[11px] text-[var(--txt-dim)]">Analitik yükleniyor...</div>
        )}
        </div>
      )}
    </PanelBody>
  );
}
