import type { Db } from '../../db.js';
import type { UserContext } from '../../core/access-service.js';
import type { Role } from '../../core/access.js';

// Мост «пользователь Сферы → пользователь TP_Approval». Своих учёток у модуля
// нет: при каждом запросе (с кешем) учётка в tp.users и её роли маршрута
// приводятся к роли и РЭС из Сферы. Пишется вручную (импорт TP его не трогает).
//
// В маршруте TP на каждую роль (а для ролей РЭС — на каждый РЭС) должен быть
// ровно один сотрудник — иначе отправка сообщит «несколько …» (ASSIGNEE_CONFIGURATION).
export const TP_ISSUER = 'energysphere';

const ROLE_MAP: Partial<Record<Role, string>> = {
  // Документы ведёт инженер развития; инженер реализации только смотрит акты своего РЭС
  // (RES_VIEWER, миграция tp/sphere_002) — решение владельца 26.11.2026.
  eng_development: 'RIRU_ENGINEER',  // готовит, загружает, формирует акты, отправляет в маршрут
  eng_realization: 'RES_VIEWER',     // зритель: видит документы своего РЭС, ничего не меняет
  nach_riru: 'RIRU_HEAD',            // 1-й согласующий своего РЭС
  nach_res: 'RES_HEAD',              // 2-й согласующий своего РЭС
  nach_stp: 'STP', eng_stp: 'STP_ENGINEER',
  nach_sue: 'SUE', eng_sue: 'SUE_ENGINEER',
  // ТЕХБЛОК: согласует Главный инженер; СРС и ПТС пока видят всё для чтения
  // (участие в согласовании — решение владельца на этапе маршрута).
  glav_ing: 'GI',
  nach_srs: 'GI_ENGINEER', eng_srs: 'GI_ENGINEER',
  nach_pts: 'GI_ENGINEER', eng_pts: 'GI_ENGINEER',
};
const RES_SCOPED = new Set(['RIRU_ENGINEER', 'RIRU_HEAD', 'RES_HEAD', 'RES_VIEWER']);

export function tpRolesOf(user: Pick<UserContext, 'role' | 'isSuper' | 'resId'>): { role: string; res: boolean }[] {
  if (user.isSuper || user.role === 'admin') return [{ role: 'TECH_ADMIN', res: false }, { role: 'PROCESS_ADMIN', res: false }];
  const mapped = user.role ? ROLE_MAP[user.role] : undefined;
  if (!mapped) return [];
  if (RES_SCOPED.has(mapped) && !user.resId) return [];
  return [{ role: mapped, res: RES_SCOPED.has(mapped) }];
}

const cache = new Map<number, { key: string; at: number }>();
const CACHE_MS = 60_000;

export async function syncTpUser(db: Db, user: UserContext): Promise<void> {
  const key = [user.role, user.resId, user.resName, user.isSuper, user.fullName, user.username, user.status].join('|');
  const hit = cache.get(user.id);
  if (hit && hit.key === key && Date.now() - hit.at < CACHE_MS) return;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Тот же замок, что TP берёт при назначении задач: не меняем роли посреди назначения.
    await client.query('SELECT pg_advisory_xact_lock(817624)');
    const tpUser = await client.query<{ id: string }>(
      `INSERT INTO tp.users(issuer, subject, name, active) VALUES ($1, $2, $3, true)
       ON CONFLICT (issuer, subject) DO UPDATE SET name = EXCLUDED.name, active = true, deleted_at = NULL
       RETURNING id`,
      [TP_ISSUER, String(user.id), user.fullName || user.username]);
    const tpId = tpUser.rows[0].id;

    let tpRes: string | null = null;
    if (user.resName) {
      const found = await client.query<{ id: string }>('SELECT id FROM tp.res_units WHERE name = $1', [user.resName]);
      tpRes = found.rows[0]?.id ?? (await client.query<{ id: string }>(
        'INSERT INTO tp.res_units(code, name) VALUES ($1, $2) RETURNING id', [`ES_${user.resId}`, user.resName])).rows[0].id;
    }

    const wanted = tpRolesOf(user).map(r => ({ role: r.role, res: r.res ? tpRes : null }));
    const current = await client.query<{ id: string; role: string; res_id: string | null }>(
      'SELECT id, role, res_id FROM tp.roles WHERE user_id = $1 AND revoked_at IS NULL', [tpId]);
    for (const r of current.rows) {
      if (!wanted.some(w => w.role === r.role && w.res === r.res_id)) {
        await client.query('UPDATE tp.roles SET revoked_at = now() WHERE id = $1', [r.id]);
      }
    }
    for (const w of wanted) {
      if (!current.rows.some(r => r.role === w.role && r.res_id === w.res)) {
        await client.query('INSERT INTO tp.roles(user_id, role, res_id) VALUES ($1, $2, $3)', [tpId, w.role, w.res]);
      }
    }
    await client.query('COMMIT');
    cache.set(user.id, { key, at: Date.now() });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
