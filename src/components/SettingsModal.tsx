import { useState } from "react";
import { useData } from "../context/DataContext";
import { Modal } from "./Modal";
import type { HomelabConfig } from "../types";

const FIELDS: { key: keyof HomelabConfig; label: string; secret?: boolean }[] = [
  { key: "ydevhub_url", label: "YDevHub URL" },
  { key: "ydevhub_key", label: "YDevHub API anahtarı", secret: true },
  { key: "ynetmon_url", label: "YNetMon URL" },
  { key: "ynetmon_key", label: "YNetMon API anahtarı", secret: true },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { config, saveConfig } = useData();
  const [draft, setDraft] = useState<HomelabConfig>(config);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await saveConfig(draft);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Ayarlar — Homelab bağlantıları" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="text-[11px] text-[var(--txt-muted)]">{f.label}</span>
            <input
              type={f.secret ? "password" : "text"}
              value={draft[f.key]}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-mono outline-none focus:border-[var(--accent)] select-text"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        ))}
        <p className="text-[10px] text-[var(--txt-dim)]">Kayıt yeri: ~/.config/ydevhub/config.json (ydev CLI ile paylaşılır).</p>
        {error && <p className="text-[11px] text-[var(--err)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs text-[var(--txt-muted)] hover:bg-[var(--surface-raised)]">
            Vazgeç
          </button>
          <button disabled={saving} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent)] text-black disabled:opacity-60">
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
