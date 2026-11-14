import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

let permission: boolean | null = null;

/** Masaüstü bildirimi gönderir; Linux'ta KDE/GNOME için notify-send önceliklidir. */
export async function notify(title: string, body: string): Promise<void> {
  try {
    if (navigator.userAgent.includes("Linux")) {
      try {
        await invoke("send_desktop_notification", { title, body });
        return;
      } catch {
        // notify-send yoksa Tauri plugin fallback'e geç
      }
    }
    if (permission === null) {
      permission = (await isPermissionGranted()) || (await requestPermission()) === "granted";
    }
    if (permission) sendNotification({ title, body });
  } catch (e) {
    console.error("Bildirim gönderilemedi:", e);
  }
}
