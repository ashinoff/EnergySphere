// Копирует шаблоны актов ТП из папки отдела («Создание актов/шаблоны») в
// assets/act-templates/<id>.docx по каталогу, очищая значения полей образца
// (ФИО и адреса заявителей в репозиторий не попадают). Запуск после обновления шаблонов:
//   node --import tsx scripts/prepare-act-templates.ts ["<папка шаблонов>"]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import JSZip from 'jszip';
import { ACT_TEMPLATES } from '../apps/api/src/modules/tp/acts/catalog.js';
import { blankTemplate, templateFields } from '../apps/api/src/modules/tp/acts/merge.js';

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
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
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
  return { docx: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), removed };
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
      zip.file(path, (await zip.file(path)!.async('string')).replace(/<(?:Relationship|Override)[^>]*recipientData[^>]*\/>/gi, ''));
    else if (/^word\/embeddings\/.*\.vsdx$/i.test(path)) {   // схема Visio — своя docProps/core.xml
      const vz = await JSZip.loadAsync(await zip.file(path)!.async('uint8array'));
      const core = vz.file('docProps/core.xml');
      if (core) { vz.file('docProps/core.xml', anonymize(await core.async('string'))); zip.file(path, await vz.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })); }
    }
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
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
  const patched = await patch(await blankTemplate(readFileSync(from)), PATCHES.filter(p => p.id === t.id));
  const { docx: fixed, removed } = await stripLosses(patched, t.id);
  writeFileSync(join(out, t.file), await cleanup(fixed));
  const fields = await templateFields(fixed);
  console.log(`${t.id.padEnd(26)} полей: ${String(fields.length).padStart(2)}  ${removed.length ? `потери: убрано ${removed.join(', ')}` : ''}`);
}
if (missing) process.exit(1);
