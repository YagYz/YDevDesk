import { GitBranch, GitCompare, Server, Zap } from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";
import { PanelBody } from "../components/ui";

const ACTIONS = [
  { label: "ydev status", cmd: "ydev status", icon: Zap },
  { label: "git status", cmd: "git status -s", icon: GitBranch },
  { label: "git diff --stat", cmd: "git diff --stat", icon: GitCompare },
  { label: "docker ps (debian)", cmd: "ssh debian 'docker ps --format \"table {{.Names}}\\t{{.Status}}\"'", icon: Server },
];

export default function QuickActionsPanel() {
  const { runInTerminal } = useWorkspace();
  return (
    <PanelBody>
      <div className="text-[10px] text-[var(--txt-dim)] mb-2">Etkin terminalde çalıştırır.</div>
      <div className="grid gap-1.5">
        {ACTIONS.map(({ label, cmd, icon: Icon }) => (
          <button
            key={label}
            onClick={() => runInTerminal(cmd)}
            className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs text-left bg-[var(--surface-raised)] border border-[var(--border)] hover:border-[var(--accent)]/50 hover:text-[var(--accent)] transition-colors"
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="font-mono">{label}</span>
          </button>
        ))}
      </div>
    </PanelBody>
  );
}
