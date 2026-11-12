import pg from 'pg';
import type { Db } from '../../db.js';

// Служебная роль модуля «Акты ТП» — как в TP_Approval: объекты схемы tp и их
// SECURITY DEFINER-функции принадлежат владельцу базы (обходят защиту строк),
// а сам модуль работает под tp_runtime — для неё политики действуют, права выданы
// миграциями. Создать роль может только суперпользователь (или роль с CREATEROLE):
// если владелец базы не может, один раз задаётся TP_SETUP_DATABASE_URL.
export const TP_RUNTIME_ROLE = 'tp_runtime';

export async function ensureTpRuntime(db: Db, password: string, setupUrl?: string) {
  const exists = await db.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [TP_RUNTIME_ROLE]);
  if (exists.rowCount) return false;
  const literal = (await db.query('SELECT quote_literal($1) AS v', [password])).rows[0].v as string;
  const sql = `CREATE ROLE ${TP_RUNTIME_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD ${literal}`;
  try {
    await db.query(sql);
  } catch (error) {
    if ((error as { code?: string }).code !== '42501' || !setupUrl) {
      throw new Error(`Нет служебной роли ${TP_RUNTIME_ROLE} для «Актов ТП», а владелец базы не может её создать. `
        + 'Задайте на один запуск TP_SETUP_DATABASE_URL (подключение суперпользователя), затем удалите.');
    }
    const admin = new pg.Client({ connectionString: setupUrl });
    await admin.connect();
    try { await admin.query(sql); } finally { await admin.end(); }
  }
  console.log(`[tp] создана служебная роль ${TP_RUNTIME_ROLE}`);
  return true;
}

// Подключение модуля: та же база, но под tp_runtime.
export function runtimeUrl(databaseUrl: string, password: string) {
  const url = new URL(databaseUrl);
  url.username = TP_RUNTIME_ROLE;
  url.password = password;
  return url.toString();
}

// Как в TP_Approval: служебная роль не должна быть всесильной и владеть таблицами.
export async function checkTpRuntime(runtime: Db) {
  const role = (await runtime.query('SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user')).rows[0];
  if (role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb) throw new Error('tp_runtime не должна иметь особых прав');
  const owned = await runtime.query("SELECT 1 FROM pg_tables WHERE schemaname = 'tp' AND tableowner = current_user LIMIT 1");
  if (owned.rowCount) throw new Error('tp_runtime не должна владеть таблицами');
  await runtime.query('SELECT id FROM tp.res_units LIMIT 1');
}
