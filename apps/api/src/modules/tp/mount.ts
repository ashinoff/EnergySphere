import type { Express } from 'express';
import { join, resolve } from 'node:path';
import { config } from '../../config.js';
import { HttpError, type Db } from '../../db.js';
import type { Verify } from '../../core/keycloak.js';
import type { AccessService } from '../../core/access-service.js';
import { DEV_IDENTITY, asDevSuper } from '../../core/dev.js';
import { createApp as createTpApp } from './core/app.js';
import { HttpError as TpHttpError } from './core/db.js';
import { TP_ISSUER, syncTpUser } from './bridge.js';
import { actBuilder } from './acts/routes.js';

// Модуль 04 «Акты ТП» = TP_Approval (core/ — импорт scripts/import-tp.mjs).
// Его приложение работает как есть в режиме keycloak; вместо проверки токена
// Keycloak ему подаётся своя: токен Сферы → пользователь Сферы → мост в tp.users.
export function mountTp(app: Express, { db, tpDb, verify, access }: { db: Db; tpDb: Db; verify: Verify; access: AccessService }) {
  const authenticate = async (header: string | undefined) => {
    try {
      let user;
      if (config.authDisabled && !config.production) user = asDevSuper(await access.resolve(DEV_IDENTITY));
      else {
        if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Войдите в систему.');
        user = await access.resolve(await verify(header.slice(7)));
      }
      if (user.status !== 'active') throw new HttpError(403, 'Учётная запись не активна.');
      if (!user.permissions.has('tp.view')) throw new HttpError(403, 'Нет доступа к разделу «Акты ТП». Обратитесь к администратору.');
      await syncTpUser(db, user);
      return { issuer: TP_ISSUER, subject: String(user.id) };
    } catch (error) {
      if (error instanceof HttpError) throw new TpHttpError(error.status, error.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN', error.message);
      throw error;
    }
  };

  // Запросы модуля — под tp_runtime (политики защиты строк действуют), мост ролей —
  // под владельцем (таблицы учёток TP ему не доступны на запись).
  const tp = createTpApp(tpDb, {
    authMode: 'keycloak',
    // Проверку токена выполняет authenticate — эти поля TP в таком режиме не использует.
    issuer: 'https://energysphere.invalid', jwksUrl: 'https://energysphere.invalid/certs', audience: 'energysphere',
    // Страницы TP открываются во фрейме Сферы, а Сфера — во фрейме платформы.
    platformOrigin: `'self' ${config.platformOrigin}`,
    storagePath: join(config.storagePath, 'tp'),
    maxFileBytes: 20 * 1024 * 1024,
    production: config.production,
    clamavHost: process.env.CLAMAV_HOST || undefined,
    clamavPort: Number(process.env.CLAMAV_PORT || 3310),
    webPath: resolve(config.webPath, 'tp'),
    trustProxyHops: 1,
  }, authenticate);
  // «Создание акта по ТУ» (modules/tp/acts) — раньше приложения TP: у него свой ответ 404.
  app.use('/tp/api/v1/act-builder', actBuilder({ pool: tpDb, authenticate, storagePath: join(config.storagePath, 'tp') }));
  app.use('/tp', tp);
}
