import { useEffect, useRef, useState } from "react";
import { Brain, StickyNote, TerminalSquare } from "lucide-react";
import { useData } from "../context/DataContext";
import { useWorkspace } from "../context/WorkspaceContext";

type Mode = "command" | "note" | "log";
const MODES: { id: Mode; label: string; icon: typeof Brain; placeholder: string }[] = [
  { id: "command", label: "Komut", icon: TerminalSquare, placeholder: "Etkin terminalde çalıştırılacak komut…" },
  { id: "note", label: "Not", icon: StickyNote, placeholder: "YDevHub'a not ekle…" },
  { id: "log", label: "Hafıza", icon: Brain, placeholder: "Bilgi ağına kayıt ekle…" },
];

export function OmniBar({ onClose }: { onClose: () => void }) {
  const { addNote, addKnowledge, hubStatus } = useData();
  const { runInTerminal } = useWorkspace();
  const [mode, setMode] = useState<Mode>("command");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = value.trim();
    if (!text) return;
    setError("");
    if (mode === "command") {
      runInTerminal(text);
      onClose();
      return;
    }
    if (hubStatus !== "ok") {
      setError("YDevHub bağlı değil. Ayarlar'dan bağlantıyı yapılandır.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "note") await addNote(text);
      else await addKnowledge("Hızlı Kayıt", text);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const current = MODES.find((m) => m.id === mode)!;

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center pt-[14vh] bg-black/50 backdrop-blur-sm" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            setMode(MODES[(MODES.findIndex((m) => m.id === mode) + 1) % MODES.length].id);
          } else if (e.key === "Escape") onClose();
        }}
        className="w-[600px] max-w-[92vw] rounded-2xl border border-[var(--border-glow)] bg-[var(--surface)] shadow-2xl overflow-hidden"
      >
        <div className="flex gap-1 p-2 border-b border-[var(--border)]">
          {MODES.map((m) => (
            <button
              type="button"
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] ${mode === m.id ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--txt-muted)] hover:bg-[var(--surface-raised)]"}`}
            >
              <m.icon className="w-3.5 h-3.5" /> {m.label}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-[var(--txt-dim)] self-center pr-1">Tab: mod · Enter: gönder · Esc: kapat</span>
        </div>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={current.placeholder}
          disabled={busy}
          className="w-full bg-transparent px-4 py-3.5 text-sm font-mono outline-none select-text"
          spellCheck={false}
        />
        {error && <div className="px-4 pb-3 text-[11px] text-[var(--err)]">{error}</div>}
      </form>
    </div>
  );
}
