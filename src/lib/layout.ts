import type { DockviewApi } from "dockview-react";
import { MODULE_MAP, TERMINAL_COMPONENT } from "../panels/registry";

export const LAYOUT_KEY = "ydevdesk_layout_v2";
export const MAIN_TERMINAL_ID = "term-main";

export function newTerminalId(): string {
  return `term-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function saveLayout(api: DockviewApi) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON()));
  } catch (e) {
    console.error("Düzen kaydedilemedi:", e);
  }
}

export function clearSavedLayout() {
  localStorage.removeItem(LAYOUT_KEY);
}

export function hasTerminal(api: DockviewApi): boolean {
  return api.panels.some((p) => p.api.component === TERMINAL_COMPONENT);
}

function addModule(api: DockviewApi, id: string, position?: Parameters<DockviewApi["addPanel"]>[0]["position"]) {
  const def = MODULE_MAP[id];
  api.addPanel({ id, component: id, title: def.title, position, initialWidth: def.width });
}

/** Varsayılan yerleşim: ortada terminal, solda oturum/eylemler, sağda telemetri ve veri modülleri. */
export function buildDefaultLayout(api: DockviewApi) {
  api.addPanel({
    id: MAIN_TERMINAL_ID,
    component: TERMINAL_COMPONENT,
    title: "Terminal",
    params: { kind: "shell" },
    renderer: "always",
  });

  addModule(api, "agent_usage", { referencePanel: MAIN_TERMINAL_ID, direction: "right" });
  addModule(api, "network", { referencePanel: "agent_usage", direction: "below" });
  addModule(api, "recent_tools", { referencePanel: "network", direction: "below" });
  addModule(api, "notes", { referencePanel: "recent_tools", direction: "within" });
  addModule(api, "knowledge", { referencePanel: "recent_tools", direction: "within" });
  addModule(api, "file_heat", { referencePanel: "recent_tools", direction: "within" });
  api.getPanel("recent_tools")?.api.setActive();

  addModule(api, "sessions", { referencePanel: MAIN_TERMINAL_ID, direction: "left" });
  addModule(api, "quick_actions", { referencePanel: "sessions", direction: "below" });

  api.getPanel("agent_usage")?.api.setSize({ width: 320, height: 250 });
  api.getPanel("network")?.api.setSize({ height: 240 });
  api.getPanel("sessions")?.api.setSize({ width: 250 });
  api.getPanel(MAIN_TERMINAL_ID)?.api.setActive();
}

export function addModuleDefault(api: DockviewApi, id: string) {
  const anchor = api.panels.find((p) => p.api.component === TERMINAL_COMPONENT) ?? api.panels[0];
  addModule(api, id, anchor ? { referencePanel: anchor.id, direction: "right" } : undefined);
}
