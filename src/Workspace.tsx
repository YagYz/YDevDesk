import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewHeaderActionsProps, type IWatermarkPanelProps } from "dockview-react";
import { Maximize2, Minimize2, Plus } from "lucide-react";
import { WorkspaceContext, type WorkspaceActions } from "./context/WorkspaceContext";
import { terminalManager } from "./lib/terminalManager";
import { DOCK_COMPONENTS, TERMINAL_COMPONENT } from "./panels/registry";
import { addModuleDefault, buildDefaultLayout, clearSavedLayout, hasTerminal, LAYOUT_KEY, MAIN_TERMINAL_ID, newTerminalId, saveLayout } from "./lib/layout";
import { TitleBar } from "./components/TitleBar";
import { StatusBar } from "./components/StatusBar";
import { OmniBar } from "./components/OmniBar";
import { SettingsModal, type SettingsTab } from "./components/SettingsModal";
import { UpdatePopup } from "./components/UpdatePopup";
import { AgentSetupModal } from "./components/AgentSetupModal";
import { api } from "./lib/tauri";
import { KnowledgeModal } from "./components/KnowledgeModal";
import { panelHistory } from "./lib/panelHistory";
import {
  markSessionCleanExit,
  markSessionRunning,
  readPreviousCrashSnapshot,
  snapshotFromDockview,
  type RecoverySnapshot,
} from "./lib/recovery";
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
      <img
        src="/logo-128.png"
        alt="YDevDesk"
        className="w-20 h-20 rounded-2xl object-contain shadow-2xl border border-[var(--border-glow)] opacity-90 hover:opacity-100 transition-opacity"
      />
      <div className="text-xs font-medium text-[var(--txt-muted)]">Açık panel yok</div>
      <button
        className="px-3.5 py-1.5 rounded-lg text-xs bg-[var(--accent)] text-black font-semibold hover:brightness-110 transition-all shadow"
        onClick={() =>
          containerApi.addPanel({ id: newTerminalId(), component: TERMINAL_COMPONENT, title: "Terminal", params: { kind: "shell" }, renderer: "always" })
        }
      >
        Yeni Terminal
      </button>
    </div>
  );
}

export default function Workspace() {
  const apiRef = useRef<DockviewApi | null>(null);
  const lastTerminalRef = useRef<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const restoringRef = useRef(false);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [showOmni, setShowOmni] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [showAgentSetup, setShowAgentSetup] = useState(false);
  const [knowledgeItem, setKnowledgeItem] = useState<Knowledge | null>(null);
  const [crashBanner, setCrashBanner] = useState<RecoverySnapshot | null>(null);

  const syncOpen = useCallback(() => {
    const api = apiRef.current;
    if (api) setOpenIds(new Set(api.panels.map((p) => p.id)));
  }, []);

  const openTerminal = useCallback<WorkspaceActions["openTerminal"]>((opts = {}) => {
    const api = apiRef.current;
    if (!api) return;
    const id = newTerminalId();
    const existingTerm = !opts.groupId
      ? (lastTerminalRef.current && api.getPanel(lastTerminalRef.current)) ||
        api.getPanel(MAIN_TERMINAL_ID) ||
        api.panels.find((p) => p.api.component === TERMINAL_COMPONENT)
      : undefined;
    const targetGroupId = opts.groupId ?? existingTerm?.group?.id;
    const activeGroupId = api.activeGroup?.id;
    const position = targetGroupId
      ? { referenceGroup: targetGroupId }
      : activeGroupId
        ? { referenceGroup: activeGroupId, direction: "right" as const }
        : undefined;
    api.addPanel({
      id,
      component: TERMINAL_COMPONENT,
      title: opts.title ?? "Terminal",
      params: { initCmd: opts.initCmd, kind: opts.kind ?? "shell" },
      renderer: "always",
      position,
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
      const prevCrash = readPreviousCrashSnapshot();

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

      panelHistory.captureSnapshot(api);
      markSessionRunning(snapshotFromDockview(api));
      if (prevCrash) {
        setCrashBanner(prevCrash);
      }

      api.onDidRemovePanel((p) => {
        if (restoringRef.current) return;
        panelHistory.recordClosedPanel(api, p);
        if (p.api.component === TERMINAL_COMPONENT) {
          terminalManager.dispose(p.id);
          if (lastTerminalRef.current === p.id) lastTerminalRef.current = null;
        }
        markSessionRunning(snapshotFromDockview(api));
        syncOpen();
      });
      api.onDidAddPanel(() => {
        if (restoringRef.current) return;
        panelHistory.captureSnapshot(api);
        markSessionRunning(snapshotFromDockview(api));
        syncOpen();
      });
      api.onDidActivePanelChange(({ panel: p }) => {
        if (p && p.api.component === TERMINAL_COMPONENT) lastTerminalRef.current = p.id;
      });
      api.onDidLayoutChange(() => {
        panelHistory.captureSnapshot(api);
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          saveLayout(api);
          markSessionRunning(snapshotFromDockview(api));
        }, 400);
      });
      syncOpen();
    },
    [syncOpen],
  );

  // Ctrl/Cmd+K: komut paleti, Ctrl/Cmd+Shift+T: son kapanan paneli geri aç
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        setShowOmni((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        e.stopPropagation();
        const dock = apiRef.current;
        if (
          dock &&
          panelHistory.restoreClosedPanel(dock, 0, (v) => {
            restoringRef.current = v;
          })
        ) {
          syncOpen();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [syncOpen]);

  // Temiz kapanışta son düzeni hemen yaz ve çökme bayrağını temizle
  useEffect(() => {
    const onBeforeUnload = () => {
      const dock = apiRef.current;
      if (!dock) return;
      saveLayout(dock);
      markSessionCleanExit(snapshotFromDockview(dock));
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);
  // İlk açılışta eksik ajan kontrolü ve karşılama sihirbazı
  useEffect(() => {
    const hide = localStorage.getItem("ydevdesk_hide_agent_setup_on_launch") === "true";
    if (!hide) {
      api.checkAgentEnvironment()
        .then((env) => {
          if (env.agents.some((a) => !a.is_installed)) {
            setShowAgentSetup(true);
          }
        })
        .catch(console.error);
    }
  }, []);


  const actions = useMemo<WorkspaceActions>(
    () => ({
      openTerminal,
      runInTerminal,
      toggleModule,
      isModuleOpen: (id) => openIds.has(id),
      resetLayout,
      openKnowledge: setKnowledgeItem,
      openOmniBar: () => setShowOmni(true),
      openAgentSetup: () => setShowAgentSetup(true),
    }),
    [openTerminal, runInTerminal, toggleModule, openIds, resetLayout],
  );


  return (
    <WorkspaceContext.Provider value={actions}>
      <div className="h-full w-full flex flex-col bg-[var(--bg)]">
        <TitleBar onSettings={() => setSettingsTab("connections")} />
        {crashBanner && (
          <div className="flex items-center justify-between gap-3 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/30 text-xs text-amber-200">
            <span>
              Önceki oturum beklenmedik şekilde kapandı ({crashBanner.panels.length} panel kayıtlı).
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  const dock = apiRef.current;
                  if (dock) {
                    for (const p of crashBanner.panels) {
                      if (!dock.getPanel(p.id)) {
                        dock.addPanel({
                          id: p.id,
                          component: p.component,
                          title: p.title,
                          params: p.params,
                          renderer: p.component === TERMINAL_COMPONENT ? "always" : undefined,
                        });
                      }
                    }
                    syncOpen();
                  }
                  setCrashBanner(null);
                }}
                className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-100 hover:bg-amber-500/30 cursor-pointer"
              >
                Eksik Panelleri Kurtar
              </button>
              <button
                type="button"
                onClick={() => setCrashBanner(null)}
                className="px-2 py-0.5 rounded text-[var(--txt-dim)] hover:text-[var(--txt-main)] cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        )}
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
      {settingsTab && <SettingsModal initialTab={settingsTab} onClose={() => setSettingsTab(null)} />}
      {showAgentSetup && <AgentSetupModal onClose={() => setShowAgentSetup(false)} />}
      {knowledgeItem && <KnowledgeModal item={knowledgeItem} onClose={() => setKnowledgeItem(null)} />}
      <UpdatePopup onOpenDetails={() => setSettingsTab("update")} />
    </WorkspaceContext.Provider>
  );
}
