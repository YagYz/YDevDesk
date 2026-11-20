import { useMemo } from "react";
import type { FunctionComponent } from "react";
import type { LucideIcon } from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";
import { useSettings } from "../context/SettingsContext";
import { notify } from "../lib/notify";
import type { Connection, ConnectionType } from "../types";

export { useVisibilityPoll } from "../lib/useVisibilityPoll";

export type ModuleCommand = {
  id: string;
  title: string;
  subtitle?: string;
  run: () => void;
};

/**
 * Her modülün `src/modules/<id>/manifest.ts` dosyasında dışa aktardığı sözleşme.
 * Klasöre yeni bir `manifest.ts` eklemek modülü uygulamaya otomatik olarak kaydeder.
 */
export type ModuleManifest = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  component: FunctionComponent<any>;
  width: number;
  /** Menü sıralama önceliği (küçük değer üstte görünür; varsayılan 100). */
  order?: number;
  /** Modülün çalışması için gereken bağlantı tipi; yoksa menüde pasif görünür. */
  requires?: ConnectionType;
};

export type ModuleStorage = {
  get: <T>(key: string, fallback: T) => T;
  set: (key: string, value: unknown) => void;
  remove: (key: string) => void;
};

export type ModuleSDK = {
  terminal: {
    run: (cmd: string) => void;
    open: (opts?: { title?: string; initCmd?: string; kind?: "shell" | "agent" | "server"; groupId?: string }) => void;
  };
  markdown: {
    open: (opts: { path: string; title?: string; agent?: string; groupId?: string; content?: string }) => void;
  };
  notify: (title: string, body: string) => Promise<void>;
  storage: ModuleStorage;
  connections: {
    all: Connection[];
    byType: (type: ConnectionType) => Connection[];
    projectRoots: string[];
  };
};

/**
 * Harici veya yerleşik modüllerin çekirdek iç yapısına dokunmadan
 * terminal, markdown, bildirim, bağlantı ve izole depolamaya erişmesini sağlayan SDK hook'u.
 */
export function useModuleSDK(moduleId = "global"): ModuleSDK {
  const { runInTerminal, openTerminal, openMarkdown } = useWorkspace();
  const { settings, projectRoots } = useSettings();

  return useMemo<ModuleSDK>(() => {
    const prefix = `ydevdesk_mod_${moduleId}_`;
    return {
      terminal: {
        run: runInTerminal,
        open: openTerminal,
      },
      markdown: {
        open: openMarkdown,
      },
      notify,
      storage: {
        get: <T,>(key: string, fallback: T): T => {
          try {
            const raw = localStorage.getItem(prefix + key);
            return raw === null ? fallback : (JSON.parse(raw) as T);
          } catch {
            return fallback;
          }
        },
        set: (key: string, value: unknown) => {
          try {
            localStorage.setItem(prefix + key, JSON.stringify(value));
          } catch {
            /* depolama doluysa sessiz */
          }
        },
        remove: (key: string) => {
          try {
            localStorage.removeItem(prefix + key);
          } catch {
            /* sessiz */
          }
        },
      },
      connections: {
        all: settings.connections,
        byType: (type: ConnectionType) => settings.connections.filter((c) => c.type === type),
        projectRoots,
      },
    };
  }, [moduleId, runInTerminal, openTerminal, openMarkdown, settings.connections, projectRoots]);
}
