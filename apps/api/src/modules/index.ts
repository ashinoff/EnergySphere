import type { Express } from 'express';
import type { Db } from '../db.js';
import { mountConsumers } from './consumers/router.js';
import { mountRiru } from './riru/router.js';

// Реестр модулей. Каждый модуль — своя папка modules/<id>/ со своим роутером
// под /api/<id>/..., своей схемой в базе (db/migrations/<id>/) и без импорта
// других модулей. Общее — только core (пользователь, РЭС, права).
// Модуль 01 (анализ) серверной части не имеет — он целиком в браузере.
export function mountModules(app: Express, deps: { db: Db }) {
  mountConsumers(app, deps);
  mountRiru(app, deps);
}
