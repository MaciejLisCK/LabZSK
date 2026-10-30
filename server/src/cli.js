// Administration from the command line:
//   node src/cli.js teacher <login> <password>   – adds a teacher account or changes its password
//   node src/cli.js teachers                     – lists teacher accounts
//   node src/cli.js secret                       – prints the shared secret (set in the panel: Ustawienia)

import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { setTeacher } from './auth.js';

const [command, ...args] = process.argv.slice(2);
const config = loadConfig();
const db = openDatabase(config.dataDir);

if (command === 'teacher' && args.length === 2) {
  if (args[1].length < 8) {
    console.error('Hasło musi mieć co najmniej 8 znaków.');
    process.exit(1);
  }
  setTeacher(db, args[0], args[1]);
  console.log(`Zapisano konto prowadzącego "${args[0]}". Działa od razu, bez restartu.`);
} else if (command === 'teachers') {
  for (const t of db.prepare('SELECT login, created_at FROM teachers ORDER BY login').all()) {
    console.log(`${t.login}\t${new Date(t.created_at).toLocaleString('pl-PL')}`);
  }
} else if (command === 'secret') {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'secret'").get();
  console.log(row ? row.value : 'Sekret nie jest ustawiony – ustaw go w panelu (Ustawienia).');
} else {
  console.log('Użycie:\n  teacher <login> <hasło>   dodaje konto prowadzącego lub zmienia hasło\n  teachers                  lista kont\n  secret                    wspólny sekret LabZSK i Lab Managera');
  process.exit(command ? 1 : 0);
}
