import { invoke } from "@tauri-apps/api/core";

export type SoundKind = "done" | "notify" | "notify2" | "warn";

function playWebAudioFallback(kind: SoundKind): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const notes =
      kind === "done"
        ? [523.25, 659.25, 783.99, 987.77]
        : kind === "notify"
          ? [880.0, 1318.51]
          : kind === "notify2"
            ? [587.33, 739.99, 880.0]
            : [659.25, 493.88];

    notes.forEach((freq, idx) => {
      const start = now + idx * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.08, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.36);
    });

    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 800);
  } catch {
    // Ses bağlamı yoksa sessizce geç
  }
}

export function playChime(kind: SoundKind = "done"): void {
  invoke("play_notification_sound", { kind }).catch(() => {
    playWebAudioFallback(kind);
  });
}
