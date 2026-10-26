// Identité locale : pseudo + playerId (UUID) + token secret (32 hex), sans compte.
// Persistée dans localStorage ; tout accès au stockage est protégé (mode privé, quota, etc.).

export interface Identity {
  name: string;
  playerId: string;
  token: string;
}

const STORAGE_KEY = 'flibuste:identity';

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomUUID(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Repli RFC 4122 v4 pour les contextes sans randomUUID (http non sécurisé).
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function createIdentity(name = ''): Identity {
  return { name, playerId: randomUUID(), token: randomHex(16) };
}

function isValid(x: unknown): x is Identity {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.name === 'string' &&
    typeof o.playerId === 'string' &&
    o.playerId.length > 0 &&
    typeof o.token === 'string' &&
    /^[0-9a-f]{32}$/.test(o.token)
  );
}

function read(): Identity | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function write(identity: Identity): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    /* stockage indisponible : l'identité vit en mémoire pour cette session */
  }
}

let cached: Identity | null = null;

/** Charge (ou crée puis persiste) l'identité locale. */
export function loadIdentity(): Identity {
  if (cached) return cached;
  cached = read() ?? createIdentity();
  write(cached);
  return cached;
}

export function setName(name: string): Identity {
  const id = loadIdentity();
  cached = { ...id, name: name.trim().slice(0, 20) };
  write(cached);
  return cached;
}

/** Réinitialise l'identité (nouvel UUID + token). Utile pour les tests ou un "oublie-moi". */
export function resetIdentity(): Identity {
  cached = createIdentity();
  write(cached);
  return cached;
}
