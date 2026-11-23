// Копирует шаблоны актов ТП из папки отдела («Создание актов/шаблоны») в
// assets/act-templates/<id>.docx по каталогу, очищая значения полей образца
// (ФИО и адреса заявителей в репозиторий не попадают). Запуск после обновления шаблонов:
//   node --import tsx scripts/prepare-act-templates.ts ["<папка шаблонов>"]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import JSZip from 'jszip';
import { ACT_TEMPLATES } from '../apps/api/src/modules/tp/acts/catalog.js';
import { blankTemplate, packDocx, templateFields } from '../apps/api/src/modules/tp/acts/merge.js';

// Ошибки шаблонов отдела: данные заявителя вписаны обычным текстом (надпись на схеме).
// Такой фрагмент превращается в поле слияния с тем же оформлением.
const PATCHES: { id: string; text: string; field: string }[] = [
  { id: 'ecp-vu-direct', text: 'Общество с ограниченной ответственностью «Славяне»', field: 'Фио_полностью' },
  // шаблоны 1 и 4 — готовые акты: в п. 11.1 (текст из ТУ заявителя) номер договора вписан текстом
  { id: 'paper-pole-le15', text: '10207-26-01083258-1', field: 'M__договора' },
  { id: 'paper-pole_low-gt15', text: '40202-26-01091572-1', field: 'M__договора' },
];

async function patch(docx: Buffer, fixes: typeof PATCHES): Promise<Buffer> {
  if (!fixes.length) return docx;
  const zip = await JSZip.loadAsync(docx);
  let xml = await zip.file('word/document.xml')!.async('string');
  for (const f of fixes) {
    // фрагмент текста внутри одного w:t: режем на «до» / поле / «после» с тем же оформлением
    const esc = f.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // оформление — строго внутри своего фрагмента (не перешагивая через соседние)
    const run = new RegExp(`<w:r\\b[^>]*>(<w:rPr>(?:(?!</w:rPr>)[\\s\\S])*</w:rPr>)?<w:t(?:\\s[^>]*)?>([^<]*?)${esc}([^<]*)</w:t></w:r>`, 'g');
    let n = 0;
    xml = xml.replace(run, (_all, rpr = '', before: string, after: string) => {
      n++;
      const part = (t: string) => t ? `<w:r>${rpr}<w:t xml:space="preserve">${t}</w:t></w:r>` : '';
      return `${part(before)}<w:fldSimple w:instr=" MERGEFIELD ${f.field} "><w:r>${rpr}<w:t>‹${f.field}›</w:t></w:r></w:fldSimple>${part(after)}`;
    });
    if (!n) throw new Error(`${f.id}: не найден текст «${f.text}»`);
    console.log(`  исправлено: ${f.id} — «${f.text}» → поле ${f.field} (${n})`);
  }
  zip.file('word/document.xml', xml);
  return packDocx(zip);
}

// Подписант сетевой организации вписан текстом под конкретного человека и доверенность
// («в лице Помощника директора … Метелицкой Л.О., действующей на основании доверенности
// №119/4-СЭС от 15.12.2025г.»). Всё после «в лице» → поле «Подписант» (acts/signer.ts).
// Фраза бывает разбита на несколько фрагментов текста — ищем по сплошному тексту абзаца.
const SIGNER = /в лице (?!‹)([^‹\n]{5,400}?,\s*действующ(?:его|ей)\s+на\s+основании\s+доверенности\s*(?:№\s*[^\s,;]+\s*от\s*\d{2}\.\d{2}\.\d{4}\s*(?:г\.|\.)?|от\s*\d{2}\.\d{2}\.\d{4}\s*(?:г\.)?\s*№\s*[^\s,;]+))/;
const T_TOKEN = /<w:t(?=[\s>])[^>]*>([^<]*)<\/w:t>/g;

// Подпись того же человека внизу акта и на схеме: «/Л.О. Метелицкая/», «/ М.В. Догадов /» →
// поле «Подписант_подпись». Строки без косых черт («А.Э. Хабирова ___ 2026») — другие
// должностные лица (согласование), остаются текстом шаблона.
const SIGNATURE = /\/\s*([А-ЯЁ]\.\s?[А-ЯЁ]\.\s?[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)\s*\//;

/** Первое совпадение re (группа 1) в сплошном тексте абзаца → поле слияния field. null — не найдено. */
function spanField(xml: string, re: RegExp, field: string, id: string): { xml: string; found: string } | null {
  const tokens = [...xml.matchAll(T_TOKEN)].map(m => ({ start: m.index!, end: m.index! + m[0].length, text: m[1] }));
  let text = '';
  const at: number[] = [];   // начало каждого фрагмента в сплошном тексте
  tokens.forEach((t, i) => {   // граница абзаца — перевод строки: фраза ищется внутри абзаца
    if (i && xml.slice(tokens[i - 1].end, t.start).includes('</w:p>')) text += '\n';
    at.push(text.length); text += t.text;
  });
  const m = re.exec(text);
  if (!m) return null;
  const from = m.index + m[0].indexOf(m[1]), to = from + m[1].length;
  const first = at.findLastIndex(p => p <= from), last = at.findLastIndex(p => p < to);
  if (xml.slice(tokens[first].start, tokens[last].end).includes('</w:p>')) throw new Error(`${id}: «${m[1]}» в разных абзацах`);
  const runStart = Math.max(xml.lastIndexOf('<w:r>', tokens[first].start), xml.lastIndexOf('<w:r ', tokens[first].start));
  const runEnd = xml.indexOf('</w:r>', tokens[first].end) + '</w:r>'.length;
  const rpr = /^<w:r\b[^>]*>(<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<\/w:rPr>)?/.exec(xml.slice(runStart))?.[1] ?? '';
  const t = (s: string) => `<w:t xml:space="preserve">${s}</w:t>`;
  const fld = `<w:fldSimple w:instr=" MERGEFIELD ${field} "><w:r>${rpr}<w:t>‹${field}›</w:t></w:r></w:fldSimple>`;
  const edits: { start: number; end: number; text: string }[] = [];
  const head = tokens[first].text.slice(0, from - at[first]);
  edits.push({ start: tokens[first].start, end: tokens[first].end, text: t(head) });
  if (first === last) {
    const tail = tokens[first].text.slice(to - at[first]);
    edits.push({ start: runEnd, end: runEnd, text: fld + (tail ? `<w:r>${rpr}${t(tail)}</w:r>` : '') });
  } else {
    edits.push({ start: runEnd, end: runEnd, text: fld });
    for (let i = first + 1; i < last; i++) edits.push({ start: tokens[i].start, end: tokens[i].end, text: t('') });
    edits.push({ start: tokens[last].start, end: tokens[last].end, text: t(tokens[last].text.slice(to - at[last])) });
  }
  edits.sort((a, b) => b.start - a.start || a.end - b.end);
  for (const e of edits) xml = xml.slice(0, e.start) + e.text + xml.slice(e.end);
  return { xml, found: m[1].replace(/\s+/g, ' ') };
}

async function signerField(docx: Buffer, id: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  let xml = await zip.file('word/document.xml')!.async('string');
  // в бумажном шаблоне два документа (акт о выполнении ТУ и акт ТП) — фраза в каждом
  const phrases: string[] = [];
  for (let r = spanField(xml, SIGNER, 'Подписант', id); r; r = spanField(xml, SIGNER, 'Подписант', id)) {
    xml = r.xml; phrases.push(r.found);
    if (phrases.length > 10) throw new Error(`${id}: слишком много фраз подписанта`);
  }
  if (!phrases.length) throw new Error(`${id}: не найдена фраза подписанта`);
  const phrase = { found: `${phrases.length}× ${phrases[0]}` };
  const signatures: string[] = [];
  for (let r = spanField(xml, SIGNATURE, 'Подписант_подпись', id); r; r = spanField(xml, SIGNATURE, 'Подписант_подпись', id)) {
    xml = r.xml; signatures.push(r.found);
    if (signatures.length > 20) throw new Error(`${id}: слишком много подписей`);
  }
  zip.file('word/document.xml', xml);
  console.log(`  подписант: ${id} — «${phrase.found.slice(0, 50)}…», подписи: ${signatures.join('; ') || 'нет'}`);
  return packDocx(zip);
}

// В уведомлениях ЭЦП вставлены картинки штампа «ПОДПИСАНО ЭЛЕКТРОННОЙ ЦИФРОВОЙ ПОДПИСЬЮ…
// Владелец: …» с прошлого подписания. Штамп ставит программа подписи при настоящем
// подписании — в черновик из шаблона он попадать не должен (тем более с другим владельцем).
async function stripSignatureStamps(docx: Buffer, id: string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  let xml = await zip.file('word/document.xml')!.async('string');
  const stamp = /ПОДПИСАНО\s+ЭЛЕКТРОННОЙ/;
  let n = 0;
  for (const re of [/<mc:AlternateContent>[\s\S]*?<\/mc:AlternateContent>/g, /<w:drawing>[\s\S]*?<\/w:drawing>/g, /<w:pict\b[\s\S]*?<\/w:pict>/g])
    xml = xml.replace(re, s => stamp.test(s) && !/<mc:AlternateContent>[\s\S]*<mc:AlternateContent>/.test(s) ? (n++, '') : s);
  if (stamp.test(xml)) throw new Error(`${id}: штамп ЭЦП остался в документе`);
  if (!n) return docx;
  // файлы картинок, на которые больше никто не ссылается
  const relsPath = 'word/_rels/document.xml.rels';
  let rels = await zip.file(relsPath)!.async('string');
  const parts = (await Promise.all(Object.keys(zip.files).filter(p => /^word\/(document|header\d*|footer\d*)\.xml$/.test(p)).map(p => p === 'word/document.xml' ? xml : zip.file(p)!.async('string')))).join('');
  for (const m of [...rels.matchAll(/<Relationship\b[^>]*Type="[^"]*\/image"[^>]*\/>/g)]) {
    const rid = /Id="([^"]+)"/.exec(m[0])![1], target = /Target="([^"]+)"/.exec(m[0])![1];
    if (parts.includes(`"${rid}"`)) continue;
    rels = rels.replace(m[0], '');
    if (!rels.includes(`Target="${target}"`)) zip.remove(`word/${target}`);
  }
  zip.file(relsPath, rels);
  zip.file('word/document.xml', xml);
  console.log(`  штамп ЭЦП: ${id} — убрано картинок: ${n}`);
  return packDocx(zip);
}

// Приложение «Расчёт потерь» в шаблонах — картинка (EMF/PNG) или вставленная книга Excel
// с расчётом прошлого заявителя (его имя, исполнитель; в одном шаблоне — весь «Список»).
// Убираем вместе с файлами и ставим метку: таблица потерь строится для каждого акта заново.
export const LOSSES_MARKER = '‹РАСЧЁТ_ПОТЕРЬ›';
const LOSSES_PNG: Record<string, string[]> = { 'change-ru-ct': ['media/image2.png'] };
const utf16Text = (b: Buffer) => [...b.toString('latin1').matchAll(/(?:[\x20-\xff][\x00\x04]){3,}/g)]
  .map(m => Buffer.from(m[0], 'latin1').toString('utf16le')).join(' ');

async function stripLosses(docx: Buffer, id: string): Promise<{ docx: Buffer; removed: string[] }> {
  const zip = await JSZip.loadAsync(docx);
  const relsPath = 'word/_rels/document.xml.rels';
  let rels = await zip.file(relsPath)!.async('string');
  let xml = await zip.file('word/document.xml')!.async('string');
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map(m => [/Id="([^"]+)"/.exec(m[0])![1], /Target="([^"]+)"/.exec(m[0])![1]]));
  const lossIds = new Set<string>();
  for (const [rid, target] of targets) {
    const file = zip.file(`word/${target}`);
    if (!file) continue;
    if (/\.xlsx$/i.test(target)) lossIds.add(rid);
    else if (/\.emf$/i.test(target) && /потер/i.test(utf16Text(Buffer.from(await file.async('uint8array'))))) lossIds.add(rid);
    else if (LOSSES_PNG[id]?.includes(target)) lossIds.add(rid);
  }
  // У объекта Excel превью — тоже расчёт: убираем объект целиком
  for (const m of xml.matchAll(/<w:object\b[\s\S]*?<\/w:object>/g)) {
    const ids = [...m[0].matchAll(/r:id="([^"]+)"/g)].map(x => x[1]);
    if (ids.some(r => lossIds.has(r))) ids.forEach(r => lossIds.add(r));
  }
  if (!lossIds.size) return { docx, removed: [] };
  const uses = (s: string) => [...lossIds].some(r => s.includes(`"${r}"`));
  const marker = `<w:t>${LOSSES_MARKER}</w:t>`;
  // самый внешний контейнер рисунка: mc:AlternateContent → w:drawing / w:pict / w:object
  for (const re of [/<mc:AlternateContent>[\s\S]*?<\/mc:AlternateContent>/g, /<w:object\b[\s\S]*?<\/w:object>/g, /<w:drawing>[\s\S]*?<\/w:drawing>/g, /<w:pict\b[\s\S]*?<\/w:pict>/g])
    xml = xml.replace(re, s => uses(s) && !/<mc:AlternateContent>[\s\S]*<mc:AlternateContent>/.test(s) ? marker : s);
  if (uses(xml)) throw new Error(`${id}: рисунок расчёта потерь остался в документе`);
  const removed: string[] = [];
  for (const rid of lossIds) {
    const target = targets.get(rid)!;
    rels = rels.replace(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*/>`), '');
    if (![...targets].some(([r, t]) => t === target && !lossIds.has(r))) { zip.remove(`word/${target}`); removed.push(target); }
  }
  zip.file(relsPath, rels);
  zip.file('word/document.xml', xml);
  return { docx: await packDocx(zip), removed };
}

// Служебное: список получателей слияния и авторы файла (сотрудники) — не нужны в шаблоне.
const AUTHOR = 'ЭнергоСфера';
const anonymize = (core: string) => core
  .replace(/<dc:creator>[^<]*<\/dc:creator>/, `<dc:creator>${AUTHOR}</dc:creator>`)
  .replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/, `<cp:lastModifiedBy>${AUTHOR}</cp:lastModifiedBy>`);
async function cleanup(docx: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx);
  for (const path of Object.keys(zip.files)) {
    if (/recipientData\.xml$/i.test(path)) zip.remove(path);
    else if (path === 'docProps/core.xml') zip.file(path, anonymize(await zip.file(path)!.async('string')));
    else if (/^word\/_rels\/.*\.rels$/.test(path) || path === '[Content_Types].xml')
      zip.file(path, (await zip.file(path)!.async('string')).replace(/<(?:Relationship|Override)\b[^>]*recipientData[^>]*\/>/gi, ''));
    else if (/^word\/embeddings\/.*\.vsdx$/i.test(path)) {   // схема Visio — своя docProps/core.xml
      const vz = await JSZip.loadAsync(await zip.file(path)!.async('uint8array'));
      const core = vz.file('docProps/core.xml');
      if (core) { vz.file('docProps/core.xml', anonymize(await core.async('string'))); zip.file(path, await vz.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })); }
    }
  }
  return packDocx(zip);
}

const src = resolve(process.argv[2] ?? 'Создание актов/шаблоны');
const out = resolve('assets/act-templates');
mkdirSync(out, { recursive: true });
let missing = 0;
for (const t of ACT_TEMPLATES) {
  const from = join(src, t.source);
  if (!existsSync(from)) { console.error(`нет файла: ${t.source}`); missing++; continue; }
  // сначала значения полей образца (ФИО, адреса заявителей) → «‹поле›», затем то,
  // что осталось вписанным обычным текстом, превращаем в поля, затем убираем расчёт потерь
  const patched = await signerField(await patch(await blankTemplate(readFileSync(from)), PATCHES.filter(p => p.id === t.id)), t.id);
  const { docx: fixed, removed } = await stripLosses(await stripSignatureStamps(patched, t.id), t.id);
  writeFileSync(join(out, t.file), await cleanup(fixed));
  const fields = await templateFields(fixed);
  console.log(`${t.id.padEnd(26)} полей: ${String(fields.length).padStart(2)}  ${removed.length ? `потери: убрано ${removed.join(', ')}` : ''}`);
}
if (missing) process.exit(1);
