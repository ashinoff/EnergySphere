import { config } from '../config.js';
import type { Db } from '../db.js';
import type { Identity } from './keycloak.js';
import {
  DEFAULT_ROLE_PERMISSIONS, LOCKED_ROLE, PERMISSION_IDS, ROLES, isPermission, isRole,
  type Permission, type Role,
} from './access.js';

export type UserStatus = 'active' | 'pending' | 'blocked';

export interface UserContext {
  id: number;
  username: string;
  email: string | null;
  fullName: string | null;
  role: Role | null;
  resId: number | null;
  resName: string | null;
  isSuper: boolean;
  status: UserStatus;
  permissions: Set<Permission>;
  // null — все РЭС; массив — только перечисленные.
  resScope: number[] | null;
}

interface UserRow {
  id: number; username: string | null; email: string | null; full_name: string | null;
  role: string | null; res_id: number | null; res_name: string | null;
  extra_permissions: unknown; is_active: boolean;
}

const CACHE_MS = 30_000;

export class AccessService {
  private matrix: { at: number; value: Map<Role, Set<Permission>> } | null = null;
  private users = new Map<string, { at: number; ctx: UserContext }>();

  constructor(private db: Db) {}

  // Стартовые права роли выдаются один раз: отметка в core.seeded_roles. Роль,
  // добавленная в каталог позже, получит свои права при следующем запуске, а
  // права, которые админ потом снял, не вернутся.
  async seedDefaults() {
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const fresh = await this.db.query('INSERT INTO core.seeded_roles(role) VALUES ($1) ON CONFLICT DO NOTHING RETURNING role', [role]);
      if (!fresh.rowCount) continue;
      for (const permission of perms) {
        await this.db.query('INSERT INTO core.role_permissions(role, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING', [role, permission]);
      }
    }
  }

  invalidate() { this.matrix = null; this.users.clear(); }

  async roleMatrix(): Promise<Map<Role, Set<Permission>>> {
    if (this.matrix && Date.now() - this.matrix.at < CACHE_MS) return this.matrix.value;
    const value = new Map<Role, Set<Permission>>(Object.keys(ROLES).map(r => [r as Role, new Set<Permission>()]));
    const { rows } = await this.db.query<{ role: string; permission: string }>('SELECT role, permission FROM core.role_permissions');
    for (const row of rows) if (isRole(row.role) && isPermission(row.permission)) value.get(row.role)!.add(row.permission);
    value.set(LOCKED_ROLE, new Set(PERMISSION_IDS));
    this.matrix = { at: Date.now(), value };
    return value;
  }

  // Учётка ищется по keycloak_id, затем один раз по e-mail (привязка), иначе
  // создаётся «ожидающей роли». Доступ к данным даёт только назначенная роль.
  async resolve(identity: Identity): Promise<UserContext> {
    const cached = this.users.get(identity.sub);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.ctx;

    let id: number | undefined;
    const bySub = await this.db.query<{ id: number }>('SELECT id FROM core.users WHERE keycloak_id=$1', [identity.sub]);
    id = bySub.rows[0]?.id;
    if (!id && identity.email) {
      const byEmail = await this.db.query<{ id: number }>(
        'UPDATE core.users SET keycloak_id=$1 WHERE lower(email)=$2 AND keycloak_id IS NULL RETURNING id', [identity.sub, identity.email]);
      id = byEmail.rows[0]?.id;
    }
    // E-mail уже занят учёткой, привязанной к другому keycloak_id, — заводим без него.
    const emailFree = identity.email
      ? !(await this.db.query('SELECT 1 FROM core.users WHERE lower(email)=$1', [identity.email])).rowCount
      : true;
    const email = emailFree ? identity.email : null;
    if (!id) {
      const created = await this.db.query<{ id: number }>(
        `INSERT INTO core.users(keycloak_id, username, email, full_name) VALUES ($1, $2, $3, $4)
         ON CONFLICT (keycloak_id) DO UPDATE SET username=EXCLUDED.username RETURNING id`,
        [identity.sub, identity.username, email, identity.name]);
      id = created.rows[0].id;
    }
    await this.db.query(
      `UPDATE core.users SET username=$2, email=COALESCE($3, email), full_name=COALESCE($4, full_name), last_login_at=now()
       WHERE id=$1 AND (last_login_at IS NULL OR last_login_at < now() - interval '5 minutes' OR username IS DISTINCT FROM $2)`,
      [id, identity.username, email, identity.name]);

    const ctx = await this.load(id, identity);
    this.users.set(identity.sub, { at: Date.now(), ctx });
    return ctx;
  }

  async load(id: number, identity?: Pick<Identity, 'username' | 'email'>): Promise<UserContext> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT u.id, u.username, u.email, u.full_name, u.role, u.res_id, r.name AS res_name, u.extra_permissions, u.is_active
       FROM core.users u LEFT JOIN core.res r ON r.id=u.res_id WHERE u.id=$1`, [id]);
    const row = rows[0];
    const username = row.username ?? identity?.username ?? '';
    const email = row.email ?? identity?.email ?? null;
    const isSuper = [username, email].some(v => v && config.superAdmins.includes(v.toLowerCase()));
    const role = isRole(row.role) ? row.role : null;

    let permissions = new Set<Permission>();
    if (isSuper) permissions = new Set(PERMISSION_IDS);
    else if (role && row.is_active) {
      permissions = new Set((await this.roleMatrix()).get(role));
      const extra = Array.isArray(row.extra_permissions) ? row.extra_permissions : [];
      for (const p of extra) if (isPermission(p)) permissions.add(p);
    }

    const status: UserStatus = !row.is_active && !isSuper ? 'blocked' : role || isSuper ? 'active' : 'pending';
    const allRes = isSuper || (role !== null && ROLES[role].scope === 'all');
    return {
      id: row.id, username, email, fullName: row.full_name, role, resId: row.res_id, resName: row.res_name,
      isSuper, status, permissions,
      resScope: allRes ? null : row.res_id ? [row.res_id] : [],
    };
  }
}

export const toPublicUser = (ctx: UserContext) => ({
  id: ctx.id,
  username: ctx.username,
  email: ctx.email,
  fullName: ctx.fullName,
  role: ctx.role,
  roleTitle: ctx.role ? ROLES[ctx.role].title : ctx.isSuper ? 'Суперадминистратор' : null,
  res: ctx.resId ? { id: ctx.resId, name: ctx.resName } : null,
  isSuper: ctx.isSuper,
  status: ctx.status,
  permissions: [...ctx.permissions],
  allRes: ctx.resScope === null,
});
