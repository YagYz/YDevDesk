import { useEffect, useRef } from "react";
import { notify } from "./notify";
import { playChime } from "./sound";
import type { AgentStatus, HubStatus, NetworkData, NotificationSettings } from "../types";

type Snapshot = { agent: AgentStatus; hubStatus: HubStatus; network: NetworkData };

/** Durum geçişlerini izleyip (ajan bitti, kota azaldı, servis koptu) bildirim gönderir. */
export function useNotifications(s: Snapshot, cfg: NotificationSettings, ready: boolean) {
  const prev = useRef<{ working: boolean; quotaLow: boolean; hubDown: boolean; netDown: boolean } | null>(null);

  useEffect(() => {
    const working = s.agent.agent_state === "working";
    const quota = Math.min(s.agent.quota_5h_percent, s.agent.quota_weekly_percent);
    const quotaLow = quota <= cfg.quota_threshold;
    const hubDown = s.hubStatus === "error";
    const netDown = s.network.status === "offline";

    const p = prev.current;
    // İlk değerler ve ayarlar yüklenmeden önce bildirim üretme
    if (ready && p && cfg.enabled) {
      if (cfg.agent_done && p.working && !working) {
        notify("Ajan bitti", `${s.agent.model} görevini tamamladı.`);
        if (cfg.sound_enabled) playChime("done");
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
  }, [s.agent.agent_state, s.agent.quota_5h_percent, s.agent.quota_weekly_percent, s.agent.model, s.hubStatus, s.network.status, cfg, ready]);
}
