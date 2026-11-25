/** Sürüm notları: uygulamayla birlikte gelir (çevrimdışı çalışır, GitHub API sınırına takılmaz). En yeni sürüm başta. */

export const KNOWLEDGE_DOCS_URL = "https://yagyz.github.io/YDevDesk/knowledge.html";

export type ReleaseNote = {
  version: string;
  title: string;
  items: string[];
  /** Pencerede "Ayrıntılar" bağlantısı olarak gösterilir. */
  link?: string;
};

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "1.4.0",
    title: "Ajanlara tek tıkla bağlan, güncelleme notları",
    link: KNOWLEDGE_DOCS_URL,
    items: [
      "Ayarlar → Bilgi Ağı → \"Ajanlara ekle\": Claude Code, Codex ve AGY için MCP kaydını ve genel kural bloğunu tek tıkla ekler. Yazmadan önce önizleme gösterir, yedek alır, istediğin zaman kaldırır.",
      "İngilizce ajan kural şablonları (CLAUDE.md, AGENTS.md, GEMINI.md) siteden indirilebilir.",
      "Sistemine ne eklediğimizi ve nasıl geri alacağını anlatan Bilgi Ağı rehberi sitede (Türkçe ve İngilizce).",
      "Yeni sürüm kurulduktan sonra ilk açılışta bu pencere gösterilir.",
    ],
  },
  {
    version: "1.3.0",
    title: "Bilgi Ağı: ajanlar için ortak hafıza",
    link: KNOWLEDGE_DOCS_URL,
    items: [
      "Ajan oturumları (Claude Code, Codex, AGY) yaptıkları işi kaydeder, sonraki oturumlar okur. YDevHub gerekmez, kayıtlar yerel SQLite'ta durur.",
      "Uygulamanın kendi dosyası MCP sunucusu olur (ydevdesk --mcp): knowledge_log ve knowledge_read araçları. Ayrı CLI kurmak gerekmez.",
      "Depolama: Yerel, YDevHub veya İkisi birden. Hub kapalıyken kayıtlar kuyruğa alınır, açılınca gönderilir.",
      "Çalışma izni: Kapalı, yalnızca uygulama açıkken veya her zaman.",
      "Bilgi Ağı paneli: arama, etiketle gezinme, yazan ajan rozeti.",
    ],
  },
];

const MAX_SHOWN = 3;

/** "1.10.0" > "1.2.9" olacak şekilde sayısal karşılaştırır; ön ek ve ek sürüm etiketleri yok sayılır. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** `last` sürümünden sonra ve `current` dahil olan notlar, en yeni başta, en çok 3 tane. */
export function notesSince(last: string | null, current: string, notes: ReleaseNote[] = RELEASE_NOTES): ReleaseNote[] {
  return notes
    .filter((n) => compareVersions(n.version, current) <= 0 && (last === null || compareVersions(n.version, last) > 0))
    .sort((x, y) => compareVersions(y.version, x.version))
    .slice(0, MAX_SHOWN);
}
