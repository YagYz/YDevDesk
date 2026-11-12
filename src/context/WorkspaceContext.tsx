import { createContext, useContext } from "react";
import type { Knowledge } from "../types";

export type WorkspaceActions = {
  /** Yeni terminal paneli açar; hedef grup verilirse o grupta sekme olarak ekler. */
  openTerminal: (opts?: { title?: string; initCmd?: string; kind?: "shell" | "agent" | "server"; groupId?: string }) => void;
  /** Etkin terminale komut yazar; terminal yoksa yeni terminal açıp komutu orada çalıştırır. */
  runInTerminal: (cmd: string) => void;
  toggleModule: (id: string) => void;
  isModuleOpen: (id: string) => boolean;
  resetLayout: () => void;
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
