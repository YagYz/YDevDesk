import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

let permission: boolean | null = null;

/** Masaüstü bildirimi gönderir; izin yoksa bir kez ister, reddedilirse sessizce vazgeçer. */
export async function notify(title: string, body: string): Promise<void> {
  try {
    if (permission === null) {
      permission = (await isPermissionGranted()) || (await requestPermission()) === "granted";
    }
    if (permission) sendNotification({ title, body });
  } catch (e) {
    console.error("Bildirim gönderilemedi:", e);
  }
}
