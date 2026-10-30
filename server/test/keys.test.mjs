import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decryptToken, importKey, parseKeyFile, personLabel, personOf } from '../panel/keys.js';

const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };
const b64 = (b) => Buffer.from(b).toString('base64');
const b64url = (b) => Buffer.from(b).toString('base64url');

async function keyPair() {
  const pair = await crypto.subtle.generateKey({ ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt']);
  return { pair, publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey), pkcs8: b64(await crypto.subtle.exportKey('pkcs8', pair.privateKey)) };
}

/** The same scheme as encryptFor in Lab Manager, written as the token of ExternalLinks.EncToken. */
async function token(publicKey, value) {
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(value)));
  const wrapped = await crypto.subtle.encrypt(RSA, publicKey, await crypto.subtle.exportKey('raw', aes));
  return [iv, wrapped, data].map(b64url).join('.');
}

const STUDENT = { firstName: 'Łucja', lastName: 'Żak', email: 'lz@example.edu', album: '123456' };

test('a Lab Manager key file decrypts the token of a link; the imported key cannot be exported', async () => {
  const { pair, publicJwk, pkcs8 } = await keyPair();
  const key = await importKey(JSON.stringify({ format: 'labmanager-private-key-v1', publicKey: publicJwk, privateKey: pkcs8 }));
  assert.equal(key.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('pkcs8', key));
  const person = await decryptToken(key, await token(pair.publicKey, STUDENT));
  assert.deepEqual(person, { firstName: 'Łucja', lastName: 'Żak', email: 'lz@example.edu' });
  assert.equal(personLabel(person), 'Żak Łucja');
});

test('a PEM key is accepted; a file whose keys differ or a broken file is refused', async () => {
  const a = await keyPair();
  const b = await keyPair();
  assert.equal(parseKeyFile(`-----BEGIN PRIVATE KEY-----\n${a.pkcs8}\n-----END PRIVATE KEY-----`).pkcs8, a.pkcs8);
  assert.ok(await importKey(`-----BEGIN PRIVATE KEY-----\n${a.pkcs8}\n-----END PRIVATE KEY-----`));
  await assert.rejects(importKey(JSON.stringify({ publicKey: b.publicJwk, privateKey: a.pkcs8 })), /nie pasuje/);
  await assert.rejects(importKey(JSON.stringify({ privateKey: 'AAAA' })), /Nieprawidłowy/);
  await assert.rejects(importKey('coś innego'), /format/);
});

test('without the right key no name is available', async () => {
  const a = await keyPair();
  const b = await keyPair();
  const t = await token(a.pair.publicKey, STUDENT);
  assert.equal(await personOf(null, t), null);
  assert.equal(await personOf(await importKey(JSON.stringify({ privateKey: b.pkcs8 })), t), null);
  assert.equal(await personOf(await importKey(JSON.stringify({ privateKey: a.pkcs8 })), null), null);
});
