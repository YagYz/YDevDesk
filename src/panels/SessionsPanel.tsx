import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Copy, Folder, Pencil, Pin, Play, Search, Users, Zap } from "lucide-react";
import { useData } from "../context/DataContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { formatAgo } from "../lib/format";
import { api } from "../lib/tauri";
import { Dot, Empty, PanelBody } from "../components/ui";
import type { ActiveAgentSession, SessionPrefs } from "../types";

type AgentFilter = "all" | "agy" | "claude" | "codex";

const AGENT_META: Record<string, { label: string; badgeClass: string }> = {
  agy: {
    label: "AGY",
    badgeClass: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  },
  claude: {
    label: "Claude",
    badgeClass: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
  codex: {
    label: "Codex",
    badgeClass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildResumeCommand(session: ActiveAgentSession, bypass: boolean): string {
  const id = session.full_session_id || session.session_id;
  const cdPrefix = session.cwd ? `cd ${shellQuote(session.cwd)} && ` : "";
  const quotedId = shellQuote(id);

  switch (session.agent) {
    case "claude":
      return `${cdPrefix}claude --resume ${quotedId}${bypass ? " --dangerously-skip-permissions" : ""}`;
    case "codex":
      return bypass
        ? `${cdPrefix}codex --dangerously-bypass-approvals-and-run-code resume ${quotedId}`
        : `${cdPrefix}codex resume ${quotedId}`;
    case "agy":
    default:
      return `${cdPrefix}agy --conversation ${quotedId}${bypass ? " --dangerously-skip-permissions" : ""}`;
  }
}

function folderName(cwd?: string | null): string | null {
  if (!cwd) return null;
  const parts = cwd.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || cwd;
}

function sessionKey(session: ActiveAgentSession): string {
  return `${session.agent}:${session.full_session_id || session.session_id}`;
}

export default function SessionsPanel() {
  const { agent } = useData();
  const { openTerminal } = useWorkspace();
  const [filter, setFilter] = useState<AgentFilter>("all");
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<SessionPrefs>({ pinned: {}, aliases: {} });
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const cancelEditRef = useRef(false);

  useEffect(() => {
    api
      .loadSessionPrefs()
      .then((loaded) => {
        if (loaded) {
          setPrefs({ pinned: loaded.pinned ?? {}, aliases: loaded.aliases ?? {} });
        }
      })
      .catch(() => {});
  }, []);

  const updatePrefs = (updater: (prev: SessionPrefs) => SessionPrefs) => {
    setPrefs((prev) => {
      const next = updater(prev);
      api.saveSessionPrefs(next).catch(() => {});
      return next;
    });
  };

  const togglePin = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    updatePrefs((prev) => {
      const pinned = { ...prev.pinned };
      if (pinned[key]) {
        delete pinned[key];
      } else {
        pinned[key] = true;
      }
      return { ...prev, pinned };
    });
  };

  const startRename = (key: string, currentTitle: string) => {
    cancelEditRef.current = false;
    setEditingKey(key);
    setDraftTitle(currentTitle);
  };

  const commitRename = (key: string) => {
    const trimmed = draftTitle.trim();
    setEditingKey(null);
    updatePrefs((prev) => {
      const aliases = { ...prev.aliases };
      if (!trimmed) {
        delete aliases[key];
      } else {
        aliases[key] = trimmed;
      }
      return { ...prev, aliases };
    });
  };

  const counts = useMemo(() => {
    const c = { all: agent.sessions.length, agy: 0, claude: 0, codex: 0 };
    for (const s of agent.sessions) {
      if (s.agent === "agy") c.agy++;
      else if (s.agent === "claude") c.claude++;
      else if (s.agent === "codex") c.codex++;
    }
    return c;
  }, [agent.sessions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = agent.sessions.filter((s) => {
      if (filter !== "all" && s.agent !== filter) return false;
      if (!q) return true;
      const alias = prefs.aliases[sessionKey(s)] ?? "";
      return (
        s.title.toLowerCase().includes(q) ||
        alias.toLowerCase().includes(q) ||
        s.session_id.toLowerCase().includes(q) ||
        s.full_session_id.toLowerCase().includes(q) ||
        (s.cwd?.toLowerCase().includes(q) ?? false)
      );
    });
    list.sort((a, b) => {
      const ap = prefs.pinned[sessionKey(a)] ? 1 : 0;
      const bp = prefs.pinned[sessionKey(b)] ? 1 : 0;
      return bp - ap;
    });
    return list;
  }, [agent.sessions, filter, query, prefs]);

  const launchSession = (session: ActiveAgentSession, bypass: boolean) => {
    const meta = AGENT_META[session.agent] ?? { label: session.agent.toUpperCase(), badgeClass: "" };
    const cmd = buildResumeCommand(session, bypass);
    const alias = prefs.aliases[sessionKey(session)];
    openTerminal({
      title: `${meta.label} · ${alias || session.session_id}`,
      initCmd: cmd,
      kind: "agent",
    });
  };

  const copySessionId = (e: React.MouseEvent, session: ActiveAgentSession) => {
    e.stopPropagation();
    const id = session.full_session_id || session.session_id;
    navigator.clipboard?.writeText(id).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
  };

  const tabs: { id: AgentFilter; label: string; count: number }[] = [
    { id: "all", label: "Tümü", count: counts.all },
    { id: "agy", label: "AGY", count: counts.agy },
    { id: "claude", label: "Claude", count: counts.claude },
    { id: "codex", label: "Codex", count: counts.codex },
  ];

  return (
    <PanelBody className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center gap-1 flex-wrap">
          {tabs.map((t) => {
            const active = filter === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer ${
                  active
                    ? "bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/40"
                    : "bg-[var(--surface-raised)] text-[var(--txt-dim)] border-[var(--border)] hover:text-[var(--txt-main)]"
                }`}
              >
                {t.label} <span className="font-mono opacity-75">{t.count}</span>
              </button>
            );
          })}
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[var(--txt-dim)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Oturum, proje veya ID ara..."
            className="w-full pl-8 pr-2.5 py-1.5 rounded-md bg-[var(--surface-raised)] border border-[var(--border)] text-xs text-[var(--txt-main)] placeholder:text-[var(--txt-dim)] focus:outline-none focus:border-[var(--accent)]/50"
          />
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--txt-dim)] mb-1.5">
          <span>Son Oturumlar (Maks 50)</span>
          <span className="font-mono">{filtered.length}</span>
        </div>

        {filtered.length === 0 ? (
          <Empty
            icon={<Bot className="w-5 h-5" />}
            title="Oturum bulunamadı"
            hint="AGY (~/.gemini), Claude (~/.claude) veya Codex (~/.codex) oturumları burada listelenir."
          />
        ) : (
          <ul className="space-y-1.5">
            {filtered.map((s) => {
              const meta = AGENT_META[s.agent] ?? {
                label: s.agent.toUpperCase(),
                badgeClass: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
              };
              const fullId = s.full_session_id || s.session_id;
              const key = sessionKey(s);
              const proj = folderName(s.cwd);
              const isCopied = copiedId === fullId;
              const isPinned = Boolean(prefs.pinned[key]);
              const customAlias = prefs.aliases[key];
              const displayTitle = customAlias || s.title || `${meta.label} Oturumu`;
              const isEditing = editingKey === key;

              return (
                <li key={key}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (!isEditing) launchSession(s, false);
                    }}
                    onKeyDown={(e) => {
                      if (isEditing) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        launchSession(s, false);
                      }
                    }}
                    title={`Tıkla ve başlat: ${buildResumeCommand(s, false)}`}
                    className={`group rounded-md px-2.5 py-2 bg-[var(--surface-raised)] border transition-colors cursor-pointer ${
                      isPinned
                        ? "border-[var(--accent)]/40 hover:border-[var(--accent)]/70"
                        : "border-[var(--border)] hover:border-[var(--accent)]/50"
                    } hover:bg-[var(--surface-hover,var(--surface-raised))]`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Dot tone={s.is_active ? "ok" : "idle"} />
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                      <span className="font-mono text-[11px] text-[var(--txt-dim)]">{s.session_id}</span>
                      {isPinned && <Pin className="w-2.5 h-2.5 text-[var(--accent)] shrink-0" />}
                      <span className="ml-auto text-[10px] text-[var(--txt-dim)] font-mono shrink-0">
                        {formatAgo(s.updated_ago_secs)}
                      </span>
                    </div>

                    {isEditing ? (
                      <input
                        type="text"
                        autoFocus
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                        onBlur={() => {
                          if (cancelEditRef.current) {
                            cancelEditRef.current = false;
                            return;
                          }
                          commitRename(key);
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitRename(key);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelEditRef.current = true;
                            setEditingKey(null);
                          }
                        }}
                        placeholder={s.title || `${meta.label} Oturumu`}
                        className="mt-1 w-full px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--accent)]/60 text-xs text-[var(--txt-main)] font-medium focus:outline-none"
                      />
                    ) : (
                      <div
                        title={displayTitle}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          startRename(key, customAlias || s.title || "");
                        }}
                        className="mt-1 text-xs text-[var(--txt-main)] font-medium truncate"
                      >
                        {displayTitle}
                      </div>
                    )}

                    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-[var(--txt-dim)]">
                      {proj && (
                        <span className="inline-flex items-center gap-1 truncate max-w-[110px]" title={s.cwd ?? undefined}>
                          <Folder className="w-3 h-3 shrink-0" />
                          <span className="truncate">{proj}</span>
                        </span>
                      )}

                      {(s.subagent_count ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[10px] text-[var(--txt-dim)] shrink-0">
                          <Users className="w-2.5 h-2.5" />
                          {s.subagent_count} subagent
                        </span>
                      )}

                      <div className="ml-auto flex items-center gap-0.5 opacity-80 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={(e) => togglePin(e, key)}
                          title={isPinned ? "Sabitlemeyi kaldır" : "Üste sabitle"}
                          className={`p-1 rounded hover:bg-[var(--surface)] cursor-pointer ${
                            isPinned ? "text-[var(--accent)]" : "text-[var(--txt-dim)] hover:text-[var(--txt-main)]"
                          }`}
                        >
                          <Pin className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startRename(key, customAlias || s.title || "");
                          }}
                          title="Yeniden adlandır"
                          className="p-1 rounded hover:bg-[var(--surface)] text-[var(--txt-dim)] hover:text-[var(--txt-main)] cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => copySessionId(e, s)}
                          title={`Tam ID kopyala: ${fullId}`}
                          className="p-1 rounded hover:bg-[var(--surface)] text-[var(--txt-dim)] hover:text-[var(--txt-main)] cursor-pointer"
                        >
                          {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            launchSession(s, true);
                          }}
                          title="Tam yetkiyle (Bypass) başlat"
                          className="p-1 rounded hover:bg-amber-500/15 text-[var(--txt-dim)] hover:text-amber-300 cursor-pointer"
                        >
                          <Zap className="w-3 h-3" />
                        </button>
                        <span
                          title="Oturumu başlat"
                          className="p-1 rounded text-[var(--accent)]"
                        >
                          <Play className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {agent.subagents.length > 0 && (
        <section>
          <div className="text-[10px] uppercase tracking-wider text-[var(--txt-dim)] mb-1.5 flex items-center gap-1">
            <Users className="w-3 h-3" /> Alt ajanlar
          </div>
          <ul className="space-y-1">
            {agent.subagents.map((s, i) => (
              <li key={`${s.name}-${i}`} className="rounded-md px-2 py-1.5 bg-[var(--surface-raised)] border border-[var(--border)] text-xs">
                <div className="flex items-center gap-2">
                  <Dot tone={s.status === "running" || s.status === "working" ? "ok" : "idle"} />
                  <span className="font-medium truncate">{s.name}</span>
                  <span className="ml-auto text-[var(--txt-dim)]">{s.status}</span>
                </div>
                {s.role && <div className="text-[10px] text-[var(--txt-dim)] truncate mt-0.5">{s.role}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </PanelBody>
  );
}
