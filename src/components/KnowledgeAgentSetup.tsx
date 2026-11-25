import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { KNOWLEDGE_DOCS_URL } from "../lib/releaseNotes";
import { api } from "../lib/tauri";
import { ErrorBanner } from "./ui";
import type { AgentApplyResult, AgentPreview, AgentSetupId, AgentSetupStatus } from "../types";

const AGENT_NAMES: Record<AgentSetupId, string> = {
  claude: "Claude Code",
  codex: "OpenAI Codex",
  agy: "Antigravity (AGY)",
};

const ACTION_LABEL: Record<string, string> = {
  add: "eklenecek",
  update: "güncellenecek",
  none: "değişiklik yok",
  error: "hata",
};

function badge(s: AgentSetupStatus): { text: string; cls: string } {
  if (s.rules_installed && s.mcp_installed) return { text: "Kurulu", cls: "text-[var(--ok)] border-[var(--ok)]/40" };
  if (s.rules_installed || s.mcp_installed) return { text: "Kısmen kurulu", cls: "text-[var(--warn)] border-[var(--warn)]/40" };
  return { text: "Kurulu değil", cls: "text-[var(--txt-dim)] border-[var(--border)]" };
}

/** Ayarlar → Bilgi Ağı: ajanlara MCP kaydı ve genel kural bloğu ekleme (önizleme + onay + geri alma). */
export function KnowledgeAgentSetup() {
  const [statuses, setStatuses] = useState<AgentSetupStatus[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [previews, setPreviews] = useState<AgentPreview[] | null>(null);
  const [results, setResults] = useState<AgentApplyResult[]>([]);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const list = await api.agentSetupStatus();
      setStatuses(list);
      setSelected((prev) => {
        const next = { ...prev };
        for (const s of list) if (!(s.id in next)) next[s.id] = !(s.rules_installed && s.mcp_installed);
        return next;
      });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const chosen = statuses.filter((s) => selected[s.id]).map((s) => s.id);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onPreview = () =>
    run(async () => {
      setResults([]);
      setConfirmRemove(false);
      setPreviews(await api.agentSetupPreview(chosen));
    });

  const onApply = () =>
    run(async () => {
      setResults(await api.agentSetupApply(chosen));
      setPreviews(null);
      await refresh();
    });

  const onRemove = () =>
    run(async () => {
      setResults(await api.agentSetupRemove(chosen));
      setPreviews(null);
      setConfirmRemove(false);
      await refresh();
    });

  return (
    <div className="rounded-lg border border-[var(--border)] p-3 space-y-2">
      <div className="text-[11px] font-medium text-[var(--txt-main)]">Ajanlara ekle</div>
      <p className="text-[10px] text-[var(--txt-dim)]">
        Seçilen ajanlara MCP sunucusunu kaydeder ve genel kural dosyasına (ör. ~/.claude/CLAUDE.md) işaretçili bir blok ekler.
        Dosyaların geri kalanına dokunulmaz, değişiklikten önce yedek alınır. Önce neyin değişeceğini görürsünüz.
      </p>
      <div className="rounded-md border border-[var(--warn)]/40 bg-[var(--warn)]/5 px-2.5 py-1.5 text-[10px] text-[var(--txt-muted)] space-y-1">
        <div>
          Bu işlem sisteminize dosya ekler ve ajanlarınızın ayarlarına bir MCP bağlantısı kaydeder. Hangi dosyaların nerede
          değiştiği, gizlilik ve elle kaldırma adımları sitede anlatılıyor.
        </div>
        <button
          type="button"
          onClick={() => openUrl(KNOWLEDGE_DOCS_URL).catch(() => {})}
          className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline cursor-pointer"
        >
          <ExternalLink className="w-3 h-3" /> Ne değişiyor? Siteyi aç
        </button>
      </div>

      <div className="space-y-1.5">
        {statuses.map((s) => {
          const b = badge(s);
          return (
            <label
              key={s.id}
              className="flex items-start gap-2 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs cursor-pointer"
            >
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--accent)]"
                checked={!!selected[s.id]}
                disabled={busy}
                onChange={(e) => {
                  setSelected({ ...selected, [s.id]: e.target.checked });
                  setPreviews(null);
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{AGENT_NAMES[s.id] ?? s.id}</span>
                  <span className={`px-1.5 py-0.5 rounded-full border text-[9px] ${b.cls}`}>{b.text}</span>
                  {!s.cli_found && (
                    <span className="px-1.5 py-0.5 rounded-full border text-[9px] text-[var(--warn)] border-[var(--warn)]/40">
                      CLI bulunamadı
                    </span>
                  )}
                </div>
                <div className="text-[10px] font-mono text-[var(--txt-dim)] truncate">{s.rules_path}</div>
                {s.note && <div className="text-[10px] text-[var(--warn)]">{s.note}</div>}
              </div>
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={busy || chosen.length === 0}
          onClick={() => void onPreview()}
          className="px-3 py-1 rounded-md bg-[var(--accent)] text-black text-[11px] font-medium disabled:opacity-50 cursor-pointer"
        >
          {busy && !previews ? <Loader2 size={12} className="animate-spin inline" /> : "Önizle ve ekle"}
        </button>
        {!confirmRemove ? (
          <button
            type="button"
            disabled={busy || chosen.length === 0}
            onClick={() => setConfirmRemove(true)}
            className="px-3 py-1 rounded-md border border-[var(--border)] text-[11px] disabled:opacity-50 cursor-pointer"
          >
            Kaldır
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onRemove()}
            className="px-3 py-1 rounded-md border border-[var(--err)]/60 text-[var(--err)] text-[11px] cursor-pointer"
          >
            Seçilenlerden kaldırmayı onayla
          </button>
        )}
      </div>

      {previews && (
        <div className="space-y-2 rounded-md border border-[var(--border-glow)] p-2">
          <div className="text-[11px] font-medium">Önizleme: şunlar yazılacak</div>
          {previews.map((p) => (
            <div key={p.id} className="space-y-1 text-[10px]">
              <div className="font-medium text-xs">{AGENT_NAMES[p.id] ?? p.id}</div>
              <div className="font-mono">
                Kural dosyası: {p.rules_path} <span className="text-[var(--accent)]">({ACTION_LABEL[p.rules_action] ?? p.rules_action})</span>
              </div>
              <div className="font-mono">
                MCP: {p.mcp_target} <span className="text-[var(--accent)]">({ACTION_LABEL[p.mcp_action] ?? p.mcp_action})</span>
              </div>
              {p.mcp_snippet && (
                <pre className="rounded bg-[var(--bg)] border border-[var(--border)] p-1.5 overflow-x-auto font-mono select-text">
                  {p.mcp_snippet}
                </pre>
              )}
              {p.error && <div className="text-[var(--err)]">{p.error}</div>}
            </div>
          ))}
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onApply()}
              className="px-3 py-1 rounded-md bg-[var(--accent)] text-black text-[11px] font-medium disabled:opacity-50 cursor-pointer"
            >
              {busy ? "Yazılıyor…" : "Onayla ve yaz"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPreviews(null)}
              className="px-3 py-1 rounded-md border border-[var(--border)] text-[11px] cursor-pointer"
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <ul className="space-y-0.5 text-[10px]">
          {results.map((r) => (
            <li key={r.id} className={r.ok ? "text-[var(--ok)]" : "text-[var(--err)]"}>
              {AGENT_NAMES[r.id] ?? r.id}: {r.message}
            </li>
          ))}
        </ul>
      )}

      <ErrorBanner error={error} context="settings" />
    </div>
  );
}
