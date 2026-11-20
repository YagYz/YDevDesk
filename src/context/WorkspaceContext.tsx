import { createContext, useContext } from "react";
import type { SavedWorkspace } from "../lib/workspaces";
import type { InstalledPlugin, Knowledge } from "../types";

export type WorkspaceActions = {
  /** Yeni terminal paneli açar; hedef grup verilirse o grupta sekme olarak ekler. */
  openTerminal: (opts?: { title?: string; initCmd?: string; kind?: "shell" | "agent" | "server"; groupId?: string }) => void;
  /** Markdown dosyasını merkez çalışma grubunda yeni sekme olarak açar. */
  openMarkdown: (opts: { path: string; title?: string; agent?: string; groupId?: string; content?: string }) => void;
  /** Kurulu bir harici eklentiyi (plugin) Dockview paneli olarak açar/odaklar. */
  openPlugin: (plugin: InstalledPlugin) => void;
  /** Etkin terminale komut yazar; terminal yoksa yeni terminal açıp komutu orada çalıştırır. */
  runInTerminal: (cmd: string) => void;
  toggleModule: (id: string) => void;
  isModuleOpen: (id: string) => boolean;
  resetLayout: () => void;
  workspaces: SavedWorkspace[];
  saveCurrentWorkspace: (name: string) => void;
  loadSavedWorkspace: (id: string) => void;
  deleteSavedWorkspace: (id: string) => void;
  openKnowledge: (kb: Knowledge) => void;
  openOmniBar: () => void;
  openAgentSetup: () => void;
};

export const WorkspaceContext = createContext<WorkspaceActions | null>(null);

export function useWorkspace(): WorkspaceActions {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace yalnızca Workspace içinde kullanılabilir");
  return ctx;
}
