#!/usr/bin/env node
// Verifies a LabZSK log: the HMAC-SHA256 fingerprint added by the LabZSK server and the binding to
// the student and task. Standalone: needs only Node.js 18+, no packages. Also imported by the server.
//
//   node verify-log.mjs <file.log> (--secret <secret> | --secret-file <file> | env LABZSK_SECRET)
//                       [--user ID] [--course ID] [--session ID] [--task ID] [--json]
//
// Exit codes: 0 valid, 5 valid but the work was interrupted (steps done without connection – tell the teacher),
//             1 modified / wrong fingerprint / not a LabZSK log, 2 unsigned (emergency) log,
//             3 valid fingerprint but a different student or task, 4 usage error.
//
// Algorithm (to implement it elsewhere, e.g. in the Lab Manager checking script):
//   1. Normalise line endings to LF and drop a UTF-8 BOM.
//   2. The last line must be "#LABZSK-HMAC <64 hex digits>". Everything before it is the content.
//   3. The last content line starting with "#LABZSK " holds JSON with user, course, session, task.
//   4. HMAC-SHA256(secret, user + "\n" + course + "\n" + session + "\n" + task + "\n" + content) in hex
//      must equal the digits from step 2.

import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const META_PREFIX = '#LABZSK ';
export const HMAC_PREFIX = '#LABZSK-HMAC ';
export const EXIT = { valid: 0, interrupted: 5, invalid: 1, malformed: 1, unsigned: 2, mismatch: 3 };

/** Text normalisation applied before computing and checking the fingerprint. */
export function normalize(text) {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export function fingerprint(secret, meta, content) {
  const binding = `${meta.user}\n${meta.course}\n${meta.session}\n${meta.task}\n`;
  return crypto.createHmac('sha256', String(secret)).update(binding + content, 'utf8').digest('hex');
}

function readMeta(content) {
  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith(META_PREFIX)) continue;
    try {
      return JSON.parse(lines[i].slice(META_PREFIX.length));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {string} input log file contents
 * @param {string} secret shared LabZSK secret
 * @param {{user?: string, course?: string, session?: string, task?: string}} expected binding to check
 * @returns {{result: 'valid'|'invalid'|'unsigned'|'malformed'|'mismatch', interrupted: boolean, meta: object|null, messages: string[]}}
 */
export function verifyLog(input, secret, expected = {}) {
  const text = normalize(input).replace(/\n+$/, '\n');
  const at = text.lastIndexOf(`\n${HMAC_PREFIX}`);
  const content = at < 0 ? text : text.slice(0, at + 1);
  const meta = readMeta(content);
  const messages = [];
  if (!meta || meta.format !== 'labzsk-log') {
    return { result: 'malformed', interrupted: false, meta, messages: ['Plik nie jest logiem LabZSK (brak danych podejścia #LABZSK).'] };
  }
  const interrupted = meta.offlineEvents > 0 || meta.offlineStart === true || meta.signed === false;
  if (meta.signed === false || at < 0) {
    messages.push('Log NIEPODPISANY – zapisany awaryjnie bez połączenia z serwerem LabZSK. Treść nie jest zweryfikowana, decyzję podejmuje nauczyciel.');
    return { result: 'unsigned', interrupted: true, meta, messages };
  }
  const given = text.slice(at + 1 + HMAC_PREFIX.length).trim();
  if (!/^[0-9a-f]{64}$/.test(given)) return { result: 'invalid', interrupted, meta, messages: ['Uszkodzony odcisk lub dopisana treść po odcisku.'] };
  const expectedHmac = fingerprint(secret, meta, content);
  if (!crypto.timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expectedHmac, 'hex'))) {
    return { result: 'invalid', interrupted, meta, messages: ['Odcisk nieprawidłowy – log zmieniono albo nie pochodzi z tego serwera LabZSK.'] };
  }
  for (const [field, label] of [['user', 'studenta'], ['course', 'kursu'], ['session', 'zajęć'], ['task', 'zadania']]) {
    if (expected[field] != null && expected[field] !== '' && String(expected[field]) !== String(meta[field])) {
      messages.push(`Log dotyczy innego ${label}: "${meta[field]}" (oczekiwano "${expected[field]}").`);
    }
  }
  if (messages.length) return { result: 'mismatch', interrupted, meta, messages };
  messages.push('Odcisk prawidłowy, treść niezmieniona.');
  if (meta.status !== 'finished') messages.push('Uwaga: log wygenerowano przed zakończeniem pracy.');
  if (meta.offlineStart) messages.push('Zadanie rozpoczęto bez połączenia z serwerem LabZSK.');
  if (meta.offlineEvents > 0) messages.push(`Przerwa w połączeniu: kroki wykonane offline (liczba: ${meta.offlineEvents}) są oznaczone [offline].`);
  return { result: 'valid', interrupted, meta, messages };
}

// ------------------------------------------------------------------ CLI
async function main(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  const secret = args.secret ?? (args['secret-file'] ? fs.readFileSync(args['secret-file'], 'utf8').trim() : process.env.LABZSK_SECRET);
  const file = args._[0];
  if (!file || !secret) {
    console.error('Użycie: node verify-log.mjs <plik.log> (--secret S | --secret-file plik | LABZSK_SECRET) [--user ID] [--course ID] [--session ID] [--task ID] [--json]');
    return 4;
  }
  const report = verifyLog(fs.readFileSync(file, 'utf8'), secret, { user: args.user, course: args.course, session: args.session, task: args.task });
  const code = report.result === 'valid' && report.interrupted ? EXIT.interrupted : EXIT[report.result];
  if (args.json) console.log(JSON.stringify({ ...report, exitCode: code }, null, 2));
  else {
    const names = { valid: 'POPRAWNY', invalid: 'NIEPOPRAWNY', malformed: 'NIEPOPRAWNY', unsigned: 'NIEPODPISANY', mismatch: 'INNY STUDENT LUB ZADANIE' };
    console.log(`Wynik: ${names[report.result]}${report.result === 'valid' && report.interrupted ? ' (z przerwą w połączeniu)' : ''}`);
    if (report.meta) console.log(`Student: ${report.meta.user}  Kurs: ${report.meta.course}  Zajęcia: ${report.meta.session}  Zadanie: ${report.meta.task}  Błędy: ${report.meta.mistakes ?? '—'}`);
    for (const m of report.messages) console.log(`- ${m}`);
  }
  return code;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    console.error(e.message);
    process.exit(4);
  });
}
