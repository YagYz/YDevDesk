import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  Cpu,
  Download,
  Loader2,
  RefreshCw,
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

  const getAgentIcon = (id: string) => {
    switch (id) {
      case "agy":
        return <Sparkles className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />;
      case "claude":
        return <Bot className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />;
      case "codex":
        return <Cpu className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />;
      default:
        return <Bot className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />;
    }
  };

  const missingCount = env?.agents.filter((a) => !a.is_installed).length ?? 0;

  return (
    <div className="space-y-2 text-xs">
      {/* Node / npm Çevre Çubuğu - Modüller sekmesi tarzı */}
      <div className="flex items-center justify-between rounded-lg px-2.5 py-1.5 border border-[var(--border)] text-[11px] font-mono text-[var(--txt-muted)]">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            Node:{" "}
            <span className={env?.node_installed ? "text-[var(--ok)]" : "text-[var(--err)]"}>
              {env?.node_version || "yok"}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            npm:{" "}
            <span className={env?.npm_installed ? "text-[var(--ok)]" : "text-[var(--err)]"}>
              {env?.npm_version || "yok"}
            </span>
          </span>
        </div>

        <button
          type="button"
          disabled={loading || busyAgent !== null}
          onClick={loadEnv}
          className="flex items-center gap-1 text-[var(--txt-dim)] hover:text-[var(--txt-main)] transition-colors"
          title="Yeniden tara"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          <span>tara</span>
        </button>
      </div>

      {/* Ajan Listesi - Modüller sekmesi mimarisi */}
      <div className="space-y-1.5">
        {env?.agents.map((a) => {
          const isBusy = busyAgent === a.id;
          const log = installLogs[a.id];
          const isExpanded = expandedLogs[a.id];

          return (
            <div
              key={a.id}
              className="rounded-lg border border-[var(--border)] px-2.5 py-2 space-y-1.5 hover:border-[var(--border-glow)] transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <div className="mt-0.5">{getAgentIcon(a.id)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[var(--txt-main)]">{a.name}</span>
                      {a.version && (
                        <span className="text-[10px] font-mono text-[var(--txt-dim)]">v{a.version}</span>
                      )}
                      <span
                        className={`text-[10px] font-mono ${
                          a.is_installed ? "text-[var(--ok)]" : "text-[var(--txt-dim)]"
                        }`}
                      >
                        {a.is_installed ? "yüklü" : "yüklü değil"}
                      </span>
                    </div>
                    <p className="text-[10px] text-[var(--txt-dim)] truncate mt-0.5">{a.description}</p>
                  </div>
                </div>

                {/* Butonlar: Modüller sekmesi tarzı ince, mat ve köşeli */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {a.is_installed ? (
                    <div className="flex items-center gap-1">
                      {/* ÇALIŞTIR */}
                      <button
                        type="button"
                        onClick={() => handleLaunch(a, false)}
                        title="Normal başlat"
                        className="px-2 py-0.5 rounded text-[11px] font-mono border border-[var(--border)] text-[var(--txt-main)] hover:border-[var(--ok)]/60 hover:text-[var(--ok)] hover:bg-[var(--surface-raised)] transition-colors"
                      >
                        çalıştır
                      </button>

                      {/* BYPASS */}
                      {a.bypass_cmd && (
                        <button
                          type="button"
                          onClick={() => handleLaunch(a, true)}
                          title={`Onaysız tam yetkili bypass modu (${a.bypass_cmd})`}
                          className="px-2 py-0.5 rounded text-[10px] font-mono border border-[var(--border)] text-[var(--warn)] hover:border-[var(--warn)]/60 hover:bg-[var(--surface-raised)] transition-colors"
                        >
                          bypass
                        </button>
                      )}

                      {/* GÜNCELLE */}
                      <button
                        type="button"
                        disabled={isBusy || busyAgent !== null}
                        onClick={() => handleInstall(a.id)}
                        title="Güncelle"
                        className="px-1.5 py-0.5 rounded text-[10px] font-mono border border-[var(--border)] text-[var(--txt-dim)] hover:text-[var(--txt-main)] hover:bg-[var(--surface-raised)] transition-colors disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : "güncelle"}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={isBusy || busyAgent !== null}
                        onClick={() => handleInstall(a.id)}
                        className="px-2.5 py-0.5 rounded text-[11px] font-mono border border-[var(--border)] text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[var(--surface-raised)] transition-colors disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : "kur"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenInstallTerminal(a)}
                        title="Terminalde aç"
                        className="p-1 rounded border border-[var(--border)] text-[var(--txt-dim)] hover:text-[var(--txt-main)] hover:bg-[var(--surface-raised)] transition-colors"
                      >
                        <SquareTerminal className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Günlük / Log Çıktısı (varsa) */}
              {log && (
                <div className="pt-1 border-t border-[var(--border)]/50">
                  <button
                    type="button"
                    onClick={() => setExpandedLogs((prev) => ({ ...prev, [a.id]: !prev[a.id] }))}
                    className="text-[10px] text-[var(--txt-dim)] hover:text-[var(--txt-muted)]"
                  >
                    {isExpanded ? "▲ Çıktıyı gizle" : "▼ Çıktıyı göster"}
                  </button>
                  {isExpanded && (
                    <pre className="mt-1 p-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[10px] font-mono text-[var(--txt-muted)] max-h-24 overflow-auto whitespace-pre-wrap select-text">
                      {log}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {globalMsg && <div className="text-[11px] text-[var(--ok)] font-mono px-1">{globalMsg}</div>}
      {globalErr && <div className="text-[11px] text-[var(--err)] font-mono px-1 whitespace-pre-wrap">{globalErr}</div>}

      {/* Alt Kontrol Çubuğu */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
        <label className="flex items-center gap-2 text-xs text-[var(--txt-muted)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => toggleDontShow(e.target.checked)}
            className="rounded border-[var(--border)] bg-[var(--bg)] text-[var(--accent)] accent-[var(--accent)]"
          />
          <span>Açılışta otomatik gösterme</span>
        </label>

        <div className="flex items-center gap-2">
          {missingCount > 0 && (
            <button
              type="button"
              disabled={busyAgent !== null || loading}
              onClick={handleInstallAll}
              className="px-2.5 py-1 rounded text-xs font-mono border border-[var(--accent)]/50 text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-50 transition-colors"
            >
              {busyAgent !== null ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : <Download className="w-3 h-3 inline mr-1" />}
              tümünü kur ({missingCount})
            </button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1 rounded text-xs font-mono text-[var(--txt-muted)] hover:text-[var(--txt-main)] hover:bg-[var(--surface-raised)] transition-colors"
            >
              kapat
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
          <img src="/logo.png" alt="YDevDesk" className="w-5 h-5 rounded-md object-contain shadow" />
          <span>Ajan Yönetim & Kurulum Merkezi</span>
        </div>
      }
      onClose={onClose}
      width={540}
    >
      <AgentSetupContent onClose={onClose} />
    </Modal>
  );
}
