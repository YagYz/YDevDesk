export const AGENT_META: Record<string, { label: string; badgeClass: string }> = {
  agy: {
    label: "AGY",
    badgeClass: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  },
  claude: {
    label: "Claude",
    badgeClass: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
  codex: {
    label: "Codex",
    badgeClass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  project: {
    label: "Proje",
    badgeClass: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  },
};

export function getAgentMeta(agent: string) {
  return (
    AGENT_META[agent] ?? {
      label: agent.toUpperCase(),
      badgeClass: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
    }
  );
}
