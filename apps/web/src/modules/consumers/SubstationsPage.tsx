import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { useAuth } from '../../auth/AuthContext.js';
import { api } from '../../auth/session.js';
import { Badge, Button, Card, Empty, PageHeader, Select, Switch, useToast } from '../../ui/kit.js';
import { IconDownload, IconUpload } from '../../ui/icons.js';
import type { MenuItem, ModuleMeta } from '../registry.js';
import { distanceM, fmtTime, parseCoords, routeUrl, type Card as CardData } from './api.js';
import { sheetJs } from './parse.js';
import { RouteLinks } from './RouteLinks.js';

// ТП и карта: справочник ТП РЭС (координаты загружает администратор по шаблону
// «РЭС | ТП | Координаты»), число потребителей на ТП — по действующему реестру РЭС
// (столбец «Подключение · ТП»), карта: ТП и потребители с координатами реестра,
// линия «потребитель → его ТП». Длинная линия — повод проверить привязку.

type Sub = { name: string; lat: number | null; lon: number | null; consumers: number; withCoords: number };
type Data = {
  res: { id: number; name: string }[];
  current: null | {
    id: number; name: string; registry: { uploadedAt: string; rows: number } | null;
    columns: { tp: string | null; coords: string | null }; directoryUploadedAt: string | null;
    substations: Sub[]; unknown: { name: string; consumers: number; withCoords: number }[];
    totals: { consumers: number; withCoords: number; noTp: number; linked: number };
    points: [number, number, number, number][];
  };
};
type Report = { loaded: { res: string; count: number; withCoords: number }[]; skipped: { row: number; reason: string }[]; skippedTotal: number };

/** Расстояние до ТП: до 500 м — норма, до 1,5 км — проверить, дальше — скорее всего чужая ТП. */
export const FAR_M = 1500, NEAR_M = 500;
const lineColor = (m: number) => m <= NEAR_M ? 'var(--ok)' : m <= FAR_M ? 'var(--warn)' : 'var(--danger)';
const km = (m: number) => m < 1000 ? `${Math.round(m)} м` : `${(m / 1000).toFixed(1).replace('.', ',')} км`;

export function SubstationsPage({ module, page }: { module: ModuleMeta; page: MenuItem }) {
  const { can } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [resId, setResId] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [allLines, setAllLines] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback((id = resId) => {
    api<Data>(`/api/consumers/substations${id ? `?res=${id}` : ''}`)
      .then(d => { setData(d); setSelected(null); if (!id && d.current) setResId(String(d.current.id)); })
      .catch(e => toast(e.message, 'error'));
  }, [resId, toast]);
  useEffect(() => { load(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = data?.current ?? null;
  // Дальность до своей ТП по каждой точке с координатами
  const far = useMemo(() => {
    const out = new Map<number, number>();   // № ТП → сколько потребителей дальше FAR_M
    if (!cur) return out;
    for (const [, lat, lon, i] of cur.points) {
      const s = i >= 0 ? cur.substations[i] : null;
      if (s?.lat == null || s.lon == null) continue;
      if (distanceM({ lat, lon }, { lat: s.lat, lon: s.lon }) > FAR_M) out.set(i, (out.get(i) ?? 0) + 1);
    }
    return out;
  }, [cur]);
  const farTotal = [...far.values()].reduce((a, b) => a + b, 0);

  const upload = async () => {
    const f = file.current?.files?.[0];
    if (file.current) file.current.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const rows = await readDirectory(f);
      const r = await api<Report>('/api/consumers/substations', { method: 'POST', json: { rows } });
      setReport(r);
      toast(`Справочник ТП загружен: ${r.loaded.map(l => `${l.res} — ${l.count}`).join(', ')}`);
      load();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };

  const actions = can('consumers.substations') ? (
    <>
      <Button icon={<IconDownload />} onClick={() => downloadTemplate().catch(e => toast(e.message, 'error'))}>Скачать шаблон</Button>
      <Button variant="primary" icon={<IconUpload />} onClick={() => file.current?.click()} disabled={busy}>{busy ? 'Загружаю…' : 'Загрузить справочник ТП'}</Button>
      <input ref={file} type="file" accept=".xlsx,.xls,.csv" hidden onChange={upload} />
    </>
  ) : undefined;

  return (
    <>
      <PageHeader crumbs={['ЭнергоСфера', module.title]} title={page.title} subtitle={page.about} actions={actions} />
      {report && (
        <Card title="Загрузка справочника ТП" aside={<Button variant="ghost" onClick={() => setReport(null)}>Скрыть</Button>}>
          <p>{report.loaded.map(l => `${l.res}: ТП ${l.count}, с координатами ${l.withCoords}`).join(' · ')}</p>
          {report.skippedTotal > 0 && (
            <>
              <p><b>Пропущено строк: {report.skippedTotal}</b></p>
              <ul className="cs-skipped">{report.skipped.slice(0, 30).map(s => <li key={s.row}>строка {s.row} — {s.reason}</li>)}</ul>
            </>
          )}
        </Card>
      )}
      {!data ? <p className="muted">Загрузка…</p> : !cur ? <Card><Empty image={module.image} title="Нет доступных РЭС" /></Card> : (
        <div className="cs-subs">
          <div className="cs-subs__bar">
            {data.res.length > 1 && (
              <Select value={resId} onChange={e => { setResId(e.target.value); load(e.target.value); }}>
                {data.res.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            )}
            <span className="muted">
              {cur.registry ? `Реестр от ${fmtTime(cur.registry.uploadedAt)}` : 'Реестр РЭС не загружен'}
              {cur.directoryUploadedAt ? ` · справочник ТП от ${fmtTime(cur.directoryUploadedAt)}` : ' · справочник ТП не загружен'}
            </span>
          </div>

          <div className="cs-subs__stats">
            <Stat value={cur.substations.length} label="ТП в справочнике" note={`с координатами ${cur.substations.filter(s => s.lat !== null).length}`} />
            <Stat value={cur.totals.consumers} label="потребителей в реестре" note={`с координатами ${cur.totals.withCoords}`} />
            <Stat value={cur.totals.linked} label="привязаны к ТП справочника" note={`без ТП в реестре ${cur.totals.noTp}`} />
            <Stat value={farTotal} label={`дальше ${km(FAR_M)} от своей ТП`} note="проверить привязку" tone={farTotal ? 'danger' : undefined} />
          </div>

          {cur.registry && (!cur.columns.tp || !cur.columns.coords) && (
            <Card><p>В реестре РЭС не найден столбец {[!cur.columns.tp && '«ТП»', !cur.columns.coords && '«Координаты»'].filter(Boolean).join(' и ')} — {!cur.columns.tp ? 'потребителей по ТП не посчитать' : 'потребителей на карте не показать'}. Загрузите расширенный список с этими столбцами.</p></Card>
          )}

          <Card className="card--flush" title="Карта" aside={<Switch checked={allLines} onChange={setAllLines} label="Связи всех потребителей" />}>
            <SubstationMap data={cur} selected={selected} onSelect={setSelected} allLines={allLines} />
            <div className="cs-legend">
              <span><i style={{ background: 'var(--ok)' }} />до {km(NEAR_M)}</span>
              <span><i style={{ background: 'var(--warn)' }} />до {km(FAR_M)}</span>
              <span><i style={{ background: 'var(--danger)' }} />дальше — проверить привязку</span>
              <span><i className="is-none" />ТП нет в справочнике</span>
              <span className="muted">Нажмите на ТП — покажутся её потребители и связи.</span>
            </div>
          </Card>

          <Card className="card--flush" title={`ТП · ${cur.substations.length}`}>
            {!cur.substations.length ? (
              <Empty title="Справочник ТП этого РЭС не загружен" text="Его загружает администратор по шаблону «РЭС | ТП | Координаты»." />
            ) : (
              <div className="table-wrap">
                <table className="table cs-subs__table">
                  <thead><tr><th>ТП</th><th>Координаты</th><th>Потребителей</th><th>С координатами</th><th>Дальше {km(FAR_M)}</th></tr></thead>
                  <tbody>
                    {cur.substations.map((s, i) => (
                      <tr key={s.name} className={selected === i ? 'is-selected' : ''} onClick={() => setSelected(selected === i ? null : i)}>
                        <td><b>{s.name}</b></td>
                        <td onClick={e => e.stopPropagation()}>{s.lat !== null && s.lon !== null ? <RouteLinks geo={{ lat: s.lat, lon: s.lon }} label={`${s.lat}; ${s.lon}`} /> : <span className="muted">нет</span>}</td>
                        <td>{s.consumers}</td>
                        <td>{s.withCoords}</td>
                        <td>{far.get(i) ? <Badge tone="danger">{far.get(i)}</Badge> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {cur.unknown.length > 0 && (
            <Card className="card--flush" title={`ТП из реестра, которых нет в справочнике · ${cur.unknown.length}`}>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>ТП в реестре</th><th>Потребителей</th><th>С координатами</th></tr></thead>
                  <tbody>{cur.unknown.map(u => <tr key={u.name}><td>{u.name}</td><td>{u.consumers}</td><td>{u.withCoords}</td></tr>)}</tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

function Stat({ value, label, note, tone }: { value: number; label: string; note: string; tone?: 'danger' }) {
  return (
    <div className={`cs-stat${tone ? ` cs-stat--${tone}` : ''}`}>
      <b>{value.toLocaleString('ru-RU')}</b><span>{label}</span><small>{note}</small>
    </div>
  );
}

// ── Карта ──────────────────────────────────────────────────────────────
const loadLeaflet = () => import('leaflet').then(m => m.default);
type LeafletLib = Awaited<ReturnType<typeof loadLeaflet>>;
const SOCHI: [number, number] = [43.585, 39.723];
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim() || '#888';

function SubstationMap({ data, selected, onSelect, allLines }: { data: NonNullable<Data['current']>; selected: number | null; onSelect: (i: number | null) => void; allLines: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const lib = useRef<LeafletLib | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const pick = useRef(onSelect);
  pick.current = onSelect;

  useEffect(() => {
    let alive = true;
    Promise.all([loadLeaflet(), import('leaflet/dist/leaflet.css')]).then(([L]) => {
      if (!alive || !box.current) return;
      lib.current = L;
      const m = L.map(box.current, { center: SOCHI, zoom: 11, preferCanvas: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      }).addTo(m);
      layer.current = L.layerGroup().addTo(m);
      map.current = m;
      setReady(true);
    }).catch(() => alive && setFailed(true));
    return () => { alive = false; map.current?.remove(); map.current = null; };
  }, []);

  // Карта встаёт на РЭС при смене данных
  useEffect(() => {
    const L = lib.current, m = map.current;
    if (!ready || !L || !m) return;
    const pts: [number, number][] = [...data.points.map(p => [p[1], p[2]] as [number, number]),
      ...data.substations.filter(s => s.lat !== null && s.lon !== null).map(s => [s.lat!, s.lon!] as [number, number])];
    if (pts.length) m.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 });
  }, [ready, data]);

  useEffect(() => {
    const L = lib.current, g = layer.current;
    if (!ready || !L || !g) return;
    g.clearLayers();
    const colors = { ok: css('var(--ok)'), warn: css('var(--warn)'), danger: css('var(--danger)'), accent: css('var(--accent-strong)'), none: '#8a929c' };
    const renderer = L.canvas({ padding: 0.3 });
    for (const [id, lat, lon, i] of data.points) {
      const s = i >= 0 ? data.substations[i] : null;
      const hasTp = s?.lat != null && s.lon != null;
      const d = hasTp ? distanceM({ lat, lon }, { lat: s!.lat!, lon: s!.lon! }) : null;
      const color = d === null ? colors.none : d <= NEAR_M ? colors.ok : d <= FAR_M ? colors.warn : colors.danger;
      const dim = selected !== null && i !== selected;
      if (hasTp && (allLines || i === selected))
        L.polyline([[lat, lon], [s!.lat!, s!.lon!]], { renderer, color, weight: 1.5, opacity: dim ? 0.15 : 0.8, interactive: false }).addTo(g);
      L.circleMarker([lat, lon], { renderer, radius: dim ? 3 : 5, color: '#fff', weight: 1, fillColor: color, fillOpacity: dim ? 0.35 : 0.95 })
        .addTo(g).bindPopup(() => consumerPopup(id, s, d), { maxWidth: 320 });
    }
    data.substations.forEach((s, i) => {
      if (s.lat === null || s.lon === null) return;
      L.marker([s.lat, s.lon], {
        icon: L.divIcon({ className: `cs-tp${selected === i ? ' is-selected' : ''}`, html: `<span>${escapeHtml(s.name)}</span><b>${s.consumers}</b>`, iconSize: null as unknown as Leaflet.PointExpression, iconAnchor: [12, 12] }),
        zIndexOffset: selected === i ? 1000 : 0,
      }).addTo(g).on('click', () => pick.current(selected === i ? null : i));
    });
  }, [ready, data, selected, allLines]);

  if (failed) return <p className="muted cs-subs__pad">Карта не загрузилась — проверьте интернет и обновите страницу.</p>;
  return <div ref={box} className="cs-map cs-map--big" />;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Всплывашка потребителя: подгружается при нажатии (карточка из реестра). */
function consumerPopup(id: number, tp: Sub | null, d: number | null) {
  const el = document.createElement('div');
  el.className = 'cs-popup';
  el.textContent = 'Загрузка…';
  api<CardData>(`/api/consumers/records/${id}`).then(c => {
    const tpCell = c.cells.find(([l]) => /(^|· )ТП$/.test(l))?.[1];
    const geo = c.cells.find(([l]) => /координат/i.test(l))?.[1];
    const geoAt = geo ? parseCoords(geo) : null;
    el.innerHTML = `<b>${escapeHtml(c.title || 'Без наименования')}</b><br>${escapeHtml(c.address)}<br>`
      + `${c.meter ? `ПУ ${escapeHtml(c.meter)} · ` : ''}${c.account ? `ЛС ${escapeHtml(c.account)}` : ''}<br>`
      + `ТП по реестру: <b>${escapeHtml(tpCell ?? '—')}</b>${tp ? '' : ' (нет в справочнике)'}`
      + (d !== null ? `<br>До ТП по прямой: <b style="color:${css(lineColor(d))}">${km(d)}</b>` : '')
      + (geoAt ? `<br><a href="${routeUrl(geoAt)}" target="_blank" rel="noreferrer">Маршрут</a>` : '');
  }).catch(() => { el.textContent = 'Не удалось загрузить карточку — возможно, реестр обновили.'; });
  return el;
}

// ── Шаблон и чтение справочника ─────────────────────────────────────────
type SheetLib = Awaited<ReturnType<typeof sheetJs>> & {
  utils: { aoa_to_sheet(rows: unknown[][]): unknown; book_new(): unknown; book_append_sheet(b: unknown, s: unknown, n: string): void; sheet_to_json(s: unknown, o: object): unknown[][] };
  writeFile(b: unknown, name: string): void;
};

async function downloadTemplate() {
  const X = await sheetJs() as SheetLib;
  const book = X.utils.book_new();
  const sheet = X.utils.aoa_to_sheet([['РЭС', 'ТП', 'Координаты'], ['Дагомысский РЭС', 'ТП-Д165', '43,8135; 39,6107']]) as Record<string, unknown>;
  sheet['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 22 }];
  X.utils.book_append_sheet(book, sheet, 'Справочник ТП');
  X.writeFile(book, 'Шаблон справочника ТП.xlsx');
}

/** Строки справочника: шапка «РЭС | ТП | Координаты» (или «Широта» и «Долгота» отдельно). */
async function readDirectory(f: File): Promise<{ res: string; tp: string; coords: string }[]> {
  const X = await sheetJs() as SheetLib;
  const book = X.read(await f.arrayBuffer(), { type: 'array' });
  const sheet = book.Sheets[book.SheetNames[0]];
  const rows = X.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as string[][];
  const low = (v: unknown) => String(v ?? '').toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
  const head = rows.findIndex(r => r.some(c => /^рэс/.test(low(c))) && r.some(c => /^(тп|наименование тп)$/.test(low(c))));
  if (head < 0) throw new Error('Не нашлась шапка «РЭС | ТП | Координаты» — скачайте шаблон и заполните его.');
  const h = rows[head].map(low);
  const col = (re: RegExp) => h.findIndex(c => re.test(c));
  const res = col(/^рэс/), tp = col(/^(тп|наименование тп)$/), coords = col(/координат/), lat = col(/широт/), lon = col(/долгот/);
  if (coords < 0 && (lat < 0 || lon < 0)) throw new Error('Нет столбца «Координаты» (или «Широта» и «Долгота»).');
  const out = rows.slice(head + 1)
    .map(r => ({ res: String(r[res] ?? '').trim(), tp: String(r[tp] ?? '').trim(), coords: coords >= 0 ? String(r[coords] ?? '').trim() : [r[lat], r[lon]].filter(Boolean).join('; ') }))
    .filter(r => r.res || r.tp);
  if (!out.length) throw new Error('В файле нет строк под шапкой.');
  return out;
}
