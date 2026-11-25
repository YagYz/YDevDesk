import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "../context/WorkspaceContext";
import { Empty, ErrorBanner, PanelBody } from "../components/ui";
import { api } from "../lib/tauri";
import { useVisibilityPoll } from "../lib/useVisibilityPoll";
import type { Knowledge, KnowledgeEntry } from "../types";

const KNOWN_AGENTS = ["claude", "codex", "agy", "user"];

function agentLabel(agent: string): string {
  const a = (agent || "").toLowerCase();
  return KNOWN_AGENTS.includes(a) ? a : "unknown";
}

function relativeTime(ts: string | number): string {
  const t = typeof ts === "number" ? (ts < 1e12 ? ts * 1000 : ts) : Date.parse(ts);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "az önce";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}

function toKnowledge(e: KnowledgeEntry): Knowledge {
  return {
    id: e.id,
    service_tag: e.service,
    title: e.title,
    summary: e.summary,
    linked_topics: e.tags,
    agent: e.agent,
    device: e.device,
    created_at: e.created_at,
  };
}

export default function KnowledgePanel() {
  const { openKnowledge } = useWorkspace();
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [tags, setTags] = useState<[string, number][]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const refresh = useCallback(async () => {
    try {
      const [list, t] = await Promise.all([
        api.knowledgeList(undefined, search || undefined, tag ?? undefined, 100),
        api.knowledgeTags(),
      ]);
      setEntries(list);
      setTags(t);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, [search, tag]);

  // Başka süreç (MCP) de yazdığı için 5 sn'de bir yenilenir; filtre değişince interval yeniden kurulur.
  useVisibilityPoll(refresh, 5000, true);

  return (
    <PanelBody className="flex flex-col gap-2">
      <input
        type="text"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Ara…"
        className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs outline-none focus:border-[var(--accent)] select-text shrink-0"
      />
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 shrink-0">
          {tags.map(([name, count]) => {
            const active = tag === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => setTag(active ? null : name)}
                className={`px-1.5 py-0.5 rounded-full border text-[10px] font-mono cursor-pointer ${
                  active
                    ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--txt-dim)] hover:text-[var(--txt-main)]"
                }`}
              >
                {name} <span className="opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      )}
      <ErrorBanner error={error} compact />
      {entries.length === 0 && !error ? (
        <Empty title="Henüz kayıt yok" />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {entries.map((e) => (
            <li key={e.id} className="min-w-0">
              <button
                onClick={() => openKnowledge(toKnowledge(e))}
                className="block w-full min-w-0 text-left rounded-md px-2 py-1.5 bg-[var(--surface-raised)] border border-[var(--border)] hover:border-[var(--accent)]/50 transition-colors"
              >
                <div className="flex items-center gap-1.5 text-[10px] font-mono">
                  <span className="text-[var(--accent)] truncate">{e.service}</span>
                  <span className="px-1 rounded border border-[var(--border)] text-[var(--txt-muted)]">{agentLabel(e.agent)}</span>
                  <span className="ml-auto text-[var(--txt-dim)] shrink-0">{relativeTime(e.created_at)}</span>
                </div>
                <div className="text-xs font-medium truncate">{e.title}</div>
                <div className="text-[10px] text-[var(--txt-dim)] line-clamp-2">{e.summary}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </PanelBody>
  );
}
