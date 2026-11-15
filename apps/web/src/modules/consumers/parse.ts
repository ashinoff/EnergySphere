// Разбор реестра потребителей (расширенный список, XLS/XLSX) в браузере.
// Шапка распознаётся по названиям столбцов — как в Web_abonent (public/core.js):
// ищется строка с «№ ПУ» и «ЛС», многострочная шапка из объединённых ячеек
// склеивается в «Раздел · Столбец». Excel целиком на сервер не уходит —
// только найденные строки, частями.

interface XlsxCell { t: string; v?: unknown; w?: string }
interface XlsxRange { s: { r: number; c: number }; e: { r: number; c: number } }
interface XlsxSheet { [cell: string]: unknown; '!ref'?: string; '!merges'?: XlsxRange[] }
interface Xlsx {
  read(data: ArrayBuffer, opts: object): { SheetNames: string[]; Sheets: Record<string, XlsxSheet> };
  utils: { decode_range(ref: string): XlsxRange; encode_cell(a: { r: number; c: number }): string };
}

// SheetJS уже лежит в поставке (им пользуется анализатор) — подгружаем по требованию.
let loading: Promise<Xlsx> | null = null;
function sheetJs(): Promise<Xlsx> {
  const ready = (window as unknown as { XLSX?: Xlsx }).XLSX;
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/analysis/xlsx.full.min.js';
    s.onload = () => resolve((window as unknown as { XLSX: Xlsx }).XLSX);
    s.onerror = () => { loading = null; reject(new Error('Не удалось загрузить модуль чтения Excel. Обновите страницу.')); };
    document.head.appendChild(s);
  });
  return loading;
}

const clean = (v: unknown) => String(v ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const norm = (v: unknown) => clean(v).toLocaleLowerCase('ru').replace(/ё/g, 'е');

const ALIASES: Record<string, string[]> = {
  meter: ['номер счетчика', 'заводской номер счетчика', 'номер пу', 'заводской номер пу', 'серийный номер', 'счетчик номер'],
  account: ['лс / лс стек', 'лс', 'л/с', 'лицевой счет', 'номер лс', 'номер лицевого счета', 'лс стек'],
  name: ['наименование договора', 'фио', 'абонент', 'наименование абонента', 'потребитель', 'наименование потребителя'],
  locality: ['населенный пункт', 'город', 'н.п.'], street: ['улица'], house: ['дом', 'номер дома'],
  building: ['корпус'], flat: ['квартира', 'кв.'], address: ['адрес', 'адрес точки учета', 'адрес объекта'],
};
const FIELD = new Map<string, string>();
for (const [key, list] of Object.entries(ALIASES)) for (const a of list) if (!FIELD.has(a)) FIELD.set(a, key);
const fieldKey = (label: string) => {
  for (const part of norm(label).split(' · ').reverse()) { const k = FIELD.get(part); if (k) return k; }
  return null;
};
const headerScore = (row: string[]) => {
  const keys = new Set(row.map(fieldKey).filter(Boolean));
  return (keys.has('meter') ? 7 : 0) + (keys.has('account') ? 7 : 0) + Math.min(keys.size, 6);
};

export interface RegistryRow { meter: string; account: string; title: string; address: string; cells: [string, string][] }
export interface ParsedRegistry { rows: RegistryRow[]; sheets: string[]; skipped: string[]; columns: { meter: string; account: string; name?: string; address?: string } }

// Значение ячейки как строка. Целые номера — без «1,23E+11» и без потери нулей формата.
function cellText(cell: XlsxCell | undefined) {
  if (!cell) return '';
  if (cell.t === 'n' && typeof cell.v === 'number' && Number.isInteger(cell.v) && Math.abs(cell.v) < 1e15) return String(cell.v);
  return clean(cell.w ?? cell.v);
}

function readSheet(X: Xlsx, sheet: XlsxSheet) {
  if (!sheet['!ref']) return { matrix: [] as string[][], merges: [] as XlsxRange[] };
  const range = X.utils.decode_range(sheet['!ref']);
  const matrix: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 255); c++) row.push(cellText(sheet[X.utils.encode_cell({ r, c })] as XlsxCell | undefined));
    matrix.push(row);
  }
  const shift = (m: XlsxRange) => ({ s: { r: m.s.r - range.s.r, c: m.s.c - range.s.c }, e: { r: m.e.r - range.s.r, c: m.e.c - range.s.c } });
  return { matrix, merges: (sheet['!merges'] ?? []).map(shift) };
}

function layout(matrix: string[][], merges: XlsxRange[]) {
  let start = -1, best = 0;
  for (let i = 0; i < Math.min(matrix.length, 80); i++) {
    const score = headerScore(matrix[i]);
    if (score > best) { best = score; start = i; }
  }
  if (start < 0 || best < 8) return null;
  // Шапка из объединённых ячеек — берём весь её блок.
  let end = start;
  const enclosing = merges.filter(m => m.s.r <= start && m.e.r >= start && m.e.r - m.s.r < 6);
  if (enclosing.length) start = Math.min(start, ...enclosing.map(m => m.s.r));
  end = Math.max(end, ...merges.filter(m => m.s.r >= start && m.s.r <= end && m.e.r - m.s.r < 6).map(m => m.e.r));
  while (end + 1 < matrix.length && end - start < 4 && headerScore(matrix[end + 1]) >= 8 && !/^\d+$/.test(matrix[end + 1][0] || '')) end++;
  const width = Math.max(...matrix.slice(start, end + 11).map(r => r.length));
  const seen = new Map<string, number>();
  const labels = Array.from({ length: width }, (_, c) => {
    const parts: string[] = [];
    for (let r = start; r <= end; r++) {
      const m = merges.find(x => x.s.r <= r && x.e.r >= r && x.s.c <= c && x.e.c >= c);
      const text = m ? matrix[m.s.r]?.[m.s.c] : matrix[r]?.[c];
      if (text && !parts.includes(text)) parts.push(text);
    }
    const label = parts.join(' · ') || `Столбец ${c + 1}`;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return n === 1 ? label : `${label} (${n})`;
  });
  const map: Record<string, number> = {};
  labels.forEach((l, c) => { const k = fieldKey(l); if (k && map[k] === undefined) map[k] = c; });
  return { end, labels, map };
}

export async function parseRegistry(file: File): Promise<ParsedRegistry> {
  const X = await sheetJs();
  let book;
  try { book = X.read(await file.arrayBuffer(), { type: 'array', cellDates: false, cellNF: false, dense: false }); }
  catch { throw new Error('Файл не читается как Excel. Нужен расширенный список в формате XLS или XLSX.'); }
  const rows: RegistryRow[] = [];
  const sheets: string[] = [];
  const skipped: string[] = [];
  let columns: ParsedRegistry['columns'] | null = null;
  for (const name of book.SheetNames) {
    const { matrix, merges } = readSheet(X, book.Sheets[name]);
    const found = layout(matrix, merges);
    if (!found || (found.map.meter === undefined && found.map.account === undefined)) { if (matrix.length) skipped.push(name); continue; }
    const { end, labels, map } = found;
    columns ??= {
      meter: map.meter !== undefined ? labels[map.meter] : '—', account: map.account !== undefined ? labels[map.account] : '—',
      name: map.name !== undefined ? labels[map.name] : undefined, address: map.address !== undefined ? labels[map.address] : undefined,
    };
    const at = (row: string[], key: string) => (map[key] !== undefined ? row[map[key]] ?? '' : '');
    let count = 0;
    for (const row of matrix.slice(end + 1)) {
      const meter = at(row, 'meter');
      const account = at(row, 'account');
      if (!meter && !account) continue;
      const address = at(row, 'address') || [at(row, 'locality'), at(row, 'street'), at(row, 'house') && `д. ${at(row, 'house')}`,
        at(row, 'building') && `корп. ${at(row, 'building')}`, at(row, 'flat') && `кв. ${at(row, 'flat')}`].filter(Boolean).join(', ');
      const cells: [string, string][] = [];
      labels.forEach((l, c) => { if (row[c]) cells.push([l.slice(0, 300), row[c].slice(0, 4000)]); });
      rows.push({ meter: meter.slice(0, 200), account: account.slice(0, 200), title: at(row, 'name').slice(0, 500), address: address.slice(0, 1000), cells });
      count++;
    }
    if (count) sheets.push(name); else skipped.push(name);
  }
  if (!rows.length || !columns) throw new Error('Не найдена шапка с номером ПУ или лицевым счётом. Проверьте, что выбран реестр абонентов (расширенный список).');
  return { rows, sheets, skipped, columns };
}

// Строки — частями до ~700 КБ (ограничение запроса на сервере — 1 МБ).
export function* chunks(rows: RegistryRow[], maxBytes = 700_000) {
  let part: RegistryRow[] = [];
  let size = 0;
  for (const row of rows) {
    const n = JSON.stringify(row).length * 2;
    if (part.length && (size + n > maxBytes || part.length >= 4000)) { yield part; part = []; size = 0; }
    part.push(row);
    size += n;
  }
  if (part.length) yield part;
}
