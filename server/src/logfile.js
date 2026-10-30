// The final log of an attempt: the student's log as recorded by the server, the attempt data and
// the HMAC fingerprint (see tools/verify-log.mjs for the format).

import { META_PREFIX, HMAC_PREFIX, fingerprint, normalize } from '../../tools/verify-log.mjs';

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const local = (ms) => (ms ? new Date(ms).toLocaleString('pl-PL', { timeZone: process.env.TZ || 'Europe/Warsaw' }) : '—');

export const AUDIT_TEXT = {
  opened: 'rozpoczęcie zadania',
  offline_start: 'rozpoczęcie zadania bez połączenia z serwerem (zgłoszone po powrocie połączenia)',
  continued: 'kontynuacja w tej samej przeglądarce',
  finished: 'zakończenie pracy przez studenta',
  denied: 'odmowa wejścia',
};

/** Lines of the student's log, with every step delivered offline marked. */
function body(events) {
  const out = [];
  let offline = false;
  for (const e of events) {
    if (e.offline && !offline) out.push('>>>>>>>> POCZĄTEK FRAGMENTU OFFLINE – kroki wykonane bez połączenia z serwerem, dosłane później >>>>>>>>');
    if (!e.offline && offline) out.push('<<<<<<<< KONIEC FRAGMENTU OFFLINE <<<<<<<<');
    offline = Boolean(e.offline);
    let text = normalize(e.text);
    if (e.kind === 'finish') text = `\n======== ZAKOŃCZENIE PRACY PRZEZ STUDENTA (${local(e.client_ts)}) ========\n`;
    if (!text) continue;
    const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
    // lines looking like the document markers are indented so the student's text cannot imitate them
    for (const l of lines) {
      const safe = /^(#LABZSK|>{8}|<{8})/.test(l) ? ` ${l}` : l;
      out.push(e.offline ? `[offline] ${safe}` : safe);
    }
  }
  if (offline) out.push('<<<<<<<< KONIEC FRAGMENTU OFFLINE <<<<<<<<');
  return out;
}

/** Builds the final log with the fingerprint made with the shared secret. */
export function buildLog(secret, attempt, events, audit, now = Date.now()) {
  const offlineEvents = events.filter((e) => e.offline).length;
  const meta = {
    format: 'labzsk-log',
    v: 2,
    signed: true,
    user: attempt.user_id,
    course: attempt.course,
    session: attempt.lab_session,
    task: attempt.task,
    attempt: attempt.id,
    status: attempt.status === 'finished' ? 'finished' : 'in-progress',
    startedAt: iso(attempt.created_at),
    finishedAt: iso(attempt.finished_at),
    generatedAt: iso(now),
    events: events.length,
    offlineEvents,
    offlineStart: Boolean(attempt.offline_start),
    mistakes: attempt.mistakes,
  };
  const interrupted = offlineEvents > 0 || meta.offlineStart;
  const lines = [
    ...body(events),
    '',
    '================ LabZSK – dane podejścia (wygenerowane przez serwer LabZSK) ================',
    `Student (userId): ${meta.user}`,
    `Kurs / zajęcia / zadanie: ${meta.course} / ${meta.session} / ${meta.task}`,
    `Status:        ${meta.status === 'finished' ? 'ZAKOŃCZONE' : 'W TOKU (log wygenerowany przed zakończeniem pracy)'}`,
    `Rozpoczęcie:   ${local(attempt.created_at)}`,
    `Zakończenie:   ${local(attempt.finished_at)}`,
    `Wygenerowano:  ${local(now)}`,
    `Błędy:         ${attempt.mistakes}`,
    `Połączenie:    ${interrupted
      ? `PRZERWANE${meta.offlineStart ? ' – start bez połączenia z serwerem' : ''}${offlineEvents ? ` – kroki offline: ${offlineEvents}, oznaczone [offline]` : ''}`
      : 'bez przerw – wszystkie kroki dotarły do serwera na bieżąco'}`,
    'Historia (zapis serwera):',
    ...audit.map((a) => `  ${local(a.at)}  ${AUDIT_TEXT[a.kind] ?? a.kind}${a.detail ? ` (${a.detail})` : ''}`),
    META_PREFIX + JSON.stringify(meta),
    '',
  ];
  const content = lines.join('\n');
  return `${content}${HMAC_PREFIX}${fingerprint(secret, meta, content)}\n`;
}
