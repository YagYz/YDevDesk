import { useCallback, useEffect, useState } from "react";
import { api } from "./tauri";
import { notesSince, type ReleaseNote } from "./releaseNotes";

const KEY = "ydevdesk.lastSeenVersion";

// localStorage bazı ortamlarda erişilemeyebilir; sessizce yok sayılır.
function readLast(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function writeLast(v: string) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* sessiz */
  }
}

/**
 * Yeni sürüm kurulduktan sonraki ilk açılışta gösterilecek notları döner.
 * Taze kurulumda (ayar dosyası yok) hiçbir şey göstermez. Ayarlar senkronize edildiği için son görülen
 * sürüm ayar dosyasında değil, bu cihazın yerel depolamasında tutulur.
 */
export function useReleaseNotes(ready: boolean): { notes: ReleaseNote[]; dismiss: () => void } {
  const [notes, setNotes] = useState<ReleaseNote[]>([]);
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        const current = await api.appVersion();
        const last = readLast();
        if (last === current) return;
        if (last === null) {
          const saved = await api.loadAppSettings();
          if (saved === null) {
            writeLast(current);
            return;
          }
        }
        const list = notesSince(last, current);
        if (cancelled) return;
        if (list.length === 0) {
          writeLast(current);
          return;
        }
        setVersion(current);
        setNotes(list);
      } catch {
        /* sürüm okunamazsa pencere gösterilmez */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  const dismiss = useCallback(() => {
    if (version) writeLast(version);
    setNotes([]);
  }, [version]);

  return { notes, dismiss };
}
