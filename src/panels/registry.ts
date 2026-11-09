import type { FunctionComponent } from "react";
import { Activity, Bot, Brain, Flame, Network, GitBranch, ListTodo, StickyNote, Users, Zap, type LucideIcon } from "lucide-react";
import AgentUsagePanel from "./AgentUsagePanel";
import SessionsPanel from "./SessionsPanel";
import ToolsPanel from "./ToolsPanel";
import FileHeatPanel from "./FileHeatPanel";
import NetworkPanel from "./NetworkPanel";
import GitPanel from "./GitPanel";
import TasksPanel from "./TasksPanel";
import NotesPanel from "./NotesPanel";
import KnowledgePanel from "./KnowledgePanel";
import QuickActionsPanel from "./QuickActionsPanel";
import TerminalPanel from "./TerminalPanel";
import type { ConnectionType } from "../types";

export type ModuleDef = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  component: FunctionComponent<any>;
  width: number;
  /** Modülün çalışması için gereken bağlantı tipi; yoksa menüde pasif görünür. */
  requires?: ConnectionType;
};

/** Eklenip kaldırılabilen veri modülleri. Her biri tek örnek (singleton) çalışır. */
export const MODULES: ModuleDef[] = [
  { id: "agent_usage", title: "Ajan Durumu", description: "Model, token, maliyet, kota", icon: Bot, component: AgentUsagePanel, width: 320 },
  { id: "network", title: "YNetMon Ağ", description: "Canlı trafik ve cihazlar", icon: Network, component: NetworkPanel, width: 320, requires: "ynetmon" },
  { id: "recent_tools", title: "Araç Akışı", description: "AGY son araç çağrıları", icon: Activity, component: ToolsPanel, width: 320 },
  { id: "file_heat", title: "Dosya Yoğunluğu", description: "En çok dokunulan dosyalar", icon: Flame, component: FileHeatPanel, width: 320 },
  { id: "sessions", title: "Oturumlar", description: "AGY oturumları ve alt ajanlar", icon: Users, component: SessionsPanel, width: 260 },
  { id: "notes", title: "Notlar", description: "YDevHub günlük notları", icon: StickyNote, component: NotesPanel, width: 320, requires: "ydevhub" },
  { id: "tasks", title: "Görevler", description: "YDevHub görevleri: listele, ekle, tamamla", icon: ListTodo, component: TasksPanel, width: 320, requires: "ydevhub" },
  { id: "git", title: "Git", description: "Proje branch, değişen dosyalar, PR durumu", icon: GitBranch, component: GitPanel, width: 320, requires: "projects-root" },
  { id: "knowledge", title: "Bilgi Ağı", description: "YDevHub hafıza kayıtları", icon: Brain, component: KnowledgePanel, width: 320, requires: "ydevhub" },
  { id: "quick_actions", title: "Hızlı Eylemler", description: "Terminale tek tık komut", icon: Zap, component: QuickActionsPanel, width: 260 },
];

export const MODULE_MAP = Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<string, ModuleDef>;

export const TERMINAL_COMPONENT = "terminal";

export const DOCK_COMPONENTS: Record<string, FunctionComponent<any>> = {
  [TERMINAL_COMPONENT]: TerminalPanel,
  ...Object.fromEntries(MODULES.map((m) => [m.id, m.component])),
};
