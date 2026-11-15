import heicConvert from 'heic-convert';
import { PDFDocument, degrees } from 'pdf-lib';
import { HttpError } from '../../db.js';

// Вложения отметки монтёра. С телефона приходят JPEG/PNG, с iPhone — HEIC, ПСУ
// бывает и PDF. Фото объекта храним как изображение (HEIC → JPEG, чтобы открывалось
// везде), ПСУ — всегда одним PDF: фото становятся страницами, PDF добавляются целиком.

export type Kind = 'jpeg' | 'png' | 'heic' | 'pdf';

export function kindOf(buf: Buffer): Kind | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  // HEIF: блок ftyp с маркой heic/heix/mif1… (так снимает iPhone).
  if (buf.length > 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp'
    && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(buf.subarray(8, 12).toString('latin1'))) return 'heic';
  return null;
}

const NOT_SUPPORTED = 'Поддерживаются фото JPEG, PNG, HEIC (iPhone) и PDF.';

// Изображение, пригодное для просмотра где угодно: HEIC перекодируется в JPEG.
export async function toViewable(buf: Buffer): Promise<{ data: Buffer; mime: string; ext: string }> {
  const kind = kindOf(buf);
  if (kind === 'jpeg') return { data: buf, mime: 'image/jpeg', ext: 'jpg' };
  if (kind === 'png') return { data: buf, mime: 'image/png', ext: 'png' };
  if (kind === 'heic') {
    try {
      const jpeg = await heicConvert({ buffer: buf, format: 'JPEG', quality: 0.85 });
      return { data: Buffer.from(jpeg), mime: 'image/jpeg', ext: 'jpg' };
    } catch { throw new HttpError(400, 'Не удалось прочитать фото HEIC — попробуйте снять заново или выбрать «Наиболее совместимый» формат камеры.'); }
  }
  throw new HttpError(400, kind === 'pdf' ? 'Фото объекта — только изображение (JPEG, PNG, HEIC).' : NOT_SUPPORTED);
}

// Поворот снимка из EXIF (тег 0x0112): телефон пишет кадр как есть, а как его
// держали — отдельной пометкой. 1 — ровно, 3 — 180°, 6 — 90° по часовой, 8 — против.
export function exifOrientation(jpeg: Buffer): number {
  let i = 2;
  while (i + 4 < jpeg.length && jpeg[i] === 0xff) {
    const marker = jpeg[i + 1];
    const size = jpeg.readUInt16BE(i + 2);
    if (marker === 0xe1 && jpeg.subarray(i + 4, i + 10).toString('latin1') === 'Exif\0\0') {
      const tiff = i + 10;
      const le = jpeg.subarray(tiff, tiff + 2).toString('latin1') === 'II';
      const u16 = (o: number) => (le ? jpeg.readUInt16LE(o) : jpeg.readUInt16BE(o));
      const u32 = (o: number) => (le ? jpeg.readUInt32LE(o) : jpeg.readUInt32BE(o));
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > jpeg.length) return 1;
      for (let n = 0, count = u16(ifd); n < count; n++) {
        const entry = ifd + 2 + n * 12;
        if (entry + 12 > jpeg.length) break;
        if (u16(entry) === 0x0112) return u16(entry + 8);
      }
      return 1;
    }
    if (marker === 0xda) break; // дальше — сами данные кадра
    i += 2 + size;
  }
  return 1;
}

const A4 = { short: 595.28, long: 841.89 };
const MARGIN = 24;

// ПСУ одним PDF: каждая фотография — страница A4 (ориентация по снимку),
// страницы присланных PDF — как есть.
export async function psuPdf(parts: Buffer[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (const part of parts) {
    const kind = kindOf(part);
    if (kind === 'pdf') {
      let src: PDFDocument;
      try { src = await PDFDocument.load(part, { ignoreEncryption: true }); } catch { throw new HttpError(400, 'PDF с ПСУ повреждён или защищён паролем.'); }
      for (const page of await pdf.copyPages(src, src.getPageIndices())) pdf.addPage(page);
      continue;
    }
    if (!kind) throw new HttpError(400, NOT_SUPPORTED);
    const { data, mime } = await toViewable(part);
    const image = mime === 'image/png' ? await pdf.embedPng(data) : await pdf.embedJpg(data);
    const turn = mime === 'image/jpeg' ? exifOrientation(data) : 1;
    const sideways = turn === 6 || turn === 8;
    // Размер «как видит человек» (с учётом поворота) — по нему выбираем лист.
    const shownW = sideways ? image.height : image.width;
    const shownH = sideways ? image.width : image.height;
    const [pw, ph] = shownW > shownH ? [A4.long, A4.short] : [A4.short, A4.long];
    const s = Math.min((pw - 2 * MARGIN) / shownW, (ph - 2 * MARGIN) / shownH);
    const w = image.width * s;
    const h = image.height * s;
    const x0 = (pw - shownW * s) / 2;
    const y0 = (ph - shownH * s) / 2;
    const page = pdf.addPage([pw, ph]);
    // pdf-lib поворачивает против часовой вокруг точки вставки — сдвигаем её так,
    // чтобы повёрнутый кадр лёг в ту же рамку x0, y0.
    if (turn === 6) page.drawImage(image, { x: x0, y: y0 + w, width: w, height: h, rotate: degrees(-90) });
    else if (turn === 8) page.drawImage(image, { x: x0 + h, y: y0, width: w, height: h, rotate: degrees(90) });
    else if (turn === 3) page.drawImage(image, { x: x0 + w, y: y0 + h, width: w, height: h, rotate: degrees(180) });
    else page.drawImage(image, { x: x0, y: y0, width: w, height: h });
  }
  if (!pdf.getPageCount()) throw new HttpError(400, 'Приложите ПСУ — фото или PDF.');
  return Buffer.from(await pdf.save());
}
