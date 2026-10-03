// An optional encrypted copy of the recovery phrase in this browser.
// PBKDF2-SHA-256 (600,000 iterations) derives an AES-GCM key from the passphrase;
// only the ciphertext, salt and IV are stored. The phrase never leaves the page.

const STORE = 'qanary.vault.v1';
const ITERATIONS = 600_000;

export interface VaultRecord {
  v: 1;
  scheme: string;
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: number;
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealPhrase(phrase: string, passphrase: string, scheme: string): Promise<VaultRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(passphrase, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(phrase)));
  return { v: 1, scheme, salt: b64(salt), iv: b64(iv), ciphertext: b64(ct), createdAt: Date.now() };
}

export async function openPhrase(record: VaultRecord, passphrase: string): Promise<string> {
  const key = await keyFrom(passphrase, unb64(record.salt));
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(record.iv) as BufferSource }, key, unb64(record.ciphertext) as BufferSource);
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error('That passphrase does not open the saved phrase.');
  }
}

export function loadVault(): VaultRecord | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as VaultRecord) : null;
  } catch {
    return null;
  }
}

export function saveVault(r: VaultRecord): void {
  localStorage.setItem(STORE, JSON.stringify(r));
}

export function forgetVault(): void {
  localStorage.removeItem(STORE);
}

// ---------- treasuries opened from this browser ----------

const TREASURIES = 'qanary.treasuries.v1';

export interface TreasuryRecord {
  network: string;
  address: string;
  scheme: string;
  hot?: { window: number; cap: string; eoa: string };
  createdAt: number;
}

export function loadTreasuries(): TreasuryRecord[] {
  try {
    return JSON.parse(localStorage.getItem(TREASURIES) ?? '[]') as TreasuryRecord[];
  } catch {
    return [];
  }
}

export function rememberTreasury(t: TreasuryRecord): void {
  const rest = loadTreasuries().filter((x) => !(x.network === t.network && x.address.toLowerCase() === t.address.toLowerCase()));
  localStorage.setItem(TREASURIES, JSON.stringify([t, ...rest].slice(0, 20)));
}
