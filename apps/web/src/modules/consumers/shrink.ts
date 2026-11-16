// Фото с телефона — 4–10 МБ (HEIC с iPhone ещё и перекодирует сервер, медленно).
// Перед отправкой уменьшаем в браузере до JPEG: снимок объекта — 2048 px по длинной
// стороне, лист ПСУ — 2600 px (текст должен читаться). Поворот по EXIF браузер
// применяет сам при отрисовке. Что браузер открыть не смог (HEIC на Android) или
// PDF — уходит как есть, сервер справится.
const LIMIT = { photo: 2048, psu: 2600 };
const SMALL = 700 * 1024;

export async function shrink(file: File, kind: keyof typeof LIMIT): Promise<File> {
  if (!/^image\//.test(file.type) && !/\.(heic|heif|jpe?g|png)$/i.test(file.name)) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.max(img.naturalWidth, img.naturalHeight);
    if (!side || (side <= LIMIT[kind] && file.size <= SMALL && /jpe?g|png/i.test(file.type))) return file;
    const k = Math.min(1, LIMIT[kind] / side);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#fff'; // прозрачный PNG — на белом, как на бумаге
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(ok => canvas.toBlob(ok, 'image/jpeg', 0.85));
    if (!blob || (blob.size >= file.size && /jpe?g|png/i.test(file.type))) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
