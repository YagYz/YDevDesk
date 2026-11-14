import type { DockviewApi } from "dockview-react";

export interface RecoveryPanelInfo {
  id: string;
  component: string;
  title: string;
  params?: Record<string, unknown>;
}

export interface RecoverySnapshot {
  savedAt: number;
  cleanExit: boolean;
  panels: RecoveryPanelInfo[];
}

export const RECOVERY_KEY = "ydevdesk_recovery_v1";

function writeSnapshot(cleanExit: boolean, panels: RecoveryPanelInfo[]) {
  try {
    const snapshot: RecoverySnapshot = {
      savedAt: Date.now(),
      cleanExit,
      panels,
    };
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(snapshot));
  } catch (e) {
    console.error("Kurtarma anlık görüntüsü yazılamadı:", e);
  }
}

export function markSessionRunning(panels: RecoveryPanelInfo[]) {
  writeSnapshot(false, panels);
}

export function markSessionCleanExit(panels: RecoveryPanelInfo[]) {
  writeSnapshot(true, panels);
}

export function readPreviousCrashSnapshot(): RecoverySnapshot | null {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RecoverySnapshot>;
    if (
      parsed &&
      parsed.cleanExit === false &&
      Array.isArray(parsed.panels) &&
      parsed.panels.length > 0 &&
      typeof parsed.savedAt === "number"
    ) {
      return {
        savedAt: parsed.savedAt,
        cleanExit: false,
        panels: parsed.panels,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function snapshotFromDockview(api: DockviewApi): RecoveryPanelInfo[] {
  return api.panels.map((p) => ({
    id: p.id,
    component: p.api.component,
    title: p.title ?? p.id,
    params: p.params,
  }));
}
