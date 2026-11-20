import { useEffect, useState } from "react";
import { Bot, Layers, LayoutGrid, Plug, Plus, RotateCcw, Search, Settings, SquareTerminal, Trash2 } from "lucide-react";
import { api } from "../lib/tauri";
import { useWorkspace } from "../context/WorkspaceContext";
import { MODULES } from "../panels/registry";
import { useSettings } from "../context/SettingsContext";
import { hasConnection } from "../lib/settings";
import { Menu, MenuItem } from "./Menu";

const btn = "flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11px] text-[var(--txt-muted)] hover:text-[var(--txt-main)] hover:bg-[var(--surface-raised)] transition-colors";

export function TitleBar({ onSettings }: { onSettings: () => void }) {
  const ws = useWorkspace();
  const { settings, plugins } = useSettings();
  const [version, setVersion] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  useEffect(() => { api.appVersion().then(setVersion).catch(() => {}); }, []);
  const run = (fn: () => Promise<void>) => () => fn().catch(console.error);

  return (
    <header data-tauri-drag-region className="h-10 shrink-0 flex items-center gap-2 pl-3 pr-2 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-1.5 mr-1" data-tauri-drag-region>
        <button onClick={run(api.windowClose)} className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-125" title="Kapat" />
        <button onClick={run(api.windowMinimize)} className="w-3 h-3 rounded-full bg-[#febc2e] hover:brightness-125" title="Küçült" />
        <button onClick={run(api.windowToggleMaximize)} className="w-3 h-3 rounded-full bg-[#28c840] hover:brightness-125" title="Büyüt" />
      </div>
      <div className="flex items-center gap-1.5 mr-0.5 select-none" data-tauri-drag-region>
        <img src="/logo.png" alt="YDevDesk" className="w-6 h-6 rounded-md object-contain shadow-sm" />
        <span className="text-xs font-semibold tracking-wide text-[var(--txt-main)]">
          YDev<span className="text-[var(--accent)]">Desk</span>
        </span>
      </div>
      {version && (
        <button
          onClick={onSettings}
          title="Sürüm ve güncelleme kontrolü"
          className="px-1.5 py-0.5 mr-1 rounded text-[10px] font-mono text-[var(--txt-muted)] bg-[var(--surface-raised)] border border-[var(--border)] hover:border-[var(--accent)]/50 hover:text-[var(--accent)] transition-colors"
        >
          v{version}
        </button>
      )}

      <Menu
        trigger={() => (
          <button className={btn}>
            <Plus className="w-3.5 h-3.5" /> Yeni oturum
          </button>
        )}
      >
        {(close) =>
          settings.terminal_presets.map((p) => (
            <MenuItem
              key={p.id}
              icon={<SquareTerminal className="w-3.5 h-3.5" />}
              title={p.title}
              description={p.description}
              onClick={() => {
                ws.openTerminal({ title: p.title, initCmd: p.initCmd, kind: p.kind });
                close();
              }}
            />
          ))
        }
      </Menu>

      <Menu
        trigger={() => (
          <button className={btn}>
            <LayoutGrid className="w-3.5 h-3.5" /> Modüller
          </button>
        )}
      >
        {() => (
          <>
            {MODULES.filter((m) => !settings.disabled_modules.includes(m.id) && hasConnection(settings, m.requires)).map((m) => (
              <MenuItem
                key={m.id}
                icon={<m.icon className="w-3.5 h-3.5" />}
                title={m.title}
                description={m.description}
                checked={ws.isModuleOpen(m.id)}
                onClick={() => ws.toggleModule(m.id)}
              />
            ))}
            {plugins.length > 0 && (
              <>
                <div className="my-1 border-t border-[var(--border)]" />
                <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-[var(--txt-dim)]">Eklentiler</div>
                {plugins.map((p) => (
                  <MenuItem
                    key={p.id}
                    icon={<Plug className="w-3.5 h-3.5" />}
                    title={p.name}
                    description={p.description || `v${p.version}`}
                    checked={ws.isModuleOpen(`plugin-${p.id}`)}
                    onClick={() => ws.openPlugin(p)}
                  />
                ))}
              </>
            )}
            <div className="my-1 border-t border-[var(--border)]" />
            <MenuItem icon={<RotateCcw className="w-3.5 h-3.5" />} title="Düzeni sıfırla" description="Varsayılan yerleşime dön" onClick={ws.resetLayout} />
          </>
        )}
      </Menu>

      <Menu
        trigger={() => (
          <button className={btn}>
            <Layers className="w-3.5 h-3.5" /> Alanlar
          </button>
        )}
      >
        {(close) => (
          <div className="w-64">
            <form
              className="flex items-center gap-1.5 p-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = workspaceName.trim();
                if (!trimmed) return;
                ws.saveCurrentWorkspace(trimmed);
                setWorkspaceName("");
              }}
            >
              <input
                type="text"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="Çalışma alanı adı..."
                className="flex-1 min-w-0 px-2 py-1 rounded-lg text-xs bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--txt-main)] placeholder:text-[var(--txt-dim)] focus:outline-none focus:border-[var(--accent)]"
              />
              <button
                type="submit"
                disabled={!workspaceName.trim()}
                className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[var(--accent)] text-black hover:brightness-110 disabled:opacity-40 transition-all shrink-0"
              >
                Kaydet
              </button>
            </form>
            <div className="my-1 border-t border-[var(--border)]" />
            {ws.workspaces.length === 0 ? (
              <div className="px-2.5 py-2 text-[11px] text-[var(--txt-dim)]">Kayıtlı çalışma alanı yok</div>
            ) : (
              <div className="max-h-60 overflow-y-auto">
                {ws.workspaces.map((w) => (
                  <div
                    key={w.id}
                    onClick={() => {
                      ws.loadSavedWorkspace(w.id);
                      close();
                    }}
                    className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--surface-raised)] transition-colors cursor-pointer group"
                  >
                    <Layers className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-[var(--txt-main)] truncate">{w.name}</div>
                      <div className="text-[10px] text-[var(--txt-dim)]">{w.panelCount} panel</div>
                    </div>
                    <button
                      type="button"
                      title="Sil"
                      onClick={(e) => {
                        e.stopPropagation();
                        ws.deleteSavedWorkspace(w.id);
                      }}
                      className="p-1 rounded text-[var(--txt-dim)] hover:text-red-400 hover:bg-[var(--surface)] opacity-70 group-hover:opacity-100 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Menu>

      <button
        onClick={ws.openAgentSetup}
        className={btn}
        title="Ajan ve CLI kurulum sihirbazı (AGY, Claude Code, Codex)"
      >
        <Bot className="w-3.5 h-3.5 text-[var(--accent)]" /> Ajanlar
      </button>

      <div data-tauri-drag-region className="flex-1 min-w-3 h-full" />

      <button
        type="button"
        onClick={ws.openOmniBar}
        title="Komut paleti (Ctrl+K)"
        className="flex items-center gap-2 px-3 h-7 w-full max-w-[340px] min-w-[160px] rounded-lg border border-[var(--border)] bg-[var(--bg)]/80 hover:border-[var(--accent)]/50 text-[11px] text-[var(--txt-dim)] hover:text-[var(--txt-main)] transition-colors cursor-pointer"
      >
        <Search className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
        <span className="truncate">Komut çalıştır veya ara…</span>
        <kbd className="ml-auto px-1.5 py-0.5 rounded bg-[var(--surface-raised)] border border-[var(--border)] text-[10px] font-mono text-[var(--txt-muted)] shrink-0">
          Ctrl+K
        </kbd>
      </button>

      <div data-tauri-drag-region className="flex-1 min-w-3 h-full" />

      <button
        type="button"
        onClick={() => ws.openTerminal({ title: "Terminal", kind: "shell" })}
        className={btn}
        title="Yeni Terminal"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
      <button type="button" onClick={onSettings} className={btn} title="Ayarlar">
        <Settings className="w-3.5 h-3.5" />
      </button>
    </header>
  );
}
