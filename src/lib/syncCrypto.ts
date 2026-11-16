import type { SyncPayload } from "./sync";

export type EncryptedSyncEnvelope = {
  encrypted: true;
  v: 1;
  alg: "AES-256-GCM";
  salt: string;
  iv: string;
  ciphertext: string;
};

const PBKDF2_ITERATIONS = 100_000;
const KEY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function generateSyncKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let chunk = "";
    for (let i = 0; i < 4; i++) {
      chunk += KEY_ALPHABET[bytes[g * 4 + i] % KEY_ALPHABET.length];
    }
    groups.push(chunk);
  }
  return `YDEV-${groups.join("-")}`;
}

async function deriveAesKey(syncKey: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(syncKey.trim()),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function isEncryptedEnvelope(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    return Boolean(parsed && parsed.encrypted === true && typeof parsed.ciphertext === "string");
  } catch {
    return false;
  }
}

export async function encryptSyncPayload(payload: SyncPayload, syncKey: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const key = await deriveAesKey(syncKey, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);

  const envelope: EncryptedSyncEnvelope = {
    encrypted: true,
    v: 1,
    alg: "AES-256-GCM",
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(cipherBuf)),
  };
  return JSON.stringify(envelope);
}

export async function decryptSyncPayload(
  raw: string,
  syncKey: string | null | undefined,
): Promise<{ payload: SyncPayload; wasEncrypted: boolean }> {
  const parsed = JSON.parse(raw);
  if (parsed && parsed.encrypted === true) {
    if (!syncKey || !syncKey.trim()) {
      throw new Error("SYNC_KEY_REQUIRED");
    }
    try {
      const salt = fromBase64(parsed.salt);
      const iv = fromBase64(parsed.iv);
      const ciphertext = fromBase64(parsed.ciphertext);
      const key = await deriveAesKey(syncKey, salt);
      const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
      const text = new TextDecoder().decode(plainBuf);
      return { payload: JSON.parse(text) as SyncPayload, wasEncrypted: true };
    } catch {
      throw new Error("Sync anahtarı hatalı veya şifreli veri çözülemedi.");
    }
  }
  return { payload: parsed as SyncPayload, wasEncrypted: false };
}
