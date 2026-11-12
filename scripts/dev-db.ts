// Локальная база для разработки (embedded Postgres, порт 54329).
// Запуск: npm run dev:db — держать открытым, пока идёт разработка.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';

const dir = '.dev-db';
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port: 54329, persistent: true });
if (!existsSync(dir)) await pg.initialise();
await pg.start();
try { await pg.createDatabase('energysphere'); } catch { /* уже есть */ }
console.log('Postgres: postgres://postgres:postgres@127.0.0.1:54329/energysphere (Ctrl+C — остановить)');
process.on('SIGINT', async () => { await pg.stop(); process.exit(0); });
