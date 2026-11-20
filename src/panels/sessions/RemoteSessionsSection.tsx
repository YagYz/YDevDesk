import { formatAgo } from "../../lib/format";
import { getAgentMeta } from "./meta";
import type { SessionPrefs } from "../../types";

export type RemoteSessionEntry = {
  device_id: string;
  device_name: string;
  agent: string;
  session_id: string;
  masked_id: string;
  title: string;
  updated_at: number;
};

type Props = {
  sessions: RemoteSessionEntry[];
  prefs: SessionPrefs;
  onNotice: (msg: string) => void;
};

export function RemoteSessionsSection({ sessions, prefs, onNotice }: Props) {
  if (sessions.length === 0) return null;

  return (
    <section>
      <div className="text-[10px] uppercase tracking-wider text-[var(--txt-dim)] mb-1.5">
        Diğer Cihazlardaki Oturumlar
      </div>
      <ul className="space-y-1.5">
        {sessions.map((rs) => {
          const meta = getAgentMeta(rs.agent);
          const key = `${rs.agent}:${rs.session_id}`;
          const displayTitle = prefs.aliases[key] || rs.title || `${meta.label} Oturumu`;
          const agoSecs = Math.max(0, Math.floor((Date.now() - rs.updated_at) / 1000));
          const notice = `Bu oturum yalnızca '${rs.device_name}' cihazında yerel olarak başlatılabilir.`;
          return (
            <li key={`${rs.device_id}:${key}`}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onNotice(notice)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onNotice(notice);
                  }
                }}
                className="rounded-md px-2.5 py-2 bg-[var(--surface-raised)]/60 border border-[var(--border)] opacity-85 hover:opacity-100 transition-opacity cursor-not-allowed"
              >
                <div className="flex items-center gap-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${meta.badgeClass}`}>
                    {meta.label}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--txt-dim)]">{rs.masked_id}</span>
                  <span className="px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[9px] text-[var(--txt-muted)]">
                    {rs.device_name}
                  </span>
                  <span className="ml-auto text-[10px] text-[var(--txt-dim)] font-mono shrink-0">
                    {formatAgo(agoSecs)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-[var(--txt-main)] font-medium truncate">{displayTitle}</div>
                <div className="mt-1 text-[10px] text-[var(--txt-dim)]">
                  Başka cihazda ({rs.device_name}) · Bu cihazda başlatılamaz
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
