// Teacher's private key in this browser only: a non-extractable CryptoKey in IndexedDB, used to read
// student names encrypted by Lab Manager (RSA-OAEP + AES-GCM). The key and the names never reach the server.

const DB_NAME = 'labzsk-keys';
const STORE = 'keys';
const KEY_ID = 'teacher';
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };

export const cryptoAvailable = () => Boolean(globalThis.crypto?.subtle);

const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const fromB64Url = (s) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/'));

/** Key file of Lab Manager (JSON) or a PKCS#8 key in PEM format. */
export function parseKeyFile(text) {
  const t = text.trim();
  if (t.startsWith('{')) {
    let data;
    try {
      data = JSON.parse(t);
    } catch {
      throw new Error('Nieznany format pliku klucza.');
    }
    if (typeof data.privateKey !== 'string') throw new Error('Plik nie zawiera klucza prywatnego.');
    return { pkcs8: data.privateKey, publicJwk: data.publicKey };
  }
  const pem = /-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/.exec(t);
  if (pem) return { pkcs8: pem[1].replace(/\s+/g, '') };
  throw new Error('Nieznany format pliku klucza.');
}

/** Imports the key as non-extractable; a key file with its public key is also checked against it. */
export async function importKey(text) {
  const { pkcs8, publicJwk } = parseKeyFile(text);
  let key;
  try {
    key = await crypto.subtle.importKey('pkcs8', fromB64(pkcs8), RSA, false, ['decrypt']);
  } catch {
    throw new Error('Nieprawidłowy klucz prywatny.');
  }
  if (publicJwk) {
    const probe = crypto.getRandomValues(new Uint8Array(16));
    const pub = await crypto.subtle.importKey('jwk', publicJwk, RSA, false, ['encrypt']).catch(() => null);
    const back = pub && await crypto.subtle.decrypt(RSA, key, await crypto.subtle.encrypt(RSA, pub, probe)).catch(() => null);
    if (!back || new Uint8Array(back).some((b, i) => b !== probe[i])) throw new Error('Klucz prywatny nie pasuje do klucza publicznego z pliku.');
  }
  return key;
}

/** Personal data from a link's enc value (iv.key.data); throws when the key does not fit. */
export async function decryptToken(key, token) {
  const [iv, wrapped, data] = token.split('.').map(fromB64Url);
  const raw = await crypto.subtle.decrypt(RSA, key, wrapped);
  const aes = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const person = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aes, data)));
  return { firstName: String(person.firstName ?? ''), lastName: String(person.lastName ?? ''), email: String(person.email ?? '') };
}

/** Null without a key or a token, or when the key does not fit. */
export const personOf = (key, token) => (key && token ? decryptToken(key, token).catch(() => null) : Promise.resolve(null));

/** Surname and name, as on the lists of Lab Manager. */
export const personLabel = (p) => `${p.lastName} ${p.firstName}`.trim() || p.email;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export async function loadKey() {
  if (!cryptoAvailable()) return null;
  return (await tx('readonly', (s) => s.get(KEY_ID)))?.key ?? null;
}

export async function saveKey(text) {
  const key = await importKey(text);
  await tx('readwrite', (s) => s.put({ key, savedAt: Date.now() }, KEY_ID));
  return key;
}

export const clearKey = () => tx('readwrite', (s) => s.delete(KEY_ID));
