import type { DockviewApi, SerializedDockview } from "dockview-react";

export type SavedWorkspace = {
  id: string;
  name: string;
  layout: SerializedDockview;
  panelCount: number;
  savedAt: number;
};

export const WORKSPACES_KEY = "ydevdesk_workspaces_v1";

function persistWorkspaces(list: SavedWorkspace[]) {
  try {
    localStorage.setItem(WORKSPACES_KEY, JSON.stringify(list));
  } catch (e) {
    console.error("Çalışma alanları kaydedilemedi:", e);
  }
}

export function loadWorkspaces(): SavedWorkspace[] {
  try {
    const raw = localStorage.getItem(WORKSPACES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedWorkspace[]) : [];
  } catch {
    return [];
  }
}

export function saveWorkspacePreset(name: string, api: DockviewApi): SavedWorkspace[] {
  const trimmed = name.trim();
  const current = loadWorkspaces();
  if (!trimmed) return current;

  const entry: SavedWorkspace = {
    id: `ws-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name: trimmed,
    layout: api.toJSON(),
    panelCount: api.panels.length,
    savedAt: Date.now(),
  };

  const next = [entry, ...current];
  persistWorkspaces(next);
  return next;
}

export function deleteWorkspacePreset(id: string): SavedWorkspace[] {
  const next = loadWorkspaces().filter((w) => w.id !== id);
  persistWorkspaces(next);
  return next;
}
