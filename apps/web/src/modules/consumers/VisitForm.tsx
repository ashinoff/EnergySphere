import { useEffect, useRef, useState } from 'react';
import { api } from '../../auth/session.js';
import { Button, Card, Field, TextArea, useToast } from '../../ui/kit.js';
import { IconCamera, IconCheck, IconDoc, IconMap, IconTrash, IconUpload } from '../../ui/icons.js';
import { mapUrl, refreshCounts } from './api.js';

// Отметка монтёра на месте: геометка, фото объекта, ПСУ (фото или PDF).
// Всё уходит одним запросом инженерам РИРУ своего РЭС.
type Geo = { lat: number; lon: number; accuracy: number };
interface Picked { file: File; url: string }

const MAX = 10;
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

export function VisitForm({ recordId, onSent }: { recordId: number; onSent: () => void }) {
  const toast = useToast();
  const [geo, setGeo] = useState<Geo | null>(null);
  const [locating, setLocating] = useState(false);
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [psu, setPsu] = useState<Picked[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const psuInput = useRef<HTMLInputElement>(null);

  // Превью освобождаем, когда форма уходит.
  const all = useRef<Picked[]>([]);
  all.current = [...photos, ...psu];
  useEffect(() => () => all.current.forEach(p => URL.revokeObjectURL(p.url)), []);

  const locate = () => {
    if (!navigator.geolocation) { toast('Телефон не даёт координаты — включите геолокацию', 'error'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      p => { setGeo({ lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), accuracy: Math.round(p.coords.accuracy) }); setLocating(false); },
      e => {
        setLocating(false);
        toast(e.code === e.PERMISSION_DENIED ? 'Нет доступа к геолокации — разрешите его браузеру в настройках телефона'
          : 'Не удалось определить место — выйдите на открытое место и повторите', 'error');
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };

  const add = (set: typeof setPhotos, list: Picked[], input: HTMLInputElement | null, allowPdf: boolean) => {
    const files = [...(input?.files ?? [])];
    if (input) input.value = '';
    const ok = files.filter(f => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png)$/i.test(f.name) || (allowPdf && isPdf(f)));
    if (ok.length < files.length) toast(allowPdf ? 'Можно приложить фото или PDF' : 'Можно приложить только фото', 'error');
    if (list.length + ok.length > MAX) toast(`Не больше ${MAX} файлов`, 'error');
    set([...list, ...ok.slice(0, MAX - list.length).map(file => ({ file, url: URL.createObjectURL(file) }))]);
  };
  const remove = (set: typeof setPhotos, list: Picked[], i: number) => { URL.revokeObjectURL(list[i].url); set(list.filter((_, n) => n !== i)); };

  const send = async () => {
    if (!geo && !photos.length && !psu.length) { toast('Поставьте геометку или приложите фото объекта / ПСУ', 'error'); return; }
    const form = new FormData();
    form.set('recordId', String(recordId));
    if (geo) { form.set('lat', String(geo.lat)); form.set('lon', String(geo.lon)); form.set('accuracy', String(geo.accuracy)); }
    if (comment.trim()) form.set('comment', comment.trim());
    photos.forEach(p => form.append('photo', p.file, p.file.name));
    psu.forEach(p => form.append('psu', p.file, p.file.name));
    setBusy(true);
    try {
      await api('/api/consumers/visits', { method: 'POST', body: form });
      toast('Отправлено инженеру РИРУ');
      [...photos, ...psu].forEach(p => URL.revokeObjectURL(p.url));
      setGeo(null); setPhotos([]); setPsu([]); setComment('');
      refreshCounts();
      onSent();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };

  return (
    <Card title="Отметка на месте" className="cs-visit">
      <div className="cs-visit__step">
        <div className="cs-visit__label"><IconMap size={20} /><b>Геометка</b></div>
        {geo ? (
          <p className="cs-visit__geo">
            <a className="cs-link" href={mapUrl(geo)} target="_blank" rel="noreferrer">{geo.lat}, {geo.lon}</a>
            <span className="muted"> · точность ±{geo.accuracy} м</span>
          </p>
        ) : <p className="muted">Встаньте у объекта и нажмите кнопку — телефон определит координаты.</p>}
        <Button icon={<IconMap size={18} />} onClick={locate} disabled={locating}>{locating ? 'Определяем…' : geo ? 'Обновить геометку' : 'Поставить геометку'}</Button>
      </div>

      <div className="cs-visit__step">
        <div className="cs-visit__label"><IconCamera size={20} /><b>Фото объекта</b><span className="muted">{photos.length}/{MAX}</span></div>
        <Thumbs list={photos} onRemove={i => remove(setPhotos, photos, i)} />
        <input ref={photoInput} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={() => add(setPhotos, photos, photoInput.current, false)} />
        <Button icon={<IconCamera size={18} />} onClick={() => photoInput.current?.click()} disabled={photos.length >= MAX}>Сфотографировать / выбрать</Button>
      </div>

      <div className="cs-visit__step">
        <div className="cs-visit__label"><IconDoc size={20} /><b>ПСУ</b><span className="muted">фото листов или PDF — инженер получит один PDF</span></div>
        <Thumbs list={psu} onRemove={i => remove(setPsu, psu, i)} />
        <input ref={psuInput} type="file" accept="image/*,.heic,.heif,application/pdf,.pdf" multiple hidden onChange={() => add(setPsu, psu, psuInput.current, true)} />
        <Button icon={<IconUpload size={18} />} onClick={() => psuInput.current?.click()} disabled={psu.length >= MAX}>Приложить ПСУ</Button>
      </div>

      <Field label="Комментарий" hint="Необязательно: где установлен ПУ, что заметили">
        <TextArea value={comment} onChange={e => setComment(e.target.value)} maxLength={1000} />
      </Field>

      <div className="cs-visit__send">
        <Button variant="primary" icon={<IconCheck size={18} />} onClick={send} disabled={busy}>{busy ? 'Отправляем…' : 'Отправить инженеру'}</Button>
      </div>
    </Card>
  );
}

function Thumbs({ list, onRemove }: { list: Picked[]; onRemove: (i: number) => void }) {
  if (!list.length) return null;
  return (
    <ul className="cs-thumbs">
      {list.map((p, i) => (
        <li key={p.url} className="cs-thumb">
          {isPdf(p.file) ? <span className="cs-thumb__file"><IconDoc size={22} />PDF</span>
            : <img src={p.url} alt="" onError={e => { (e.currentTarget.parentElement as HTMLElement).classList.add('is-raw'); }} />}
          <span className="cs-thumb__name">{p.file.name}</span>
          <Button variant="ghost" icon={<IconTrash size={16} />} title="Убрать" aria-label="Убрать" onClick={() => onRemove(i)} />
        </li>
      ))}
    </ul>
  );
}
