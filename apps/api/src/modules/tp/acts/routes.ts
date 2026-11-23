import express from 'express';
import type pg from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { config } from '../../../config.js';
import { transaction, HttpError, type DB } from '../core/db.js';
import { role } from '../core/workflow.js';
import { documentModel } from '../core/documents.js';
import { loadReferences } from '../core/references.js';
import { ACT_TEMPLATES, KIND_TITLES, METERING_TITLES, POINT_TITLES, type ActKind, type ActMetering, type ActPoint } from './catalog.js';
import { ACT_FIELDS, FIELD_INPUTS, actValues, canonicalField, type ActInput } from './fields.js';
import { templateFields } from './merge.js';
import { lineLosses } from './losses.js';
import { TEMPLATES_PATH, lossesInput, renderAct } from './render.js';
import { signerPhrase, signerSignature } from './signer.js';
import { shortName } from './compute.js';
import { tuFacts } from './tu-facts.js';

// «Создание акта по ТУ» (страница Сферы): анкета акта из карточки договора и ТУ,
// ПУ из «Учёт ПУ» (Светлячок), сборка Word. Сохранение версии в маршрут — обычными
// запросами TP (POST /acts/:id/files + /versions): там все проверки вида и состояния.
// Пишется вручную, импорт TP не трогает.

type Authenticate = (header: string | undefined) => Promise<{ issuer: string; subject: string }>;
const PREPARING = ['DRAFT', 'RETURNED', 'REVISING'];
const uuid = z.uuid();

const meterSchema = z.object({ type: z.string().max(200).optional(), number: z.string().max(200).optional(), accuracyClass: z.string().max(20).optional(),
  checkQuarter: z.number().int().min(1).max(4).optional(), checkYear: z.number().int().min(1990).max(2100).optional() }).strict();
const inputSchema = z.object({
  applicantFullName: z.string().trim().min(1).max(500),
  ...Object.fromEntries(['basis', 'address', 'objectName', 'contractNumber', 'contractDate', 'tuNumber', 'tuDate', 'requestNumber', 'requestDate', 'previousOwner',
    'voltageKv', 'tp', 'feeder', 'substationVoltage', 'supplyCenter', 'tuPointsNetwork', 'tuPointsApplicant', 'actNumber', 'actDate', 'poleNumber', 'breakerA',
    'cableBrand', 'cableSection', 'project', 'monter'].map(k => [k, z.string().trim().max(2000).optional()])),
  ...Object.fromEntries(['powerAllowedKw', 'powerAttachedKw', 'powerExistingKw', 'amountRub', 'vatPercent', 'cableLengthM'].map(k => [k, z.number().min(0).max(1e9).optional()])),
  meter: meterSchema.optional(),
  ct: meterSchema.omit({ number: true }).extend({ numbers: z.string().max(300).optional(), ratio: z.string().max(40).optional() }).strict().optional(),
  overrides: z.record(z.string().max(80), z.string().max(2000)).optional(),
}).strict();
const lossesSchema = z.object({ powerKw: z.number().positive().optional(), lengthM: z.number().positive().optional(), sectionMm2: z.number().positive().optional(),
  material: z.enum(['Al', 'Cu']).optional() }).strict().nullable().optional();

// Поля каждого шаблона (по словарю) — анкета показывает только нужные шаблону.
let templateFieldsCache: Promise<Record<string, { fields: string[]; extra: string[] }>> | null = null;
const fieldsByTemplate = () => templateFieldsCache ??= Promise.all(ACT_TEMPLATES.map(async t => {
  const names = await templateFields(await readFile(resolve(TEMPLATES_PATH, t.file)));
  const fields = [...new Set(names.map(n => canonicalField(n)).filter((n): n is string => !!n))];
  return [t.id, { fields, extra: names.filter(n => !canonicalField(n)) }] as const;
})).then(Object.fromEntries).catch(e => { templateFieldsCache = null; throw e; });

export function actBuilder({ pool, authenticate, storagePath }: { pool: pg.Pool; authenticate: Authenticate; storagePath: string }) {
  const router = express.Router();
  router.use(express.json({ limit: '200kb' }));
  router.use(async (req, res, next) => {
    try {
      const identity = await authenticate(req.headers.authorization);
      const found = await pool.query('SELECT tp.resolve_identity($1,$2) AS id', [identity.issuer, identity.subject]);
      if (!found.rows[0]?.id) throw new HttpError(403, 'USER_NOT_PROVISIONED', 'Учётная запись не подключена к «Актам ТП».');
      res.locals.userId = found.rows[0].id;
      next();
    } catch (e) { next(e); }
  });
  const run = <T>(res: express.Response, fn: (db: DB) => Promise<T>, read = false) => transaction(pool, res.locals.userId, fn, read);
  const handle = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => { fn(req, res).catch(next); };

  /** Карточка договора, которую готовит инженер этого РЭС. */
  async function preparingAct(db: DB, actId: string) {
    const act = (await db.query('SELECT * FROM tp.acts WHERE id=$1', [uuid.parse(actId)])).rows[0];
    if (!act) throw new HttpError(404, 'NOT_FOUND', 'Карточка не найдена.');
    await role(db, 'RIRU_ENGINEER', act.res_id);
    return act;
  }

  // Карточки, по которым можно сформировать акт: черновик / возврат / доработка, вид — акт ТП или уведомление.
  router.get('/acts', handle(async (_req, res) => {
    res.json(await run(res, async db => (await db.query(
      `SELECT a.id,a.res_id,r.name AS res_name,a.act_type,a.state,a.contract_number,a.contract_date,a.applicant,a.address,a.created_at,
        a.technical_conditions_id IS NOT NULL AS has_tu,(SELECT count(*) FROM tp.versions v WHERE v.act_id=a.id)::int AS versions
       FROM tp.acts a JOIN tp.res_units r ON r.id=a.res_id
       WHERE a.state=ANY($1) AND a.act_type IN ('ACT_TP','NOTICE') AND tp.has_role('RIRU_ENGINEER',a.res_id)
       ORDER BY a.created_at DESC LIMIT 200`, [PREPARING])).rows, true));
  }));

  router.get('/catalog', handle(async (_req, res) => {
    const refs = await run(res, db => loadReferences(db), true);
    const today = new Date().toISOString().slice(0, 10);
    const used = await fieldsByTemplate();
    res.json({
      templates: ACT_TEMPLATES.map(({ source: _s, ...t }) => ({ ...t, ...used[t.id] })), kinds: KIND_TITLES, points: POINT_TITLES, meterings: METERING_TITLES,
      fields: ACT_FIELDS.map(f => ({ ...f, input: FIELD_INPUTS[f.name] ?? null })),
      attorneys: refs.attorneys.rows.map(a => ({ ...a, expired: !!a.validUntil && a.validUntil < today, phrase: signerPhrase(a), signature: signerSignature(a) })),
      cableBrands: refs.cables.brands, breakers: refs.breakers.rows,
      svetlyachok: !!(config.svetlyachokUrl && config.svetlyachokKey),
    });
  }));

  // Анкета по карточке: реквизиты карточки + разбор ТУ + подсказка схемы.
  router.get('/acts/:id/prefill', handle(async (req, res) => {
    const out = await run(res, async db => {
      const act = await preparingAct(db, String(req.params.id));
      const card = Object.fromEntries((await db.query('SELECT field_code,value FROM tp.card_values WHERE act_id=$1', [act.id])).rows.map(r => [r.field_code, r.value]));
      const tu = act.technical_conditions_id ? (await db.query(
        'SELECT t.document_number,t.document_date,t.file_id FROM tp.technical_conditions t WHERE t.id=$1', [act.technical_conditions_id])).rows[0] : null;
      return { act, card, tu };
    }, true);
    const { act, card, tu } = out;
    let facts: ReturnType<typeof tuFacts> = {};
    let tuNote = act.technical_conditions_id ? '' : 'К карточке не приложены ТУ — данные ТУ заполните вручную.';
    if (tu) {
      try { facts = tuFacts((await documentModel(await readFile(resolve(storagePath, tu.file_id)))).blocks); }
      catch { tuNote = 'Не удалось прочитать файл ТУ — проверьте данные ТУ вручную.'; }
    }
    const day = (d: unknown) => d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : typeof d === 'string' ? d.slice(0, 10) : undefined;
    const power = card.power_kw ? Number(card.power_kw) : facts.powerAllowedKw;
    const input: Partial<ActInput> = {
      applicantFullName: act.applicant ?? facts.applicantFullName, address: act.address, objectName: facts.objectName,
      contractNumber: act.contract_number, contractDate: day(act.contract_date),
      tuNumber: tu?.document_number ?? facts.tuNumber, tuDate: day(tu?.document_date), requestNumber: facts.requestNumber,
      powerAllowedKw: power, powerAttachedKw: power, powerExistingKw: 0,
      voltageKv: card.voltage_kv ? String(card.voltage_kv).replace('.', ',') : facts.voltageKv,
      tp: facts.tp, feeder: facts.feeder, substationVoltage: facts.substationVoltage, supplyCenter: facts.supplyCenter,
      tuPointsNetwork: facts.tuPointsNetwork, tuPointsApplicant: facts.tuPointsApplicant,
      actNumber: act.act_number && act.act_number !== act.contract_number ? act.act_number : undefined,
      actDate: new Date().toISOString().slice(0, 10),
    };
    const kind: ActKind = act.act_type === 'NOTICE' ? 'ecp' : 'paper';
    const metering: ActMetering = /тт/i.test(String(card.phases ?? '')) ? 'ct' : 'direct';
    res.json({
      act: { id: act.id, resId: act.res_id, state: act.state, actType: act.act_type, revision: act.revision, contractNumber: act.contract_number },
      input, tu: { ...facts, note: tuNote },
      suggestion: { kind, point: facts.point ?? null, metering },
    });
  }));

  // ПУ по номеру договора из «Учёт ПУ» (служебный ключ между приложениями).
  router.get('/acts/:id/meters', handle(async (req, res) => {
    const act = await run(res, db => preparingAct(db, String(req.params.id)), true);
    if (!config.svetlyachokUrl || !config.svetlyachokKey) throw new HttpError(503, 'SVETLYACHOK_NOT_CONFIGURED', 'Связь с «Учёт ПУ» не настроена — заполните ПУ вручную.');
    const r = await fetch(`${config.svetlyachokUrl}/api/service/pu?contract=${encodeURIComponent(act.contract_number)}`,
      { headers: { 'X-Service-Key': config.svetlyachokKey }, signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!r?.ok) throw new HttpError(502, 'SVETLYACHOK_UNAVAILABLE', `«Учёт ПУ» не ответил${r ? ` (${r.status})` : ''} — заполните ПУ вручную.`);
    const body = await r.json() as { items?: Record<string, unknown>[] };
    res.json({ items: body.items ?? [] });
  }));

  // Предпросмотр для анкеты: посчитанные поля (прописью, сумма с НДС, склонение) и потери.
  router.post('/preview', handle(async (req, res) => {
    const b = z.object({ input: inputSchema.partial(), losses: lossesSchema }).parse(req.body);
    const v = actValues({ applicantFullName: '', ...b.input } as ActInput);
    const p = lossesInput(b.input as ActInput, b.losses);
    res.json({
      computed: { ФИО: v.ФИО, склонен: v.склонен, прописью: v.прописью, сумма: v.сумма, Дата_акта: v.Дата_акта },
      losses: p ? { input: p, result: lineLosses(p) } : null,
    });
  }));

  // Word акта / уведомления.
  router.post('/acts/:id/render', handle(async (req, res) => {
    const b = z.object({ templateId: z.string().max(60), input: inputSchema, attorneyNumber: z.string().max(60).nullable().optional(), losses: lossesSchema }).strict().parse(req.body);
    const { attorney, author } = await run(res, async db => {
      await preparingAct(db, String(req.params.id));
      const refs = await loadReferences(db);
      const me = (await db.query('SELECT tp.my_profile() AS p')).rows[0]?.p;
      return { attorney: b.attorneyNumber ? refs.attorneys.rows.find(a => a.number === b.attorneyNumber) ?? null : null, author: typeof me?.name === 'string' && me.name.trim() ? shortName(me.name, false) : undefined };
    }, true);
    if (b.attorneyNumber && !attorney) throw new HttpError(422, 'ATTORNEY_NOT_FOUND', 'Доверенности нет в справочнике.');
    const out = await renderAct({ templateId: b.templateId, input: b.input as ActInput, attorney, losses: b.losses, author });
    res.set('X-Missing-Fields', encodeURIComponent(JSON.stringify(out.missing)));
    res.set('X-Losses-Included', String(out.lossesIncluded));
    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').send(out.docx);
  }));

  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error instanceof HttpError ? error.status : error instanceof z.ZodError ? 422 : (error as { code?: string })?.code === '42501' ? 403 : 500;
    if (status === 500) console.error('act-builder', error);
    const message = error instanceof HttpError ? (error.message !== error.code ? error.message : error.code === 'ROLE_REQUIRED' ? 'Формировать акт может инженер РИРУ своего РЭС.' : error.code)
      : error instanceof z.ZodError ? `Проверьте анкету: ${error.issues.map(i => i.path.join('.')).join(', ')}` : status === 403 ? 'Нет доступа.' : 'Ошибка сервера';
    res.status(status).json({ error: message });
  });
  return router;
}
