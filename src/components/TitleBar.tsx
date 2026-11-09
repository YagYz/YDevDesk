import { Command, LayoutGrid, Plus, RotateCcw, Settings, SquareTerminal } from "lucide-react";
import { api } from "../lib/tauri";
import { useWorkspace } from "../context/WorkspaceContext";
import { MODULES } from "../panels/registry";
import { useData } from "../context/DataContext";
import { CONNECTION_TYPES, hasConnection } from "../lib/settings";
import { Menu, MenuItem } from "./Menu";

const btn = "flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11px] text-[var(--txt-muted)] hover:text-[var(--txt-main)] hover:bg-[var(--surface-raised)] transition-colors";

export function TitleBar({ onSettings }: { onSettings: () => void }) {
  const ws = useWorkspace();
  const { settings } = useData();
  const run = (fn: () => Promise<void>) => () => fn().catch(console.error);

  return (
    <header data-tauri-drag-region className="h-10 shrink-0 flex items-center gap-2 pl-3 pr-2 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-1.5 mr-1" data-tauri-drag-region>
        <button onClick={run(api.windowClose)} className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-125" title="Kapat" />
        <button onClick={run(api.windowMinimize)} className="w-3 h-3 rounded-full bg-[#febc2e] hover:brightness-125" title="Küçült" />
        <button onClick={run(api.windowToggleMaximize)} className="w-3 h-3 rounded-full bg-[#28c840] hover:brightness-125" title="Büyüt" />
      </div>
      <span data-tauri-drag-region className="text-xs font-semibold tracking-wide text-[var(--txt-main)] pr-2">
        YDev<span className="text-[var(--accent)]">Desk</span>
      </span>

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
            {MODULES.filter((m) => !settings.disabled_modules.includes(m.id)).map((m) => {
              const ok = hasConnection(settings, m.requires);
              return (
                <MenuItem
                  key={m.id}
                  icon={<m.icon className="w-3.5 h-3.5" />}
                  title={m.title}
                  description={ok ? m.description : `Bağlantı gerekli: ${CONNECTION_TYPES[m.requires!].label}`}
                  checked={ws.isModuleOpen(m.id)}
                  disabled={!ok}
                  onClick={() => ws.toggleModule(m.id)}
                />
              );
            })}
            <div className="my-1 border-t border-[var(--border)]" />
            <MenuItem icon={<RotateCcw className="w-3.5 h-3.5" />} title="Düzeni sıfırla" description="Varsayılan yerleşime dön" onClick={ws.resetLayout} />
          </>
        )}
      </Menu>

      <div data-tauri-drag-region className="flex-1 h-full" />

      <button onClick={ws.openOmniBar} className={btn} title="Komut paleti">
        <Command className="w-3.5 h-3.5" /> Ctrl+K
      </button>
      <button onClick={onSettings} className={btn} title="Ayarlar">
        <Settings className="w-3.5 h-3.5" />
      </button>
    </header>
  );
}
