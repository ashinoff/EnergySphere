import JSZip from 'jszip';

// Заполнение шаблонов Word со слиянием (MERGEFIELD) без Word.
// Документ обходится как поток в порядке следования: начало поля → инструкция
// «MERGEFIELD имя» → разделитель → результат (текст) → конец. Значение пишется в
// первый текстовый фрагмент результата (сохраняя его оформление), остальные
// очищаются, служебная разметка поля удаляется — поле становится обычным текстом,
// и Word не пытается при открытии найти источник данных (mailMerge тоже снимается).
// Поля внутри надписей схемы обрабатываются так же. Другие поля (PAGE) не трогаем.
//
// Поле без значения очищается: в акт не должны попасть данные заявителя из
// образца. Список таких полей возвращается в missing.

const PARTS = /^word\/(document|header\d*|footer\d*)\.xml$/;
const TOKEN = /<w:fldChar\b[^>]*?(?:\/>|>[\s\S]*?<\/w:fldChar>)|<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>|<w:instrText\b[^>]*\/>|<w:t(?=[\s>\/])[^>]*\/>|<w:t(?=[\s>])[^>]*>[\s\S]*?<\/w:t>/g;
const FIELD_NAME = /^\s*MERGEFIELD\s+(?:"([^"]+)"|(\S+))/i;

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fieldName = (instr: string) => { const m = FIELD_NAME.exec(unescape(instr)); return m ? (m[1] ?? m[2]).trim() : null; };
/** Ключ для сравнения имён: регистр, «_», пробелы и «ё» не важны. */
export const fieldKey = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[\s_.]+/g, '');

/** Текст значения для w:t: переносы строк — разрывы строки Word. */
const textRun = (value: string) => `<w:t xml:space="preserve">${value.split(/\r?\n/).map(escape).join('</w:t><w:br/><w:t xml:space="preserve">')}</w:t>`;

type Edit = { start: number; end: number; text: string };

function fillPart(xml: string, lookup: (name: string) => string | undefined, seen: Set<string>, missing: Set<string>, keepFields = false): string {
  const edits: Edit[] = [];
  // Простые поля: <w:fldSimple w:instr="MERGEFIELD …">runs</w:fldSimple>
  xml = xml.replace(/<w:fldSimple\b([^>]*?)(\/>|>([\s\S]*?)<\/w:fldSimple>)/g, (all, attrs: string, _end, inner?: string) => {
    const instr = /w:instr="([^"]*)"/.exec(attrs)?.[1] ?? '';
    const name = fieldName(instr);
    if (!name) return all;
    seen.add(name);
    const value = lookup(name);
    if (value === undefined) missing.add(name);
    const text = value ?? '';
    if (!inner) return keepFields ? all : `<w:r>${textRun(text)}</w:r>`;
    let first = true;
    const body = inner.replace(/<w:t(?=[\s>\/])[^>]*\/>|<w:t(?=[\s>])[^>]*>[\s\S]*?<\/w:t>/g, () => { const r = first ? textRun(text) : ''; first = false; return r; });
    return keepFields ? `<w:fldSimple${attrs}>${body}</w:fldSimple>` : body;
  });

  // Составные поля: поток fldChar / instrText / w:t
  type State = { instr: string; instrAt: Edit[]; chars: Edit[]; name: string | null; phase: 'instr' | 'result'; results: Edit[] };
  let cur: State | null = null;
  for (const m of xml.matchAll(TOKEN)) {
    const tok = m[0], start = m.index!, end = start + tok.length;
    if (tok.startsWith('<w:fldChar')) {
      const type = /w:fldCharType="(\w+)"/.exec(tok)?.[1];
      if (type === 'begin') { cur = { instr: '', instrAt: [], chars: [{ start, end, text: '' }], name: null, phase: 'instr', results: [] }; continue; }
      if (!cur) continue;
      cur.chars.push({ start, end, text: '' });
      if (type === 'separate') { cur.name = fieldName(cur.instr); cur.phase = 'result'; continue; }
      if (type === 'end') {
        const name = cur.name ?? fieldName(cur.instr);
        if (name) {
          seen.add(name);
          const value = lookup(name);
          if (value === undefined) missing.add(name);
          const text = textRun(value ?? '');
          // значение — в первый фрагмент результата; если результата нет — на место инструкции
          if (keepFields) cur.results.forEach((r, i) => edits.push({ ...r, text: i === 0 ? text : '' }));
          else if (cur.results.length) {
            cur.results.forEach((r, i) => edits.push({ ...r, text: i === 0 ? text : '' }));
            cur.instrAt.forEach(r => edits.push({ ...r, text: '' }));
            edits.push(...cur.chars);
          } else {
            cur.instrAt.forEach((r, i) => edits.push({ ...r, text: i === 0 ? text : '' }));
            edits.push(...cur.chars);
          }
        }
        cur = null;
      }
      continue;
    }
    if (!cur) continue;
    if (tok.startsWith('<w:instrText')) {
      if (cur.phase === 'instr') { cur.instr += unescape(tok.replace(/^<w:instrText\b[^>]*>|<\/w:instrText>$/g, '')); cur.instrAt.push({ start, end, text: '' }); }
      continue;
    }
    if (cur.phase === 'result') cur.results.push({ start, end, text: '' });
  }
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) xml = xml.slice(0, e.start) + e.text + xml.slice(e.end);
  return xml;
}

export type FillResult = { docx: Buffer; fields: string[]; missing: string[] };

/** Заполнить шаблон: values — по именам полей шаблона (сравнение без учёта регистра и «_»). */
export async function fillTemplate(template: Buffer | Uint8Array, values: Record<string, string | number | null | undefined>): Promise<FillResult> {
  const byKey = new Map<string, string>();
  for (const [k, v] of Object.entries(values)) {
    const s = v === null || v === undefined ? '' : String(v).trim();   // хвостовые пробелы из таблиц в акт не тянем
    if (s) byKey.set(fieldKey(k), s);
  }
  const lookup = (name: string) => byKey.get(fieldKey(name));
  const zip = await JSZip.loadAsync(template);
  const seen = new Set<string>(), missing = new Set<string>();
  for (const path of Object.keys(zip.files)) {
    if (!PARTS.test(path)) continue;
    const xml = await zip.file(path)!.async('string');
    zip.file(path, fillPart(xml, lookup, seen, missing));
  }
  // Документ больше не связан с таблицей слияния
  const settings = zip.file('word/settings.xml');
  if (settings) zip.file('word/settings.xml', (await settings.async('string')).replace(/<w:mailMerge>[\s\S]*?<\/w:mailMerge>/g, ''));
  const rels = zip.file('word/_rels/settings.xml.rels');
  if (rels) zip.file('word/_rels/settings.xml.rels', (await rels.async('string')).replace(/<Relationship\b[^>]*(?:mailMergeSource|recipientData|mailMergeHeaderSource)[^>]*\/>/g, ''));
  const docx = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { docx, fields: [...seen], missing: [...missing] };
}

/** Шаблон без данных образца: значения полей → «‹имя›», сами поля сохраняются.
 *  Так в репозиторий не попадают ФИО и адреса заявителей из примеров отдела. */
export async function blankTemplate(template: Buffer | Uint8Array): Promise<Buffer> {
  const zip = await JSZip.loadAsync(template);
  for (const path of Object.keys(zip.files)) {
    if (!PARTS.test(path)) continue;
    const xml = await zip.file(path)!.async('string');
    zip.file(path, fillPart(xml, name => `‹${name}›`, new Set(), new Set(), true));
  }
  const settings = zip.file('word/settings.xml');
  if (settings) zip.file('word/settings.xml', (await settings.async('string')).replace(/<w:mailMerge>[\s\S]*?<\/w:mailMerge>/g, ''));
  const rels = zip.file('word/_rels/settings.xml.rels');
  if (rels) zip.file('word/_rels/settings.xml.rels', (await rels.async('string')).replace(/<Relationship[^>]*(?:mailMergeSource|recipientData|mailMergeHeaderSource)[^>]*\/>/g, ''));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Имена полей слияния шаблона (в порядке первого появления). */
export async function templateFields(template: Buffer | Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(template);
  const names: string[] = [];
  for (const path of Object.keys(zip.files)) {
    if (!PARTS.test(path)) continue;
    const xml = await zip.file(path)!.async('string');
    let instr: string | null = null;
    for (const m of xml.matchAll(/<w:fldChar\b[^>]*w:fldCharType="(\w+)"|<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>|<w:fldSimple\b[^>]*w:instr="([^"]*)"/g)) {
      if (m[1] === 'begin') instr = '';
      else if (m[1]) { const n = instr !== null ? fieldName(instr) : null; if (n && !names.includes(n)) names.push(n); instr = null; }
      else if (m[2] !== undefined && instr !== null) instr += unescape(m[2]);
      else if (m[3] !== undefined) { const n = fieldName(m[3]); if (n && !names.includes(n)) names.push(n); }
    }
  }
  return names;
}

/** Плоский текст документа (для проверок и предпросмотра). */
export async function documentText(docx: Buffer | Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(docx);
  const xml = await zip.file('word/document.xml')!.async('string');
  return xml.replace(/<w:p[\s>][\s\S]*?<\/w:p>/g, p => [...p.matchAll(/<w:t(?=[\s>])[^>]*>([\s\S]*?)<\/w:t>|<w:br\/>/g)].map(x => x[1] !== undefined ? unescape(x[1]) : '\n').join('') + '\n')
    .replace(/<[^>]+>/g, '');
}
