const list = (value: string | undefined) => (value ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export const config = {
  production: process.env.NODE_ENV === 'production',
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? '',
  keycloakUrl: (process.env.KEYCLOAK_URL ?? 'https://keycloak-waw-ashinoff.waw0.amvera.tech').replace(/\/+$/, ''),
  realm: process.env.KEYCLOAK_REALM ?? 'platform',
  clientId: process.env.KEYCLOAK_CLIENT ?? 'web-desktop',
  // Пусто — realm-роль не требуется: доступ решает своя база (роль назначает админ).
  accessRole: (process.env.ACCESS_ROLE ?? '').trim(),
  superAdmins: list(process.env.SUPER_ADMINS),
  platformOrigin: process.env.PLATFORM_ORIGIN ?? 'https://sue-system-2-ashinoff.waw0.amvera.tech',
  webPath: process.env.WEB_PATH ?? 'dist/web',
  migrationsPath: process.env.MIGRATIONS_PATH ?? 'db/migrations',
  // Файлы, поставляемые с приложением (PDF нормативки и т.п.), и загруженные файлы.
  seedPath: process.env.SEED_PATH ?? 'db/seed',
  storagePath: process.env.STORAGE_PATH ?? '.data/storage',
  authDisabled: process.env.AUTH_DISABLED === 'true',
};

export const oidcBase = () => `${config.keycloakUrl}/realms/${config.realm}`;
