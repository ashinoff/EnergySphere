import express, { type NextFunction, type Request, type Response } from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { config } from './config.js';
import { HttpError, type Db } from './db.js';
import type { TokenClient, Verify } from './core/keycloak.js';
import { AccessService, toPublicUser, type UserContext } from './core/access-service.js';
import {
  LOCKED_ROLE, PERMISSIONS, PERMISSION_GROUPS, ROLES, ROLE_IDS, isPermission, isRole, type Permission,
} from './core/access.js';
import { mountModules } from './modules/index.js';
import { requirePermission, route, userOf } from './core/http.js';
import { DEV_IDENTITY, asDevSuper } from './core/dev.js';
import { mountTp } from './modules/tp/mount.js';

export { requirePermission, userOf };

export interface AppDeps {
  db: Db;
  // Подключение модуля «Акты ТП» под служебной ролью tp_runtime (без него модуль не подключается).
  tpDb?: Db;
  verify: Verify;
  tokens: TokenClient;
  access: AccessService;
}

const credentials = z.object({ username: z.string().trim().min(1).max(200), password: z.string().min(1).max(500) });
const refreshBody = z.object({ refreshToken: z.string().min(10).max(8000) });
const userPatch = z.object({
  role: z.string().nullable().optional(),
  resId: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
  extraPermissions: z.array(z.string()).max(100).optional(),
  fullName: z.string().trim().max(200).optional(),
});
const resBody = z.object({ name: z.string().trim().min(2).max(120), sort: z.number().int().min(0).max(100000).optional() });

export function createApp({ db, tpDb, verify, tokens, access }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({
    frameguard: false, // приложение открывается и внутри платформы (iframe)
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // подложка карты геометки (модуль 02)
        imgSrc: ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'self'", config.platformOrigin],
      },
    },
  }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));

  const audit = (user: UserContext, action: string, details: object) =>
    user.id ? db.query('INSERT INTO core.audit(user_id, action, details) VALUES ($1, $2, $3)', [user.id, action, details]) : undefined;

  app.get('/api/health', route(async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true });
  }));

  // ── Вход (без авторизации) ─────────────────────────────────────────────
  app.post('/api/auth/login', route(async (req, res) => {
    const body = credentials.safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'Введите логин и пароль.');
    res.json(await tokens.login(body.data.username, body.data.password));
  }));
  app.post('/api/auth/refresh', route(async (req, res) => {
    const body = refreshBody.safeParse(req.body);
    if (!body.success) throw new HttpError(401, 'Сессия истекла. Войдите заново.');
    res.json(await tokens.refresh(body.data.refreshToken));
  }));
  app.post('/api/auth/logout', route(async (req, res) => {
    const body = refreshBody.safeParse(req.body);
    if (body.success) await tokens.logout(body.data.refreshToken);
    res.json({ ok: true });
  }));

  // Счётчик для плитки платформы запрашивается с её домена (fetch с токеном).
  app.use('/api/platform/badge', cors({ origin: config.platformOrigin, methods: ['GET'], allowedHeaders: ['Authorization'], maxAge: 600 }));

  // ── Всё остальное под /api — только с токеном ────────────────────────
  app.use('/api', (req, res, next) => {
    if (config.authDisabled && !config.production) {
      access.resolve(DEV_IDENTITY).then(user => { res.locals.user = asDevSuper(user); next(); }, next);
      return;
    }
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next(new HttpError(401, 'Войдите в систему.'));
    verify(header.slice(7)).then(identity => access.resolve(identity))
      .then(user => { res.locals.user = user; next(); }, next);
  }, (req, res, next) => {
    // /api/me отвечает и заблокированным/ожидающим — интерфейс покажет их статус.
    const user = userOf(res);
    if (req.path === '/me' || user.status === 'active') return next();
    next(new HttpError(403, user.status === 'blocked' ? 'Учётная запись заблокирована.' : 'Администратор ещё не назначил вам роль.'));
  });

  app.get('/api/me', (_req, res) => { res.json(toPublicUser(userOf(res))); });

  app.get('/api/catalog', (_req, res) => {
    res.json({ roles: ROLES, permissions: PERMISSIONS, groups: PERMISSION_GROUPS, lockedRole: LOCKED_ROLE });
  });

  app.get('/api/res', route(async (_req, res) => {
    const { rows } = await db.query('SELECT id, name, sort FROM core.res ORDER BY sort, name');
    res.json(rows);
  }));

  // ── Админка: пользователи ─────────────────────────────────────────────
  app.get('/api/admin/users', requirePermission('admin.users'), route(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT u.id, u.username, u.email, u.full_name AS "fullName", u.role, u.res_id AS "resId", r.name AS "resName",
              u.extra_permissions AS "extraPermissions", u.is_active AS "isActive", u.created_at AS "createdAt",
              u.last_login_at AS "lastLoginAt"
       FROM core.users u LEFT JOIN core.res r ON r.id=u.res_id
       ORDER BY (u.role IS NULL) DESC, u.full_name NULLS LAST, u.username`);
    const supers = new Set(config.superAdmins);
    res.json(rows.map(u => ({ ...u, isSuper: [u.username, u.email].some((v: string | null) => v && supers.has(v.toLowerCase())) })));
  }));

  app.patch('/api/admin/users/:id', requirePermission('admin.users'), route(async (req, res) => {
    const me = userOf(res);
    const id = Number(req.params.id);
    const body = userPatch.safeParse(req.body);
    if (!Number.isInteger(id) || !body.success) throw new HttpError(400, 'Некорректные данные.');
    const patch = body.data;
    const target = await db.query<{ role: string | null; res_id: number | null }>('SELECT role, res_id FROM core.users WHERE id=$1', [id]);
    if (!target.rowCount) throw new HttpError(404, 'Пользователь не найден.');
    const current = target.rows[0];

    const canAdmin = me.isSuper || me.role === LOCKED_ROLE;
    if (id === me.id && !me.isSuper && (patch.role !== undefined || patch.extraPermissions || patch.isActive === false)) {
      throw new HttpError(403, 'Свою роль и права меняет другой администратор.');
    }
    if (!canAdmin && (current.role === LOCKED_ROLE || patch.role === LOCKED_ROLE)) {
      throw new HttpError(403, 'Учётки администраторов меняет только администратор.');
    }
    if (patch.extraPermissions && !me.permissions.has('admin.permissions')) {
      throw new HttpError(403, `Недостаточно прав: ${PERMISSIONS['admin.permissions'].title}`);
    }
    if (patch.role !== undefined && patch.role !== null && !isRole(patch.role)) throw new HttpError(400, 'Неизвестная роль.');
    if (patch.extraPermissions?.some(p => !isPermission(p))) throw new HttpError(400, 'Неизвестное право.');

    const role = patch.role !== undefined ? patch.role : current.role;
    const resId = patch.resId !== undefined ? patch.resId : current.res_id;
    if (isRole(role) && ROLES[role].scope === 'res' && !resId) {
      throw new HttpError(400, `Для роли «${ROLES[role].title}» нужно выбрать РЭС.`);
    }

    await db.query(
      `UPDATE core.users SET role=$2, res_id=$3,
         is_active=COALESCE($4, is_active), extra_permissions=COALESCE($5, extra_permissions), full_name=COALESCE($6, full_name)
       WHERE id=$1`,
      [id, role, resId, patch.isActive ?? null, patch.extraPermissions ? JSON.stringify([...new Set(patch.extraPermissions)]) : null,
        patch.fullName || null]);
    access.invalidate();
    await audit(me, 'user.update', { id, ...patch });
    res.json({ ok: true });
  }));

  // ── Админка: матрица прав ролей ──────────────────────────────────────
  app.get('/api/admin/roles', requirePermission('admin.permissions'), route(async (_req, res) => {
    const matrix = await access.roleMatrix();
    res.json(Object.fromEntries(ROLE_IDS.map(r => [r, [...(matrix.get(r) ?? [])]])));
  }));

  app.put('/api/admin/roles/:role', requirePermission('admin.permissions'), route(async (req, res) => {
    const role = req.params.role;
    const perms = z.object({ permissions: z.array(z.string()).max(200) }).safeParse(req.body);
    if (!isRole(role) || !perms.success || perms.data.permissions.some(p => !isPermission(p))) throw new HttpError(400, 'Некорректные данные.');
    if (role === LOCKED_ROLE) throw new HttpError(400, 'У администратора всегда все права.');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM core.role_permissions WHERE role=$1', [role]);
      for (const p of new Set(perms.data.permissions)) {
        await client.query('INSERT INTO core.role_permissions(role, permission) VALUES ($1, $2)', [role, p]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    access.invalidate();
    await audit(userOf(res), 'role.update', { role, permissions: perms.data.permissions });
    res.json({ ok: true });
  }));

  // ── Админка: справочник РЭС ──────────────────────────────────────────
  app.post('/api/admin/res', requirePermission('admin.users'), route(async (req, res) => {
    const body = resBody.safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'Название РЭС — от 2 до 120 символов.');
    const { rows } = await db.query(
      `INSERT INTO core.res(name, sort) VALUES ($1, COALESCE($2, (SELECT COALESCE(max(sort), 0) + 10 FROM core.res)))
       ON CONFLICT (name) DO NOTHING RETURNING id, name, sort`, [body.data.name, body.data.sort ?? null]);
    if (!rows.length) throw new HttpError(409, 'Такой РЭС уже есть.');
    await audit(userOf(res), 'res.create', rows[0]);
    res.status(201).json(rows[0]);
  }));

  app.patch('/api/admin/res/:id', requirePermission('admin.users'), route(async (req, res) => {
    const body = resBody.safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'Название РЭС — от 2 до 120 символов.');
    const { rowCount } = await db.query('UPDATE core.res SET name=$2, sort=COALESCE($3, sort) WHERE id=$1',
      [Number(req.params.id), body.data.name, body.data.sort ?? null]).catch((error: { code?: string }) => {
      throw error.code === '23505' ? new HttpError(409, 'Такой РЭС уже есть.') : error;
    });
    if (!rowCount) throw new HttpError(404, 'РЭС не найден.');
    access.invalidate();
    await audit(userOf(res), 'res.update', { id: Number(req.params.id), ...body.data });
    res.json({ ok: true });
  }));

  app.delete('/api/admin/res/:id', requirePermission('admin.users'), route(async (req, res) => {
    const id = Number(req.params.id);
    const used = await db.query('SELECT count(*)::int AS n FROM core.users WHERE res_id=$1', [id]);
    if (used.rows[0].n) throw new HttpError(409, `К РЭС привязано пользователей: ${used.rows[0].n}. Сначала переназначьте их.`);
    await db.query('DELETE FROM core.res WHERE id=$1', [id]);
    await audit(userOf(res), 'res.delete', { id });
    res.json({ ok: true });
  }));

  mountModules(app, { db });
  // Модуль 04 «Акты ТП» (TP_Approval) — своё Express-приложение под /tp со своим
  // API (/tp/api/v1), интерфейсом (/tp/) и входом через мост к пользователям Сферы.
  if (tpDb) mountTp(app, { db, tpDb, verify, access });

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Не найдено.')));

  // ── Интерфейс ───────────────────────────────────────────────────────
  const web = resolve(config.webPath);
  if (existsSync(web)) {
    app.use(express.static(web, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(resolve(web, 'index.html')); });
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    console.error('[api] ошибка:', error instanceof Error ? error.message : error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера.' });
  });

  return app;
}
