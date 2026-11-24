import type { Express } from 'express';
import { z } from 'zod';
import { HttpError, type Db } from '../../db.js';
import { requirePermission, route, userOf } from '../../core/http.js';
import type { UserContext } from '../../core/access-service.js';

// Справочник ТП и карта «потребители ↔ ТП». ТП потребителя и его координаты берутся
// из действующего реестра РЭС (столбцы «Подключение · ТП» и «Координаты»), координаты
// ТП — из справочника, который загружает администратор. Линия «потребитель → его ТП»
// на карте показывает, правдоподобна ли привязка (как поопорная схема).

/** Ключ ТП: «ТП-Д165», «КТП Д-165», «д165» → «Д165». РП и прочее — без префикса не режем. */
export function tpKey(value: unknown): string {
  return String(value ?? '').toLocaleUpperCase('ru').replace(/Ё/g, 'Е').replace(/\s+/g, '')
    .replace(/^(?:[КМЗСГ]?ТП[НП]?|БКТП|КТПН)(?=[-№.]|[А-ЯA-Z]?\d)/, '').replace(/[^0-9A-ZА-Я/]/g, '');
}

/** «43,8135; 39,6107», «43.8135, 39.6107», «43,8135 39,6107» → { lat, lon }. */
export function parseCoords(value: unknown): { lat: number; lon: number } | null {
  const nums = String(value ?? '').match(/-?\d{1,3}(?:[.,]\d+)?/g);
  if (!nums || nums.length !== 2) return null;
  const [lat, lon] = nums.map(n => Number(n.replace(',', '.')));
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180) || (lat === 0 && lon === 0)) return null;
  return { lat, lon };
}

const norm = (s: string) => s.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const lastPart = (label: string) => norm(label.split(' · ').pop() ?? '');
/** Номера столбцов ТП и координат в реестре (по собственному названию столбца). */
export function registryColumns(labels: string[]) {
  const tp = labels.findIndex(l => /^(тп|наименование тп|номер тп|тп\/рп)$/.test(lastPart(l)));
  const coords = labels.findIndex(l => /координат/.test(lastPart(l)));
  return { tp: tp < 0 ? null : tp, coords: coords < 0 ? null : coords, tpLabel: tp < 0 ? null : labels[tp], coordsLabel: coords < 0 ? null : labels[coords] };
}

/** «Дагомысский РЭС», «дагомысский», «Дагомысский район электросетей» → ключ для сопоставления. */
const resKey = (s: string) => norm(s).replace(/рэс|район\S*\s+электр\S*\s+сет\S*/g, '').replace(/[^а-яa-z0-9]/g, '');

const inScope = (user: UserContext, resId: number) => user.resScope === null || user.resScope.includes(resId);

type Point = { id: number; tp: string; lat: number | null; lon: number | null };

export function mountSubstations(app: Express, { db }: { db: Db }) {
  const view = requirePermission('consumers.view');

  /** Потребители действующего реестра РЭС (строки тарифных зон одного ПУ и ЛС — один потребитель). */
  async function consumersOf(resId: number) {
    const reg = (await db.query<{ labels: string[]; upload_id: string; uploaded_at: Date; rows: number }>(
      'SELECT labels, upload_id, uploaded_at, rows FROM consumers.registries WHERE res_id=$1', [resId])).rows[0];
    if (!reg) return { columns: registryColumns([]), registry: null, points: [] as Point[] };
    const columns = registryColumns(reg.labels ?? []);
    if (columns.tp === null && columns.coords === null) return { columns, registry: reg, points: [] as Point[] };
    const { rows } = await db.query<{ id: number; tp: string | null; coords: string | null }>(
      `SELECT min(c.id)::int AS id, min(c.cells->>$3::int) AS tp, min(c.cells->>$4::int) AS coords
       FROM consumers.records c WHERE c.res_id=$1 AND c.upload_id=$2 AND jsonb_typeof(c.cells->0) IS DISTINCT FROM 'array'
       GROUP BY c.meter, c.account, CASE WHEN c.meter = '' AND c.account = '' THEN c.id END`,
      [resId, reg.upload_id, columns.tp ?? -1, columns.coords ?? -1]);
    const points = rows.map(r => { const g = parseCoords(r.coords); return { id: r.id, tp: (r.tp ?? '').trim(), lat: g?.lat ?? null, lon: g?.lon ?? null }; });
    return { columns, registry: reg, points };
  }

  async function resOf(user: UserContext, wanted: unknown) {
    const list = (await db.query<{ id: number; name: string }>(
      'SELECT id, name FROM core.res WHERE ($1::int[] IS NULL OR id = ANY($1)) ORDER BY sort, name', [user.resScope])).rows;
    if (wanted === undefined || wanted === '') return { list, res: list[0] ?? null };
    const res = list.find(r => r.id === Number(wanted));
    if (!res) throw new HttpError(403, 'Этот РЭС вам не доступен.');
    return { list, res };
  }

  // Справочник ТП РЭС с числом потребителей по действующему реестру + карта.
  app.get('/api/consumers/substations', view, route(async (req, res) => {
    const user = userOf(res);
    const { list, res: r } = await resOf(user, req.query.res);
    if (!r) { res.json({ res: list, current: null }); return; }
    const subs = (await db.query<{ name: string; name_key: string; lat: number | null; lon: number | null; uploaded_at: Date }>(
      'SELECT name, name_key, lat, lon, uploaded_at FROM consumers.substations WHERE res_id=$1 ORDER BY name', [r.id])).rows;
    const { columns, registry, points } = await consumersOf(r.id);
    const index = new Map(subs.map((s, i) => [s.name_key, i]));
    const counts = subs.map(() => ({ consumers: 0, withCoords: 0 }));
    const unknown = new Map<string, { name: string; consumers: number; withCoords: number }>();
    let noTp = 0;
    // Точки карты: [id записи, широта, долгота, № ТП в справочнике или -1]
    const mapPoints: [number, number, number, number][] = [];
    for (const p of points) {
      const key = tpKey(p.tp);
      const i = key ? index.get(key) : undefined;
      if (!key) noTp++;
      else if (i === undefined) {
        const u = unknown.get(key) ?? { name: p.tp, consumers: 0, withCoords: 0 };
        u.consumers++; if (p.lat !== null) u.withCoords++;
        unknown.set(key, u);
      } else { counts[i].consumers++; if (p.lat !== null) counts[i].withCoords++; }
      if (p.lat !== null && p.lon !== null) mapPoints.push([p.id, p.lat, p.lon, i ?? -1]);
    }
    res.json({
      res: list,
      current: {
        id: r.id, name: r.name,
        registry: registry ? { uploadedAt: registry.uploaded_at, rows: registry.rows } : null,
        columns: { tp: columns.tpLabel, coords: columns.coordsLabel },
        directoryUploadedAt: subs.reduce<Date | null>((m, s) => !m || s.uploaded_at > m ? s.uploaded_at : m, null),
        substations: subs.map((s, i) => ({ name: s.name, lat: s.lat, lon: s.lon, ...counts[i] })),
        unknown: [...unknown.values()].sort((a, b) => b.consumers - a.consumers),
        totals: { consumers: points.length, withCoords: mapPoints.length, noTp, linked: counts.reduce((a, c) => a + c.consumers, 0) },
        points: mapPoints,
      },
    });
  }));

  // Загрузка справочника (администратор): строки из шаблона, разобранные в браузере.
  // Для каждого РЭС из файла справочник заменяется целиком; РЭС, которых в файле нет, не трогаются.
  const rowSchema = z.object({ res: z.string().max(200), tp: z.string().max(200), coords: z.string().max(200).default('') });
  app.post('/api/consumers/substations', requirePermission('consumers.substations'), route(async (req, res) => {
    const user = userOf(res);
    const parsed = z.array(rowSchema).min(1).max(20000).safeParse(req.body?.rows);
    if (!parsed.success) throw new HttpError(400, 'Строки справочника пришли в неверном виде — проверьте шаблон.');
    const resList = (await db.query<{ id: number; name: string }>('SELECT id, name FROM core.res')).rows;
    const byKey = new Map(resList.map(r => [resKey(r.name), r]));
    const skipped: { row: number; reason: string }[] = [];
    const byRes = new Map<number, Map<string, { name: string; lat: number | null; lon: number | null }>>();
    parsed.data.forEach((row, i) => {
      const n = i + 2;   // строка Excel: первая — шапка
      const r = byKey.get(resKey(row.res));
      if (!r) return void skipped.push({ row: n, reason: `РЭС «${row.res}» не найден в списке РЭС Сферы` });
      if (!inScope(user, r.id)) return void skipped.push({ row: n, reason: `РЭС «${r.name}» вам не доступен` });
      const key = tpKey(row.tp);
      if (!key) return void skipped.push({ row: n, reason: 'не указана ТП' });
      const g = row.coords.trim() ? parseCoords(row.coords) : null;
      if (row.coords.trim() && !g) return void skipped.push({ row: n, reason: `координаты «${row.coords}» не распознаны — нужно «43,8135; 39,6107»` });
      const map = byRes.get(r.id) ?? new Map();
      if (map.has(key)) skipped.push({ row: n, reason: `ТП «${row.tp.trim()}» повторяется — взята последняя строка` });
      map.set(key, { name: row.tp.trim(), lat: g?.lat ?? null, lon: g?.lon ?? null });
      byRes.set(r.id, map);
    });
    if (!byRes.size) throw new HttpError(400, `Ни одной строки не загружено: ${skipped.slice(0, 3).map(s => `строка ${s.row} — ${s.reason}`).join('; ')}`);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const [resId, map] of byRes) {
        await client.query('DELETE FROM consumers.substations WHERE res_id=$1', [resId]);
        await client.query(
          `INSERT INTO consumers.substations(res_id, name, name_key, lat, lon, uploaded_by)
           SELECT $1, x.name, x.key, x.lat, x.lon, $3 FROM jsonb_to_recordset($2::jsonb) AS x(name text, key text, lat float8, lon float8)`,
          [resId, JSON.stringify([...map].map(([key, v]) => ({ key, ...v }))), user.id || null]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    res.json({
      loaded: [...byRes].map(([id, map]) => ({ res: resList.find(r => r.id === id)!.name, count: map.size, withCoords: [...map.values()].filter(v => v.lat !== null).length })),
      skipped: skipped.slice(0, 200), skippedTotal: skipped.length,
    });
  }));
}
