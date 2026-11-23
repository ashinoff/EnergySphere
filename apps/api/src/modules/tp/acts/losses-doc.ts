import JSZip from 'jszip';
import { packDocx } from './merge.js';
import { RESISTIVITY, type LossesInput, type LossesResult } from './losses.js';

// Приложение «Расчёт потерь электроэнергии» — отдельным листом в конце акта, по форме
// листа «Потери» отдела (исходные данные, помесячно, итог за год). В шаблоне на месте
// прежней картинки стоит метка ‹РАСЧЁТ_ПОТЕРЬ›: метка убирается, лист добавляется
// перед параметрами раздела документа.

export const LOSSES_MARKER = '‹РАСЧЁТ_ПОТЕРЬ›';
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n: number, digits: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/ /g, ' ');

const run = (text: string, bold = false, size = 20) =>
  `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const para = (text: string, { bold = false, size = 20, align = 'left', after = 60 } = {}) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="${after}"/><w:jc w:val="${align}"/></w:pPr>${run(text, bold, size)}</w:p>`;
const cell = (text: string, width: number, { bold = false, align = 'center', fill = '' } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}<w:vAlign w:val="center"/></w:tcPr>` +
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="${align}"/></w:pPr>${run(text, bold, 18)}</w:p></w:tc>`;
const table = (widths: number[], rows: string[]) =>
  `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>` +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('') +
  `</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="57" w:type="dxa"/><w:right w:w="57" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
  `<w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;
const row = (cells: string[]) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells.join('')}</w:tr>`;

export type LossesSheet = { point: string; input: LossesInput; result: LossesResult; cable?: string; author?: string };

/** XML листа «Расчёт потерь» (абзацы и таблицы body). */
export function lossesSheetXml({ point, input, result, cable, author }: LossesSheet): string {
  const U = input.voltageKv ?? 0.4, cos = input.cosPhi ?? 0.94, kf = input.formFactor ?? 1.15, tc = input.hoursPerDay ?? 24;
  const head = 'E2EFD9';
  const source: [string, string, string][] = [
    ['Наименование точки присоединения', '', point],
    ['Максимальная мощность, Рм', 'кВт', fmt(input.powerKw, 1)],
    ['Линия', '', cable || (input.material === 'Al' ? 'алюминий' : 'медь')],
    ['Протяжённость линии, Lл', 'м', fmt(input.lengthM, 0)],
    ['Сечение питающей линии, S', 'мм²', fmt(input.sectionMm2, 0)],
    [`Удельное сопротивление, ρ (${input.material === 'Al' ? 'алюминий' : 'медь'})`, 'мкОм·м', String(RESISTIVITY[input.material]).replace('.', ',')],
    ['Сопротивление линии, Rл = ρ·L/S', 'Ом', fmt(result.resistanceOhm, 4)],
    ['Напряжение линии, U', 'кВ', fmt(U, 2)],
    ['Коэффициент мощности, cos φ', '', fmt(cos, 2)],
    ['Коэффициент формы графика, Кф', '', fmt(kf, 2)],
    ['Кл, Кк, Кв', '', '1,00'],
    ['Часов активной деятельности в сутки, Тс', 'ч', String(tc)],
  ];
  const w1 = [5200, 1300, 3100];
  const sourceTable = table(w1, [
    row([cell('Исходные данные', w1[0], { bold: true, fill: head }), cell('Ед.', w1[1], { bold: true, fill: head }), cell('Значение', w1[2], { bold: true, fill: head })]),
    ...source.map(([label, unit, value]) => row([cell(label, w1[0], { align: 'left' }), cell(unit, w1[1]), cell(value, w1[2])])),
  ]);
  const w2 = [1700, 900, 1900, 1500, 1900, 1700];
  const monthsTable = table(w2, [
    row(['Месяц', 'Дней', 'Потребление W, кВт·ч', 'Часов, Т', 'Потери ΔW, кВт·ч', 'Потери, %'].map((t, i) => cell(t, w2[i], { bold: true, fill: head }))),
    ...result.months.map(m => row([
      cell(MONTHS[m.month - 1], w2[0], { align: 'left' }), cell(String(m.days), w2[1]), cell(fmt(m.energyKwh, 0), w2[2]),
      cell(String(m.days * 24), w2[3]), cell(fmt(m.lossesKwh, 2), w2[4]), cell(fmt(m.percent, 3), w2[5]),
    ])),
    row([cell('Итого за год', w2[0] + w2[1] + w2[2] + w2[3], { bold: true, align: 'left' }).replace('<w:tcPr>', '<w:tcPr><w:gridSpan w:val="4"/>'),
      cell(fmt(result.yearKwh, 2), w2[4], { bold: true }), cell(fmt(result.yearPercent, 3), w2[5], { bold: true })]),
  ]);
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
    para('Расчёт потерь электроэнергии в линии', { bold: true, size: 26, align: 'center', after: 120 }) +
    sourceTable + para('', { after: 120 }) +
    para('ΔW = W² / (U² · T · cos²φ) · Rл · Кл · Кк · Кф² · 10⁻³', { align: 'center', after: 120 }) +
    monthsTable + para('', { after: 60 }) +
    para(`Потери в месяц (в среднем): ${fmt(result.monthAvgKwh, 3)} кВт·ч`, { bold: true }) +
    (author ? para(`исп. ${author}`, { size: 18 }) : '');
}

/** Вставить лист потерь в документ (метка убирается). Без листа — только убрать метку. */
export async function insertLosses(docx: Buffer, sheet: LossesSheet | null): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  let xml = await zip.file('word/document.xml')!.async('string');
  if (!xml.includes(LOSSES_MARKER) && !sheet) return docx;
  xml = xml.split(`<w:t>${LOSSES_MARKER}</w:t>`).join('<w:t></w:t>');
  if (sheet) {
    const at = xml.lastIndexOf('<w:sectPr');
    const body = xml.lastIndexOf('</w:body>');
    // параметры раздела всего документа — последний элемент body (не sectPr внутри абзаца)
    const pos = at > 0 && at < body && !xml.slice(at, body).includes('</w:p>') ? at : body;
    xml = xml.slice(0, pos) + lossesSheetXml(sheet) + xml.slice(pos);
  }
  zip.file('word/document.xml', xml);
  return packDocx(zip);
}
