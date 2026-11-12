// Интеграционный тест ядра: настоящая Postgres (embedded), настоящие миграции,
// Keycloak-токены подписаны тестовым ключом (локальный JWKS вместо Keycloak).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import request from 'supertest';

process.env.SUPER_ADMINS = 'boss';
process.env.KEYCLOAK_URL = 'https://kc.test';
process.env.KEYCLOAK_REALM = 'platform';
process.env.STORAGE_PATH = mkdtempSync(join(tmpdir(), 'es-store-'));

const { createApp } = await import('../apps/api/src/app.js');
const { AccessService } = await import('../apps/api/src/core/access-service.js');
const { createVerifier, createTokenClient } = await import('../apps/api/src/core/keycloak.js');
const { migrate } = await import('../apps/api/src/migrate.js');
const { createPool } = await import('../apps/api/src/db.js');

const dir = mkdtempSync(join(tmpdir(), 'es-pg-'));
const port = 54400 + Math.floor(Math.random() * 400);
const pg = new EmbeddedPostgres({ databaseDir: dir, port, user: 'postgres', password: 'postgres', persistent: true });
const db = createPool(`postgres://postgres:postgres@127.0.0.1:${port}/es_test`);
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] });

let app: ReturnType<typeof createApp>;
let access: InstanceType<typeof AccessService>;

const token = (sub: string, username: string, extra: Record<string, unknown> = {}) =>
  new SignJWT({ preferred_username: username, azp: 'web-desktop', realm_access: { roles: [] }, ...extra })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setSubject(sub).setIssuer('https://kc.test/realms/platform')
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
const as = async (sub: string, username: string, extra?: Record<string, unknown>) =>
  ({ Authorization: `Bearer ${await token(sub, username, extra)}` });

before(async () => {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('es_test');
  await migrate(db, 'db/migrations');
  await migrate(db, 'db/migrations'); // повторный запуск ничего не ломает
  access = new AccessService(db);
  await access.seedDefaults();
  app = createApp({ db, access, verify: createVerifier(jwks), tokens: createTokenClient(async () => new Response('{}', { status: 500 })) });
}, { timeout: 120_000 });

after(async () => {
  await db.end();
  await pg.stop();
  // На Windows Postgres отпускает файлы не сразу — временная папка не критична.
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* останется в TEMP */ }
});

test('без токена — 401, с чужим azp — 401', async () => {
  assert.equal((await request(app).get('/api/me')).status, 401);
  const res = await request(app).get('/api/me').set(await as('x', 'x', { azp: 'other' }));
  assert.equal(res.status, 401);
});

test('новый сотрудник: учётка создаётся «ожидающей роли», данных не видит', async () => {
  const headers = await as('sub-monter', 'ivanov', { email: 'Ivanov@Test.ru', name: 'Иванов И.И.' });
  const me = await request(app).get('/api/me').set(headers);
  assert.equal(me.status, 200);
  assert.equal(me.body.status, 'pending');
  assert.deepEqual(me.body.permissions, []);
  assert.equal(me.body.email, 'ivanov@test.ru');
  assert.equal((await request(app).get('/api/res').set(headers)).status, 403);
});

test('суперадмин видит всё и назначает роль; роль «свой РЭС» без РЭС не сохраняется', async () => {
  const boss = await as('sub-boss', 'boss');
  const me = await request(app).get('/api/me').set(boss);
  assert.equal(me.body.isSuper, true);
  assert.equal(me.body.allRes, true);

  const users = await request(app).get('/api/admin/users').set(boss);
  assert.equal(users.status, 200);
  const ivanov = users.body.find((u: { username: string }) => u.username === 'ivanov');
  assert.ok(ivanov);

  const noRes = await request(app).patch(`/api/admin/users/${ivanov.id}`).set(boss).send({ role: 'monter' });
  assert.equal(noRes.status, 400);
  assert.match(noRes.body.error, /РЭС/);

  const res = await request(app).get('/api/res').set(boss);
  assert.equal(res.body.length, 7);
  const ok = await request(app).patch(`/api/admin/users/${ivanov.id}`).set(boss).send({ role: 'monter', resId: res.body[0].id });
  assert.equal(ok.status, 200);

  const monter = await request(app).get('/api/me').set(await as('sub-monter', 'ivanov'));
  assert.equal(monter.body.status, 'active');
  assert.equal(monter.body.allRes, false);
  assert.equal(monter.body.res.name, 'Адлерский РЭС');
  assert.deepEqual([...monter.body.permissions].sort(), ['consumers.field', 'consumers.view']);
});

test('права роли меняются в матрице и применяются; у администратора матрицу не изменить', async () => {
  const boss = await as('sub-boss', 'boss');
  const matrix = await request(app).get('/api/admin/roles').set(boss);
  const put = await request(app).put('/api/admin/roles/monter').set(boss)
    .send({ permissions: [...matrix.body.monter, 'riru.view'] });
  assert.equal(put.status, 200);
  const monter = await request(app).get('/api/me').set(await as('sub-monter', 'ivanov'));
  assert.ok(monter.body.permissions.includes('riru.view'));

  assert.equal((await request(app).put('/api/admin/roles/admin').set(boss).send({ permissions: [] })).status, 400);
  assert.equal((await request(app).put('/api/admin/roles/monter').set(boss).send({ permissions: ['nope'] })).status, 400);
});

test('монтёр не попадает в админку и не раздаёт себе права', async () => {
  const monter = await as('sub-monter', 'ivanov');
  assert.equal((await request(app).get('/api/admin/users').set(monter)).status, 403);
  const me = await request(app).get('/api/me').set(monter);
  assert.equal((await request(app).patch(`/api/admin/users/${me.body.id}`).set(monter).send({ role: 'admin' })).status, 403);
});

test('заблокированный видит свой статус, но не данные', async () => {
  const boss = await as('sub-boss', 'boss');
  const users = await request(app).get('/api/admin/users').set(boss);
  const ivanov = users.body.find((u: { username: string }) => u.username === 'ivanov');
  await request(app).patch(`/api/admin/users/${ivanov.id}`).set(boss).send({ isActive: false });
  const monter = await as('sub-monter', 'ivanov');
  const me = await request(app).get('/api/me').set(monter);
  assert.equal(me.body.status, 'blocked');
  assert.deepEqual(me.body.permissions, []);
  assert.equal((await request(app).get('/api/res').set(monter)).status, 403);
});

test('справочник РЭС: дубль — 409, РЭС с людьми не удаляется', async () => {
  const boss = await as('sub-boss', 'boss');
  assert.equal((await request(app).post('/api/admin/res').set(boss).send({ name: 'Сочинский РЭС' })).status, 409);
  const added = await request(app).post('/api/admin/res').set(boss).send({ name: 'Учебный РЭС' });
  assert.equal(added.status, 201);
  assert.equal((await request(app).delete(`/api/admin/res/${added.body.id}`).set(boss)).status, 200);
  const res = await request(app).get('/api/res').set(boss);
  assert.equal((await request(app).delete(`/api/admin/res/${res.body[0].id}`).set(boss)).status, 409);
});

test('вход: ответы Keycloak переводятся в понятные сообщения', async () => {
  const fake = (status: number, body: object) => createTokenClient(async () => new Response(JSON.stringify(body), { status }));
  await assert.rejects(fake(401, { error: 'invalid_grant', error_description: 'Invalid user credentials' }).login('a', 'b'),
    { status: 401, message: 'Неверный логин или пароль.' });
  await assert.rejects(fake(400, { error: 'invalid_grant', error_description: 'Account disabled' }).login('a', 'b'), { status: 403 });
  await assert.rejects(fake(400, { error: 'unauthorized_client' }).login('a', 'b'), { status: 502 });
  const ok = await fake(200, { access_token: 'A', refresh_token: 'R', expires_in: 300 }).login('a', 'b');
  assert.equal(ok.accessToken, 'A');
  const login = await request(app).post('/api/auth/login').send({ username: '', password: '' });
  assert.equal(login.status, 400);
});

test('РИРУ: план с личными отметками за период, правка — только по праву', async () => {
  const boss = await as('sub-boss', 'boss');
  const plan = await request(app).get('/api/riru/plan/strategic').set(boss);
  assert.equal(plan.status, 200);
  assert.equal(plan.body.data.length, 3);
  assert.match(plan.body.period.label, /год/);
  const item = plan.body.data[0].tasks[0].id;
  assert.equal((await request(app).post('/api/riru/plan/strategic/progress').set(boss).send({ itemId: item, done: true })).status, 200);
  assert.deepEqual((await request(app).get('/api/riru/plan/strategic').set(boss)).body.done, [item]);
  assert.equal((await request(app).post('/api/riru/plan/strategic/progress').set(boss).send({ itemId: 'нет', done: true })).status, 404);

  const dup = structuredClone(plan.body.data);
  dup[0].tasks.push({ ...dup[0].tasks[0] });
  assert.equal((await request(app).put('/api/riru/plan/strategic').set(boss).send({ data: dup })).status, 400);
  const edited = structuredClone(plan.body.data);
  edited[0].tasks[0].title = 'Новое название';
  assert.equal((await request(app).put('/api/riru/plan/strategic').set(boss).send({ data: edited })).status, 200);
  assert.equal((await request(app).get('/api/riru/plan/strategic').set(boss)).body.data[0].tasks[0].title, 'Новое название');

  const op = await request(app).get('/api/riru/plan/operational').set(boss);
  assert.match(op.body.period.resets, /ежедневно/);
  const pending = await as('sub-new', 'newbie');
  assert.equal((await request(app).get('/api/riru/plan/strategic').set(pending)).status, 403);
});

test('РИРУ: нормативка из поставки и загрузка своего PDF', async () => {
  const boss = await as('sub-boss', 'boss');
  const docs = await request(app).get('/api/riru/docs').set(boss);
  assert.equal(docs.body.length, 21);
  assert.ok(docs.body.every((d: { files: { ref?: string }[] }) => d.files.every(f => !('ref' in f))));
  const n49 = docs.body.find((d: { num: string; category: string }) => d.num === '49' && d.category === 'normative');
  const pdf = await request(app).get(`/api/riru/docs/${n49.id}/files/0`).set(boss).buffer(true).parse((r, cb) => {
    const parts: Buffer[] = []; r.on('data', (c: Buffer) => parts.push(c)); r.on('end', () => cb(null, Buffer.concat(parts)));
  });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal((pdf.body as Buffer).subarray(0, 5).toString(), '%PDF-');

  const created = await request(app).post('/api/riru/docs').set(boss).send({ category: 'normative', num: '777', name: 'Тестовый приказ' });
  assert.equal(created.status, 201);
  const bad = await request(app).post(`/api/riru/docs/${created.body.id}/files`).set(boss).set('Content-Type', 'application/pdf').send(Buffer.from('not a pdf'));
  assert.equal(bad.status, 400);
  const up = await request(app).post(`/api/riru/docs/${created.body.id}/files`).set(boss)
    .set('Content-Type', 'application/pdf').set('X-File-Title', encodeURIComponent('Приложение 1')).send(Buffer.from('%PDF-1.4 test'));
  assert.equal(up.status, 201);
  const after = (await request(app).get('/api/riru/docs').set(boss)).body.find((d: { id: number }) => d.id === created.body.id);
  assert.equal(after.files[0].title, 'Приложение 1');
  assert.equal((await request(app).delete(`/api/riru/docs/${created.body.id}`).set(boss)).status, 200);
});
