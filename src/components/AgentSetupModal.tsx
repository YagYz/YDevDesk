import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Bot, CheckCircle2, ChevronDown, ChevronRight, Cpu, Download, Loader2, RefreshCw, Sparkles, SquareTerminal } from "lucide-react";
import { api } from "../lib/tauri";
import { useWorkspace } from "../context/WorkspaceContext";
import { Modal } from "./Modal";
import type { AgentCliInfo, AgentEnvironmentStatus } from "../types";

const LAUNCH_PREF_KEY = "ydevdesk_hide_agent_setup_on_launch";

export function AgentSetupContent({ onClose }: { onClose?: () => void }) {
  const ws = useWorkspace();
  const [env, setEnv] = useState<AgentEnvironmentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  const [installLogs, setInstallLogs] = useState<Record<string, string>>({});
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});
  const [dontShowAgain, setDontShowAgain] = useState(
    () => localStorage.getItem(LAUNCH_PREF_KEY) === "true",
  );
  const [globalMsg, setGlobalMsg] = useState("");
  const [globalErr, setGlobalErr] = useState("");

  const loadEnv = useCallback(async () => {
    setLoading(true);
    setGlobalErr("");
    try {
      const data = await api.checkAgentEnvironment();
      setEnv(data);
    } catch (err) {
      setGlobalErr(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEnv();
  }, [loadEnv]);

  const toggleDontShow = (val: boolean) => {
    setDontShowAgain(val);
    localStorage.setItem(LAUNCH_PREF_KEY, String(val));
  };

  const handleInstall = async (agentId: string) => {
    setBusyAgent(agentId);
    setGlobalMsg("");
    setGlobalErr("");
    try {
      const res = await api.installAgentCli(agentId);
      setInstallLogs((prev) => ({ ...prev, [agentId]: res.output }));
      setGlobalMsg(res.message);
      await loadEnv();
    } catch (err) {
      const msg = String(err);
      setGlobalErr(msg);
      setInstallLogs((prev) => ({ ...prev, [agentId]: msg }));
      setExpandedLogs((prev) => ({ ...prev, [agentId]: true }));
    } finally {
      setBusyAgent(null);
    }
  };

  const handleInstallAll = async () => {
    if (!env) return;
    const missing = env.agents.filter((a) => !a.is_installed);
    if (missing.length === 0) return;

    for (const a of missing) {
      setBusyAgent(a.id);
      try {
        const res = await api.installAgentCli(a.id);
        setInstallLogs((prev) => ({ ...prev, [a.id]: res.output }));
      } catch (err) {
        setInstallLogs((prev) => ({ ...prev, [a.id]: String(err) }));
        setExpandedLogs((prev) => ({ ...prev, [a.id]: true }));
      }
    }
    setBusyAgent(null);
    await loadEnv();
  };

  const handleOpenTerminal = (agent: AgentCliInfo) => {
    ws.openTerminal({
      title: `${agent.name} Kurulum`,
      initCmd: agent.install_cmd,
      kind: "shell",
    });
    if (onClose) onClose();
  };

  const getAgentTheme = (id: string) => {
    switch (id) {
      case "agy":
        return {
          icon: Sparkles,
          color: "text-[#00d2ff]",
          bg: "bg-[#00d2ff]/10 border-[#00d2ff]/30",
          tag: "Google",
        };
      case "claude":
        return {
          icon: Bot,
          color: "text-[#d97706]",
          bg: "bg-[#d97706]/10 border-[#d97706]/30",
          tag: "Anthropic",
        };
      case "codex":
        return {
          icon: Cpu,
          color: "text-[#10b981]",
          bg: "bg-[#10b981]/10 border-[#10b981]/30",
          tag: "OpenAI",
        };
      default:
        return {
          icon: Bot,
          color: "text-[var(--accent)]",
          bg: "bg-[var(--surface-raised)] border-[var(--border)]",
          tag: "Agent",
        };
    }
  };

  const missingCount = env?.agents.filter((a) => !a.is_installed).length ?? 0;

  return (
    <div className="space-y-4">
      {/* Çevre ve Bağımlılık Şeridi */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-mono">
            {env?.node_installed ? (
              <span className="flex items-center gap-1 text-[var(--ok)]">
                <CheckCircle2 className="w-3.5 h-3.5" /> Node {env.node_version}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[var(--err)]" title="Claude Code ve Codex için Node.js gereklidir">
                <AlertCircle className="w-3.5 h-3.5" /> Node.js Yok
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 font-mono">
            {env?.npm_installed ? (
              <span className="flex items-center gap-1 text-[var(--ok)]">
                <CheckCircle2 className="w-3.5 h-3.5" /> npm {env.npm_version}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[var(--err)]" title="npm paket yöneticisi bulunamadı">
                <AlertCircle className="w-3.5 h-3.5" /> npm Yok
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          disabled={loading || busyAgent !== null}
          onClick={loadEnv}
          className="flex items-center gap-1 text-[11px] text-[var(--txt-muted)] hover:text-[var(--txt-main)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Yenile
        </button>
      </div>

      {/* Ajan Kartları Listesi */}
      <div className="space-y-2.5">
        {env?.agents.map((a) => {
          const theme = getAgentTheme(a.id);
          const isBusy = busyAgent === a.id;
          const log = installLogs[a.id];
          const isExpanded = expandedLogs[a.id];

          return (
            <div
              key={a.id}
              className={`rounded-xl border p-3.5 transition-all ${a.is_installed ? "border-[var(--border)] bg-[var(--surface)]" : "border-[var(--border-glow)] bg-[var(--surface-raised)]/50"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-xl border shrink-0 mt-0.5 ${theme.bg}`}>
                    <theme.icon className={`w-5 h-5 ${theme.color}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-[var(--txt-main)]">{a.name}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--txt-muted)]">
                        {a.binary}
                      </span>
                      <span className="text-[10px] text-[var(--txt-dim)]">({theme.tag})</span>
                    </div>
                    <p className="text-[11px] text-[var(--txt-muted)] mt-0.5 leading-relaxed">{a.description}</p>
                    
                    <div className="mt-2 flex items-center gap-2">
                      {a.is_installed ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--ok)]">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>v{a.version || "kurulu"}</span>
                          {a.path && <span className="text-[10px] text-[var(--txt-dim)]">({a.path})</span>}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-[var(--warn)]">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>Kurulu Değil</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={isBusy || busyAgent !== null}
                    onClick={() => handleInstall(a.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50 ${
                      a.is_installed
                        ? "border border-[var(--border)] bg-[var(--bg)] text-[var(--txt-muted)] hover:text-[var(--txt-main)] hover:border-[var(--accent)]"
                        : "bg-[var(--accent)] text-black hover:brightness-110 shadow-sm"
                    }`}
                  >
                    {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : a.is_installed ? <RefreshCw className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                    {isBusy ? "Kuruluyor…" : a.is_installed ? "Güncelle" : "Tek Tıkla Kur"}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenTerminal(a)}
                    title="Komutu terminal sekmesinde aç"
                    className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--txt-dim)] hover:text-[var(--txt-main)] hover:border-[var(--accent)] transition-colors"
                  >
                    <SquareTerminal className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Kurulum Günlüğü / Çıktı */}
              {log && (
                <div className="mt-2.5 pt-2 border-t border-[var(--border)]">
                  <button
                    type="button"
                    onClick={() => setExpandedLogs((prev) => ({ ...prev, [a.id]: !prev[a.id] }))}
                    className="flex items-center gap-1 text-[10px] text-[var(--txt-dim)] hover:text-[var(--txt-muted)]"
                  >
                    {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <span>Kurulum konsol çıktısını {isExpanded ? "gizle" : "göster"}</span>
                  </button>
                  {isExpanded && (
                    <pre className="mt-1.5 p-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[10px] font-mono text-[var(--txt-muted)] max-h-32 overflow-auto whitespace-pre-wrap select-text">
                      {log}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {globalMsg && <div className="text-xs text-[var(--ok)] px-1">{globalMsg}</div>}
      {globalErr && <div className="text-xs text-[var(--err)] px-1 whitespace-pre-wrap">{globalErr}</div>}

      {/* Alt Bilgi & Hızlı Eylem Çubuğu */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
        <label className="flex items-center gap-2 text-xs text-[var(--txt-muted)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => toggleDontShow(e.target.checked)}
            className="rounded border-[var(--border)] bg-[var(--bg)] text-[var(--accent)]"
          />
          <span>Açılışta tekrar otomatik gösterme</span>
        </label>

        <div className="flex items-center gap-2">
          {missingCount > 0 && (
            <button
              type="button"
              disabled={busyAgent !== null || loading}
              onClick={handleInstallAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent)] text-black hover:brightness-110 disabled:opacity-50"
            >
              {busyAgent !== null ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Tüm Eksikleri Kur ({missingCount})
            </button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs text-[var(--txt-muted)] hover:bg-[var(--surface-raised)] transition-colors"
            >
              Kapat
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function AgentSetupModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Ajan & CLI Kurulum Sihirbazı" onClose={onClose} width={580}>
      <AgentSetupContent onClose={onClose} />
    </Modal>
  );
}
