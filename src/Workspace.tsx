import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewHeaderActionsProps, type IWatermarkPanelProps } from "dockview-react";
import { Maximize2, Minimize2, Plus, SquareTerminal } from "lucide-react";
import { WorkspaceContext, type WorkspaceActions } from "./context/WorkspaceContext";
import { terminalManager } from "./lib/terminalManager";
import { DOCK_COMPONENTS, TERMINAL_COMPONENT } from "./panels/registry";
import { addModuleDefault, buildDefaultLayout, clearSavedLayout, hasTerminal, LAYOUT_KEY, MAIN_TERMINAL_ID, newTerminalId, saveLayout } from "./lib/layout";
import { TitleBar } from "./components/TitleBar";
import { StatusBar } from "./components/StatusBar";
import { OmniBar } from "./components/OmniBar";
import { SettingsModal } from "./components/SettingsModal";
import { KnowledgeModal } from "./components/KnowledgeModal";
import type { Knowledge } from "./types";

function HeaderActions({ containerApi, group, panels }: IDockviewHeaderActionsProps) {
  const [maximized, setMaximized] = useState(false);
  const hasTerm = panels.some((p) => p.api.component === TERMINAL_COMPONENT);
  const btn = "p-1 rounded-md text-[var(--txt-muted)] hover:text-[var(--accent)] hover:bg-[var(--surface-raised)]";

  const toggleMax = () => {
    if (containerApi.hasMaximizedGroup()) {
      containerApi.exitMaximizedGroup();
      setMaximized(false);
    } else {
      containerApi.maximizeGroup(group.activePanel ?? group.panels[0]);
      setMaximized(true);
    }
  };

  return (
    <div className="flex items-center gap-0.5 pr-1.5 h-full">
      {hasTerm && (
        <button
          className={btn}
          title="Bu gruba yeni terminal ekle"
          onClick={() => {
            const id = newTerminalId();
            containerApi.addPanel({ id, component: TERMINAL_COMPONENT, title: "Terminal", params: { kind: "shell" }, renderer: "always", position: { referenceGroup: group.id } });
          }}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      )}
      <button className={btn} title={maximized ? "Küçült" : "Tam ekran yap"} onClick={toggleMax}>
        {maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function Watermark({ containerApi }: IWatermarkPanelProps) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-[var(--txt-dim)]">
      <SquareTerminal className="w-8 h-8" />
      <div className="text-xs">Açık panel yok</div>
      <button
        className="px-3 py-1.5 rounded-lg text-xs bg-[var(--accent)] text-black font-medium"
        onClick={() =>
          containerApi.addPanel({ id: newTerminalId(), component: TERMINAL_COMPONENT, title: "Terminal", params: { kind: "shell" }, renderer: "always" })
        }
      >
        Yeni terminal
      </button>
    </div>
  );
}

export default function Workspace() {
  const apiRef = useRef<DockviewApi | null>(null);
  const lastTerminalRef = useRef<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [showOmni, setShowOmni] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [knowledgeItem, setKnowledgeItem] = useState<Knowledge | null>(null);

  const syncOpen = useCallback(() => {
    const api = apiRef.current;
    if (api) setOpenIds(new Set(api.panels.map((p) => p.id)));
  }, []);

  const openTerminal = useCallback<WorkspaceActions["openTerminal"]>((opts = {}) => {
    const api = apiRef.current;
    if (!api) return;
    const id = newTerminalId();
    api.addPanel({
      id,
      component: TERMINAL_COMPONENT,
      title: opts.title ?? "Terminal",
      params: { initCmd: opts.initCmd, kind: opts.kind ?? "shell" },
      renderer: "always",
      position: opts.groupId ? { referenceGroup: opts.groupId } : undefined,
    });
    api.getPanel(id)?.api.setActive();
  }, []);

  const runInTerminal = useCallback((cmd: string) => {
    const api = apiRef.current;
    if (!api) return;
    const active = api.activePanel;
    const target =
      active && active.api.component === TERMINAL_COMPONENT
        ? active.id
        : lastTerminalRef.current && api.getPanel(lastTerminalRef.current)
          ? lastTerminalRef.current
          : null;
    if (target) {
      api.getPanel(target)?.api.setActive();
      terminalManager.write(target, cmd);
    } else {
      openTerminal({ title: "Terminal", initCmd: cmd });
    }
  }, [openTerminal]);

  const toggleModule = useCallback((id: string) => {
    const api = apiRef.current;
    if (!api) return;
    const existing = api.getPanel(id);
    if (existing) existing.api.close();
    else addModuleDefault(api, id);
  }, []);

  const resetLayout = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    clearSavedLayout();
    api.clear();
    buildDefaultLayout(api);
    syncOpen();
  }, [syncOpen]);

  const onReady = useCallback(
    (e: DockviewReadyEvent) => {
      const api = e.api;
      apiRef.current = api;

      let restored = false;
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved) {
        try {
          api.fromJSON(JSON.parse(saved));
          restored = api.panels.length > 0;
        } catch (err) {
          console.warn("Kayıtlı düzen yüklenemedi, varsayılana dönülüyor:", err);
          api.clear();
        }
      }
      if (!restored) buildDefaultLayout(api);
      else if (!hasTerminal(api)) {
        api.addPanel({ id: MAIN_TERMINAL_ID, component: TERMINAL_COMPONENT, title: "Terminal", params: { kind: "shell" }, renderer: "always" });
      }

      api.onDidRemovePanel((p) => {
        if (p.api.component === TERMINAL_COMPONENT) {
          terminalManager.dispose(p.id);
          if (lastTerminalRef.current === p.id) lastTerminalRef.current = null;
        }
        syncOpen();
      });
      api.onDidAddPanel(syncOpen);
      api.onDidActivePanelChange(({ panel: p }) => {
        if (p && p.api.component === TERMINAL_COMPONENT) lastTerminalRef.current = p.id;
      });
      api.onDidLayoutChange(() => {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => saveLayout(api), 400);
      });
      syncOpen();
    },
    [syncOpen],
  );

  // Ctrl/Cmd+K: komut paleti
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        setShowOmni((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const actions = useMemo<WorkspaceActions>(
    () => ({
      openTerminal,
      runInTerminal,
      toggleModule,
      isModuleOpen: (id) => openIds.has(id),
      resetLayout,
      openKnowledge: setKnowledgeItem,
      openOmniBar: () => setShowOmni(true),
    }),
    [openTerminal, runInTerminal, toggleModule, openIds, resetLayout],
  );


  return (
    <WorkspaceContext.Provider value={actions}>
      <div className="h-full w-full flex flex-col bg-[var(--bg)]">
        <TitleBar onSettings={() => setShowSettings(true)} />
        <main className="flex-1 min-h-0">
          <DockviewReact
            className="dockview-theme-ydesk"
            components={DOCK_COMPONENTS}
            rightHeaderActionsComponent={HeaderActions}
            watermarkComponent={Watermark}
            onReady={onReady}
          />
        </main>
        <StatusBar />
      </div>
      {showOmni && <OmniBar onClose={() => setShowOmni(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {knowledgeItem && <KnowledgeModal item={knowledgeItem} onClose={() => setKnowledgeItem(null)} />}
    </WorkspaceContext.Provider>
  );
}
