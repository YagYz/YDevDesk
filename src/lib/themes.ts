import { terminalManager } from "./terminalManager";
import type { ThemeManifest } from "../types";

export const DEFAULT_THEME_ID = "deep-navy";

/** Seçili temanın CSS değişkenlerini belge köküne ve tüm açık terminallere uygular. */
export function applyTheme(theme: ThemeManifest | undefined): void {
  if (!theme) return;
  const root = document.documentElement;
  for (const [key, val] of Object.entries(theme.vars)) {
    if (key.startsWith("--")) {
      root.style.setProperty(key, val);
    }
  }
  terminalManager.applyTheme(theme.terminal ?? undefined);
}

/** Aktif CSS tema değişkenlerini sandboxed plugin iframe'ine enjekte etmek için CSS bloğu üretir. */
export function buildThemeCssSnapshot(): string {
  const keys = [
    "--bg",
    "--surface",
    "--surface-raised",
    "--border",
    "--border-glow",
    "--accent",
    "--petrol",
    "--txt-main",
    "--txt-muted",
    "--txt-dim",
    "--ok",
    "--warn",
    "--err",
  ];
  const style = getComputedStyle(document.documentElement);
  const lines = keys
    .map((k) => {
      const v = style.getPropertyValue(k).trim();
      return v ? `  ${k}: ${v};` : "";
    })
    .filter(Boolean);
  return `:root {\n${lines.join("\n")}\n}\nhtml, body { margin: 0; padding: 0; background: var(--surface); color: var(--txt-main); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }`;
}
