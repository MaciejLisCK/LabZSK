// Configuration from environment variables (and an optional .env file for local runs).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Reads KEY=value lines from server/.env without overriding variables already set. */
function loadDotEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

export function loadConfig(overrides = {}) {
  loadDotEnv(path.join(serverDir, '.env'));
  const env = { ...process.env, ...overrides };
  const production = env.NODE_ENV === 'production';
  return {
    production,
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    dataDir: path.resolve(serverDir, env.DATA_DIR ?? 'data'),
    webDir: path.resolve(serverDir, env.WEB_DIR ?? '../web'),
    panelDir: path.resolve(serverDir, env.PANEL_DIR ?? 'panel'),
    // Base address used in generated links, e.g. https://labzsk.example.edu (default: taken from the request).
    publicUrl: (env.PUBLIC_URL ?? '').replace(/\/+$/, ''),
    teacherLogin: env.TEACHER_LOGIN ?? 'prowadzacy',
    teacherPassword: env.TEACHER_PASSWORD ?? (production ? '' : 'prowadzacy'),
    // true behind an HTTPS reverse proxy: the session cookie gets the Secure attribute.
    secureCookies: env.SECURE_COOKIES === 'true',
    trustProxy: env.TRUST_PROXY === 'true',
    // A step delivered this many seconds after it was made is marked as offline in the log.
    offlineAfterSeconds: Number(env.OFFLINE_AFTER_SECONDS ?? 20),
    // A student is shown as connected in the panel when the last contact is newer than this.
    onlineSeconds: Number(env.ONLINE_SECONDS ?? 30),
  };
}
