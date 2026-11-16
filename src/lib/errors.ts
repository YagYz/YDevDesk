export type ErrorContext = "hub" | "git" | "update" | "agent" | "pty" | "settings";

export interface FormattedError {
  message: string;
  detail?: string;
}

function extractRawMessage(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err.trim();
  if (err instanceof Error) return (err.message || String(err)).trim();
  if (typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message.trim();
  }
  return String(err).trim();
}

function cleanPrefix(raw: string): string {
  return raw.replace(/^Error:\s*/i, "").trim();
}

export function formatError(err: unknown, context?: ErrorContext): FormattedError {
  const raw = cleanPrefix(extractRawMessage(err));
  if (!raw) return { message: "Bilinmeyen bir hata oluştu." };

  const low = raw.toLowerCase();

  // Bağlantı reddedildi / erişilemiyor
  if (
    low.includes("connection refused") ||
    low.includes("os error 111") ||
    low.includes("os error 10061") ||
    low.includes("econnrefused") ||
    low.includes("client error (connect)") ||
    low.includes("error sending request") ||
    low.includes("dns error") ||
    low.includes("failed to lookup") ||
    low.includes("failed to fetch") ||
    low.includes("networkerror")
  ) {
    const target =
      context === "hub"
        ? "YDevHub sunucusuna"
        : context === "update"
          ? "GitHub güncelleme sunucusuna"
          : "Sunucuya";
    return {
      message: `${target} bağlanılamadı. Adresin doğru olduğundan ve servisin çalıştığından emin ol.`,
      detail: raw,
    };
  }

  // Zaman aşımı
  if (low.includes("timed out") || low.includes("timeout") || low.includes("etimedout")) {
    return {
      message: "İstek zaman aşımına uğradı. Sunucu yanıt vermiyor veya ağ yavaş olabilir.",
      detail: raw,
    };
  }

  // TLS / SSL
  if (low.includes("certificate") || low.includes("tls") || low.includes("ssl") || low.includes("handshake")) {
    return {
      message: "Güvenli bağlantı (SSL/TLS) kurulamadı.",
      detail: raw,
    };
  }

  // HTTP durum kodları
  if (/\b401\b/.test(low) || low.includes("unauthorized")) {
    return {
      message: "Yetkisiz erişim (401). Ayarlar'dan API anahtarını kontrol et.",
      detail: raw,
    };
  }
  if (/\b403\b/.test(low) || low.includes("forbidden")) {
    return {
      message: "Erişim reddedildi (403). Yetki veya istek sınırını kontrol et.",
      detail: raw,
    };
  }
  if (/\b404\b/.test(low) || low.includes("not found")) {
    return {
      message:
        context === "hub"
          ? "YDevHub uç noktası bulunamadı (404). Sunucu URL'ini kontrol et."
          : "İstenen kaynak bulunamadı (404).",
      detail: raw,
    };
  }
  if (/\b429\b/.test(low) || low.includes("rate limit")) {
    return {
      message: "Çok fazla istek gönderildi (429). Kısa süre bekleyip tekrar dene.",
      detail: raw,
    };
  }
  if (/\b50[0234]\b/.test(low)) {
    return {
      message: "Sunucu geçici bir hata verdi. Biraz sonra tekrar dene.",
      detail: raw,
    };
  }

  // Git özel hataları
  if (low.includes("not a git repository")) {
    return {
      message: "Seçili klasör geçerli bir Git deposu değil.",
      detail: raw,
    };
  }
  if (context === "git" && (low.includes("program not found") || low.includes("git:"))) {
    return {
      message: "Sistemde Git komutu bulunamadı veya çalıştırılamadı.",
      detail: raw,
    };
  }

  // Dosya / klasör yok
  if (
    low.includes("no such file or directory") ||
    low.includes("os error 2") ||
    low.includes("os error 3") ||
    low.includes("enoent") ||
    low.includes("cannot find the path")
  ) {
    return {
      message:
        context === "git"
          ? "Proje klasörü bulunamadı. Ayarlar'dan proje yolunu kontrol et."
          : "Dosya veya klasör bulunamadı.",
      detail: raw,
    };
  }

  // Yetki / izin hatası
  if (
    low.includes("permission denied") ||
    low.includes("os error 13") ||
    low.includes("os error 5") ||
    low.includes("eacces")
  ) {
    return {
      message: "Erişim izni reddedildi. Dosya veya sistem izinlerini kontrol et.",
      detail: raw,
    };
  }

  // JSON / Parse hatası
  if (
    low.includes("error decoding response body") ||
    low.includes("expected value at line") ||
    low.includes("unexpected token") ||
    low.includes("invalid json")
  ) {
    return {
      message: "Sunucudan gelen yanıt okunamadı (beklenmeyen veri biçimi).",
      detail: raw,
    };
  }

  // PTY / Terminal hatası
  if (context === "pty" || low.includes("pty") || low.includes("failed to spawn")) {
    return {
      message: "Terminal oturumu başlatılamadı. Kabuk (shell) ayarlarını kontrol et.",
      detail: raw,
    };
  }

  // Zaten kısa ve okunaklı bir mesajsa (ör. backend'den gelen Türkçe mesajlar) doğrudan göster
  const looksTechnical =
    raw.includes("\n") ||
    raw.length > 140 ||
    /os error \d+|https?:\/\/|panicked at|stack backtrace/i.test(raw);

  if (!looksTechnical) {
    return { message: raw };
  }

  const firstLine = raw.split(/\r?\n/)[0].trim();
  const preview = firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
  return {
    message: context === "agent"
      ? "Ajan kurulumu sırasında bir hata oluştu. Detayları inceleyebilirsin."
      : `İşlem tamamlanamadı: ${preview}`,
    detail: raw,
  };
}

export function friendlyErrorMessage(err: unknown, context?: ErrorContext): string {
  return formatError(err, context).message;
}
