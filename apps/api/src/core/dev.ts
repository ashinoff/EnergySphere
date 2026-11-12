import { PERMISSIONS, type Permission } from './access.js';
import type { UserContext } from './access-service.js';
import type { Identity } from './keycloak.js';

// Только разработка (AUTH_DISABLED): настоящая учётка «dev» в базе — чтобы
// работало всё, что ссылается на пользователя, — но с правами суперадмина.
export const DEV_IDENTITY: Identity = { sub: 'dev-local', username: 'dev', email: null, name: 'Разработчик (вход без Keycloak)', roles: [] };
export const asDevSuper = (user: UserContext): UserContext => ({
  ...user, isSuper: true, status: 'active', resScope: null,
  permissions: new Set(Object.keys(PERMISSIONS) as Permission[]),
});
