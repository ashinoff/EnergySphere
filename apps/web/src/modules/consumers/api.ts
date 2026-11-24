import { api, apiBlob } from '../../auth/session.js';

// Модуль 02 «Поиск потребителя»: типы и обращения к /api/consumers.

export interface ResInfo {
  id: number;
  name: string;
  newVisits: number;
  registry: { fileName: string; rows: number; uploadedAt: string; uploadedBy: string | null } | null;
}

// zones — сколько строк реестра у этого ПУ с тем же ЛС (тарифные зоны физлица).
export interface Found { id: number; resId: number; resName: string; meter: string; account: string; title: string; address: string; zones: number }

export interface VisitFile { id: number; kind: 'photo' | 'psu'; name: string; size: number }
export interface Visit {
  id: number;
  res: { id: number; name: string };
  meter: string; account: string; title: string; address: string;
  geo: { lat: number; lon: number; accuracy: number | null } | null;
  comment: string | null;
  status: 'new' | 'done';
  createdAt: string; author: string | null;
  doneAt: string | null; doneBy: string | null; deleteAt: string | null;
  files: VisitFile[];
}

// zones — ячейки каждой тарифной зоны (пусто, если зона одна).
export interface Card extends Omit<Found, 'zones'> { cells: [string, string][]; zones: [string, string][][]; visits: Visit[] }

export const loadRes = () => api<ResInfo[]>('/api/consumers/res');

// Счётчик на пункте меню «Отметки монтёров».
export const newVisitsCount = () => api<{ count: number }>('/api/consumers/new-count').then(r => r.count);
// Пересчитать счётчики меню сразу (после отправки или завершения отметки).
export const refreshCounts = () => window.dispatchEvent(new Event('es-counts'));

export const mapUrl = (g: { lat: number; lon: number }) => `https://yandex.ru/maps/?pt=${g.lon},${g.lat}&z=18&l=map`;
export const fmtTime = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

// Скачать файл с токеном (ссылкой не открыть — нужен заголовок авторизации).
export async function saveFile(path: string, name: string) {
  const url = URL.createObjectURL(await apiBlob(path));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Координаты из реестра: «43,8135; 39,6107», «43.8135, 39.6107» → широта и долгота.
export function parseCoords(value: string): { lat: number; lon: number } | null {
  const nums = value.match(/-?\d{1,3}(?:[.,]\d+)?/g);
  if (!nums || nums.length !== 2) return null;
  const [lat, lon] = nums.map(n => Number(n.replace(',', '.')));
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180) || (lat === 0 && lon === 0)) return null;
  return { lat, lon };
}
// Маршрут от текущего места: Яндекс Карты (в телефоне откроют приложение) и Навигатор.
export const routeUrl = (g: { lat: number; lon: number }) => `https://yandex.ru/maps/?rtext=~${g.lat},${g.lon}&rtt=auto`;
export const naviUrl = (g: { lat: number; lon: number }) => `yandexnavi://build_route_on_map?lat_to=${g.lat}&lon_to=${g.lon}`;
export const isPhone = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
/** Расстояние по прямой, м. */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
