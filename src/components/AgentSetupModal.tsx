import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cpu,
  Download,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
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

  const handleLaunch = (agent: AgentCliInfo, bypass = false) => {
    const cmd = bypass && agent.bypass_cmd ? agent.bypass_cmd : agent.binary;
    const title = bypass ? `${agent.name} (Bypass)` : agent.name;
    ws.openTerminal({
      title,
      initCmd: cmd,
      kind: "agent",
    });
    if (onClose) onClose();
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

  const handleOpenInstallTerminal = (agent: AgentCliInfo) => {
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
          bg: "bg-[#00d2ff]/10 border-[#00d2ff]/25",
          tag: "Google",
        };
      case "claude":
        return {
          icon: Bot,
          color: "text-[#f97316]",
          bg: "bg-[#f97316]/10 border-[#f97316]/25",
          tag: "Anthropic",
        };
      case "codex":
        return {
          icon: Cpu,
          color: "text-[#10b981]",
          bg: "bg-[#10b981]/10 border-[#10b981]/25",
          tag: "OpenAI",
        };
      default:
        return {
          icon: Bot,
          color: "text-[var(--accent)]",
          bg: "bg-[var(--surface-raised)] border-[var(--border)]",
          tag: "CLI",
        };
    }
  };

  const missingCount = env?.agents.filter((a) => !a.is_installed).length ?? 0;

  return (
    <div className="space-y-3.5">
      {/* Üst Başlık & Çevre Çubuğu */}
      <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-[var(--surface-raised)] border border-[var(--border)] text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <span className={`w-1.5 h-1.5 rounded-full ${env?.node_installed ? "bg-[var(--ok)] shadow-[0_0_6px_var(--ok)]" : "bg-[var(--err)]"}`} />
            <span className={env?.node_installed ? "text-[var(--txt-main)]" : "text-[var(--err)]"}>
              Node {env?.node_version || "Yok"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <span className={`w-1.5 h-1.5 rounded-full ${env?.npm_installed ? "bg-[var(--ok)] shadow-[0_0_6px_var(--ok)]" : "bg-[var(--err)]"}`} />
            <span className={env?.npm_installed ? "text-[var(--txt-main)]" : "text-[var(--err)]"}>
              npm {env?.npm_version || "Yok"}
            </span>
          </div>
        </div>

        <button
          type="button"
          disabled={loading || busyAgent !== null}
          onClick={loadEnv}
          title="Çevre ve ajan durumlarını yeniden tara"
          className="flex items-center gap-1 text-[11px] text-[var(--txt-dim)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Yenile
        </button>
      </div>

      {/* Ajan Kartları */}
      <div className="space-y-2">
        {env?.agents.map((a) => {
          const theme = getAgentTheme(a.id);
          const isBusy = busyAgent === a.id;
          const log = installLogs[a.id];
          const isExpanded = expandedLogs[a.id];

          return (
            <div
              key={a.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/70 hover:border-[var(--border-glow)] p-3 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`p-2 rounded-lg border shrink-0 ${theme.bg}`}>
                    <theme.icon className={`w-4 h-4 ${theme.color}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-xs text-[var(--txt-main)] truncate">{a.name}</span>
                      <code className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--bg)] border border-[var(--border)] text-[var(--txt-muted)]">
                        {a.binary}
                      </code>
                    </div>
                    
                    <div className="mt-1 flex items-center gap-2">
                      {a.is_installed ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--ok)]">
                          <CheckCircle2 className="w-3 h-3 shrink-0" />
                          <span>v{a.version || "kurulu"}</span>
                          {a.path && <span className="text-[10px] text-[var(--txt-dim)] truncate max-w-[170px]">({a.path})</span>}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--warn)]">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          <span>Kurulu Değil</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Aksiyon Butonları */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {a.is_installed ? (
                    <>
                      {/* ÇALIŞTIR BUTONU */}
                      <button
                        type="button"
                        onClick={() => handleLaunch(a, false)}
                        title="Bu ajanı yeni terminal sekmesinde aç"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[var(--ok)]/15 hover:bg-[var(--ok)]/25 text-[var(--ok)] border border-[var(--ok)]/30 transition-colors shadow-sm"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        Çalıştır
                      </button>

                      {/* BYPASS / TAM YETKİLİ BAŞLAT */}
                      {a.bypass_cmd && (
                        <button
                          type="button"
                          onClick={() => handleLaunch(a, true)}
                          title={`Onaysız tam yetkiyle çalıştır (${a.bypass_cmd})`}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-mono bg-[var(--warn)]/10 hover:bg-[var(--warn)]/20 text-[var(--warn)] border border-[var(--warn)]/25 transition-colors"
                        >
                          <ShieldAlert className="w-3 h-3 shrink-0" />
                          Bypass
                        </button>
                      )}

                      {/* GÜNCELLE BUTONU */}
                      <button
                        type="button"
                        disabled={isBusy || busyAgent !== null}
                        onClick={() => handleInstall(a.id)}
                        title="İkili dosyayı veya npm paketini güncelle"
                        className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--txt-dim)] hover:text-[var(--txt-main)] hover:border-[var(--border-glow)] transition-colors disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* TEK TIKLA KUR */}
                      <button
                        type="button"
                        disabled={isBusy || busyAgent !== null}
                        onClick={() => handleInstall(a.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent)] text-black hover:brightness-110 shadow-sm transition-all disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                        {isBusy ? "Kuruluyor…" : "Tek Tıkla Kur"}
                      </button>

                      {/* TERMİNALDE KUR */}
                      <button
                        type="button"
                        onClick={() => handleOpenInstallTerminal(a)}
                        title="Kurulum komutunu terminal sekmesinde interaktif aç"
                        className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--txt-dim)] hover:text-[var(--txt-main)] hover:border-[var(--accent)] transition-colors"
                      >
                        <SquareTerminal className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Kurulum Günlüğü */}
              {log && (
                <div className="mt-2 pt-2 border-t border-[var(--border)]/60">
                  <button
                    type="button"
                    onClick={() => setExpandedLogs((prev) => ({ ...prev, [a.id]: !prev[a.id] }))}
                    className="flex items-center gap-1 text-[10px] text-[var(--txt-dim)] hover:text-[var(--txt-muted)]"
                  >
                    {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <span>Konsol çıktısını {isExpanded ? "gizle" : "göster"}</span>
                  </button>
                  {isExpanded && (
                    <pre className="mt-1.5 p-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[10px] font-mono text-[var(--txt-muted)] max-h-28 overflow-auto whitespace-pre-wrap select-text">
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

      {/* Alt Kontrol Çubuğu */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
        <label className="flex items-center gap-2 text-xs text-[var(--txt-muted)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => toggleDontShow(e.target.checked)}
            className="rounded border-[var(--border)] bg-[var(--bg)] text-[var(--accent)] accent-[var(--accent)]"
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
              className="px-3 py-1.5 rounded-lg text-xs text-[var(--txt-muted)] hover:text-[var(--txt-main)] hover:bg-[var(--surface-raised)] transition-colors"
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
    <Modal
      title={
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="YDevDesk" className="w-4 h-4 rounded object-contain shadow" />
          <span>Ajan Yönetim & Kurulum Merkezi</span>
        </div>
      }
      onClose={onClose}
      width={560}
    >
      <AgentSetupContent onClose={onClose} />
    </Modal>
  );
}
