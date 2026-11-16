import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../../config.js';
import { HttpError, type Db } from '../../db.js';
import { requirePermission, route, userOf } from '../../core/http.js';
import type { UserContext } from '../../core/access-service.js';
import { psuPdf, toViewable } from './files.js';

// Модуль 02 «Поиск потребителя». У каждого РЭС свой реестр (расширенный список,
// как в Web_abonent): его обновляет инженер РИРУ своего РЭС. Монтёр находит
// потребителя по № ПУ или ЛС, ставит геометку и прикладывает фото объекта и ПСУ —
// отметка уходит инженерам РИРУ своего РЭС. Завершённые отметки хранятся
// KEEP_DONE_DAYS дня и удаляются вместе с файлами.

export const KEEP_DONE_DAYS = 3;
const MAX_FILES = 10;
const MAX_FILE_MB = 30;

// Ключ поиска: без пробелов, заглавными, ё → е (номера бывают с буквами).
export const searchKey = (value: unknown) =>
  String(value ?? '').replace(/\s+/g, '').toLocaleUpperCase('ru').replace(/Ё/g, 'Е').slice(0, 80);

const inScope = (user: UserContext, resId: number) => user.resScope === null || user.resScope.includes(resId);
function scopeOf(user: UserContext, wanted?: unknown): number[] | null {
  const id = Number(wanted);
  if (wanted !== undefined && wanted !== '' && Number.isInteger(id)) {
    if (!inScope(user, id)) throw new HttpError(403, 'Этот РЭС вам не доступен.');
    return [id];
  }
  return user.resScope;
}

const rowSchema = z.object({
  meter: z.string().max(200).default(''),
  account: z.string().max(200).default(''),
  title: z.string().max(500).default(''),
  address: z.string().max(1000).default(''),
  // Значения по порядку названий столбцов загрузки (null — пусто).
  values: z.array(z.string().max(4000).nullable()).max(300),
});
const labelsSchema = z.array(z.string().max(300)).min(1).max(300);

// Ячейки карточки: [столбец, значение] без пустых. Строки старого вида уже пары.
export function cardCells(labels: string[], cells: unknown): [string, string][] {
  if (!Array.isArray(cells)) return [];
  if (cells.length && Array.isArray(cells[0])) return cells as [string, string][];
  return (cells as (string | null)[]).flatMap((v, i) => (v === null || v === '' || !labels[i] ? [] : [[labels[i], v] as [string, string]]));
}

const visitDir = (id: number) => join(config.storagePath, 'consumers', String(id));
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'без номера';

interface VisitRow {
  id: number; res_id: number; res_name: string; meter: string; account: string; title: string; address: string;
  lat: number | null; lon: number | null; accuracy: number | null; comment: string | null; status: 'new' | 'done';
  created_at: Date; created_by: number | null; author: string | null; done_at: Date | null; done_by_name: string | null;
  files: { id: number; kind: 'photo' | 'psu'; name: string; size: number }[];
}
const VISIT_SELECT = `
  SELECT v.id, v.res_id, r.name AS res_name, v.meter, v.account, v.title, v.address, v.lat, v.lon, v.accuracy, v.comment,
         v.status, v.created_at, v.created_by, coalesce(a.full_name, a.username) AS author, v.done_at,
         coalesce(d.full_name, d.username) AS done_by_name,
         coalesce((SELECT json_agg(json_build_object('id', f.id, 'kind', f.kind, 'name', f.name, 'size', f.size) ORDER BY f.id)
                   FROM consumers.visit_files f WHERE f.visit_id = v.id), '[]') AS files
  FROM consumers.visits v JOIN core.res r ON r.id = v.res_id
  LEFT JOIN core.users a ON a.id = v.created_by LEFT JOIN core.users d ON d.id = v.done_by`;
const visitOut = (v: VisitRow) => ({
  id: v.id, res: { id: v.res_id, name: v.res_name }, meter: v.meter, account: v.account, title: v.title, address: v.address,
  geo: v.lat !== null && v.lon !== null ? { lat: v.lat, lon: v.lon, accuracy: v.accuracy } : null,
  comment: v.comment, status: v.status, createdAt: v.created_at, author: v.author, doneAt: v.done_at, doneBy: v.done_by_name,
  deleteAt: v.done_at ? new Date(v.done_at.getTime() + KEEP_DONE_DAYS * 86_400_000) : null,
  files: v.files,
});

// Завершённые отметки старше срока и брошенные загрузки реестра — удалить.
export async function cleanupConsumers(db: Db) {
  const { rows } = await db.query<{ id: number }>(
    `DELETE FROM consumers.visits WHERE status='done' AND done_at < now() - make_interval(days => $1) RETURNING id`, [KEEP_DONE_DAYS]);
  for (const { id } of rows) await rm(visitDir(id), { recursive: true, force: true });
  const stale = await db.query<{ id: string }>(`DELETE FROM consumers.uploads WHERE created_at < now() - interval '1 day' RETURNING id`);
  for (const { id } of stale.rows) await db.query('DELETE FROM consumers.records WHERE upload_id=$1', [id]);
  return rows.length;
}

export function mountConsumers(app: Express, { db }: { db: Db }) {
  const view = requirePermission('consumers.view');

  // ── РЭС и их реестры ────────────────────────────────────────────────
  app.get('/api/consumers/res', view, route(async (_req, res) => {
    const user = userOf(res);
    const { rows } = await db.query(
      `SELECT r.id, r.name, g.file_name AS "fileName", g.rows, g.uploaded_at AS "uploadedAt",
              coalesce(u.full_name, u.username) AS "uploadedBy",
              (SELECT count(*)::int FROM consumers.visits v WHERE v.res_id = r.id AND v.status = 'new') AS "newVisits"
       FROM core.res r LEFT JOIN consumers.registries g ON g.res_id = r.id LEFT JOIN core.users u ON u.id = g.uploaded_by
       WHERE ($1::int[] IS NULL OR r.id = ANY($1)) ORDER BY r.sort, r.name`, [user.resScope]);
    res.json(rows.map(({ fileName, rows: count, uploadedAt, uploadedBy, ...r }) =>
      ({ ...r, registry: fileName ? { fileName, rows: count, uploadedAt, uploadedBy } : null })));
  }));

  // ── Поиск и карточка ────────────────────────────────────────────────
  app.get('/api/consumers/search', view, route(async (req, res) => {
    const user = userOf(res);
    const q = searchKey(req.query.q);
    if (q.length < 3) throw new HttpError(400, 'Введите не меньше 3 знаков номера ПУ или ЛС.');
    const scope = scopeOf(user, req.query.res);
    const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
    // Строки одного ПУ и ЛС — тарифные зоны (день/ночь у физлиц): одна запись
    // с числом зон. Разные ТУ одного ЛС (юрлица) остаются отдельными — у них свои ПУ.
    const { rows } = await db.query(
      `SELECT min(c.id) AS id, c.res_id AS "resId", r.name AS "resName", c.meter, c.account,
              min(c.title) AS title, min(c.address) AS address, count(*)::int AS zones
       FROM consumers.records c JOIN consumers.registries g ON g.res_id = c.res_id AND g.upload_id = c.upload_id
       JOIN core.res r ON r.id = c.res_id
       WHERE ($1::int[] IS NULL OR c.res_id = ANY($1)) AND (c.meter LIKE $2 OR c.account LIKE $2)
       GROUP BY c.res_id, r.name, r.sort, c.meter, c.account, CASE WHEN c.meter = '' THEN c.id END
       ORDER BY bool_or(c.meter = $3 OR c.account = $3) DESC, r.sort, c.account, c.meter LIMIT 101`, [scope, like, q]);
    res.json({ items: rows.slice(0, 100), more: rows.length > 100 });
  }));

  app.get('/api/consumers/records/:id', view, route(async (req, res) => {
    const user = userOf(res);
    const { rows } = await db.query(
      `SELECT c.id, c.res_id AS "resId", r.name AS "resName", c.meter, c.account, c.title, c.address, c.cells, g.labels
       FROM consumers.records c JOIN consumers.registries g ON g.res_id = c.res_id AND g.upload_id = c.upload_id
       JOIN core.res r ON r.id = c.res_id WHERE c.id = $1`, [Number(req.params.id)]);
    const found = rows[0];
    const record = found && { ...found, labels: undefined, cells: cardCells(found.labels, found.cells) };
    if (!record || !inScope(user, record.resId)) throw new HttpError(404, 'Потребитель не найден — возможно, реестр обновили. Повторите поиск.');
    // Тарифные зоны: все строки этого ПУ с тем же ЛС (у счётчика без номера зон нет).
    const zones = record.meter ? (await db.query<{ cells: unknown }>(
      `SELECT c.cells FROM consumers.records c JOIN consumers.registries g ON g.res_id = c.res_id AND g.upload_id = c.upload_id
       WHERE c.res_id = $1 AND c.meter = $2 AND c.account = $3 ORDER BY c.id`, [record.resId, record.meter, record.account])).rows
      .map(z => cardCells(found.labels, z.cells)) : [record.cells];
    // Прошлые отметки по этому ПУ (без номера ПУ — по ЛС): у юрлица на одном ЛС
    // много ТУ, отметка по одной точке на другие не переносится.
    const visits = await db.query<VisitRow>(
      `${VISIT_SELECT} WHERE v.res_id = $1 AND (CASE WHEN $2 <> '' THEN v.meter = $2 ELSE v.meter = '' AND v.account = $3 END)
       ORDER BY v.created_at DESC LIMIT 10`, [record.resId, record.meter, record.account]);
    res.json({ ...record, zones: zones.length > 1 ? zones : [], visits: visits.rows.map(visitOut) });
  }));

  // ── Загрузка реестра: начать → части строк → завершить ──────────────
  // Строки читает браузер (Excel любого размера телефону/серверу не грузим целиком),
  // до завершения поиску виден прежний реестр.
  const registry = requirePermission('consumers.registry');

  app.post('/api/consumers/registry/:resId/start', registry, route(async (req, res) => {
    const user = userOf(res);
    const resId = Number(req.params.resId);
    if (!Number.isInteger(resId) || !inScope(user, resId)) throw new HttpError(403, 'Реестр этого РЭС обновляет его инженер РИРУ.');
    const fileName = z.string().trim().min(1).max(300).safeParse(req.body?.fileName);
    if (!fileName.success) throw new HttpError(400, 'Не указано имя файла.');
    const labels = labelsSchema.safeParse(req.body?.labels);
    if (!labels.success) throw new HttpError(400, 'Не пришли названия столбцов реестра — обновите страницу и загрузите файл заново.');
    const old = await db.query<{ id: string }>('DELETE FROM consumers.uploads WHERE res_id=$1 RETURNING id', [resId]);
    for (const { id } of old.rows) await db.query('DELETE FROM consumers.records WHERE upload_id=$1', [id]);
    const id = randomUUID();
    await db.query('INSERT INTO consumers.uploads(id, res_id, file_name, labels, created_by) VALUES ($1,$2,$3,$4,$5)',
      [id, resId, fileName.data, JSON.stringify(labels.data), user.id || null]);
    res.status(201).json({ uploadId: id });
  }));

  async function ownUpload(req: Request, res: Response) {
    const { rows } = await db.query<{ id: string; res_id: number; file_name: string; rows: number }>(
      'SELECT id, res_id, file_name, rows FROM consumers.uploads WHERE id::text=$1 AND created_by IS NOT DISTINCT FROM $2',
      [String(req.params.id), userOf(res).id || null]);
    if (!rows[0]) throw new HttpError(404, 'Загрузка не найдена или устарела — начните заново.');
    return rows[0];
  }

  app.post('/api/consumers/registry/uploads/:id/rows', registry, route(async (req, res) => {
    const upload = await ownUpload(req, res);
    const parsed = z.array(rowSchema).max(5000).safeParse(req.body?.rows);
    if (!parsed.success) throw new HttpError(400, 'Строки реестра пришли в неверном виде.');
    const rows = parsed.data.map(({ values, ...r }) => ({ ...r, meter: searchKey(r.meter), account: searchKey(r.account), cells: values }));
    await db.query(
      `INSERT INTO consumers.records(res_id, upload_id, meter, account, title, address, cells)
       SELECT $1, $2, x.meter, x.account, x.title, x.address, x.cells
       FROM jsonb_to_recordset($3::jsonb) AS x(meter text, account text, title text, address text, cells jsonb)`,
      [upload.res_id, upload.id, JSON.stringify(rows)]);
    await db.query('UPDATE consumers.uploads SET rows = rows + $2 WHERE id=$1', [upload.id, rows.length]);
    res.json({ ok: true });
  }));

  app.post('/api/consumers/registry/uploads/:id/finish', registry, route(async (req, res) => {
    const upload = await ownUpload(req, res);
    if (!upload.rows) throw new HttpError(400, 'В файле не нашлось строк с № ПУ или ЛС.');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO consumers.registries(res_id, upload_id, file_name, rows, labels, uploaded_at, uploaded_by)
         SELECT res_id, id, file_name, rows, labels, now(), $2 FROM consumers.uploads WHERE id = $1
         ON CONFLICT (res_id) DO UPDATE SET upload_id=EXCLUDED.upload_id, file_name=EXCLUDED.file_name,
           rows=EXCLUDED.rows, labels=EXCLUDED.labels, uploaded_at=now(), uploaded_by=EXCLUDED.uploaded_by`,
        [upload.id, userOf(res).id || null]);
      await client.query('DELETE FROM consumers.uploads WHERE id=$1', [upload.id]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    // Прежний реестр — после переключения, чтобы поиск не оставался пустым.
    await db.query('DELETE FROM consumers.records WHERE res_id=$1 AND upload_id<>$2', [upload.res_id, upload.id]);
    res.json({ rows: upload.rows });
  }));

  // ── Отметка монтёра ─────────────────────────────────────────────────
  const tmp = join(config.storagePath, 'consumers', 'tmp');
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => { mkdir(tmp, { recursive: true }).then(() => cb(null, tmp), e => cb(e as Error, tmp)); },
      filename: (_req, _file, cb) => cb(null, randomUUID()),
    }),
    limits: { fileSize: MAX_FILE_MB * 1048576, files: MAX_FILES * 2, fields: 10 },
  }).fields([{ name: 'photo', maxCount: MAX_FILES }, { name: 'psu', maxCount: MAX_FILES }]);
  const receive = (req: Request, res: Response) => new Promise<void>((ok, fail) => upload(req, res, err => {
    if (!err) return ok();
    if (err instanceof multer.MulterError) {
      fail(new HttpError(400, err.code === 'LIMIT_FILE_SIZE' ? `Файл больше ${MAX_FILE_MB} МБ — снимите фото заново в обычном качестве.`
        : `Можно приложить до ${MAX_FILES} фото объекта и ${MAX_FILES} листов ПСУ.`));
    } else fail(err);
  }));

  const visitFields = z.object({
    recordId: z.coerce.number().int(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lon: z.coerce.number().min(-180).max(180).optional(),
    accuracy: z.coerce.number().min(0).max(100000).optional(),
    comment: z.string().trim().max(1000).optional(),
  });

  app.post('/api/consumers/visits', requirePermission('consumers.field'), route(async (req, res) => {
    const user = userOf(res);
    await receive(req, res);
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const all = [...(files.photo ?? []), ...(files.psu ?? [])];
    try {
      const body = visitFields.safeParse(req.body);
      if (!body.success) throw new HttpError(400, 'Отметка заполнена некорректно.');
      const { recordId, lat, lon, accuracy, comment } = body.data;
      const hasGeo = lat !== undefined && lon !== undefined;
      if (!hasGeo && !all.length) throw new HttpError(400, 'Поставьте геометку или приложите фото объекта / ПСУ.');
      const { rows } = await db.query(
        `SELECT c.res_id, c.meter, c.account, c.title, c.address FROM consumers.records c
         JOIN consumers.registries g ON g.res_id = c.res_id AND g.upload_id = c.upload_id WHERE c.id=$1`, [recordId]);
      const record = rows[0];
      if (!record || !inScope(user, record.res_id)) throw new HttpError(404, 'Потребитель не найден — возможно, реестр обновили. Повторите поиск.');

      // Сначала готовим файлы (перекодирование может отказать) — потом пишем отметку.
      const photos = await Promise.all((files.photo ?? []).map(async f => toViewable(await readFile(f.path))));
      const psu = files.psu?.length ? await psuPdf(await Promise.all(files.psu.map(f => readFile(f.path)))) : null;

      const visit = await db.query<{ id: number }>(
        `INSERT INTO consumers.visits(res_id, meter, account, title, address, lat, lon, accuracy, comment, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [record.res_id, record.meter, record.account, record.title, record.address,
          hasGeo ? lat : null, hasGeo ? lon : null, hasGeo ? accuracy ?? null : null, comment || null, user.id || null]);
      const id = visit.rows[0].id;
      const dir = visitDir(id);
      await mkdir(dir, { recursive: true });
      const label = safeName(record.meter || record.account);
      const save = async (kind: 'photo' | 'psu', data: Buffer, mime: string, name: string) => {
        const stored = `${randomUUID()}.${name.split('.').pop()}`;
        await writeFile(join(dir, stored), data);
        await db.query('INSERT INTO consumers.visit_files(visit_id, kind, name, stored, mime, size) VALUES ($1,$2,$3,$4,$5,$6)',
          [id, kind, name, stored, mime, data.length]);
      };
      for (const [n, p] of photos.entries()) await save('photo', p.data, p.mime, `${label} фото ${n + 1}.${p.ext}`);
      if (psu) await save('psu', psu, 'application/pdf', `${label} ПСУ.pdf`);
      res.status(201).json({ id });
    } finally {
      for (const f of all) await rm(f.path, { force: true });
    }
  }));

  // ── Списки отметок ──────────────────────────────────────────────────
  // new / done — инженерам и руководителям своего РЭС (все РЭС — у ролей «все РЭС»),
  // mine — монтёру: что он отправил.
  app.get('/api/consumers/visits', route(async (req, res) => {
    const user = userOf(res);
    const kind = String(req.query.status ?? 'new');
    if (kind === 'mine') {
      if (!user.permissions.has('consumers.field')) throw new HttpError(403, 'Недостаточно прав.');
      const { rows } = await db.query<VisitRow>(`${VISIT_SELECT} WHERE v.created_by = $1 ORDER BY v.created_at DESC LIMIT 100`, [user.id]);
      return res.json(rows.map(visitOut));
    }
    if (!user.permissions.has('consumers.inbox')) throw new HttpError(403, 'Недостаточно прав: видеть отметки монтёров.');
    if (kind !== 'new' && kind !== 'done') throw new HttpError(400, 'Нет такого списка.');
    const scope = scopeOf(user, req.query.res);
    const { rows } = await db.query<VisitRow>(
      `${VISIT_SELECT} WHERE v.status = $1 AND ($2::int[] IS NULL OR v.res_id = ANY($2))
       ORDER BY ${kind === 'new' ? 'v.created_at' : 'v.done_at DESC'} LIMIT 500`, [kind, scope]);
    res.json(rows.map(visitOut));
  }));

  // Отметку видит инженер её РЭС (право inbox) или сам автор.
  async function visibleVisit(req: Request, res: Response) {
    const user = userOf(res);
    const { rows } = await db.query<VisitRow>(`${VISIT_SELECT} WHERE v.id = $1`, [Number(req.params.id)]);
    const v = rows[0];
    const allowed = v && ((user.permissions.has('consumers.inbox') && inScope(user, v.res_id)) || (user.id && v.created_by === user.id));
    if (!allowed) throw new HttpError(404, 'Отметка не найдена — возможно, она уже удалена.');
    return v;
  }

  app.get('/api/consumers/visits/:id/files/:fileId', route(async (req, res) => {
    const v = await visibleVisit(req, res);
    const { rows } = await db.query<{ name: string; stored: string; mime: string; size: number }>(
      'SELECT name, stored, mime, size FROM consumers.visit_files WHERE id=$1 AND visit_id=$2', [Number(req.params.fileId), v.id]);
    const file = rows[0];
    const path = file && join(visitDir(v.id), file.stored);
    if (!file || !(await stat(path).catch(() => null))) throw new HttpError(404, 'Файл не найден.');
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', file.size);
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    createReadStream(path).pipe(res);
  }));

  // Все вложения отметки одним архивом.
  app.get('/api/consumers/visits/:id/archive', route(async (req, res) => {
    const v = await visibleVisit(req, res);
    const { rows } = await db.query<{ name: string; stored: string }>(
      'SELECT name, stored FROM consumers.visit_files WHERE visit_id=$1 ORDER BY id', [v.id]);
    if (!rows.length) throw new HttpError(404, 'К отметке не приложено файлов.');
    const zip = new JSZip();
    for (const f of rows) zip.file(f.name, await readFile(join(visitDir(v.id), f.stored)));
    const data = await zip.generateAsync({ type: 'nodebuffer' });
    const name = `${safeName(v.meter || v.account)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(data);
  }));

  app.post('/api/consumers/visits/:id/complete', requirePermission('consumers.complete'), route(async (req, res) => {
    const user = userOf(res);
    const { rows } = await db.query<{ res_id: number; status: string }>('SELECT res_id, status FROM consumers.visits WHERE id=$1', [Number(req.params.id)]);
    const v = rows[0];
    if (!v || !inScope(user, v.res_id)) throw new HttpError(404, 'Отметка не найдена — возможно, она уже удалена.');
    if (v.status === 'done') return res.json({ ok: true });
    await db.query(`UPDATE consumers.visits SET status='done', done_at=now(), done_by=$2 WHERE id=$1`, [Number(req.params.id), user.id || null]);
    res.json({ ok: true });
  }));

  // Уборка: сразу при старте и раз в час.
  const tick = () => { cleanupConsumers(db).catch(e => console.error('[consumers] уборка:', e instanceof Error ? e.message : e)); };
  tick();
  setInterval(tick, 3_600_000).unref();
}
