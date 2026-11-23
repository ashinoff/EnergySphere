import type { Block } from '../core/documents.js';
import type { ActPoint } from './catalog.js';
import type { ActInput } from './fields.js';

// Данные для акта из текста ТУ (форма ТУ отдела): наименование объекта, мощность,
// класс напряжения, точка присоединения (ТП, фидер), источник питания, заявка и
// пункты «Сетевая организация осуществляет» / «Заявитель осуществляет» (10.1–10.5,
// 11.1–11.7 — по нумерации списка Word). Это подсказки: инженер видит и правит анкету.

export type TuFacts = Partial<Pick<ActInput, 'applicantFullName' | 'objectName' | 'address' | 'powerAllowedKw' | 'voltageKv' | 'tp' | 'feeder'
  | 'substationVoltage' | 'supplyCenter' | 'requestNumber' | 'tuNumber' | 'tuPointsNetwork' | 'tuPointsApplicant'>> & { point?: ActPoint; pointText?: string };

const clean = (s: string) => s.replace(/[ \s]+/g, ' ').trim().replace(/[.;,]+$/, '');
const kw = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

export function tuFacts(blocks: Block[]): TuFacts {
  const body = blocks.filter(b => b.part === 'word/document.xml' || b.part.startsWith('pdf/'));
  const f: TuFacts = {};
  const pick = (re: RegExp) => { for (const b of body) { const m = re.exec(b.text); if (m) return m; } return null; };

  const applicant = pick(/^\s*Заявитель\s*:\s*(.+)$/i);
  if (applicant) f.applicantFullName = clean(applicant[1]);
  const object = pick(/Наименование\s+энергопринимающих\s+устройств\s+Заявителя\s*:\s*(.+)$/i);
  if (object) f.objectName = clean(object[1]);
  // «Максимальная мощность …: 15 кВт» или «… составляет 15 кВт»
  const power = pick(/Максимальная\s+мощность[^:\n]*?(?::|составляет)\s*(\d[\d\s]*(?:[.,]\d+)?)\s*кВт/i);
  if (power) f.powerAllowedKw = kw(power[1]);
  const voltage = pick(/Класс\s+напряжения[^:]*:\s*(\d+(?:[.,]\d+)?)\s*кВ/i);
  if (voltage) f.voltageKv = voltage[1].replace('.', ',');
  const request = pick(/Заявка\s*№\s*([^\s,;]+?)[.,;]?(?=\s|$)/i);
  if (request) f.requestNumber = request[1];
  const tuNumber = body.slice(0, 40).find(b => /^\s*\d{2}-\d{2}\/\d+-\d{2}\s*$/.test(b.text));
  if (tuNumber) f.tuNumber = tuNumber.text.trim();

  const point = pick(/Точка\s*\(и\)\s*присоединения[^:]*:\s*(.+)$/i);
  if (point) {
    const p = f.pointText = clean(point[1]);
    f.point = /опор/i.test(p) ? 'pole' : /ВУ-?\s*0[,.]4/i.test(p) ? 'vu' : /РУ-?\s*0[,.]4/i.test(p) ? 'ru' : undefined;
    // «ТП-А205», «ТП-К1», «КТП-12»: в шаблоне буква РЭС стоит перед полем — берём номер
    const tp = /(?<![А-Яа-яЁё])(?:К?ТП|РП)\s*-?\s*[А-ЯA-Z]?\s*-?(\d+[А-Яа-я]?)(?!\d)/.exec(p);
    if (tp) f.tp = tp[1];
    const feeder = /фидер\S*\s*(?:№\s*)?«([^»]+)»|фидер\S*\s*(?:№\s*)?([\wА-Яа-я-]+)|(?<![А-Яа-яЁё])Ф-?\s*(\d+)/i.exec(p);
    if (feeder) f.feeder = feeder[1] ?? feeder[2] ?? feeder[3];
  }
  const source = pick(/Основной\s+источник\s+питания\s*:\s*ПС\s*([\d/]+)\s*кВ\s*«([^»]+)»/i);
  if (source) { f.substationVoltage = source[1].replace(/\/+$/, ''); f.supplyCenter = source[2]; }

  // Пункты ТУ: n — номер пункта верхнего уровня, дочерние — n.1 … n.k
  let top = 0, parent: 'network' | 'applicant' | null = null;
  const count = { network: { n: 0, k: 0 }, applicant: { n: 0, k: 0 } };
  for (const b of body) {
    if (!b.numbering) continue;
    if (b.numbering.level === 0) {
      top++;
      parent = /^\s*Сетевая\s+организация\s+осуществляет/i.test(b.text) ? 'network' : /^\s*Заявитель\s+осуществляет/i.test(b.text) ? 'applicant' : null;
      if (parent) count[parent].n = top;
    } else if (b.numbering.level === 1 && parent) count[parent].k++;
  }
  const range = ({ n, k }: { n: number; k: number }) => n && k ? (k === 1 ? `${n}.1` : `${n}.1 - ${n}.${k}`) : undefined;
  f.tuPointsNetwork = range(count.network);
  f.tuPointsApplicant = range(count.applicant);
  for (const k of Object.keys(f) as (keyof TuFacts)[]) if (f[k] === undefined || f[k] === '') delete f[k];
  return f;
}
