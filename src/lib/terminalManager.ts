import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";

const THEME = {
  background: "#06090e",
  foreground: "#f0f6fc",
  cursor: "#00d2ff",
  selectionBackground: "rgba(0, 210, 255, 0.25)",
  black: "#0a111a",
  red: "#ff6b81",
  green: "#2ed573",
  yellow: "#ffa502",
  blue: "#1e90ff",
  magenta: "#70a1ff",
  cyan: "#00d2ff",
  white: "#f0f6fc",
  brightBlack: "#2f3640",
  brightRed: "#ff4757",
  brightGreen: "#7bed9f",
  brightYellow: "#eccc68",
  brightBlue: "#70a1ff",
  brightMagenta: "#a4b0be",
  brightCyan: "#70edff",
  brightWhite: "#ffffff",
};

const FONT =
  '"JetBrainsMono Nerd Font", "JetBrainsMono Nerd Font Mono", "MesloLGS Nerd Font", "JetBrains Mono", Menlo, Monaco, monospace';

type Entry = {
  term: Terminal;
  fit: FitAddon;
  disposed: boolean;
  unlisten: UnlistenFn[];
  opened: boolean;
};

/**
 * Terminal örneklerini React yaşam döngüsünün dışında tutar.
 * Panel sekmeleri arası geçişte (DOM sökülüp takılırken) terminal ve PTY oturumu korunur;
 * yalnızca dispose() çağrıldığında kabuk süreci sonlandırılır.
 */
class TerminalManager {
  private entries = new Map<string, Entry>();

  has(id: string): boolean {
    return this.entries.has(id);
  }

  attach(id: string, container: HTMLElement, initCmd?: string): void {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = this.create(id, initCmd);
    }
    if (!entry.opened) {
      entry.term.open(container);
      entry.opened = true;
    } else if (entry.term.element && entry.term.element.parentElement !== container) {
      container.appendChild(entry.term.element);
    }
    this.fit(id);
  }

  private create(id: string, initCmd?: string): Entry {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: FONT,
      fontSize: 13,
      lineHeight: 1.25,
      allowProposedApi: true,
      scrollback: 5000,
      theme: THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const unicode = new Unicode11Addon();
    term.loadAddon(unicode);
    term.unicode.activeVersion = "11";

    const entry: Entry = { term, fit, disposed: false, unlisten: [], opened: false };
    this.entries.set(id, entry);

    term.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown") {
        if (e.ctrlKey && e.shiftKey && (e.key === "C" || e.key === "c")) {
          const sel = term.getSelection();
          if (sel) navigator.clipboard.writeText(sel).catch(() => {});
          return false;
        }
        if (
          ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "t") ||
          ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "k")
        ) {
          return false;
        }
      }
      return true;
    });

    term.onData((data) => {
      invoke("write_pty", { sessionId: id, data }).catch(console.error);
    });
    term.onResize(({ cols, rows }) => {
      invoke("resize_pty", { sessionId: id, cols, rows }).catch(() => {});
    });

    this.start(id, entry, initCmd).catch((e) => {
      term.write(`\r\n\x1b[31m[PTY başlatılamadı: ${String(e)}]\x1b[0m\r\n`);
    });
    return entry;
  }

  private async start(id: string, entry: Entry, initCmd?: string): Promise<void> {
    // Önce dinleyiciler kaydedilir, böylece ilk çıktı kaçmaz.
    const unData = await listen<string>(`pty-data-${id}`, (ev) => {
      if (!entry.disposed) entry.term.write(ev.payload);
    });
    const unExit = await listen(`pty-exit-${id}`, () => {
      if (!entry.disposed) entry.term.write("\r\n\x1b[2m[süreç sonlandı]\x1b[0m\r\n");
    });
    if (entry.disposed) {
      unData();
      unExit();
      return;
    }
    entry.unlisten.push(unData, unExit);

    entry.fit.fit();
    await invoke("start_pty", {
      sessionId: id,
      cols: entry.term.cols,
      rows: entry.term.rows,
      initCmd: initCmd ?? null,
    });
    if (entry.disposed) {
      invoke("close_pty", { sessionId: id }).catch(() => {});
    }
  }

  fit(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || !entry.opened) return;
    const el = entry.term.element?.parentElement;
    if (!el || el.clientWidth < 20 || el.clientHeight < 20) return;
    try {
      entry.fit.fit();
    } catch {
      /* henüz ölçülemiyor */
    }
  }

  focus(id: string): void {
    this.entries.get(id)?.term.focus();
  }

  write(id: string, command: string): void {
    invoke("write_pty", { sessionId: id, data: command + "\r" }).catch(console.error);
    this.focus(id);
  }

  dispose(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.disposed = true;
    entry.unlisten.forEach((u) => {
      try {
        u();
      } catch {
        /* zaten kapalı */
      }
    });
    try {
      entry.term.dispose();
    } catch {
      /* zaten kapalı */
    }
    this.entries.delete(id);
    invoke("close_pty", { sessionId: id }).catch(() => {});
  }
}

export const terminalManager = new TerminalManager();
