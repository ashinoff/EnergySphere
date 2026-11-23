// Вычисляемые поля акта: числа прописью, сумма с НДС, дата словами, склонение ФИО.
// Форматы — как в «Список — ТП.xlsx» отдела.

const ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
const SCALES: [string, string, string, boolean][] = [ // формы для 1 / 2–4 / 5+, женский род
  ['тысяча', 'тысячи', 'тысяч', true], ['миллион', 'миллиона', 'миллионов', false], ['миллиард', 'миллиарда', 'миллиардов', false],
];

/** Форма слова по числу: 1 рубль, 2 рубля, 5 рублей. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b > 1 && b < 5) return few;
  return many;
}

function triad(n: number, feminine: boolean): string[] {
  const out = [HUNDREDS[Math.floor(n / 100)]];
  const r = n % 100;
  if (r >= 10 && r < 20) out.push(TEENS[r - 10]);
  else out.push(TENS[Math.floor(r / 10)], (feminine ? ONES_F : ONES_M)[r % 10]);
  return out.filter(Boolean);
}

/** Целое число прописью (род единиц — мужской или женский). */
export function numberWords(n: number, feminine = false): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'ноль';
  const words: string[] = [];
  const groups: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) groups.push(x % 1000);
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    if (i === 0) { words.push(...triad(g, feminine)); continue; }
    const [one, few, many, fem] = SCALES[i - 1];
    words.push(...triad(g, fem), plural(g, one, few, many));
  }
  return words.join(' ');
}

/** Мощность прописью: «пятнадцать», «семь целых пять десятых». */
export function powerWords(kw: number): string {
  const s = String(Math.round(kw * 1000) / 1000);
  const [int, frac] = s.split('.');
  if (!frac) return numberWords(Number(int));
  const den = ['', 'десятых', 'сотых', 'тысячных'][frac.length];
  const fracN = Number(frac);
  const fracDen = fracN % 10 === 1 && fracN % 100 !== 11 ? den.replace(/ых$/, 'ая') : den;
  return `${numberWords(Number(int), true)} ${plural(Number(int), 'целая', 'целых', 'целых')} ${numberWords(fracN, true)} ${fracDen}`;
}

const money = (x: number) => (Math.round(x * 100) / 100).toFixed(2);

/** «18390.54 руб. (восемнадцать тысяч триста девяносто) рублей 54 копейки, включая НДС (22%) в сумме 3316.33 руб. (…) рублей 33 копейки» */
export function amountWithVat(total: number, vatPercent = 22): string {
  const part = (x: number) => {
    const cents = Math.round(x * 100), rub = Math.floor(cents / 100), kop = cents % 100;
    return `${money(x)} руб. (${numberWords(rub)}) ${plural(rub, 'рубль', 'рубля', 'рублей')} ${String(kop).padStart(2, '0')} ${plural(kop, 'копейка', 'копейки', 'копеек')}`;
  };
  const vat = Math.round(total * vatPercent / (100 + vatPercent) * 100) / 100;
  return `${part(total)}, включая НДС (${vatPercent}%) в сумме ${part(vat)}`;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
/** «01 июня 2026» из 2026-06-01 / Date. */
export function dateWords(d: string | Date): string {
  const [y, m, day] = (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)).split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}
/** «20.08.2026» из 2026-08-20. */
export const dateDots = (d: string) => d.slice(0, 10).split('-').reverse().join('.');

/** «Обухович Дмитрий Константинович» → «Обухович Д. К.» (как в списках отдела). */
export function shortName(full: string, spaced = true): string {
  const [last, ...rest] = full.trim().split(/\s+/);
  if (!rest.length) return last ?? '';
  return `${last} ${rest.map(p => `${p[0].toUpperCase()}.`).join(spaced ? ' ' : '')}`;
}

/** Пол по отчеству (-вич / -вна), иначе по окончанию фамилии. */
export function guessFeminine(full: string): boolean {
  const parts = full.trim().split(/\s+/);
  const patronymic = parts[2]?.toLowerCase() ?? '';
  if (/вич$|ьич$|оглы$/.test(patronymic)) return false;
  if (/вна$|чна$|кызы$/.test(patronymic)) return true;
  return /(ова|ева|ёва|ина|ына|ская|цкая)$/i.test(parts[0] ?? '');
}

/** Фамилия в родительном (genitive) или дательном (dative) падеже. Несклоняемые
 *  (на -о, -е, -и, -у, -ых/-их, женские на согласную) остаются как есть. Это
 *  подсказка — инженер видит и правит результат. */
export function declineSurname(surname: string, feminine: boolean, kase: 'genitive' | 'dative'): string {
  const s = surname, l = s.toLowerCase();
  const end = (t: string) => l.endsWith(t);
  const cut = (n: number, add: string) => s.slice(0, s.length - n) + add;
  if (/[оеиуыэю]$/.test(l) || end('ых') || end('их')) return s;
  if (feminine) {
    if (end('ова') || end('ева') || end('ёва') || end('ина') || end('ына')) return cut(1, 'ой');
    if (end('ская') || end('цкая')) return cut(2, 'ой');
    if (end('ая')) return cut(2, 'ой');
    if (end('а') || end('я')) return kase === 'genitive' ? cut(1, /[гкхжчшщ]а$/.test(l) || end('я') ? 'и' : 'ы') : cut(1, end('я') ? 'е' : 'е');
    return s; // женская фамилия на согласную не склоняется
  }
  if (end('ский') || end('цкий')) return cut(2, kase === 'genitive' ? 'ого' : 'ому');
  if (end('ий') || end('ый') || end('ой')) return cut(2, kase === 'genitive' ? 'ого' : 'ому');
  if (end('а') || end('я')) return kase === 'genitive' ? cut(1, /[гкхжчшщ]а$/.test(l) || end('я') ? 'и' : 'ы') : cut(1, 'е');
  if (end('ь') || end('й')) return cut(1, kase === 'genitive' ? 'я' : 'ю');
  return s + (kase === 'genitive' ? 'а' : 'у');
}

/** «Горлов Сергей Васильевич» → «Горлова С.В.» (поле «склонен», по умолчанию родительный). */
export function declinedShortName(full: string, kase: 'genitive' | 'dative' = 'genitive', spaced = false): string {
  const parts = full.trim().split(/\s+/);
  if (!parts[0]) return '';
  // Юрлица и ИП («Общество…», «Индивидуальный предприниматель…») не склоняем
  if (parts.length > 3 || /^(общество|индивидуальн|ооо|ип|ао|пао|муп|гбу|нфп)/i.test(parts[0])) return full.trim();
  const fem = guessFeminine(full);
  const initials = parts.slice(1).map(p => `${p[0].toUpperCase()}.`).join(spaced ? ' ' : '');
  return initials ? `${declineSurname(parts[0], fem, kase)} ${initials}` : declineSurname(parts[0], fem, kase);
}
