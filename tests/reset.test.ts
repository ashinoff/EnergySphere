// Разовая очистка базы: сносит всё чужое (как осталось от TP_Approval), один раз.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { resetDatabaseOnce } from '../apps/api/src/reset.js';
import { migrate } from '../apps/api/src/migrate.js';

const dir = mkdtempSync(join(tmpdir(), 'es-reset-'));
const port = 54900 + Math.floor(Math.random() * 90);
const server = new EmbeddedPostgres({ databaseDir: dir, port, user: 'postgres', password: 'postgres', persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
const url = `postgres://postgres:postgres@127.0.0.1:${port}/legacy`;

before(async () => {
  await server.initialise();
  await server.start();
  await server.createDatabase('legacy');
  const admin = new pg.Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${port}/postgres` });
  await admin.connect();
  await admin.query("CREATE ROLE tp_runtime LOGIN PASSWORD 'tp_runtime' NOINHERIT");
  await admin.end();
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query(`CREATE SCHEMA app; CREATE TABLE app.acts(id int); INSERT INTO app.acts VALUES (1);
    CREATE TABLE public.schema_migrations(name text); CREATE ROLE tp_old LOGIN;
    CREATE TABLE app.owned(id int); ALTER TABLE app.owned OWNER TO tp_old;`);
  await c.end();
}, { timeout: 120_000 });

after(async () => {
  await server.stop();
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* останется в TEMP */ }
});

test('чужое имя базы — очистка отменяется', async () => {
  await assert.rejects(resetDatabaseOnce(url, 'other'), /не совпадает/);
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  assert.equal((await c.query('SELECT count(*)::int AS n FROM app.acts')).rows[0].n, 1);
  await c.end();
});

test('очистка сносит всё один раз, затем миграции ЭнергоСферы встают на чистую базу', async () => {
  await resetDatabaseOnce(url, 'legacy');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const schemas = (await c.query("SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'")).rows.map(r => r.nspname);
  assert.deepEqual(schemas, ['public']);
  assert.equal((await c.query("SELECT to_regclass('public.schema_migrations') AS t")).rows[0].t, null);
  assert.equal((await c.query("SELECT count(*)::int AS n FROM pg_tables WHERE tableowner='tp_old'")).rows[0].n, 0);
  await c.query('CREATE TABLE public.keep_me(id int)');
  await c.end();

  await resetDatabaseOnce(url, 'legacy'); // повторный запуск ничего не трогает
  const pool = new pg.Pool({ connectionString: url });
  assert.ok((await pool.query("SELECT to_regclass('public.keep_me') AS t")).rows[0].t);
  await migrate(pool, 'db/migrations');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM core.res')).rows[0].n, 7);
  await pool.end();
});
