import type { FunctionComponent } from "react";
import TerminalPanel from "./TerminalPanel";
import MarkdownPanel from "./MarkdownPanel";
import PluginPanel from "./PluginPanel";
import type { ModuleManifest } from "../sdk/moduleSdk";

export type ModuleDef = ModuleManifest;

const discovered = import.meta.glob<{ default: ModuleManifest }>("../modules/*/manifest.ts", {
  eager: true,
});

/**
 * `src/modules/<id>/manifest.ts` dosyalarından otomatik keşfedilen veri modülleri.
 * Yeni modül eklemek için ilgili klasörde bir `manifest.ts` oluşturmak yeterlidir.
 */
export const MODULES: ModuleDef[] = Object.values(discovered)
  .map((mod) => mod.default)
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

export const MODULE_MAP = Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<string, ModuleDef>;

export const TERMINAL_COMPONENT = "terminal";
export const MARKDOWN_COMPONENT = "markdown";
export const PLUGIN_COMPONENT = "plugin";

export const DOCK_COMPONENTS: Record<string, FunctionComponent<any>> = {
  [TERMINAL_COMPONENT]: TerminalPanel,
  [MARKDOWN_COMPONENT]: MarkdownPanel,
  [PLUGIN_COMPONENT]: PluginPanel,
  ...Object.fromEntries(MODULES.map((m) => [m.id, m.component])),
};
