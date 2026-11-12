import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../db.js';
import { PERMISSIONS, type Permission } from './access.js';
import type { UserContext } from './access-service.js';

// Общие помощники маршрутов для ядра и модулей.
type Handler = (req: Request, res: Response) => Promise<unknown>;
export const route = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
export const userOf = (res: Response) => res.locals.user as UserContext;

export function requirePermission(...keys: Permission[]) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const user = userOf(res);
    if (keys.some(k => user.permissions.has(k))) return next();
    next(new HttpError(403, `Недостаточно прав: ${PERMISSIONS[keys[0]].title}`));
  };
}
