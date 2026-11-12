import type { Express } from 'express';

// Реестр модулей. Каждый модуль — своя папка modules/<id>/ со своим роутером
// под /api/<id>/..., своей схемой в базе (db/migrations/<id>/) и без импорта
// других модулей. Общее — только core (пользователь, РЭС, права).
// Этап 0: модули ещё пустые — роуты появятся вместе с модулями.
export function mountModules(_app: Express) {}
