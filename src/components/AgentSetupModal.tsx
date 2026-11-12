import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Play,
  RefreshCw,
  Terminal,
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

  const handleLaunch = (agent: AgentCliInfo) => {
    ws.openTerminal({
      title: agent.name,
      initCmd: agent.binary,
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

  const missingCount = env?.agents.filter((a) => !a.is_installed).length ?? 0;

  return (
    <div className="space-y-2.5 text-xs">
      {/* Çevre Çubuğu - Köşeli, mat */}
      <div className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-[var(--surface-raised)] border border-[var(--border)] font-mono text-[11px]">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-[var(--txt-muted)]">
            <span className={`w-1.5 h-1.5 rounded-none ${env?.node_installed ? "bg-[var(--ok)]" : "bg-[var(--err)]"}`} />
            Node: <span className={env?.node_installed ? "text-[var(--txt-main)]" : "text-[var(--err)]"}>{env?.node_version || "yok"}</span>
          </span>
          <span className="flex items-center gap-1.5 text-[var(--txt-muted)]">
            <span className={`w-1.5 h-1.5 rounded-none ${env?.npm_installed ? "bg-[var(--ok)]" : "bg-[var(--err)]"}`} />
            npm: <span className={env?.npm_installed ? "text-[var(--txt-main)]" : "text-[var(--err)]"}>{env?.npm_version || "yok"}</span>
          </span>
        </div>

        <button
          type="button"
          disabled={loading || busyAgent !== null}
          onClick={loadEnv}
          className="flex items-center gap-1 text-[11px] text-[var(--txt-dim)] hover:text-[var(--txt-main)] disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Tara
        </button>
      </div>

      {/* Ajan Listesi - Köşeli, mat, VS Code / Terminal tarzı */}
      <div className="border border-[var(--border)] rounded-md divide-y divide-[var(--border)] bg-[var(--surface-raised)]">
        {env?.agents.map((a) => {
          const isBusy = busyAgent === a.id;
          const log = installLogs[a.id];
          const isExpanded = expandedLogs[a.id];

          return (
            <div key={a.id} className="p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs text-[var(--txt-main)]">{a.name}</span>
                    <span className="font-mono text-[10px] text-[var(--txt-dim)]">[{a.binary}]</span>
                  </div>
                  <div className="text-[11px] text-[var(--txt-dim)] truncate">{a.description}</div>
                </div>

                {/* Sağ Durum ve Butonlar */}
                <div className="flex items-center gap-2 shrink-0">
                  {a.is_installed ? (
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-[var(--ok)]">
                        ● v{a.version || "kurulu"}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleLaunch(a)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-[var(--surface)] border border-[var(--border)] text-[var(--txt-main)] hover:border-[var(--ok)] hover:text-[var(--ok)] transition-colors"
                        title="Oturumu başlat"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        Çalıştır
                      </button>
                      <button
                        type="button"
                        disabled={isBusy || busyAgent !== null}
                        onClick={() => handleInstall(a.id)}
                        className="px-2 py-1 rounded text-[11px] font-mono border border-[var(--border)] text-[var(--txt-dim)] hover:text-[var(--txt-main)] hover:bg-[var(--surface)] transition-colors disabled:opacity-50"
                        title="Güncelle"
                      >
                        {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : "güncelle"}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-[var(--warn)]">
                        ○ eksik
                      </span>
                      <button
                        type="button"
                        disabled={isBusy || busyAgent !== null}
                        onClick={() => handleInstall(a.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-[var(--surface)] border border-[var(--border)] text-[var(--txt-main)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                        {isBusy ? "Kuruluyor…" : "Kur"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenInstallTerminal(a)}
                        className="p-1 rounded border border-[var(--border)] text-[var(--txt-dim)] hover:text-[var(--txt-main)] hover:bg-[var(--surface)] transition-colors"
                        title="Terminalde aç"
                      >
                        <Terminal className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Günlük Çıktısı */}
              {log && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setExpandedLogs((prev) => ({ ...prev, [a.id]: !prev[a.id] }))}
                    className="flex items-center gap-1 text-[10px] text-[var(--txt-dim)] hover:text-[var(--txt-muted)]"
                  >
                    {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <span>Çıktı ({isExpanded ? "gizle" : "göster"})</span>
                  </button>
                  {isExpanded && (
                    <pre className="mt-1 p-2 rounded bg-[var(--bg)] border border-[var(--border)] text-[10px] font-mono text-[var(--txt-muted)] max-h-24 overflow-auto whitespace-pre-wrap select-text">
                      {log}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {globalMsg && <div className="text-[11px] text-[var(--ok)] font-mono">{globalMsg}</div>}
      {globalErr && <div className="text-[11px] text-[var(--err)] font-mono whitespace-pre-wrap">{globalErr}</div>}

      {/* Alt Bar - Mat, köşeli, sade */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
        <label className="flex items-center gap-2 text-xs text-[var(--txt-muted)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => toggleDontShow(e.target.checked)}
            className="rounded-none border border-[var(--border)] bg-[var(--bg)] text-[var(--accent)] accent-[var(--accent)]"
          />
          <span>Açılışta otomatik gösterme</span>
        </label>

        <div className="flex items-center gap-2">
          {missingCount > 0 && (
            <button
              type="button"
              disabled={busyAgent !== null || loading}
              onClick={handleInstallAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--txt-main)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
            >
              {busyAgent !== null ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              Tüm Eksikleri Kur ({missingCount})
            </button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs text-[var(--txt-muted)] hover:text-[var(--txt-main)] hover:bg-[var(--surface-raised)] transition-colors"
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
    <Modal title="Ajan Merkezi" onClose={onClose} width={520}>
      <AgentSetupContent onClose={onClose} />
    </Modal>
  );
}
