import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { config, oidcBase } from '../config.js';
import { HttpError } from '../db.js';

// Вход — через платформенный Keycloak, но его страница пользователю не
// показывается: логин/пароль из нашей формы сервер сам отправляет в Keycloak
// (Direct Access Grant у клиента web-desktop) и возвращает токены. Так нет
// проблем с CORS Keycloak и не нужен redirect. Токены не логируем.

export interface Identity {
  sub: string;
  username: string;
  email: string | null;
  name: string | null;
  roles: string[];
}

export type Verify = (token: string) => Promise<Identity>;

export function createVerifier(keys?: JWTVerifyGetKey): Verify {
  const jwks = keys ?? createRemoteJWKSet(new URL(`${oidcBase()}/protocol/openid-connect/certs`));
  return async token => {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, jwks, { issuer: oidcBase(), algorithms: ['RS256'], requiredClaims: ['sub', 'exp'] }));
    } catch {
      throw new HttpError(401, 'Сессия истекла. Войдите заново.');
    }
    // aud у public-клиента не проверяем, проверяем, кому выдан токен.
    if (payload.azp !== config.clientId) throw new HttpError(401, 'Токен выдан другому приложению.');
    const roles = (payload.realm_access as { roles?: unknown } | undefined)?.roles;
    const realmRoles = Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string') : [];
    if (config.accessRole && !realmRoles.includes(config.accessRole)) {
      throw new HttpError(403, 'У вашей учётной записи нет доступа к ЭнергоСфере. Обратитесь к администратору.');
    }
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return {
      sub: payload.sub!,
      username: str(payload.preferred_username) ?? payload.sub!,
      email: str(payload.email)?.toLowerCase() ?? null,
      name: str(payload.name),
      roles: realmRoles,
    };
  };
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface TokenClient {
  login(username: string, password: string): Promise<Tokens>;
  refresh(refreshToken: string): Promise<Tokens>;
  logout(refreshToken: string): Promise<void>;
}

export function createTokenClient(fetchImpl: typeof fetch = fetch): TokenClient {
  const post = async (path: string, form: Record<string, string>) => {
    try {
      return await fetchImpl(`${oidcBase()}/protocol/openid-connect/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: config.clientId, ...form }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new HttpError(502, 'Сервис входа не отвечает. Попробуйте через минуту.');
    }
  };

  const tokens = async (response: Response, badGrant: string): Promise<Tokens> => {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const description = String(body.error_description ?? '');
      if (/disabled/i.test(description)) throw new HttpError(403, 'Учётная запись отключена. Обратитесь к администратору.');
      if (/not fully set up|required action/i.test(description)) {
        throw new HttpError(403, 'Учётная запись не настроена до конца (смена пароля и т.п.). Обратитесь к администратору.');
      }
      if (body.error === 'unauthorized_client') throw new HttpError(502, 'Вход по паролю выключен в настройках Keycloak (Direct access grants).');
      if (body.error === 'invalid_grant') throw new HttpError(401, badGrant);
      throw new HttpError(502, 'Сервис входа вернул ошибку. Попробуйте позже.');
    }
    return {
      accessToken: String(body.access_token),
      refreshToken: String(body.refresh_token),
      expiresIn: Number(body.expires_in ?? 300),
      refreshExpiresIn: Number(body.refresh_expires_in ?? 1800),
    };
  };

  return {
    login: async (username, password) =>
      tokens(await post('token', { grant_type: 'password', username, password, scope: 'openid' }), 'Неверный логин или пароль.'),
    refresh: async refreshToken =>
      tokens(await post('token', { grant_type: 'refresh_token', refresh_token: refreshToken }), 'Сессия истекла. Войдите заново.'),
    logout: async refreshToken => { await post('logout', { refresh_token: refreshToken }).catch(() => undefined); },
  };
}
