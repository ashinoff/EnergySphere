import { setTimeout as delay } from 'node:timers/promises';
import { HttpError } from '../../db.js';

// Поиск дома по адресу реестра — как в Web_abonent (map-geocoder.mjs): Photon
// (OpenStreetMap), не чаще раза в 1,1 с на весь сервер, ответы кешируются.
// В запрос уходит только адрес дома — без квартиры и без данных потребителя.

// level: house — дом; street / place — дом в OSM не нашёлся, карта откроется на
// улице или в посёлке, дом монтёр укажет сам.
export type Level = 'house' | 'street' | 'place';
// exact — тот же дом, улица и посёлок (метку ставим сразу); sameHouse — дом и улица
// совпали, а посёлок OSM называет иначе (первым в списке, выбирает монтёр).
export interface Place { lat: number; lon: number; label: string; house: string; street: string; city: string; exact: boolean; sameHouse: boolean; level: Level }
// area — все названия места из OSM (город, район, посёлок): «Дагомыс» там — район Сочи.
type Found = Omit<Place, 'exact' | 'sameHouse' | 'level'> & { area: string[] };
interface Parts { locality: string; street: string; house: string }

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = (v: unknown) => clean(v).toLocaleLowerCase('ru').replace(/ё/g, 'е');
// Без «г.», «ул.», «д.» и знаков: «ул. Ленина» = «Ленина», «д 5А» = «5а».
const part = (v: unknown) => norm(v)
  .replace(/(?:^|\s)(?:г|город|пос|поселок|п|пгт|с|село|ст|станица|снт|ул|улица|проспект|пр-кт|пер|переулок|д|дом|корп|корпус)(?:\.|(?=\s|$))\s*/g, ' ')
  .replace(/[^\p{L}\p{N}]/gu, '');

// \b в JS не видит кириллицу — граница слова через (?!\p{L}).
const FLAT = /^(?:кв|квартира|офис|оф|пом|помещение|ком|комната)(?!\p{L})/iu;
const HOUSE = /^(?:д|дом)\.?\s*(?=\d)/iu;
const BUILDING = /^(?:корп|корпус|к|стр|строение)(?!\p{L})\.?\s*/iu;

// Без подписей «г», «пгт», «ул»: так Photon находит лучше («пгт Дагомыс» не находит).
const TYPE = /(?:^|\s)(?:г|город|пос|поселок|посёлок|п|пгт|рп|с|село|ст|станица|ст-ца|снт|днт|х|хутор|аул|мкр|ул|улица|пер|переулок)(?:\.|(?=\s|$))\s*/giu;
const bare = (v: string) => clean(v.replace(TYPE, ' '));

// «Сочи, ул. Ленина, д. 5, корп. 2, кв. 7» → адрес для поиска и его части.
export function houseAddress(address: string): { query: string; parts: Parts | null } {
  const items = clean(address).split(/\s*[,;]\s*/).filter(Boolean).filter(p => !FLAT.test(p));
  const at = items.findIndex(p => HOUSE.test(p));
  if (at < 0) return { query: items.join(', '), parts: null };
  const building = items[at + 1] && BUILDING.test(items[at + 1]) ? items[at + 1].replace(BUILDING, '') : '';
  const house = items[at].replace(HOUSE, '') + building;
  const keep = items.slice(0, at + (building ? 2 : 1));
  // Photon путает «д.» с литерой дома «Д» — номер без подписи (как в Web_abonent).
  const query = keep.map(p => p.replace(HOUSE, '')).join(', ');
  return { query, parts: at >= 1 ? { street: items[at - 1], locality: at >= 2 ? items[at - 2] : '', house } : null };
}

function candidates(data: unknown): Found[] {
  const features = (data as { features?: unknown[] })?.features;
  return (Array.isArray(features) ? features : []).slice(0, 8).flatMap(f => {
    const { geometry, properties: p = {} } = f as { geometry?: { type?: string; coordinates?: number[] }; properties?: Record<string, unknown> };
    const [lon, lat] = geometry?.coordinates ?? [];
    if (geometry?.type !== 'Point' || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    if (typeof p.countrycode === 'string' && p.countrycode.toUpperCase() !== 'RU') return [];
    const text = (k: string) => (typeof p[k] === 'string' ? (p[k] as string).slice(0, 180) : '');
    const city = text('city') || text('locality') || text('district');
    const street = text('street') || text('name');
    const area = ['city', 'district', 'locality', 'suburb', 'county'].map(text).filter(Boolean);
    return [{ lat: +lat.toFixed(6), lon: +lon.toFixed(6), house: text('housenumber'), street, city, area,
      label: [city, street, text('housenumber')].filter(Boolean).join(', ') || text('state') }];
  });
}

// Тот же дом на той же улице.
const sameHouse = (c: Found, parts: Parts | null) =>
  !!parts && !!c.house && part(c.house) === part(parts.house) && part(c.street) === part(parts.street);
const sameArea = (c: Found, parts: Parts) => !parts.locality || c.area.some(a => part(a) === part(parts.locality));

export function createGeocoder({ fetcher = (...a: Parameters<typeof fetch>) => globalThis.fetch(...a), intervalMs = 1100, endpoint = process.env.MAP_GEOCODER_URL || 'https://photon.komoot.io/api/' } = {}) {
  const cache = new Map<string, Found[]>();
  let chain: Promise<unknown> = Promise.resolve();
  let nextAt = 0, waiting = 0;

  async function ask(query: string) {
    await delay(Math.max(0, nextAt - Date.now()));
    nextAt = Date.now() + intervalMs;
    const url = new URL(endpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '8');
    // Только Большой Сочи (Лазаревское — Красная Поляна): иначе «Садовая, 1»
    // находится в Москве. MAP_BBOX = minLon,minLat,maxLon,maxLat.
    url.searchParams.set('bbox', process.env.MAP_BBOX || '39.0,43.35,40.45,44.15');
    url.searchParams.set('lang', 'default');
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(10_000), redirect: 'error',
      headers: { 'User-Agent': 'EnergySphere/1.0 (+https://github.com/ashinoff/EnergySphere)', Accept: 'application/json', 'Accept-Language': 'ru' },
    });
    if (!response.ok) throw new HttpError(502, response.status === 429 ? 'Сервис карты ограничил запросы — повторите через минуту.' : 'Сервис карты временно недоступен.');
    const text = await response.text();
    if (text.length > 200_000) throw new HttpError(502, 'Сервис карты вернул слишком большой ответ.');
    return candidates(JSON.parse(text));
  }

  // Один запрос к Photon по очереди со всеми, ответ — в кеш.
  async function cached(query: string) {
    const key = norm(query);
    const hit = cache.get(key);
    if (hit) return hit;
    if (waiting >= 30) throw new HttpError(429, 'Поиск адресов занят — повторите чуть позже.');
    waiting++;
    const job = chain.then(() => ask(query));
    chain = job.catch(() => {});
    try {
      const found = await job;
      cache.set(key, found);
      if (cache.size > 2000) cache.delete(cache.keys().next().value!);
      return found;
    } catch (e) {
      throw e instanceof HttpError ? e : new HttpError(502, 'Не удалось найти адрес — укажите дом на карте.');
    } finally { waiting--; }
  }

  return {
    async lookup(address: string): Promise<{ query: string; places: Place[] }> {
      const { query, parts } = houseAddress(address);
      if (query.length < 4) throw new HttpError(400, 'В реестре нет адреса — укажите дом на карте.');
      // Дом → улица → посёлок: на чём OSM остановится, туда и встанет карта.
      const tries: [Level, string][] = [['house', bare(query)]];
      if (parts) {
        tries.push(['street', bare([parts.locality, parts.street].filter(Boolean).join(', '))]);
        if (parts.locality) tries.push(['place', bare(parts.locality)]);
      }
      for (const [level, q] of tries) {
        if (q.length < 3) continue;
        const raw = await cached(q);
        if (!raw.length) continue;
        const found = raw.map(({ area, ...c }, i): Place => {
          const same = level === 'house' && sameHouse(raw[i], parts);
          return { ...c, level: level === 'house' && !c.house ? 'street' : level, sameHouse: same, exact: same && sameArea(raw[i], parts!) };
        });
        // Один и тот же дом (в OSM он бывает и зданием, и точкой адреса) — одной строкой.
        const unique = [...new Map(found.map(c => [norm(c.label), c])).values()];
        // Точные первыми, затем тот же дом в другом месте, затем остальное.
        const rank = (p: Place) => (p.exact ? 0 : p.sameHouse ? 1 : 2);
        return { query, places: unique.map((p, i) => [p, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([p]) => p).slice(0, 6) };
      }
      return { query, places: [] };
    },
  };
}
