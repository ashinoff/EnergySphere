import pg from 'pg';

// Разовая ПОЛНАЯ очистка базы (по решению владельца 2026-11-12: база досталась
// от TP_Approval, начинаем с нуля). Включается только парой переменных:
//   RESET_DATABASE_URL — подключение суперпользователя (чужие таблицы иначе не удалить);
//   RESET_CONFIRM      — имя базы, повторённое вручную (защита от ошибки адреса).
// Выполняется ОДИН раз: после очистки ставится отметка public.es_reset_done,
// и при следующих запусках очистка пропускается. После успеха переменные удалить.
export async function resetDatabaseOnce(url: string, confirm: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const db = (await client.query<{ db: string }>('SELECT current_database() AS db')).rows[0].db;
    if (db !== confirm) throw new Error(`RESET_CONFIRM (${confirm}) не совпадает с именем базы (${db}) — очистка отменена`);
    if ((await client.query("SELECT to_regclass('public.es_reset_done') AS t")).rows[0].t) {
      console.log('[reset] база уже очищалась раньше — пропускаю. Удалите RESET_DATABASE_URL и RESET_CONFIRM.');
      return;
    }

    await client.query('BEGIN');
    const { rows } = await client.query<{ name: string }>(
      `SELECT nspname AS name FROM pg_namespace
       WHERE nspname NOT LIKE 'pg\\_%' AND nspname NOT IN ('information_schema', 'public')`);
    for (const { name } of rows) await client.query(`DROP SCHEMA ${pg.escapeIdentifier(name)} CASCADE`);
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public AUTHORIZATION pg_database_owner');
    await client.query('GRANT USAGE ON SCHEMA public TO PUBLIC');
    // Служебная роль TP_Approval больше не нужна.
    const runtime = await client.query("SELECT 1 FROM pg_roles WHERE rolname='tp_runtime'");
    if (runtime.rowCount) {
      await client.query('DROP OWNED BY tp_runtime');
      await client.query('DROP ROLE tp_runtime');
    }
    await client.query('CREATE TABLE public.es_reset_done(at timestamptz NOT NULL DEFAULT now())');
    await client.query('INSERT INTO public.es_reset_done DEFAULT VALUES');
    await client.query('COMMIT');
    console.log(`[reset] база ${db} очищена полностью: удалены схемы ${rows.map(r => r.name).join(', ') || '—'} и всё в public.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
