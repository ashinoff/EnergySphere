import { amountWithVat, dateDots, dateWords, declinedShortName, powerWords, shortName } from './compute.js';

// Словарь полей шаблонов актов (имена MERGEFIELD) и сборка значений из данных
// заявки. Источник поля: tu — из ТУ/договора (автозаполнение, инженер может
// поправить), engineer — вводит инженер, meter — ПУ/ТТ («Светлячок» или вручную),
// computed — считается само.

export type FieldSource = 'tu' | 'engineer' | 'meter' | 'computed';
export type FieldInfo = { name: string; label: string; source: FieldSource; aliases?: string[] };

export const ACT_FIELDS: FieldInfo[] = [
  // из ТУ и договора
  { name: 'Фио_полностью', label: 'Заявитель (полностью)', source: 'tu' },
  { name: 'основание', label: 'Действует на основании', source: 'tu' },
  { name: 'Адрес', label: 'Адрес объекта', source: 'tu' },
  { name: 'наименование_объекта', label: 'Наименование объекта', source: 'tu' },
  { name: 'M__договора', label: '№ договора ТП', source: 'tu' },
  { name: 'дата_договора_ТП', label: 'Дата договора ТП', source: 'tu' },
  { name: 'M__ТУ', label: '№ ТУ', source: 'tu' },
  { name: 'Дата_ТУ', label: 'Дата ТУ', source: 'tu' },
  { name: 'M__Заявки', label: '№ заявки', source: 'tu' },
  { name: 'дата_заявки', label: 'Дата заявки', source: 'tu' },
  { name: 'Разрешенная_мощность', label: 'Максимальная (разрешённая) мощность, кВт', source: 'tu' },
  { name: 'Присоединяемая', label: 'Присоединяемая мощность, кВт', source: 'tu', aliases: ['Присоединяевая'] },
  { name: 'Существ_Мощ', label: 'Ранее присоединённая мощность, кВт', source: 'tu' },
  { name: 'класс_напр', label: 'Класс напряжения, кВ', source: 'tu' },
  { name: 'ТП', label: 'ТП (номер)', source: 'tu' },
  { name: 'Фидер', label: 'Фидер', source: 'tu' },
  { name: 'ПС_напряжение', label: 'Напряжение ПС', source: 'tu' },
  { name: 'Питающий_центр', label: 'Питающий центр (ПС)', source: 'tu' },
  { name: 'Выполнены_пункты_ТУ_сетевой', label: 'Пункты ТУ, выполненные сетевой организацией', source: 'tu' },
  { name: 'Выполнены_пункты_ТУ_заявителем', label: 'Пункты ТУ, выполненные заявителем', source: 'tu' },
  { name: 'Предыдущий_собственник', label: 'Предыдущий собственник / лицевой счёт', source: 'tu' },
  // вводит инженер
  { name: 'M__Акта_ТП', label: '№ акта ТП', source: 'engineer' },
  { name: 'Дата_акта', label: 'Дата акта', source: 'engineer' },
  { name: 'Номер_опоры', label: '№ опоры', source: 'engineer', aliases: ['Опора'] },
  { name: 'номинальный_ток_ВА', label: 'Номинальный ток ВА, А', source: 'engineer' },
  { name: 'марка_кабеля', label: 'Марка кабеля (провода)', source: 'engineer' },
  { name: 'сечение_кабеля', label: 'Сечение кабеля', source: 'engineer' },
  { name: 'длина_кабеля', label: 'Длина линии, м', source: 'engineer' },
  { name: 'Проект', label: 'Проект / паспорт ПУ', source: 'engineer' },
  { name: 'монтер', label: 'Монтёр (должность и ФИО, род. падеж)', source: 'engineer' },
  { name: 'Подписант', label: 'Подписант (должность, ФИО, доверенность)', source: 'engineer' },
  { name: 'Подписант_подпись', label: 'Подпись подписанта (И.О. Фамилия)', source: 'engineer' },
  // ПУ и ТТ
  { name: 'Тип_сетчика', label: 'Тип ПУ', source: 'meter' },
  { name: 'M__счетчика', label: '№ ПУ', source: 'meter' },
  { name: 'класс_точности_элсч', label: 'Класс точности ПУ', source: 'meter' },
  { name: 'квартал_проверки', label: 'Поверка ПУ: квартал', source: 'meter' },
  { name: 'год_проверки', label: 'Поверка ПУ: год', source: 'meter' },
  { name: 'Тип_ТТ', label: 'Тип ТТ', source: 'meter' },
  { name: 'ТТ', label: '№ ТТ', source: 'meter' },
  { name: 'Класс_точности_', label: 'Класс точности ТТ', source: 'meter' },
  { name: 'КТТ', label: 'Коэффициент ТТ', source: 'meter' },
  { name: 'квартал_проверки1', label: 'Поверка ТТ: квартал', source: 'meter' },
  { name: 'год_проверки1', label: 'Поверка ТТ: год', source: 'meter' },
  // считается
  { name: 'ФИО', label: 'Заявитель (кратко)', source: 'computed' },
  { name: 'склонен', label: 'Заявитель (кратко, род. падеж)', source: 'computed' },
  { name: 'прописью', label: 'Мощность прописью', source: 'computed' },
  { name: 'сумма', label: 'Стоимость с НДС (фраза)', source: 'computed' },
];

/** Данные для акта — то, что видит и правит инженер в анкете. */
export type ActInput = {
  applicantFullName: string; basis?: string; address?: string; objectName?: string;
  contractNumber?: string; contractDate?: string; tuNumber?: string; tuDate?: string;
  requestNumber?: string; requestDate?: string; previousOwner?: string;
  powerAllowedKw?: number; powerAttachedKw?: number; powerExistingKw?: number;
  voltageKv?: string; tp?: string; feeder?: string; substationVoltage?: string; supplyCenter?: string;
  tuPointsNetwork?: string; tuPointsApplicant?: string;
  actNumber?: string; actDate?: string; amountRub?: number; vatPercent?: number;
  poleNumber?: string; breakerA?: string; cableBrand?: string; cableSection?: string; cableLengthM?: number;
  project?: string; monter?: string;
  meter?: { type?: string; number?: string; accuracyClass?: string; checkQuarter?: number; checkYear?: number };
  ct?: { type?: string; numbers?: string; accuracyClass?: string; ratio?: string; checkQuarter?: number; checkYear?: number };
  /** Ручная правка вычисляемых полей (например, склонение) */
  overrides?: Record<string, string>;
};

const num = (n?: number) => n === undefined || n === null || Number.isNaN(n) ? undefined : String(n).replace('.', ',');
const isoOrText = (d?: string) => d && /^\d{4}-\d{2}-\d{2}/.test(d) ? dateDots(d) : d;

/** Значения полей шаблона из данных акта (даты ISO → как в документах отдела). */
export function actValues(a: ActInput): Record<string, string | undefined> {
  const v: Record<string, string | undefined> = {
    Фио_полностью: a.applicantFullName?.trim(),
    ФИО: a.applicantFullName ? shortName(a.applicantFullName, false) : undefined,
    склонен: a.applicantFullName ? declinedShortName(a.applicantFullName, 'genitive') : undefined,
    основание: a.basis ?? 'паспорта РФ',
    Адрес: a.address, наименование_объекта: a.objectName,
    M__договора: a.contractNumber, дата_договора_ТП: isoOrText(a.contractDate),
    M__ТУ: a.tuNumber, Дата_ТУ: isoOrText(a.tuDate),
    M__Заявки: a.requestNumber, дата_заявки: isoOrText(a.requestDate), Предыдущий_собственник: a.previousOwner,
    Разрешенная_мощность: num(a.powerAllowedKw), Присоединяемая: num(a.powerAttachedKw), Существ_Мощ: num(a.powerExistingKw ?? 0),
    прописью: a.powerAllowedKw !== undefined ? powerWords(a.powerAllowedKw) : undefined,
    класс_напр: a.voltageKv ?? '0,4', ТП: a.tp, Фидер: a.feeder, ПС_напряжение: a.substationVoltage, Питающий_центр: a.supplyCenter,
    Выполнены_пункты_ТУ_сетевой: a.tuPointsNetwork, Выполнены_пункты_ТУ_заявителем: a.tuPointsApplicant,
    M__Акта_ТП: a.actNumber, Дата_акта: a.actDate ? (/^\d{4}-/.test(a.actDate) ? dateWords(a.actDate) : a.actDate) : undefined,
    сумма: a.amountRub !== undefined ? amountWithVat(a.amountRub, a.vatPercent ?? 22) : undefined,
    Номер_опоры: a.poleNumber, номинальный_ток_ВА: a.breakerA,
    марка_кабеля: a.cableBrand, сечение_кабеля: a.cableSection, длина_кабеля: num(a.cableLengthM),
    Проект: a.project, монтер: a.monter,
    Тип_сетчика: a.meter?.type, M__счетчика: a.meter?.number, класс_точности_элсч: a.meter?.accuracyClass,
    квартал_проверки: num(a.meter?.checkQuarter), год_проверки: num(a.meter?.checkYear),
    Тип_ТТ: a.ct?.type, ТТ: a.ct?.numbers, Класс_точности_: a.ct?.accuracyClass, КТТ: a.ct?.ratio,
    квартал_проверки1: num(a.ct?.checkQuarter), год_проверки1: num(a.ct?.checkYear),
  };
  for (const f of ACT_FIELDS) for (const alias of f.aliases ?? []) v[alias] = v[f.name];
  return { ...v, ...a.overrides };
}

/** Поле анкеты для поля шаблона: путь в ActInput и вид ввода (интерфейс «Создание акта по ТУ»). */
export type FieldInput = { path: string; type: 'text' | 'number' | 'date' | 'int' | 'long' };
export const FIELD_INPUTS: Record<string, FieldInput> = {
  Фио_полностью: { path: 'applicantFullName', type: 'text' }, основание: { path: 'basis', type: 'text' }, Адрес: { path: 'address', type: 'long' },
  наименование_объекта: { path: 'objectName', type: 'text' }, M__договора: { path: 'contractNumber', type: 'text' }, дата_договора_ТП: { path: 'contractDate', type: 'date' },
  M__ТУ: { path: 'tuNumber', type: 'text' }, Дата_ТУ: { path: 'tuDate', type: 'date' }, M__Заявки: { path: 'requestNumber', type: 'text' }, дата_заявки: { path: 'requestDate', type: 'date' },
  Разрешенная_мощность: { path: 'powerAllowedKw', type: 'number' }, Присоединяемая: { path: 'powerAttachedKw', type: 'number' }, Существ_Мощ: { path: 'powerExistingKw', type: 'number' },
  класс_напр: { path: 'voltageKv', type: 'text' }, ТП: { path: 'tp', type: 'text' }, Фидер: { path: 'feeder', type: 'text' },
  ПС_напряжение: { path: 'substationVoltage', type: 'text' }, Питающий_центр: { path: 'supplyCenter', type: 'text' },
  Выполнены_пункты_ТУ_сетевой: { path: 'tuPointsNetwork', type: 'text' }, Выполнены_пункты_ТУ_заявителем: { path: 'tuPointsApplicant', type: 'text' },
  Предыдущий_собственник: { path: 'previousOwner', type: 'long' },
  M__Акта_ТП: { path: 'actNumber', type: 'text' }, Дата_акта: { path: 'actDate', type: 'date' }, Номер_опоры: { path: 'poleNumber', type: 'text' },
  номинальный_ток_ВА: { path: 'breakerA', type: 'text' }, марка_кабеля: { path: 'cableBrand', type: 'text' }, сечение_кабеля: { path: 'cableSection', type: 'text' },
  длина_кабеля: { path: 'cableLengthM', type: 'number' }, Проект: { path: 'project', type: 'long' }, монтер: { path: 'monter', type: 'long' },
  Тип_сетчика: { path: 'meter.type', type: 'text' }, M__счетчика: { path: 'meter.number', type: 'text' }, класс_точности_элсч: { path: 'meter.accuracyClass', type: 'text' },
  квартал_проверки: { path: 'meter.checkQuarter', type: 'int' }, год_проверки: { path: 'meter.checkYear', type: 'int' },
  Тип_ТТ: { path: 'ct.type', type: 'text' }, ТТ: { path: 'ct.numbers', type: 'text' }, Класс_точности_: { path: 'ct.accuracyClass', type: 'text' },
  КТТ: { path: 'ct.ratio', type: 'text' }, квартал_проверки1: { path: 'ct.checkQuarter', type: 'int' }, год_проверки1: { path: 'ct.checkYear', type: 'int' },
};

/** Имя поля шаблона → имя из словаря (с учётом синонимов вроде «Присоединяевая»). */
export function canonicalField(name: string): string | null {
  const key = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[\s_.]+/g, '');
  const k = key(name);
  return ACT_FIELDS.find(f => key(f.name) === k || f.aliases?.some(a => key(a) === k))?.name ?? null;
}
