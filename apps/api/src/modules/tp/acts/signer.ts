import { declineSurname, guessFeminine } from './compute.js';

// Подписант от сетевой организации — из справочника доверенностей TP («Справочники»).
// В шаблонах отдела фраза вписана текстом под конкретного человека; при подготовке
// шаблонов она заменена полем «Подписант», значение собирается здесь в виде, который
// разбирает проверка уведомлений (notice-rules: «в лице … действующей на основании
// доверенности №… от дд.мм.гггг»).

export type Attorney = { number: string; date: string; person: string; position: string; validUntil: string | null };

/** Организация в должности подписанта, если в справочнике указана только должность. */
export const ORGANIZATION = 'предприятия Сочинские электрические сети филиала ПАО «Россети Юг» - «Кубаньэнерго»';

// Первые слова должности в родительном падеже: «Помощник директора…» → «Помощника директора…»
const POSITION_WORDS: [RegExp, string][] = [
  // конец слова — без \b: в JavaScript он не видит границ кириллических слов
  [/^(главн)ый\s+(инженер)(?![а-яё])/i, '$1ого $2а'],
  [/^(заместител)ь(?![а-яё])/i, '$1я'],
  [/^(начальник|помощник|директор|инженер|руководител)(ь)?(?![а-яё])/i, ''],
  [/^(исполняющ)ий(?![а-яё])/i, '$1его'],
];

export function positionGenitive(position: string): string {
  const p = position.trim();
  for (const [re, to] of POSITION_WORDS) {
    if (!re.test(p)) continue;
    if (to) return p.replace(re, to);
    return p.replace(re, (_all, word: string, soft?: string) => soft ? `${word}я` : `${word}а`);
  }
  return p;
}

/** «Метелицкая Л.О.» / «Метелицкая Людмила Олеговна» → «Метелицкой Л.О.» */
export function personGenitive(person: string): string {
  const p = person.trim().replace(/\s+/g, ' ');
  const [surname, ...rest] = p.split(' ');
  if (!surname) return '';
  const initials = rest.join(' ');
  const fem = /^[А-ЯЁ]\.\s?[А-ЯЁ]\.?$/u.test(initials) ? guessFeminine(surname) : guessFeminine(p);
  const short = /^[А-ЯЁ]\.\s?[А-ЯЁ]\.?$/u.test(initials) ? initials.replace(/\s/g, '') : rest.map(x => `${x[0].toUpperCase()}.`).join('');
  return `${declineSurname(surname, fem, 'genitive')}${short ? ` ${short}` : ''}`;
}

const dots = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');

/** Фраза для поля «Подписант» (без «в лице» — оно в шаблоне). */
export function signerPhrase(a: Attorney): string {
  const position = positionGenitive(a.position || 'Помощник директора предприятия по технологическому присоединению');
  const full = /сет|филиал|россети/i.test(position) ? position : `${position} ${ORGANIZATION}`;
  const acting = guessFeminine(a.person) ? 'действующей' : 'действующего';
  return `${full} ${personGenitive(a.person)}, ${acting} на основании доверенности №${a.number.trim()} от ${dots(a.date)}г.`;
}

/** Подпись внизу акта: «Метелицкая Л.О.» / «Метелицкая Людмила Олеговна» → «Л.О. Метелицкая». */
export function signerSignature(a: Pick<Attorney, 'person'>): string {
  const [surname, ...rest] = a.person.trim().replace(/\s+/g, ' ').split(' ');
  if (!surname) return '';
  const tail = rest.join(' ');
  const initials = /^[А-ЯЁ]\.\s?[А-ЯЁ]\.?$/u.test(tail) ? tail.replace(/\s/g, '') : rest.map(x => `${x[0].toUpperCase()}.`).join('');
  return initials ? `${initials} ${surname}` : surname;
}
