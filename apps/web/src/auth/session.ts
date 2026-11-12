// Сессия на клиенте: токены Keycloak лежат в localStorage, продлеваются через
// наш сервер (/api/auth/refresh). Внутри платформы токен приходит от неё
// (postMessage platform-auth) — тогда refresh-токена нет, и за новым токеном
// мы снова обращаемся к платформе (app-ready).

const KEY = 'energysphere.auth.v1';
const PLATFORM_ORIGIN = import.meta.env.VITE_PLATFORM_ORIGIN || 'https://sue-system-2-ashinoff.waw0.amvera.tech';
export const EMBEDDED = (() => { try { return window.self !== window.top; } catch { return true; } })();

interface Stored { accessToken: string; refreshToken: string | null; expiresAt: number }
interface TokenResponse { accessToken: string; refreshToken: string; expiresIn: number }

let session: Stored | null = load();
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function load(): Stored | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}
function save(next: Stored | null) {
  session = next;
  try { next ? localStorage.setItem(KEY, JSON.stringify(next)) : localStorage.removeItem(KEY); } catch { /* приватный режим */ }
  listeners.forEach(fn => fn());
}
const fromTokens = (t: TokenResponse): Stored => ({ accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: Date.now() + t.expiresIn * 1000 });

export const hasSession = () => session !== null;
export const onSessionChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function readError(response: Response) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return new ApiError(response.status, body?.error ?? `Ошибка сервера (${response.status})`);
}

export async function login(username: string, password: string) {
  const response = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  }).catch(() => { throw new ApiError(0, 'Нет связи с сервером. Проверьте интернет.'); });
  if (!response.ok) throw await readError(response);
  save(fromTokens(await response.json()));
}

export function logout() {
  const refreshToken = session?.refreshToken;
  save(null);
  if (refreshToken) {
    void fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) }).catch(() => {});
  }
}

function refresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  const refreshToken = session?.refreshToken;
  if (!refreshToken) return Promise.resolve(false);
  refreshing = fetch('/api/auth/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }),
  }).then(async response => {
    if (response.ok) { save(fromTokens(await response.json())); return true; }
    if (response.status === 401) save(null);
    return false;
  }).catch(() => false).finally(() => { refreshing = null; });
  return refreshing;
}

// Запрос к API с токеном. Перед истечением токен продлевается, на 401 — одна
// попытка продлить и повторить, потом выход на экран входа.
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  if (session?.refreshToken && session.expiresAt - Date.now() < 30_000) await refresh();
  const send = () => {
    const headers = new Headers(init.headers);
    if (session) headers.set('Authorization', `Bearer ${session.accessToken}`);
    if (init.json !== undefined) headers.set('Content-Type', 'application/json');
    return fetch(path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body })
      .catch(() => { throw new ApiError(0, 'Нет связи с сервером. Проверьте интернет.'); });
  };
  let response = await send();
  if (response.status === 401 && session) {
    if (await refresh()) response = await send();
    else if (EMBEDDED) askPlatform();
    else save(null);
  }
  if (!response.ok) throw await readError(response);
  return response.status === 204 ? (undefined as T) : response.json();
}

// ── Встраивание в платформу ──────────────────────────────────────────
function askPlatform() {
  window.parent?.postMessage({ type: 'app-ready' }, PLATFORM_ORIGIN);
}

export function listenPlatform() {
  if (!EMBEDDED) return () => {};
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== PLATFORM_ORIGIN) return;
    const data = event.data as { type?: string; token?: unknown };
    if (data?.type !== 'platform-auth' || typeof data.token !== 'string') return;
    save({ accessToken: data.token, refreshToken: null, expiresAt: Date.now() + 4 * 60_000 });
  };
  window.addEventListener('message', onMessage);
  askPlatform();
  return () => window.removeEventListener('message', onMessage);
}
