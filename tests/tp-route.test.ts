// Сквозной маршрут «Актов ТП» на сервере Сферы: сценарий TP_Approval (tests/tp/,
// импорт scripts/import-tp.mjs) с людьми и ролями из Сферы. База — как на Amvera:
// владелец обычный (не суперпользователь), модуль работает под tp_runtime.
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import request from 'supertest';

process.env.SUPER_ADMINS = 'boss';
process.env.KEYCLOAK_URL = 'https://kc.test';
process.env.KEYCLOAK_REALM = 'platform';
process.env.STORAGE_PATH = mkdtempSync(join(tmpdir(), 'es-tp-store-'));

const { createApp } = await import('../apps/api/src/app.js');
const { AccessService } = await import('../apps/api/src/core/access-service.js');
const { createVerifier, createTokenClient } = await import('../apps/api/src/core/keycloak.js');
const { migrate } = await import('../apps/api/src/migrate.js');
const { createPool } = await import('../apps/api/src/db.js');
const { runRiruChecks } = await import('./tp/riru-review.integration.js');

const dir = mkdtempSync(join(tmpdir(), 'es-tp-pg-'));
const port = 55000 + Math.floor(Math.random() * 400);
const server = new EmbeddedPostgres({ databaseDir: dir, port, user: 'postgres', password: 'postgres', persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
const db = createPool(`postgres://es_owner:es_owner@127.0.0.1:${port}/es_tp`);
const tpDb = createPool(`postgres://tp_runtime:tp_runtime@127.0.0.1:${port}/es_tp`);
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] });
const sign = (username: string) => new SignJWT({ preferred_username: username, name: username, azp: 'web-desktop', realm_access: { roles: [] } })
  .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setSubject(`sub-${username}`).setIssuer('https://kc.test/realms/platform')
  .setIssuedAt().setExpirationTime('30m').sign(privateKey);

before(async () => {
  await server.initialise();
  await server.start();
  const admin = new pg.Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${port}/postgres` });
  await admin.connect();
  await admin.query("CREATE ROLE es_owner LOGIN PASSWORD 'es_owner' NOSUPERUSER NOCREATEROLE NOBYPASSRLS");
  await admin.query('CREATE DATABASE es_tp OWNER es_owner');
  await admin.query("CREATE ROLE tp_runtime LOGIN PASSWORD 'tp_runtime' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS");
  await admin.end();
  await migrate(db, 'db/migrations');
}, { timeout: 120_000 });

after(async () => {
  await tpDb.end();
  await db.end();
  await server.stop();
  for (const d of [dir, process.env.STORAGE_PATH!]) {
    try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* останется в TEMP */ }
  }
});

test('маршрут согласования TP_Approval на ролях Сферы (riru-review)', { timeout: 120_000 }, async () => {
  const access = new AccessService(db);
  await access.seedDefaults();
  const app = createApp({ db, tpDb, access, verify: createVerifier(jwks), tokens: createTokenClient(async () => new Response('{}', { status: 500 })) });

  // Участники сценария TP → роли Сферы. «other» — начальник РИРУ другого РЭС.
  const people: Record<string, { role: string; res?: string }> = {
    riru: { role: 'eng_development', res: 'Адлерский РЭС' },   // документы ведёт инженер развития
    'riru-head': { role: 'nach_riru', res: 'Адлерский РЭС' },
    chief: { role: 'nach_res', res: 'Адлерский РЭС' },
    sue: { role: 'nach_sue' }, stp: { role: 'nach_stp' }, gi: { role: 'glav_ing' },
    tech: { role: 'admin' }, process: { role: 'admin' },
    other: { role: 'nach_riru', res: 'Хостинский РЭС' },
  };
  const tokens: Record<string, string> = {};
  const boss = { Authorization: `Bearer ${await sign('boss')}` };
  const resList = (await request(app).get('/api/res').set(boss)).body as { id: number; name: string }[];
  for (const name of Object.keys(people)) {
    tokens[name] = await sign(name);
    await request(app).get('/api/me').set('Authorization', `Bearer ${tokens[name]}`);
  }
  const sphereUsers = (await request(app).get('/api/admin/users').set(boss)).body as { id: number; username: string }[];
  const users: Record<string, string> = {};
  for (const [name, p] of Object.entries(people)) {
    const id = sphereUsers.find(u => u.username === name)!.id;
    const resId = p.res ? resList.find(r => r.name === p.res)!.id : null;
    const set = await request(app).patch(`/api/admin/users/${id}`).set(boss).send({ role: p.role, resId });
    if (set.status !== 200) throw new Error(`${name}: ${JSON.stringify(set.body)}`);
    const me = await request(app).get('/tp/api/v1/me').set('Authorization', `Bearer ${tokens[name]}`);
    if (me.status !== 200) throw new Error(`${name}: ${JSON.stringify(me.body)}`);
    users[name] = me.body.id;
  }
  const area = (await request(app).get('/tp/api/v1/me').set('Authorization', `Bearer ${tokens.riru}`)).body.roles[0].resId as string;

  await runRiruChecks({ app, owner: db, tokens, users, area });
});
