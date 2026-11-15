// Модуль 02 «Поиск потребителя»: реестр своего РЭС, поиск, отметка монтёра
// (геометка, фото, ПСУ → один PDF), отметки у инженера, «Завершить», автоудаление.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import jpeg from 'jpeg-js';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
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
const { cleanupConsumers } = await import('../apps/api/src/modules/consumers/router.js');
const { exifOrientation } = await import('../apps/api/src/modules/consumers/files.js');

const dir = mkdtempSync(join(tmpdir(), 'es-pg-'));
const port = 54000 + Math.floor(Math.random() * 400);
const pg = new EmbeddedPostgres({ databaseDir: dir, port, user: 'postgres', password: 'postgres', persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
const db = createPool(`postgres://es_owner:es_owner@127.0.0.1:${port}/es_test`);
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] });

let app: ReturnType<typeof createApp>;
const as = async (username: string) => ({
  Authorization: `Bearer ${await new SignJWT({ preferred_username: username, azp: 'web-desktop', realm_access: { roles: [] } })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setSubject(`sub-${username}`).setIssuer('https://kc.test/realms/platform')
    .setIssuedAt().setExpirationTime('5m').sign(privateKey)}`,
});
const H: Record<string, Record<string, string>> = {};
let adler = 0, hosta = 0;

const photo = () => Buffer.from(jpeg.encode({ width: 40, height: 20, data: Buffer.alloc(40 * 20 * 4, 200) }, 80).data);

before(async () => {
  await pg.initialise();
  await pg.start();
  const admin = new (await import('pg')).default.Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${port}/postgres` });
  await admin.connect();
  await admin.query("CREATE ROLE es_owner LOGIN PASSWORD 'es_owner' NOSUPERUSER NOCREATEROLE NOBYPASSRLS");
  await admin.query('CREATE DATABASE es_test OWNER es_owner');
  // Миграции «Актов ТП» выдают права служебной роли — она должна существовать.
  await admin.query("CREATE ROLE tp_runtime LOGIN PASSWORD 'tp_runtime' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS");
  await admin.end();
  await migrate(db, 'db/migrations');
  const access = new AccessService(db);
  await access.seedDefaults();
  app = createApp({ db, access, verify: createVerifier(jwks), tokens: createTokenClient(async () => new Response('{}', { status: 500 })) });

  H.boss = await as('boss');
  const res = (await request(app).get('/api/res').set(H.boss)).body as { id: number; name: string }[];
  adler = res.find(r => r.name === 'Адлерский РЭС')!.id;
  hosta = res.find(r => r.name === 'Хостинский РЭС')!.id;
  const people: [string, string, number][] = [
    ['monter', 'monter', adler], ['eng', 'eng_realization', adler], ['chief', 'nach_riru', adler],
    ['monter2', 'monter', hosta], ['eng2', 'eng_realization', hosta], ['sue', 'eng_sue', 0],
  ];
  for (const [name, role, resId] of people) {
    H[name] = await as(name);
    await request(app).get('/api/me').set(H[name]);
    const users = (await request(app).get('/api/admin/users').set(H.boss)).body as { id: number; username: string }[];
    const id = users.find(u => u.username === name)!.id;
    const ok = await request(app).patch(`/api/admin/users/${id}`).set(H.boss).send(resId ? { role, resId } : { role });
    assert.equal(ok.status, 200, `${name}: ${JSON.stringify(ok.body)}`);
  }
}, { timeout: 120_000 });

after(async () => {
  await db.end();
  await pg.stop();
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* останется в TEMP */ }
});

async function uploadRegistry(who: string, resId: number, rows: object[]) {
  const start = await request(app).post(`/api/consumers/registry/${resId}/start`).set(H[who]).send({ fileName: 'Расширенный список.xls' });
  if (start.status !== 201) return start;
  const part = await request(app).post(`/api/consumers/registry/uploads/${start.body.uploadId}/rows`).set(H[who]).send({ rows });
  assert.equal(part.status, 200);
  return request(app).post(`/api/consumers/registry/uploads/${start.body.uploadId}/finish`).set(H[who]);
}
const row = (meter: string, account: string, title: string) =>
  ({ meter, account, title, address: 'г. Сочи, ул. Ленина, 1', cells: [['Номер счетчика', meter], ['ЛС', account], ['Наименование договора', title]] });

test('реестр обновляет только инженер РИРУ своего РЭС', async () => {
  assert.equal((await uploadRegistry('monter', adler, [row('1', '1', 'x')])).status, 403);
  assert.equal((await uploadRegistry('chief', adler, [row('1', '1', 'x')])).status, 403);
  assert.equal((await uploadRegistry('eng', hosta, [row('1', '1', 'x')])).status, 403);
  const done = await uploadRegistry('eng', adler, [row('0112 3456 7890', '230001', 'Иванов И.И.'), row('555666777', '230002', 'ООО «Колос»')]);
  assert.equal(done.status, 200);
  assert.equal(done.body.rows, 2);
  assert.equal((await uploadRegistry('eng2', hosta, [row('999000111', '777001', 'Петров П.П.')])).status, 200);

  const list = (await request(app).get('/api/consumers/res').set(H.eng)).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].registry.rows, 2);
  assert.equal((await request(app).get('/api/consumers/res').set(H.sue)).body.length, 7);
});

test('поиск по части номера ПУ или ЛС — только в своём РЭС', async () => {
  const byMeter = await request(app).get('/api/consumers/search').query({ q: '3456 78' }).set(H.monter);
  assert.equal(byMeter.status, 200);
  assert.equal(byMeter.body.items.length, 1);
  assert.equal(byMeter.body.items[0].meter, '011234567890');
  assert.equal((await request(app).get('/api/consumers/search').query({ q: '23000' }).set(H.monter)).body.items.length, 2);
  // Чужой РЭС: монтёр Хосты Адлер не видит, СУЭ видит все РЭС.
  assert.equal((await request(app).get('/api/consumers/search').query({ q: '23000' }).set(H.monter2)).body.items.length, 0);
  assert.equal((await request(app).get('/api/consumers/search').query({ q: '23000', res: adler }).set(H.monter2)).status, 403);
  assert.equal((await request(app).get('/api/consumers/search').query({ q: '000' }).set(H.sue)).body.items.length, 3);
  assert.equal((await request(app).get('/api/consumers/search').query({ q: '12' }).set(H.monter)).status, 400);

  const id = byMeter.body.items[0].id;
  const card = await request(app).get(`/api/consumers/records/${id}`).set(H.monter);
  assert.equal(card.body.title, 'Иванов И.И.');
  assert.deepEqual(card.body.cells[2], ['Наименование договора', 'Иванов И.И.']);
  assert.equal((await request(app).get(`/api/consumers/records/${id}`).set(H.monter2)).status, 404);
});

let visitId = 0;
test('монтёр: геометка, фото объекта и ПСУ (фото + PDF) → у инженера своего РЭС', async () => {
  const id = (await request(app).get('/api/consumers/search').query({ q: '230001' }).set(H.monter)).body.items[0].id;
  const extra = await PDFDocument.create();
  extra.addPage();
  const pdfPart = Buffer.from(await extra.save());

  // Без геометки и файлов — нечего отправлять; инженер отметки не ставит.
  assert.equal((await request(app).post('/api/consumers/visits').set(H.monter).field('recordId', id)).status, 400);
  assert.equal((await request(app).post('/api/consumers/visits').set(H.eng).field('recordId', id).field('lat', 43.4).field('lon', 39.9)).status, 403);
  // Файл не того вида — понятный отказ.
  const bad = await request(app).post('/api/consumers/visits').set(H.monter).field('recordId', id)
    .attach('photo', Buffer.from('not an image'), 'x.txt');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /JPEG/);

  const sent = await request(app).post('/api/consumers/visits').set(H.monter)
    .field('recordId', id).field('lat', '43.4312').field('lon', '39.9221').field('accuracy', '12').field('comment', 'Счётчик на фасаде')
    .attach('photo', photo(), 'IMG_1.jpg').attach('photo', photo(), 'IMG_2.jpg')
    .attach('psu', photo(), 'psu1.jpg').attach('psu', pdfPart, 'psu2.pdf');
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  visitId = sent.body.id;

  const inbox = await request(app).get('/api/consumers/visits').query({ status: 'new' }).set(H.eng);
  assert.equal(inbox.body.length, 1);
  const v = inbox.body[0];
  assert.equal(v.account, '230001');
  assert.deepEqual(v.geo, { lat: 43.4312, lon: 39.9221, accuracy: 12 });
  assert.equal(v.author, 'monter');
  assert.deepEqual(v.files.map((f: { kind: string; name: string }) => [f.kind, f.name]),
    [['photo', '011234567890 фото 1.jpg'], ['photo', '011234567890 фото 2.jpg'], ['psu', '011234567890 ПСУ.pdf']]);

  // ПСУ — один PDF: фото стало страницей, PDF добавлен целиком.
  const psuFile = v.files.find((f: { kind: string }) => f.kind === 'psu');
  const psu = await request(app).get(`/api/consumers/visits/${visitId}/files/${psuFile.id}`).set(H.eng).buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.equal(psu.headers['content-type'], 'application/pdf');
  assert.equal((await PDFDocument.load(psu.body)).getPageCount(), 2);

  const zip = await request(app).get(`/api/consumers/visits/${visitId}/archive`).set(H.eng).buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = []; r.on('data', (c: Buffer) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.equal(Object.keys((await JSZip.loadAsync(zip.body)).files).length, 3);

  // Начальник РИРУ видит, чужой РЭС — нет, монтёр видит свои.
  assert.equal((await request(app).get('/api/consumers/visits').query({ status: 'new' }).set(H.chief)).body.length, 1);
  assert.equal((await request(app).get('/api/consumers/visits').query({ status: 'new' }).set(H.eng2)).body.length, 0);
  assert.equal((await request(app).get(`/api/consumers/visits/${visitId}/archive`).set(H.eng2)).status, 404);
  assert.equal((await request(app).get('/api/consumers/visits').query({ status: 'new' }).set(H.monter)).status, 403);
  assert.equal((await request(app).get('/api/consumers/visits').query({ status: 'mine' }).set(H.monter)).body.length, 1);
  // В карточке потребителя видна прошлая отметка.
  assert.equal((await request(app).get(`/api/consumers/records/${id}`).set(H.monter)).body.visits.length, 1);
});

test('«Завершить» — только инженер РИРУ; завершённые удаляются через 3 дня вместе с файлами', async () => {
  assert.equal((await request(app).post(`/api/consumers/visits/${visitId}/complete`).set(H.chief)).status, 403);
  assert.equal((await request(app).post(`/api/consumers/visits/${visitId}/complete`).set(H.eng2)).status, 404);
  assert.equal((await request(app).post(`/api/consumers/visits/${visitId}/complete`).set(H.eng)).status, 200);
  assert.equal((await request(app).get('/api/consumers/visits').query({ status: 'new' }).set(H.eng)).body.length, 0);
  const done = (await request(app).get('/api/consumers/visits').query({ status: 'done' }).set(H.eng)).body;
  assert.equal(done.length, 1);
  assert.ok(new Date(done[0].deleteAt).getTime() - new Date(done[0].doneAt).getTime() === 3 * 86_400_000);

  const folder = join(process.env.STORAGE_PATH!, 'consumers', String(visitId));
  assert.ok(existsSync(folder));
  assert.equal(await cleanupConsumers(db), 0); // ещё рано
  await db.query("UPDATE consumers.visits SET done_at = now() - interval '3 days 1 minute' WHERE id=$1", [visitId]);
  assert.equal(await cleanupConsumers(db), 1);
  assert.ok(!existsSync(folder));
  assert.equal((await request(app).get('/api/consumers/visits').query({ status: 'done' }).set(H.eng)).body.length, 0);
});

test('новый реестр целиком заменяет прежний своего РЭС', async () => {
  assert.equal((await uploadRegistry('eng', adler, [row('123123123', '240001', 'Сидоров С.С.')])).status, 200);
  assert.equal((await request(app).get('/api/consumers/search').query({ q: '23000' }).set(H.monter)).body.items.length, 0);
  assert.equal((await request(app).get('/api/consumers/search').query({ q: '240001' }).set(H.monter)).body.items.length, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM consumers.records WHERE res_id=$1', [adler])).rows[0].n, 1);
  // Хостинский не тронут.
  assert.equal((await request(app).get('/api/consumers/search').query({ q: '777001' }).set(H.monter2)).body.items.length, 1);
});

test('поворот снимка из EXIF читается', () => {
  // Минимальный JPEG: SOI + APP1 Exif (II, IFD0 с тегом 0x0112 = 6).
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0, 0, 0, 0x06, 0x00, 0, 0, 0, 0, 0, 0]);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const len = Buffer.alloc(2); len.writeUInt16BE(app1.length + 2);
  assert.equal(exifOrientation(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, app1, Buffer.from([0xff, 0xd9])])), 6);
  assert.equal(exifOrientation(photo()), 1);
});
