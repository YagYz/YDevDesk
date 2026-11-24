import { useEffect, useRef } from "react";
import { notify } from "./notify";
import { playChime } from "./sound";
import type { AgentStatus, HubStatus, NetworkData, NotificationSettings } from "../types";

type Snapshot = { agent: AgentStatus; hubStatus: HubStatus; network: NetworkData };

/**
 * Ajan bu süre boyunca boşta kalırsa "bitti" bildirimi gönderilir. "Boşta" artık transkriptteki tur sonu
 * işaretinden gelir (uzun araç/düşünme sahte boşta üretmez); bu süre yalnızca tur sonu ile sıradaki
 * (kuyruğa alınmış) isteğin başlaması arasındaki kısa boşluğu — 2 sn'lik polling dahil — tolere eder.
 */
const DONE_DEBOUNCE_MS = 4_000;

/** Çalışan ajanların model adları; hiçbiri yoksa üst düzey model. */
function workingLabel(agent: AgentStatus): string {
  const names = (agent.agents ?? []).map((a) => a.model).filter(Boolean);
  return names.length > 0 ? names.join(" + ") : agent.model;
}

/** Durum geçişlerini izleyip (ajan bitti, kota azaldı, servis koptu) bildirim gönderir. */
export function useNotifications(s: Snapshot, cfg: NotificationSettings, ready: boolean) {
  const prev = useRef<{ working: boolean; quotaLow: boolean; hubDown: boolean; netDown: boolean } | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWorkingLabel = useRef("");
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  // Bileşen kapanırken bekleyen bildirimi iptal et
  useEffect(
    () => () => {
      if (doneTimer.current) clearTimeout(doneTimer.current);
    },
    [],
  );

  useEffect(() => {
    const working = s.agent.agent_state === "working";
    const quota = Math.min(s.agent.quota_5h_percent, s.agent.quota_weekly_percent);
    const quotaLow = quota <= cfg.quota_threshold;
    const hubDown = s.hubStatus === "error";
    const netDown = s.network.status === "offline";

    if (working) {
      lastWorkingLabel.current = workingLabel(s.agent);
      // Ajan tekrar çalışmaya başladı: bekleyen "bitti" bildirimini iptal et
      if (doneTimer.current) {
        clearTimeout(doneTimer.current);
        doneTimer.current = null;
      }
    }

    const p = prev.current;
    // İlk değerler ve ayarlar yüklenmeden önce bildirim üretme
    if (ready && p && cfg.enabled) {
      if (cfg.agent_done && p.working && !working && !doneTimer.current) {
        doneTimer.current = setTimeout(() => {
          doneTimer.current = null;
          const c = cfgRef.current;
          if (!c.enabled || !c.agent_done) return;
          notify("Ajan bitti", `${lastWorkingLabel.current} görevini tamamladı.`);
          if (c.sound_enabled) playChime("done");
        }, DONE_DEBOUNCE_MS);
      }
      if (cfg.quota_low && !p.quotaLow && quotaLow) {
        notify("Kota azaldı", `Kalan kota %${Math.round(quota)}.`);
        if (cfg.sound_enabled) playChime(cfg.sound_preset ?? "notify2");
      }
      const hubTriggered = !p.hubDown && hubDown;
      const netTriggered = !p.netDown && netDown;
      if (cfg.service_down && (hubTriggered || netTriggered)) {
        if (hubTriggered) notify("YDevHub koptu", "Servise ulaşılamıyor.");
        if (netTriggered) notify("YNetMon koptu", "Servise ulaşılamıyor.");
        if (cfg.sound_enabled) playChime("warn");
      }
    }
    prev.current = { working, quotaLow, hubDown, netDown };
  }, [s.agent.agent_state, s.agent.agents, s.agent.quota_5h_percent, s.agent.quota_weekly_percent, s.agent.model, s.hubStatus, s.network.status, cfg, ready]);
}
