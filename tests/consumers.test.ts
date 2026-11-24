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
const { cleanupConsumers, cardCells } = await import('../apps/api/src/modules/consumers/router.js');
const { exifOrientation } = await import('../apps/api/src/modules/consumers/files.js');
const { config } = await import('../apps/api/src/config.js');

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
  const start = await request(app).post(`/api/consumers/registry/${resId}/start`).set(H[who]).send({ fileName: 'Расширенный список.xls', labels: LABELS });
  if (start.status !== 201) return start;
  const part = await request(app).post(`/api/consumers/registry/uploads/${start.body.uploadId}/rows`).set(H[who]).send({ rows });
  assert.equal(part.status, 200);
  return request(app).post(`/api/consumers/registry/uploads/${start.body.uploadId}/finish`).set(H[who]);
}
const LABELS = ['Прибор учета · Номер счетчика', 'ЛС / ЛС СТЕК', 'Наименование договора', 'Адрес точки учета · Телефон'];
const row = (meter: string, account: string, title: string) =>
  ({ meter, account, title, address: 'г. Сочи, ул. Ленина, 1', values: [meter, account, title, null] });

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
  // Карточка — пары [столбец, значение], пустые столбцы не показываются.
  assert.deepEqual(card.body.cells, [['Прибор учета · Номер счетчика', '0112 3456 7890'], ['ЛС / ЛС СТЕК', '230001'], ['Наименование договора', 'Иванов И.И.']]);
  assert.equal(card.body.labels, undefined);
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

test('счётчик новых отметок: меню модуля и плитка платформы (CORS с её домена)', async () => {
  const badge = async (who: string) => (await request(app).get('/api/platform/badge').set(H[who])).body.count;
  assert.equal(await badge('eng'), 1);
  assert.equal(await badge('chief'), 1);
  assert.equal(await badge('sue'), 1);
  assert.equal(await badge('eng2'), 0);
  assert.equal(await badge('monter'), 0);
  assert.equal((await request(app).get('/api/consumers/new-count').set(H.eng)).body.count, 1);
  assert.equal((await request(app).get('/api/platform/badge')).status, 401);
  const pre = await request(app).options('/api/platform/badge').set('Origin', config.platformOrigin)
    .set('Access-Control-Request-Method', 'GET').set('Access-Control-Request-Headers', 'authorization');
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-origin'], config.platformOrigin);
  const other = await request(app).get('/api/platform/badge').set('Origin', 'https://evil.example').set(H.eng);
  assert.equal(other.headers['access-control-allow-origin'], config.platformOrigin); // чужому домену браузер ответ не отдаст
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

test('тарифные зоны физлица — одна запись; ЛС юрлица — несколько точек учёта', async () => {
  const zone = (meter: string, account: string, title: string, z: string) => ({ ...row(meter, account, title), values: [meter, account, title, z] });
  assert.equal((await uploadRegistry('eng2', hosta, [
    zone('555000111', '880001', 'Жилой дом', 'зона 1'), zone('555000111', '880001', 'Жилой дом', 'зона 2'),
    row('700000001', '990001', 'ООО «Альфа»'), row('700000002', '990001', 'ООО «Альфа»'),
  ])).status, 200);
  const byMeter = await request(app).get('/api/consumers/search').query({ q: '555000111' }).set(H.monter2);
  assert.equal(byMeter.body.items.length, 1);
  assert.equal(byMeter.body.items[0].zones, 2);
  const card = await request(app).get(`/api/consumers/records/${byMeter.body.items[0].id}`).set(H.monter2);
  assert.equal(card.body.zones.length, 2);
  assert.deepEqual(card.body.zones.map((z: [string, string][]) => z[3]), [['Адрес точки учета · Телефон', 'зона 1'], ['Адрес точки учета · Телефон', 'зона 2']]);

  const byAccount = await request(app).get('/api/consumers/search').query({ q: '990001' }).set(H.monter2);
  assert.deepEqual(byAccount.body.items.map((f: { meter: string; zones: number }) => [f.meter, f.zones]), [['700000001', 1], ['700000002', 1]]);
  const one = await request(app).get(`/api/consumers/records/${byAccount.body.items[0].id}`).set(H.monter2);
  assert.deepEqual(one.body.zones, []);
});

test('карточка: значения по порядку столбцов и строки прежнего вида (пары)', () => {
  assert.deepEqual(cardCells(['А', 'Б', 'В'], ['1', null, '3']), [['А', '1'], ['В', '3']]);
  assert.deepEqual(cardCells([], [['А', '1']]), [['А', '1']]);
  assert.deepEqual(cardCells(['А'], null), []);
});

test('поворот снимка из EXIF читается', () => {
  // Минимальный JPEG: SOI + APP1 Exif (II, IFD0 с тегом 0x0112 = 6).
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0, 0, 0, 0x06, 0x00, 0, 0, 0, 0, 0, 0]);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const len = Buffer.alloc(2); len.writeUInt16BE(app1.length + 2);
  assert.equal(exifOrientation(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, app1, Buffer.from([0xff, 0xd9])])), 6);
  assert.equal(exifOrientation(photo()), 1);
});

test('дом по адресу реестра: без квартиры, «д.» не уходит в запрос, точное совпадение — отдельно', async () => {
  const { houseAddress, createGeocoder } = await import('../apps/api/src/modules/consumers/geocoder.js');
  assert.deepEqual(houseAddress('Сочи, ул. Ленина, д. 5, корп. 2, кв. 7'),
    { query: 'Сочи, ул. Ленина, 5, корп. 2', parts: { locality: 'Сочи', street: 'ул. Ленина', house: '52' } });
  assert.equal(houseAddress('пгт Дагомыс, ул Батумское шоссе, д 21А, кв 3').query, 'пгт Дагомыс, ул Батумское шоссе, 21А');

  const asked: string[] = [];
  const feature = (city: string, street: string, house: string, lon: number) =>
    ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, 43.6] }, properties: { countrycode: 'RU', city, street, housenumber: house } });
  const geocoder = createGeocoder({
    intervalMs: 0,
    fetcher: async url => {
      asked.push(new URL(String(url)).searchParams.get('q')!);
      return new Response(JSON.stringify({ features: [
        feature('Дагомыс', 'улица Ленина', '5', 39.1), feature('Сочи', 'улица Ленина', '5', 39.7), feature('Сочи', 'улица Ленина', '5', 39.7),
      ] }));
    },
  });
  const one = await geocoder.lookup('Сочи, ул. Ленина, д. 5, кв. 12');
  assert.deepEqual(asked, ['Сочи, Ленина, 5']);
  assert.equal(one.places.length, 2); // одинаковые точки — одной строкой
  assert.deepEqual(one.places.map(p => [p.city, p.exact]), [['Сочи', true], ['Дагомыс', false]]);
  await geocoder.lookup('Сочи, ул. Ленина, д. 5, кв. 40'); // тот же дом — из кеша
  assert.equal(asked.length, 1);
  await assert.rejects(geocoder.lookup(''), /нет адреса/);

  // Дома в OSM нет — предлагаем улицу, потом посёлок (карта откроется рядом).
  const rural = createGeocoder({ intervalMs: 0, fetcher: async url => {
    const q = new URL(String(url)).searchParams.get('q');
    return new Response(JSON.stringify({ features: q === 'Волковка' ? [feature('Волковка', '', '', 39.6)] : [] }));
  } });
  const far = await rural.lookup('с. Волковка, ул. Садовая, д. 1');
  assert.deepEqual(far.places.map(p => [p.city, p.level, p.exact]), [['Волковка', 'place', false]]);
});

test('ТП и карта: ТП и координаты из реестра, справочник ТП от администратора, число потребителей на ТП', async () => {
  const { tpKey, parseCoords } = await import('../apps/api/src/modules/consumers/substations.js');
  assert.equal(tpKey('ТП-Д165'), 'Д165'); assert.equal(tpKey('Д-165'), 'Д165'); assert.equal(tpKey('тп д 165'), 'Д165');
  assert.equal(tpKey('КТПН-12'), '12'); assert.equal(tpKey('РП-59'), 'РП59');
  assert.deepEqual(parseCoords('43,8135; 39,6107'), { lat: 43.8135, lon: 39.6107 });
  assert.deepEqual(parseCoords('43.8135, 39.6107'), { lat: 43.8135, lon: 39.6107 });
  assert.deepEqual(parseCoords('43,8135, 39,6107'), { lat: 43.8135, lon: 39.6107 });
  assert.equal(parseCoords('нет'), null);

  // Реестр Хосты с «Подключение · ТП» и «Координаты» (у одного ПУ — две тарифные зоны)
  const labels = ['Прибор учета · Номер счетчика', 'ЛС / ЛС СТЕК', 'Наименование договора', 'Подключение · ТП', 'Координаты'];
  const r = (meter: string, account: string, tp: string, coords: string | null) =>
    ({ meter, account, title: `Потребитель ${account}`, address: 'г. Сочи', values: [meter, account, `Потребитель ${account}`, tp, coords] });
  const start = await request(app).post(`/api/consumers/registry/${hosta}/start`).set(H.eng2).send({ fileName: 'Хоста.xlsx', labels });
  await request(app).post(`/api/consumers/registry/uploads/${start.body.uploadId}/rows`).set(H.eng2).send({ rows: [
    r('101', '9001', 'ТП-Х10', '43,5100; 39,8000'), r('101', '9001', 'ТП-Х10', '43,5100; 39,8000'),   // зоны одного ПУ
    r('102', '9002', 'ТП-Х10', '43,5300; 39,8000'),   // ≈2,2 км от ТП — подозрительно
    r('103', '9003', 'Х-11', null), r('104', '9004', 'ТП-Х99', '43,5000; 39,7000'), r('105', '9005', '', null),
  ] });
  assert.equal((await request(app).post(`/api/consumers/registry/uploads/${start.body.uploadId}/finish`).set(H.eng2)).status, 200);

  // карточка: координаты как есть (ссылку на маршрут строит интерфейс)
  const found = (await request(app).get('/api/consumers/search').query({ q: '9001' }).set(H.monter2)).body.items[0];
  assert.deepEqual((await request(app).get(`/api/consumers/records/${found.id}`).set(H.monter2)).body.cells.at(-1), ['Координаты', '43,5100; 39,8000']);

  // справочник грузит только администратор
  const directory = [
    { res: 'Хостинский РЭС', tp: 'ТП-Х10', coords: '43,5101; 39,8001' },
    { res: 'хостинский', tp: 'ТП-Х11', coords: '43.52, 39.81' },
    { res: 'Хостинский РЭС', tp: 'ТП-Х12', coords: '' },
    { res: 'Тимашевский РЭС', tp: 'ТП-1', coords: '45; 38' },
    { res: 'Хостинский РЭС', tp: 'ТП-Х13', coords: 'где-то' },
  ];
  assert.equal((await request(app).post('/api/consumers/substations').set(H.eng2).send({ rows: directory })).status, 403);
  const up = await request(app).post('/api/consumers/substations').set(H.boss).send({ rows: directory });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.deepEqual(up.body.loaded, [{ res: 'Хостинский РЭС', count: 3, withCoords: 2 }]);
  assert.equal(up.body.skippedTotal, 2);
  assert.match(up.body.skipped[0].reason, /Тимашевский РЭС.*не найден/);

  // инженер Хосты видит свой РЭС: числа по реестру, ТП не из справочника — отдельно
  const view = await request(app).get('/api/consumers/substations').set(H.eng2);
  assert.equal(view.status, 200);
  const c = view.body.current;
  assert.equal(c.name, 'Хостинский РЭС');
  assert.deepEqual(c.columns, { tp: 'Подключение · ТП', coords: 'Координаты' });
  assert.deepEqual(c.substations.map((s: { name: string; consumers: number; withCoords: number }) => [s.name, s.consumers, s.withCoords]),
    [['ТП-Х10', 2, 2], ['ТП-Х11', 1, 0], ['ТП-Х12', 0, 0]]);
  assert.deepEqual(c.unknown, [{ name: 'ТП-Х99', consumers: 1, withCoords: 1 }]);
  assert.deepEqual(c.totals, { consumers: 5, withCoords: 3, noTp: 1, linked: 3 });
  assert.equal(c.points.length, 3);
  assert.equal((await request(app).get('/api/consumers/substations').query({ res: adler }).set(H.eng2)).status, 403);
  // Адлер: реестр без столбцов ТП и координат — справочника нет, столбцы не найдены
  const adl = (await request(app).get('/api/consumers/substations').set(H.eng)).body.current;
  assert.deepEqual(adl.columns, { tp: null, coords: null });
  assert.equal(adl.substations.length, 0);
});
