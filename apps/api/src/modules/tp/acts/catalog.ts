// Каталог шаблонов актов и уведомлений ТП («Создание актов/шаблоны» → assets/act-templates).
// Шаблон выбирается по осям: вид документа × точка присоединения × учёт × мощность / тип заявки.
// Файлы — исходные Word отдела со слиянием (MERGEFIELD); вёрстку и схему не трогаем.

export type ActKind = 'paper' | 'ecp' | 'change';
/** pole — ПУ на опоре (сплит); pole_low — нижний ПУ на опоре; pole_line — от опоры, ПУ в ВРУ;
 *  ru — от РУ-0,4 кВ ТП; vu — от ВУ-0,4 кВ (СЭС). */
export type ActPoint = 'pole' | 'pole_low' | 'pole_line' | 'ru' | 'vu';
export type ActMetering = 'direct' | 'ct';
export type ActPower = 'le15' | 'gt15';
export type ActRequest = 'new' | 'increase';

export type ActTemplate = {
  id: string; title: string; file: string; source: string;
  kind: ActKind; point: ActPoint; metering: ActMetering;
  power?: ActPower; request?: ActRequest;
  /** К акту прикладывается расчёт потерь в линии (в шаблоне — метка ‹РАСЧЁТ_ПОТЕРЬ›) */
  losses?: boolean;
};

export const KIND_TITLES: Record<ActKind, string> = { paper: 'Акт на бумаге', ecp: 'Уведомление (ЭЦП)', change: 'Смена собственника' };
export const POINT_TITLES: Record<ActPoint, string> = {
  pole: 'ПУ на опоре (сплит)', pole_low: 'Нижний ПУ на опоре', pole_line: 'От опоры, ПУ в ВРУ',
  ru: 'От РУ-0,4 кВ ТП', vu: 'От ВУ-0,4 кВ',
};
export const METERING_TITLES: Record<ActMetering, string> = { direct: 'Прямое включение', ct: 'С трансформаторами тока' };

const t = (id: string, title: string, source: string, axes: Omit<ActTemplate, 'id' | 'title' | 'file' | 'source'>): ActTemplate =>
  ({ id, title, file: `${id}.docx`, source, ...axes });

export const ACT_TEMPLATES: ActTemplate[] = [
  t('paper-pole-le15', 'Акт на опоре до 15 кВт', 'Бумага/1. Шаблон АОТП на опоре до 15/ТП-К143 Обухович Д.К._1083258.docx',
    { kind: 'paper', point: 'pole', metering: 'direct', power: 'le15' }),
  t('paper-pole-gt15', 'Акт на опоре свыше 15 кВт', 'Бумага/2. Шаблон акта на опоре бумага свыше 15 кВт Метелицкая/Шаблон акта на опоре бумага свыше 15 кВт Метелицкая.docx',
    { kind: 'paper', point: 'pole', metering: 'direct', power: 'gt15' }),
  t('paper-pole_low-le15', 'Акт на опоре, нижний ПУ до 15 кВт', 'Бумага/3. Шаблон акта на опоре нижний ПУ до 15 кВт/3. Шаблон акта на опоре нижний ПУ до 15 кВт.docx',
    { kind: 'paper', point: 'pole_low', metering: 'direct', power: 'le15', losses: true }),
  t('paper-pole_low-gt15', 'Акт на опоре, нижний ПУ свыше 15 кВт', 'Бумага/4. Шаблон акта на опоре бумага нижний свыше 15кВт  Метелицкая/ТП-А31 Селемизиди К.Ю._1091572 от опоры нижний бумага.docx',
    { kind: 'paper', point: 'pole_low', metering: 'direct', power: 'gt15', losses: true }),
  t('paper-ru-direct', 'Акт от РУ-0,4 кВ, прямой ПУ', 'Бумага/5. Шаблон акта от РУ-0,4 бумага прямой ПУ/Шаблон акта от РУ-0,4 бумага.docx',
    { kind: 'paper', point: 'ru', metering: 'direct', losses: true }),
  t('paper-ru-ct', 'Акт от РУ-0,4 кВ с ТТ', 'Бумага/6. Шаблон акта от РУ-0,4 бумага с ТТ/6. Шаблон акта от РУ-0,4 бумага с ТТ.docx',
    { kind: 'paper', point: 'ru', metering: 'ct', losses: true }),
  t('paper-vu-direct', 'Акт от ВУ-0,4 кВ, прямой ПУ', 'Бумага/7. Шаблон акта от ВУ-0,4 СЭС прямой ПУ/Шаблон акта от ВУ-0,4 СЭС прямой ПУ.docx',
    { kind: 'paper', point: 'vu', metering: 'direct', losses: true }),
  t('paper-vu-ct', 'Акт от ВУ-0,4 кВ с ТТ', 'Бумага/8. Шаблон акта от ВУ-0,4 СЭС с ТТ/Шаблон акта от ВУ-0,4 СЭС с ТТ.docx',
    { kind: 'paper', point: 'vu', metering: 'ct', losses: true }),

  t('ecp-pole-new', 'Уведомление: ПУ на опоре, новое до 15 кВт', 'ЭЦП/1. Уведомление акта на опоре новый до 15 кВт/1. Уведомление акта на опоре.docx',
    { kind: 'ecp', point: 'pole', metering: 'direct', power: 'le15', request: 'new' }),
  t('ecp-pole-increase', 'Уведомление: ПУ на опоре, увеличение до 15 кВт', 'ЭЦП/2. Уведомление акта на опоре увеличение до 15 кВт/1. Уведомление акта на опоре увеличение.docx',
    { kind: 'ecp', point: 'pole', metering: 'direct', power: 'le15', request: 'increase' }),
  t('ecp-pole_low-direct', 'Уведомление: нижний ПУ на опоре до 15 кВт', 'ЭЦП/3. Уведомление акта от опоры нижний ПУ до 15 кВт/3. Уведомление акта нижний ПУ до 15 кВт.docx',
    { kind: 'ecp', point: 'pole_low', metering: 'direct', power: 'le15', losses: true }),
  t('ecp-pole_low-ct', 'Уведомление: нижний ПУ на опоре с ТТ', 'ЭЦП/4. Уведомление акта от опоры нижний ПУ с ТТ/4. Уведомление акта от опоры нижний с ТТ.docx',
    { kind: 'ecp', point: 'pole_low', metering: 'ct', losses: true }),
  t('ecp-ru-direct', 'Уведомление: от РУ-0,4 кВ, прямой ПУ', 'ЭЦП/5. Уведомление акта от РУ-0,4кВ/5. Уведомление Шаблон акта РУ-0,4.docx',
    { kind: 'ecp', point: 'ru', metering: 'direct', losses: true }),
  t('ecp-ru-ct', 'Уведомление: от РУ-0,4 кВ с ТТ', 'ЭЦП/6. Уведомление акта от РУ-0,4кВ с ТТ/6. Уведомление акта от РУ-0,4кВ с ТТ.docx',
    { kind: 'ecp', point: 'ru', metering: 'ct', losses: true }),
  t('ecp-vu-direct', 'Уведомление: от ВУ-0,4 кВ, прямой ПУ', 'ЭЦП/7. Уведомление акта от ВУ-0,4 СЭС прямой ПУ/7. Уведомление акта от ВУ-0,4 СЭС прямой ПУ.docx',
    { kind: 'ecp', point: 'vu', metering: 'direct', losses: true }),
  t('ecp-vu-ct', 'Уведомление: от ВУ-0,4 кВ с ТТ', 'ЭЦП/8. Уведомление акта от ВУ-0,4 СЭС с ТТ/8. Уведомление акта от ВУ-0,4 СЭС с ТТ.docx',
    { kind: 'ecp', point: 'vu', metering: 'ct', losses: true }),

  t('change-pole', 'Смена собственника: ПУ на опоре', 'смена/Смена ПУ на опоре/ТП-К22 Кикалов Н.В сменка.docx',
    { kind: 'change', point: 'pole', metering: 'direct' }),
  t('change-pole_line-direct', 'Смена собственника: от опоры, прямой ПУ', 'смена/Смена от опоры прямоток/ТП-К158 Тодосы Петру.docx',
    { kind: 'change', point: 'pole_line', metering: 'direct', losses: true }),
  t('change-ru-direct', 'Смена собственника: от РУ-0,4 кВ, прямой ПУ', 'смена/Смена от РУ-0,4кВ прямоток/ТП-К150 НФП жилым домом по ул.Турчинского,58.docx',
    { kind: 'change', point: 'ru', metering: 'direct', losses: true }),
  t('change-ru-ct', 'Смена собственника: от РУ-0,4 кВ с ТТ', 'смена/Смена от РУ-0,4кВ  с ТТ/ТП-К10 Бирюлин М.В..docx',
    { kind: 'change', point: 'ru', metering: 'ct', losses: true }),
  t('change-vu-direct', 'Смена собственника: от ВУ-0,4 кВ, прямой ПУ', 'смена/Смена от ВУ прямоток/ТП-А278 Иваскевич Н.В. от ВУ.docx',
    { kind: 'change', point: 'vu', metering: 'direct', losses: true }),
];

export type ActChoice = { kind: ActKind; point: ActPoint; metering: ActMetering; powerKw?: number; request?: ActRequest };

/** Подходящие шаблоны для выбора инженера. Мощность и тип заявки уточняют выбор,
 *  если у вида есть варианты (до/свыше 15 кВт, новое/увеличение). */
export function pickTemplates(choice: ActChoice): ActTemplate[] {
  const base = ACT_TEMPLATES.filter(t => t.kind === choice.kind && t.point === choice.point && t.metering === choice.metering);
  const power: ActPower | undefined = choice.powerKw == null ? undefined : choice.powerKw <= 15 ? 'le15' : 'gt15';
  const byPower = power ? base.filter(t => !t.power || t.power === power) : base;
  const byRequest = choice.request ? byPower.filter(t => !t.request || t.request === choice.request) : byPower;
  return byRequest.length ? byRequest : byPower.length ? byPower : base;
}

export const findTemplate = (id: string) => ACT_TEMPLATES.find(t => t.id === id);
