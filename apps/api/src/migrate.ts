import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Db } from './db.js';

// Миграции лежат по папкам модулей: db/migrations/<core|analysis|...>/NNN_*.sql.
// Сначала core, затем модули по алфавиту. Применённый файл менять нельзя.
// Учёт — в своей таблице es_schema_migrations: в базе может жить чужая
// schema_migrations (так было с TP_Approval), к которой у нас нет прав.
export async function migrate(db: Db, root: string) {
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock(551177)');
    await client.query('CREATE TABLE IF NOT EXISTS public.es_schema_migrations(name text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const folders = (await readdir(root, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name)
      .sort((a, b) => (a === 'core' ? -1 : b === 'core' ? 1 : a.localeCompare(b)));
    for (const folder of folders) {
      for (const file of (await readdir(join(root, folder))).filter(n => n.endsWith('.sql')).sort()) {
        const name = `${folder}/${file}`;
        const sql = await readFile(join(root, folder, file), 'utf8');
        const hash = createHash('sha256').update(sql).digest('hex');
        const old = await client.query('SELECT hash FROM public.es_schema_migrations WHERE name=$1', [name]);
        if (old.rowCount) {
          if (old.rows[0].hash !== hash) throw new Error(`Миграция изменена после применения: ${name}`);
          continue;
        }
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO public.es_schema_migrations(name, hash) VALUES ($1, $2)', [name, hash]);
          await client.query('COMMIT');
          console.log(`[migrate] применена ${name}`);
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(551177)').catch(() => {});
    client.release();
  }
}
