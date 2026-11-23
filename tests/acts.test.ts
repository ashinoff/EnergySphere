// Создание актов ТП: шаблоны отдела заполняются без Word, расчёты — как в «Список — ТП.xlsx».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import JSZip from 'jszip';
import { XMLValidator } from 'fast-xml-parser';
import { ACT_TEMPLATES, pickTemplates } from '../apps/api/src/modules/tp/acts/catalog.js';
import { documentText, fillTemplate, templateFields } from '../apps/api/src/modules/tp/acts/merge.js';
import { amountWithVat, dateWords, declinedShortName, numberWords, powerWords } from '../apps/api/src/modules/tp/acts/compute.js';
import { actValues } from '../apps/api/src/modules/tp/acts/fields.js';
import { cableMaterial, cableSection, lineLosses } from '../apps/api/src/modules/tp/acts/losses.js';

const template = (file: string) => readFileSync(`assets/act-templates/${file}`);

test('каждый шаблон заполняется целиком: ни поля слияния, ни связи с таблицей Excel', async () => {
  for (const t of ACT_TEMPLATES) {
    const fields = await templateFields(template(t.file));
    assert.ok(fields.length >= 20, `${t.id}: полей ${fields.length}`);
    const values = Object.fromEntries(fields.map((f, i) => [f, `⟦${i}⟧`]));
    const { docx, missing } = await fillTemplate(template(t.file), values);
    assert.deepEqual(missing, [], t.id);
    const zip = await JSZip.loadAsync(docx);
    for (const path of Object.keys(zip.files).filter(p => /^word\/(document|header\d*|footer\d*|settings)\.xml$/.test(p))) {
      const xml = await zip.file(path)!.async('string');
      assert.equal(XMLValidator.validate(xml), true, `${t.id} ${path}: XML`);
      assert.doesNotMatch(xml, /MERGEFIELD/, `${t.id} ${path}: осталось поле`);
      assert.doesNotMatch(xml, /<w:mailMerge>/, `${t.id}: осталась связь со слиянием`);
    }
    const text = await documentText(docx);
    for (let i = 0; i < fields.length; i++) assert.ok(text.includes(`⟦${i}⟧`), `${t.id}: нет значения поля «${fields[i]}»`);
  }
});

test('расчёт потерь прошлого заявителя убран из шаблонов, на его месте — метка; пометка в каталоге совпадает', async () => {
  for (const t of ACT_TEMPLATES) {
    const zip = await JSZip.loadAsync(template(t.file));
    const xml = await zip.file('word/document.xml')!.async('string');
    assert.equal(xml.includes('‹РАСЧЁТ_ПОТЕРЬ›'), !!t.losses, `${t.id}: метка расчёта потерь`);
    assert.ok(!Object.keys(zip.files).some(p => /embeddings\/.*\.xlsx$/i.test(p)), `${t.id}: вложенная книга Excel`);
  }
});

test('поле без значения очищается — данные заявителя из образца в акт не попадают', async () => {
  const { docx, missing } = await fillTemplate(template('paper-pole-le15.docx'), { Фио_полностью: 'Иванов Иван Иванович' });
  assert.ok(missing.includes('M__Акта_ТП'));
  const text = await documentText(docx);
  assert.match(text, /Иванов Иван Иванович/);
  assert.doesNotMatch(text, /Обухович/);
  assert.doesNotMatch(text, /1000308/);
});

const SAMPLES = 'Создание актов/шаблоны/Бумага/1. Шаблон АОТП на опоре до 15';
test('акт Обуховича из его строки «Список ТП» совпадает по тексту с готовым актом отдела', { skip: !existsSync(SAMPLES) && 'нет папки образцов' }, async () => {
  const sheet = await JSZip.loadAsync(readFileSync(`${SAMPLES}/Список ТП — копия.xlsx`));
  const shared = [...(await sheet.file('xl/sharedStrings.xml')!.async('string')).matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''));
  const rows = [...(await sheet.file('xl/worksheets/sheet1.xml')!.async('string')).matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)].map(r =>
    Object.fromEntries([...r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(?:<f>[\s\S]*?<\/f>)?<v>([\s\S]*?)<\/v><\/c>/g)].map(c => [c[1], /t="s"/.test(c[2]) ? shared[Number(c[3])] : c[3]])));
  const [head, row] = rows;
  // «№ ТУ» → «M__ТУ», «Существ. Мощ.» → «Существ_Мощ», «Проект?» → «Проект»; повтор названия
  // колонки (квартал/год поверки ТТ) Word называет с «1» — так же и здесь.
  const used = new Set<string>();
  const values = Object.fromEntries(Object.entries(head).map(([col, h]) => {
    let name = String(h).replace('№', 'M').replace('?', '');
    if (used.has(name)) name += '1';
    used.add(name);
    return [name, row[col]];
  }));
  const example = readFileSync(`${SAMPLES}/ТП-К143 Обухович Д.К._1083258.docx`);
  const { docx } = await fillTemplate(template('paper-pole-le15.docx'), values);
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  assert.equal(norm(await documentText(docx)), norm(await documentText(example)));
});

test('сумма с НДС — дословно как в списках отдела', () => {
  assert.equal(amountWithVat(18390.54), '18390.54 руб. (восемнадцать тысяч триста девяносто) рублей 54 копейки, включая НДС (22%) в сумме 3316.33 руб. (три тысячи триста шестнадцать) рублей 33 копейки');
  assert.equal(amountWithVat(81537.62), '81537.62 руб. (восемьдесят одна тысяча пятьсот тридцать семь) рублей 62 копейки, включая НДС (22%) в сумме 14703.51 руб. (четырнадцать тысяч семьсот три) рубля 51 копейка');
  assert.equal(amountWithVat(89779.03), '89779.03 руб. (восемьдесят девять тысяч семьсот семьдесят девять) рублей 03 копейки, включая НДС (22%) в сумме 16189.66 руб. (шестнадцать тысяч сто восемьдесят девять) рублей 66 копеек');
});

test('прописью, дата, склонение', () => {
  assert.equal(powerWords(15), 'пятнадцать');
  assert.equal(powerWords(45), 'сорок пять');
  assert.equal(powerWords(150), 'сто пятьдесят');
  assert.equal(powerWords(7.5), 'семь целых пять десятых');
  assert.equal(numberWords(62671), 'шестьдесят две тысячи шестьсот семьдесят один');
  assert.equal(numberWords(1_000_001), 'один миллион один');
  assert.equal(dateWords('2026-06-01'), '01 июня 2026');
  assert.equal(declinedShortName('Горлов Сергей Васильевич'), 'Горлова С.В.');
  assert.equal(declinedShortName('Труфанова Ульяна Викторовна'), 'Труфановой У.В.');
  assert.equal(declinedShortName('Багирова Ольга Владимировна'), 'Багировой О.В.');
  assert.equal(declinedShortName('Обухович Дмитрий Константинович', 'dative'), 'Обуховичу Д.К.');
  assert.equal(declinedShortName('Селемизиди Константин Юрьевич'), 'Селемизиди К.Ю.');
  assert.equal(declinedShortName('Общество с ограниченной ответственностью «Славяне»'), 'Общество с ограниченной ответственностью «Славяне»');
});

test('потери в линии — как лист «Потери» (100 кВт, АВВГ 4х120, 15 м)', () => {
  assert.equal(cableMaterial('АВВГ'), 'Al'); assert.equal(cableMaterial('ВВГнг'), 'Cu'); assert.equal(cableMaterial('СИП'), 'Al');
  assert.equal(cableSection('4х120'), 120); assert.equal(cableSection('4×16'), 16);
  const r = lineLosses({ powerKw: 100, lengthM: 15, sectionMm2: 120, material: 'Al', year: 2026 });
  assert.ok(Math.abs(r.months[0].lossesKwh - 252.29052314395653) < 1e-9, String(r.months[0].lossesKwh));
  assert.ok(Math.abs(r.yearKwh - 2970.517449920778) < 1e-9, String(r.yearKwh));
  assert.ok(Math.abs(r.yearPercent - 0.3391001655160705) < 1e-12);
  // приложение к акту Бирюлина М.В.: 75 кВт, 20 м, сечение 95, алюминий
  const b = lineLosses({ powerKw: 75, lengthM: 20, sectionMm2: 95, material: 'Al', year: 2026 });
  assert.equal(b.months[0].lossesKwh.toFixed(2), '239.01');
  assert.equal(b.months[1].lossesKwh.toFixed(2), '215.88');
  assert.equal(b.yearKwh.toFixed(2), '2814.17');
  assert.equal(b.yearPercent.toFixed(3), '0.428');
});

test('выбор шаблона по осям и сборка значений', () => {
  assert.deepEqual(pickTemplates({ kind: 'paper', point: 'pole', metering: 'direct', powerKw: 12 }).map(t => t.id), ['paper-pole-le15']);
  assert.deepEqual(pickTemplates({ kind: 'paper', point: 'pole', metering: 'direct', powerKw: 40 }).map(t => t.id), ['paper-pole-gt15']);
  assert.deepEqual(pickTemplates({ kind: 'ecp', point: 'pole', metering: 'direct', powerKw: 15, request: 'increase' }).map(t => t.id), ['ecp-pole-increase']);
  assert.deepEqual(pickTemplates({ kind: 'paper', point: 'ru', metering: 'ct', powerKw: 150 }).map(t => t.id), ['paper-ru-ct']);
  const v = actValues({ applicantFullName: 'Горлов Сергей Васильевич', powerAllowedKw: 100, powerAttachedKw: 100, amountRub: 89779.03, actDate: '2026-09-07', contractDate: '2026-08-20', poleNumber: '8' });
  assert.equal(v.склонен, 'Горлова С.В.');
  assert.equal(v.прописью, 'сто');
  assert.equal(v.Дата_акта, '07 сентября 2026');
  assert.equal(v.дата_договора_ТП, '20.08.2026');
  assert.equal(v.Присоединяевая, '100');
  assert.equal(v.Опора, '8');
});
