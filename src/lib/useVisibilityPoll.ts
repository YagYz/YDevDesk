import { useEffect, useRef } from "react";

/**
 * Pencere görünürken (`!document.hidden`) belirli aralıklarla `callback` çalıştırır.
 * Pencere gizlendiğinde/küçültüldüğünde gereksiz IPC/HTTP/CPU kullanımını durdurur;
 * tekrar görünür olduğunda anında tazeler.
 */
export function useVisibilityPoll(
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let busy = false;

    const run = async () => {
      if (!alive || busy || document.hidden) return;
      busy = true;
      try {
        await cbRef.current();
      } finally {
        busy = false;
      }
    };

    const onVisibility = () => {
      if (!document.hidden) void run();
    };

    void run();
    const id = window.setInterval(() => void run(), intervalMs);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled]);
}
