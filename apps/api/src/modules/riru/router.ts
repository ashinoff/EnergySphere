import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { config } from '../../config.js';
import { HttpError, type Db } from '../../db.js';
import { requirePermission, route, userOf } from '../../core/http.js';

// Модуль 03 «Инструкция начальника РИРУ» (из strategy-to-action, упрощён):
// три плана с личными отметками, технологические карты, нормативка и законы.

export type PlanKind = 'strategic' | 'tactical' | 'operational';
const PLAN_KINDS: PlanKind[] = ['strategic', 'tactical', 'operational'];
const isPlan = (v: string): v is PlanKind => (PLAN_KINDS as string[]).includes(v);

const text = (max: number) => z.string().trim().max(max);
const id = z.string().trim().min(1).max(40);
const task = z.object({ id, title: text(300).min(1), desc: text(2000).optional(), deadline: text(120).optional(), norm: text(200).optional() });
const category = z.object({ id, title: text(200).min(1), desc: text(1000).optional(), tasks: z.array(task).max(200) });
const opItem = z.object({ id, title: text(300).min(1), desc: text(2000).optional(), req: z.boolean().optional() });
const opSection = z.object({ title: text(200).min(1), resp: text(200).optional(), items: z.array(opItem).max(200) });
const phase = z.object({ id, title: text(120).min(1), time: text(60).optional(), sections: z.array(opSection).max(50) });
const PLAN_SCHEMA = {
  strategic: z.array(category).max(50),
  tactical: z.array(category).max(50),
  operational: z.array(phase).max(20),
};

export function planItemIds(kind: PlanKind, data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  if (kind === 'operational') {
    return (data as z.infer<typeof phase>[]).flatMap(p => p.sections.flatMap(s => s.items.map(i => i.id)));
  }
  return (data as z.infer<typeof category>[]).flatMap(c => c.tasks.map(t => t.id));
}

// Период отметок по московскому времени: план на год / месяц / день.
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export function periodOf(kind: PlanKind, now = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now).split('-');
  if (kind === 'strategic') return { key: `Y${y}`, label: `${y} год`, resets: 'ежегодно' };
  if (kind === 'tactical') return { key: `M${y}-${m}`, label: `${MONTHS[Number(m) - 1]} ${y}`, resets: 'ежемесячно' };
  return { key: `D${y}-${m}-${d}`, label: `${d}.${m}.${y}`, resets: 'ежедневно' };
}

interface DocFile { title: string; ref: string; size: number }
const docMeta = z.object({
  category: z.enum(['normative', 'laws']),
  num: text(40).min(1),
  docDate: text(20).optional(),
  name: text(300).min(1),
  fullName: text(2000).optional(),
  code: text(200).optional(),
});

// Файл документа: seed:<имя> — из поставки приложения, store:<uuid>.pdf — загружен.
function filePath(ref: string) {
  const seed = /^seed:([a-z0-9-]+\.pdf)$/.exec(ref);
  if (seed) return resolve(config.seedPath, 'riru', 'pdfs', seed[1]);
  const store = /^store:([0-9a-f-]{36}\.pdf)$/.exec(ref);
  if (store) return resolve(config.storagePath, 'riru', store[1]);
  throw new HttpError(404, 'Файл не найден.');
}

export function mountRiru(app: Express, { db }: { db: Db }) {
  const view = requirePermission('riru.view');

  // ── Планы ────────────────────────────────────────────────────────────
  app.get('/api/riru/plan/:kind', view, route(async (req, res) => {
    const kind = String(req.params.kind);
    if (!isPlan(kind)) throw new HttpError(404, 'Нет такого плана.');
    const period = periodOf(kind);
    const content = await db.query('SELECT data, updated_at FROM riru.content WHERE kind=$1', [kind]);
    const done = await db.query<{ item_id: string }>(
      'SELECT item_id FROM riru.progress WHERE user_id=$1 AND kind=$2 AND period=$3', [userOf(res).id, kind, period.key]);
    res.json({
      data: content.rows[0]?.data ?? [], updatedAt: content.rows[0]?.updated_at ?? null,
      period: { label: period.label, resets: period.resets }, done: done.rows.map(r => r.item_id),
    });
  }));

  app.post('/api/riru/plan/:kind/progress', view, route(async (req, res) => {
    const kind = String(req.params.kind);
    const body = z.object({ itemId: id, done: z.boolean() }).safeParse(req.body);
    if (!isPlan(kind) || !body.success) throw new HttpError(400, 'Некорректные данные.');
    const content = await db.query('SELECT data FROM riru.content WHERE kind=$1', [kind]);
    if (!planItemIds(kind, content.rows[0]?.data).includes(body.data.itemId)) throw new HttpError(404, 'Пункт плана не найден — обновите страницу.');
    const period = periodOf(kind).key;
    const user = userOf(res).id;
    if (body.data.done) {
      await db.query('INSERT INTO riru.progress(user_id, kind, item_id, period) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [user, kind, body.data.itemId, period]);
    } else {
      await db.query('DELETE FROM riru.progress WHERE user_id=$1 AND kind=$2 AND item_id=$3 AND period=$4', [user, kind, body.data.itemId, period]);
    }
    res.json({ ok: true });
  }));

  app.put('/api/riru/plan/:kind', requirePermission('riru.edit'), route(async (req, res) => {
    const kind = String(req.params.kind);
    if (!isPlan(kind)) throw new HttpError(404, 'Нет такого плана.');
    const parsed = PLAN_SCHEMA[kind].safeParse(req.body?.data);
    if (!parsed.success) throw new HttpError(400, 'План заполнен некорректно: у каждого пункта должно быть название.');
    const ids = planItemIds(kind, parsed.data);
    if (new Set(ids).size !== ids.length) throw new HttpError(400, 'Номера пунктов плана повторяются.');
    await db.query(
      `INSERT INTO riru.content(kind, data, updated_at, updated_by) VALUES ($1, $2, now(), $3)
       ON CONFLICT (kind) DO UPDATE SET data=EXCLUDED.data, updated_at=now(), updated_by=EXCLUDED.updated_by`,
      [kind, JSON.stringify(parsed.data), userOf(res).id || null]);
    res.json({ ok: true });
  }));

  // ── Технологические карты ───────────────────────────────────────────
  app.get('/api/riru/techcards', view, route(async (_req, res) => {
    const { rows } = await db.query("SELECT data FROM riru.content WHERE kind='techcards'");
    res.json(rows[0]?.data ?? []);
  }));

  // ── Документы ───────────────────────────────────────────────────────
  app.get('/api/riru/docs', view, route(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT id, category, num, doc_date AS "docDate", name, full_name AS "fullName", code, files
       FROM riru.docs ORDER BY category, sort, id`);
    // Наружу — без внутренних ссылок на файлы.
    res.json(rows.map(r => ({ ...r, files: (r.files as DocFile[]).map(f => ({ title: f.title, size: f.size })) })));
  }));

  app.get('/api/riru/docs/:id/files/:n', view, route(async (req, res) => {
    const { rows } = await db.query<{ num: string; files: DocFile[] }>('SELECT num, files FROM riru.docs WHERE id=$1', [Number(req.params.id)]);
    const file = rows[0]?.files[Number(req.params.n)];
    if (!file) throw new HttpError(404, 'Файл не найден.');
    const path = filePath(file.ref);
    const info = await stat(path).catch(() => null);
    if (!info) throw new HttpError(404, 'Файл документа отсутствует на сервере.');
    const name = `${rows[0].num} ${file.title}`.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120) + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', info.size);
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    createReadStream(path).pipe(res);
  }));

  const docs = requirePermission('riru.docs');

  app.post('/api/riru/docs', docs, route(async (req, res) => {
    const body = docMeta.safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'Укажите номер и название документа.');
    const d = body.data;
    const { rows } = await db.query(
      `INSERT INTO riru.docs(category, num, doc_date, name, full_name, code, sort, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,(SELECT COALESCE(max(sort),0)+10 FROM riru.docs WHERE category=$1),$7) RETURNING id`,
      [d.category, d.num, d.docDate || null, d.name, d.fullName || null, d.code || null, userOf(res).id || null]);
    res.status(201).json({ id: rows[0].id });
  }));

  app.post('/api/riru/docs/:id/files', docs, express.raw({ type: 'application/pdf', limit: '40mb' }), route(async (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.subarray(0, 5).toString() !== '%PDF-') throw new HttpError(400, 'Можно загрузить только PDF.');
    const title = decodeURIComponent(String(req.headers['x-file-title'] ?? 'Документ')).trim().slice(0, 300) || 'Документ';
    const docId = Number(req.params.id);
    if (!(await db.query('SELECT 1 FROM riru.docs WHERE id=$1', [docId])).rowCount) throw new HttpError(404, 'Документ не найден.');
    const name = `${randomUUID()}.pdf`;
    await mkdir(join(config.storagePath, 'riru'), { recursive: true });
    await writeFile(join(config.storagePath, 'riru', name), body);
    await db.query('UPDATE riru.docs SET files = files || $2::jsonb WHERE id=$1',
      [docId, JSON.stringify([{ title, ref: `store:${name}`, size: body.length }])]);
    res.status(201).json({ ok: true });
  }));

  app.delete('/api/riru/docs/:id/files/:n', docs, route(async (req, res) => {
    const docId = Number(req.params.id);
    const n = Number(req.params.n);
    const { rows } = await db.query<{ files: DocFile[] }>('SELECT files FROM riru.docs WHERE id=$1', [docId]);
    const file = rows[0]?.files[n];
    if (!file) throw new HttpError(404, 'Файл не найден.');
    await db.query('UPDATE riru.docs SET files = files - $2::int WHERE id=$1', [docId, n]);
    if (file.ref.startsWith('store:')) await unlink(filePath(file.ref)).catch(() => {});
    res.json({ ok: true });
  }));

  app.delete('/api/riru/docs/:id', docs, route(async (req, res) => {
    const { rows } = await db.query<{ files: DocFile[] }>('DELETE FROM riru.docs WHERE id=$1 RETURNING files', [Number(req.params.id)]);
    if (!rows.length) throw new HttpError(404, 'Документ не найден.');
    for (const f of rows[0].files) if (f.ref.startsWith('store:')) await unlink(filePath(f.ref)).catch(() => {});
    res.json({ ok: true });
  }));
}
