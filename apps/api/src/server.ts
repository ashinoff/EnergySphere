import { config } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { resetDatabaseOnce } from './reset.js';
import { createApp } from './app.js';
import { AccessService } from './core/access-service.js';
import { createTokenClient, createVerifier } from './core/keycloak.js';

if (!config.databaseUrl) throw new Error('Не задан DATABASE_URL');
if (config.authDisabled && config.production) throw new Error('AUTH_DISABLED нельзя включать в продакшене');

const db = createPool(config.databaseUrl);

// Гонка DNS базы на старте контейнера Amvera — несколько попыток подключения.
for (let attempt = 1; ; attempt++) {
  try { await db.query('SELECT 1'); break; } catch (error) {
    if (attempt >= 15) throw error;
    console.log(`[db] нет подключения (попытка ${attempt}), повтор через 3 с`);
    await new Promise(r => setTimeout(r, 3000));
  }
}

if (process.env.RESET_DATABASE_URL) {
  await resetDatabaseOnce(process.env.RESET_DATABASE_URL, process.env.RESET_CONFIRM ?? '');
}

await migrate(db, config.migrationsPath);
const access = new AccessService(db);
await access.seedDefaults();

const app = createApp({ db, access, verify: createVerifier(), tokens: createTokenClient() });
app.listen(config.port, config.host, () => {
  console.log(`ЭнергоСфера слушает ${config.host}:${config.port}${config.authDisabled ? ' (вход без Keycloak — только для разработки)' : ''}`);
});
