import { useState } from "react";
import { Check, ExternalLink, FolderOpen, Palette, Play, Plug, RefreshCw, Trash2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../lib/tauri";

const THEMES_DOCS_URL = "https://yagyz.github.io/YDevDesk/docs.html#themes";
const PLUGINS_DOCS_URL = "https://yagyz.github.io/YDevDesk/docs.html#plugins";
import { useSettings } from "../context/SettingsContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { applyTheme } from "../lib/themes";
import type { AppSettings } from "../types";

export function ThemesSettingsTab({
  draft,
  onChange,
}: {
  draft: AppSettings;
  onChange: (next: AppSettings) => void;
}) {
  const { themes, refreshThemes } = useSettings();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const selectedId = draft.theme_id || "deep-navy";

  const handleRemove = async (id: string) => {
    setBusy(true);
    try {
      await api.removeTheme(id);
      if (selectedId === id) {
        onChange({ ...draft, theme_id: "deep-navy" });
      }
      await refreshThemes();
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleOpenDir = async () => {
    try {
      const p = await api.openThemesDir();
      setNotice(`Tema klasörü: ${p}`);
    } catch (e) {
      setNotice(String(e));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--txt-dim)]">
          Yerleşik temaları seçin veya <code className="font-mono">~/.config/ydevdesk/themes/*.json</code> içine kendi temanızı ekleyin.{" "}
          <button
            type="button"
            onClick={() => openUrl(THEMES_DOCS_URL).catch(() => {})}
            className="inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline cursor-pointer"
          >
            yagyz.github.io/YDevDesk/docs.html
            <ExternalLink className="w-2.5 h-2.5" />
          </button>
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleOpenDir}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--accent)]/50 cursor-pointer"
          >
            <FolderOpen className="w-3 h-3" /> Klasör
          </button>
          <button
            type="button"
            onClick={() => void refreshThemes()}
            title="Yenile"
            className="p-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] hover:text-[var(--accent)] cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {themes.map((t) => {
          const active = selectedId === t.id;
          const bg = t.vars["--bg"] || "#06090e";
          const surface = t.vars["--surface"] || "#0a111a";
          const accent = t.vars["--accent"] || "#00d2ff";
          const txt = t.vars["--txt-main"] || "#f0f6fc";
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                onChange({ ...draft, theme_id: t.id });
                applyTheme(t);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onChange({ ...draft, theme_id: t.id });
                  applyTheme(t);
                }
              }}
              className={`rounded-lg p-2.5 border transition-colors cursor-pointer ${
                active
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--accent)]/40"
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 shrink-0">
                  <span className="w-3.5 h-3.5 rounded-full border border-white/15" style={{ background: bg }} />
                  <span className="w-3.5 h-3.5 rounded-full border border-white/15" style={{ background: surface }} />
                  <span className="w-3.5 h-3.5 rounded-full border border-white/15" style={{ background: accent }} />
                  <span className="w-3.5 h-3.5 rounded-full border border-white/15" style={{ background: txt }} />
                </div>
                <span className="text-xs font-medium truncate">{t.name}</span>
                {active && <Check className="w-3.5 h-3.5 text-[var(--accent)] ml-auto shrink-0" />}
                {!t.builtin && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRemove(t.id);
                    }}
                    disabled={busy}
                    title="Özel temayı sil"
                    className="ml-auto p-1 rounded text-[var(--txt-dim)] hover:text-[var(--err)] cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--txt-dim)]">
                <Palette className="w-3 h-3 shrink-0" />
                <span className="truncate">{t.description || t.id}</span>
                <span className="ml-auto shrink-0">{t.builtin ? "Yerleşik" : "Özel"}</span>
              </div>
            </div>
          );
        })}
      </div>

      {notice && <p className="text-[11px] text-[var(--accent)]">{notice}</p>}
    </div>
  );
}

export function PluginsSettingsTab({ onCloseModal }: { onCloseModal: () => void }) {
  const { plugins, refreshPlugins } = useSettings();
  const { openPlugin } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const handleRemove = async (id: string) => {
    setBusy(true);
    try {
      await api.removePlugin(id);
      await refreshPlugins();
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleOpenDir = async () => {
    try {
      const p = await api.openPluginsDir();
      setNotice(`Eklentiler klasörü: ${p}`);
    } catch (e) {
      setNotice(String(e));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--txt-dim)]">
          Harici eklentiler <code className="font-mono">~/.config/ydevdesk/plugins/&lt;id&gt;/</code> dizininden sandboxed olarak yüklenir.{" "}
          <button
            type="button"
            onClick={() => openUrl(PLUGINS_DOCS_URL).catch(() => {})}
            className="inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline cursor-pointer"
          >
            yagyz.github.io/YDevDesk/docs.html
            <ExternalLink className="w-2.5 h-2.5" />
          </button>
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleOpenDir}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--accent)]/50 cursor-pointer"
          >
            <FolderOpen className="w-3 h-3" /> Klasör
          </button>
          <button
            type="button"
            onClick={() => void refreshPlugins()}
            title="Yenile"
            className="p-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] hover:text-[var(--accent)] cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {plugins.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--txt-dim)]">
          Kurulu eklenti yok. Klasöre kendi eklentini bırakabilir, örnekler ve JSON şeması için{" "}
          <button
            type="button"
            onClick={() => openUrl(PLUGINS_DOCS_URL).catch(() => {})}
            className="text-[var(--accent)] hover:underline cursor-pointer"
          >
            yagyz.github.io/YDevDesk/docs.html
          </button>{" "}
          dokümantasyonuna bakabilirsin.
        </div>
      ) : (
        <ul className="space-y-2">
          {plugins.map((p) => (
            <li
              key={p.id}
              className="rounded-lg p-2.5 border border-[var(--border)] bg-[var(--surface-raised)] flex items-center gap-2.5"
            >
              <Plug className="w-4 h-4 text-[var(--accent)] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium truncate">{p.name}</span>
                  <span className="text-[10px] font-mono text-[var(--txt-dim)]">v{p.version}</span>
                </div>
                {p.description && <div className="text-[11px] text-[var(--txt-dim)] truncate">{p.description}</div>}
                {p.permissions.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.permissions.map((perm) => (
                      <span
                        key={perm}
                        className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[var(--surface)] border border-[var(--border)] text-[var(--txt-muted)]"
                      >
                        {perm}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  openPlugin(p);
                  onCloseModal();
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/25 cursor-pointer shrink-0"
              >
                <Play className="w-3 h-3" /> Aç
              </button>
              <button
                type="button"
                onClick={() => void handleRemove(p.id)}
                disabled={busy}
                title="Eklentiyi kaldır"
                className="p-1.5 rounded-md text-[var(--txt-dim)] hover:text-[var(--err)] cursor-pointer shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {notice && <p className="text-[11px] text-[var(--accent)]">{notice}</p>}
    </div>
  );
}
