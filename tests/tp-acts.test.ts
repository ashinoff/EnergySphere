// «Создание акта по ТУ» на сервере Сферы: карточка договора с синтетическими ТУ →
// анкета из ТУ → Word акта → версия в маршруте (обычные запросы TP). База — как на
// Amvera (владелец не суперпользователь, модуль под tp_runtime). Данные выдуманные.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import JSZip from 'jszip';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import request from 'supertest';
import { zip, docxParts } from './tp/zip.js';

process.env.SUPER_ADMINS = 'boss';
process.env.KEYCLOAK_URL = 'https://kc.test';
process.env.KEYCLOAK_REALM = 'platform';
process.env.STORAGE_PATH = mkdtempSync(join(tmpdir(), 'es-acts-store-'));

const { createApp } = await import('../apps/api/src/app.js');
const { AccessService } = await import('../apps/api/src/core/access-service.js');
const { createVerifier, createTokenClient } = await import('../apps/api/src/core/keycloak.js');
const { migrate } = await import('../apps/api/src/migrate.js');
const { createPool } = await import('../apps/api/src/db.js');
const { documentText } = await import('../apps/api/src/modules/tp/acts/merge.js');

const dir = mkdtempSync(join(tmpdir(), 'es-acts-pg-'));
// TEST_PG_PORT — уже запущенный Postgres (пароль postgres): встроенный не стартует под
// администратором Windows, а pg_ctl сам понижает права
const external = Number(process.env.TEST_PG_PORT) || 0;
const port = external || 55400 + Math.floor(Math.random() * 400);
const server = new EmbeddedPostgres({ databaseDir: dir, port, user: 'postgres', password: 'postgres', persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
const db = createPool(`postgres://es_owner:es_owner@127.0.0.1:${port}/es_acts`);
const tpDb = createPool(`postgres://tp_runtime:tp_runtime@127.0.0.1:${port}/es_acts`);
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] });
const sign = (username: string) => new SignJWT({ preferred_username: username, name: username, azp: 'web-desktop', realm_access: { roles: [] } })
  .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setSubject(`sub-${username}`).setIssuer('https://kc.test/realms/platform')
  .setIssuedAt().setExpirationTime('30m').sign(privateKey);

before(async () => {
  if (!external) { await server.initialise(); await server.start(); }
  const admin = new pg.Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${port}/postgres` });
  await admin.connect();
  if (external) {   // прошлые прогоны на том же сервере: базы и роли теста
    const dbs = (await admin.query("SELECT datname FROM pg_database WHERE datdba IN (SELECT oid FROM pg_roles WHERE rolname='es_owner')")).rows;
    for (const { datname } of dbs) await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    for (const q of ['DROP ROLE IF EXISTS es_owner', 'DROP ROLE IF EXISTS tp_runtime']) await admin.query(q);
  }
  await admin.query("CREATE ROLE es_owner LOGIN PASSWORD 'es_owner' NOSUPERUSER NOCREATEROLE NOBYPASSRLS");
  await admin.query('CREATE DATABASE es_acts OWNER es_owner');
  await admin.query("CREATE ROLE tp_runtime LOGIN PASSWORD 'tp_runtime' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS");
  await admin.end();
  await migrate(db, 'db/migrations');
}, { timeout: 120_000 });

after(async () => {
  await tpDb.end();
  await db.end();
  if (!external) await server.stop();
  for (const d of [dir, process.env.STORAGE_PATH!]) {
    try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* останется в TEMP */ }
  }
});

// ТУ по форме отдела (выдуманный заявитель): пункты 10 и 11 — нумерованный список Word
const p = (text: string, level?: number) => `<w:p>${level === undefined ? '' : `<w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr>`}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const TU = [
  p('07-02/0999-26'),
  p('Приложение к договору № 00001-26-00000077-1 от 20.08.2026'),
  p('Заявитель: Тестова Анна Сергеевна.'),
  p('Заявка № з3-02-02-0200-26-00000001, письмо вх. № 1 от 14.08.2026.'),
  p('Наименование энергопринимающих устройств Заявителя: ЭПУ земельного участка.', 0),
  p('Наименование и место нахождения объектов: г. Сочи, ул. Учебная, 1.', 0),
  p('Максимальная мощность присоединяемых энергопринимающих устройств Заявителя составляет 100 кВт.', 0),
  p('Категория надежности: III-100 кВт.', 0),
  p('Класс напряжения электрических сетей, к которым осуществляется технологическое присоединение: 0,4 кВ.', 0),
  p('Год ввода в эксплуатацию: 2026 год.', 0),
  p('Точка(и) присоединения (вводные распределительные устройства): РУ-0,4 кВ ТП-А205 АРЭС (100 кВт).', 0),
  p('Основной источник питания: ПС 110/10 кВ «Учебная».', 0),
  p('Резервный источник питания: нет.', 0),
  p('Сетевая организация осуществляет:', 0),
  ...['Разработку схемы.', 'Установку учёта.', 'Проверку выполнения ТУ.'].map(t => p(t, 1)),
  p('Заявитель осуществляет:', 0),
  ...['Мероприятия.', 'Проект.', 'Строительство линии 0,4 кВ.', 'Участие в проверке.'].map(t => p(t, 1)),
].join('');
const tuDocx = zip({ ...docxParts, 'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${TU}</w:body></w:document>` });

test('создание акта по ТУ: анкета из ТУ → Word → версия акта в маршруте', { timeout: 120_000 }, async () => {
  const access = new AccessService(db);
  await access.seedDefaults();
  const app = createApp({ db, tpDb, access, verify: createVerifier(jwks), tokens: createTokenClient(async () => new Response('{}', { status: 500 })) });

  const people: Record<string, { role: string; res?: string }> = {
    riru: { role: 'eng_development', res: 'Адлерский РЭС' },   // документы ведёт инженер развития
    viewer: { role: 'eng_realization', res: 'Адлерский РЭС' }, // инженер реализации — только смотрит
    'riru-head': { role: 'nach_riru', res: 'Адлерский РЭС' },
    other: { role: 'eng_development', res: 'Хостинский РЭС' },
    tech: { role: 'admin' },
  };
  const tokens: Record<string, string> = {};
  const boss = { Authorization: `Bearer ${await sign('boss')}` };
  const resList = (await request(app).get('/api/res').set(boss)).body as { id: number; name: string }[];
  for (const name of Object.keys(people)) { tokens[name] = await sign(name); await request(app).get('/api/me').set('Authorization', `Bearer ${tokens[name]}`); }
  const sphereUsers = (await request(app).get('/api/admin/users').set(boss)).body as { id: number; username: string }[];
  for (const [name, person] of Object.entries(people)) {
    const id = sphereUsers.find(u => u.username === name)!.id;
    const resId = person.res ? resList.find(r => r.name === person.res)!.id : null;
    assert.equal((await request(app).patch(`/api/admin/users/${id}`).set(boss).send({ role: person.role, resId })).status, 200);
    assert.equal((await request(app).get('/tp/api/v1/me').set('Authorization', `Bearer ${tokens[name]}`)).status, 200);
  }
  const as = (u: string) => ({ Authorization: `Bearer ${tokens[u]}`, 'Idempotency-Key': randomUUID() });
  const ok = (r: request.Response, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
  const area = (await request(app).get('/tp/api/v1/me').set(as('riru'))).body.roles[0].resId as string;
  const B = '/tp/api/v1/act-builder';

  // справочник доверенностей (админ), карточка договора и ТУ (инженер)
  ok(await request(app).post('/tp/api/v1/admin/references/attorneys').set(as('tech'))
    .send({ rows: [{ number: '119/4-СЭС', date: '2025-12-15', person: 'Метелицкая Л.О.', position: 'Помощник директора предприятия по технологическому присоединению', validUntil: null }] }));
  const act = ok(await request(app).post('/tp/api/v1/acts').set(as('riru')).send({ resId: area, contractNumber: '00001-26-00000077-1', contractDate: '2026-08-20',
    actNumber: '00001-26-00000077-1', applicant: 'Тестова Анна Сергеевна', address: 'г. Сочи, ул. Учебная, 1' }));
  await db.query('UPDATE tp.acts SET tu_check_required=false WHERE id=$1', [act.id]);
  const tu = await request(app).post(`/tp/api/v1/acts/${act.id}/files`).set(as('riru'))
    .field('documentType', 'TU').field('documentNumber', '07-02/0999-26').field('documentDate', '2026-08-20').attach('file', tuDocx, 'tu.docx');
  ok(tu, 201);

  // список карточек и доступ: инженер другого РЭС карточку не видит и не формирует
  const list = ok(await request(app).get(`${B}/acts`).set(as('riru'))) as { id: string; has_tu: boolean }[];
  assert.ok(list.some(a => a.id === act.id && a.has_tu));
  assert.equal((ok(await request(app).get(`${B}/acts`).set(as('other'))) as unknown[]).length, 0);
  assert.ok([403, 404].includes((await request(app).get(`${B}/acts/${act.id}/prefill`).set(as('other'))).status));
  assert.equal((await request(app).get(`${B}/acts/${act.id}/prefill`)).status, 401);

  // анкета из карточки и ТУ
  const pre = ok(await request(app).get(`${B}/acts/${act.id}/prefill`).set(as('riru')));
  assert.equal(pre.tu.note, '');
  assert.equal(pre.suggestion.point, 'ru');
  assert.deepEqual({ ...pre.input, actDate: undefined }, {
    ...pre.input, actDate: undefined, applicantFullName: 'Тестова Анна Сергеевна', contractNumber: '00001-26-00000077-1', contractDate: '2026-08-20',
    tuNumber: '07-02/0999-26', tuDate: '2026-08-20', objectName: 'ЭПУ земельного участка', powerAllowedKw: 100, tp: '205',
    substationVoltage: '110/10', supplyCenter: 'Учебная', tuPointsNetwork: '10.1 - 10.3', tuPointsApplicant: '11.1 - 11.4', requestNumber: 'з3-02-02-0200-26-00000001',
  });

  const catalog = ok(await request(app).get(`${B}/catalog`).set(as('riru')));
  assert.equal(catalog.templates.length, 21);
  assert.ok(catalog.templates.find((t: { id: string }) => t.id === 'paper-ru-ct').fields.includes('Подписант'));
  assert.equal(catalog.attorneys[0].expired, false);
  assert.equal(catalog.svetlyachok, false);
  assert.equal((await request(app).get(`${B}/acts/${act.id}/meters`).set(as('riru'))).status, 503);

  const input = { ...pre.input, actNumber: '900077', amountRub: 89779.03, cableBrand: 'АВВГ', cableSection: '4х120', cableLengthM: 15, breakerA: '160',
    monter: 'эл.монтера Учебного Ивана Ивановича', project: 'паспорт прибора учета',
    meter: { type: 'Учебный ПУ-3', number: '000000000077', accuracyClass: '0,5s', checkQuarter: 4, checkYear: 2025 },
    ct: { type: 'Т-0,66', numbers: '1; 2; 3', accuracyClass: '0,5', ratio: '200/5', checkQuarter: 2, checkYear: 2025 } };
  const preview = ok(await request(app).post(`${B}/preview`).set(as('riru')).send({ input, losses: null }));
  assert.equal(preview.computed.прописью, 'сто');
  assert.match(preview.computed.сумма, /^89779\.03 руб\. \(восемьдесят девять тысяч/);
  assert.ok(Math.abs(preview.losses.result.yearKwh - 2970.517449920778) < 1e-6);

  // Word: инженер другого РЭС — отказ; свой — документ с подписантом, данными ТУ и листом потерь
  assert.ok([403, 404].includes((await request(app).post(`${B}/acts/${act.id}/render`).set(as('other')).send({ templateId: 'paper-ru-ct', input, attorneyNumber: '119/4-СЭС' })).status));
  const rendered = await request(app).post(`${B}/acts/${act.id}/render`).set(as('riru')).buffer(true)
    .parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); })
    .send({ templateId: 'paper-ru-ct', input, attorneyNumber: '119/4-СЭС' });
  assert.equal(rendered.status, 200);
  assert.equal(rendered.headers['x-losses-included'], 'true');
  const docx = rendered.body as Buffer;
  const text = (await documentText(docx)).replace(/\s+/g, ' ');
  for (const part of ['Тестова Анна Сергеевна', 'Тестовой А.С.', 'ТП-А205', 'ПС 110/10кВ «Учебная»', 'Пункты 10.1 - 10.3', '11.1 - 11.4', '900077',
    'Метелицкой Л.О., действующей на основании доверенности №119/4-СЭС от 15.12.2025г.', 'Учебный ПУ-3', 'Расчёт потерь электроэнергии в линии', '2 970,52'])
    assert.ok(text.includes(part), `нет «${part}»`);
  assert.doesNotMatch(text, /‹/);
  assert.ok((await JSZip.loadAsync(docx)).file('word/document.xml'));

  // в маршрут — как это делает страница: файл акта → версия
  const stored = ok(await request(app).post(`/tp/api/v1/acts/${act.id}/files`).set(as('riru')).field('documentType', 'ACT_TP').attach('file', docx, 'Акт ТП.docx'), 201);
  const card = ok(await request(app).get(`/tp/api/v1/acts/${act.id}`).set(as('riru')));
  const version = ok(await request(app).post(`/tp/api/v1/acts/${act.id}/versions`).set(as('riru')).send({ fileId: stored.id, expectedRevision: card.revision }));
  assert.equal(version.number, 1);

  // инженер реализации своего РЭС — зритель: видит акт и файлы, но ничего не готовит
  const tpMe = ok(await request(app).get('/tp/api/v1/me').set(as('viewer')));
  assert.deepEqual(tpMe.roles.map((r: { role: string }) => r.role), ['RES_VIEWER']);
  assert.equal((await request(app).get(`/tp/api/v1/acts/${act.id}`).set(as('viewer'))).status, 200);
  assert.ok((ok(await request(app).get('/tp/api/v1/registry').set(as('viewer'))).items as { id: string }[]).some(a => a.id === act.id));
  assert.equal((await request(app).post(`/tp/api/v1/acts/${act.id}/files`).set(as('viewer')).field('documentType', 'ACT_TP').attach('file', docx, 'x.docx')).status, 403);
  assert.equal((await request(app).post('/tp/api/v1/acts').set(as('viewer')).send({ resId: area, contractNumber: '00001-26-00000078-1', contractDate: '2026-08-20',
    actNumber: '1', applicant: 'Тестов', address: 'Сочи' })).status, 403);
  assert.ok([403, 404].includes((await request(app).get(`${B}/acts/${act.id}/prefill`).set(as('viewer'))).status));
  assert.equal((ok(await request(app).get(`${B}/acts`).set(as('viewer'))) as unknown[]).length, 0);
  // права Сферы: у инженера реализации нет «Готовить акты ТП»
  const sphereMe = ok(await request(app).get('/api/me').set({ Authorization: `Bearer ${tokens.viewer}` }));
  assert.ok(!sphereMe.permissions.includes('tp.create') && sphereMe.permissions.includes('tp.view'));
  const after = ok(await request(app).get(`${B}/acts`).set(as('riru'))) as { id: string; versions: number }[];
  assert.equal(after.find(a => a.id === act.id)!.versions, 1);
});
