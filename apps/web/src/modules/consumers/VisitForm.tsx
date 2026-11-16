import { useEffect, useRef, useState } from 'react';
import { api } from '../../auth/session.js';
import { Button, Card, Field, TextArea, useToast } from '../../ui/kit.js';
import { IconCamera, IconCheck, IconDoc, IconMap, IconSearch, IconTarget, IconTrash, IconUpload } from '../../ui/icons.js';
import { mapUrl, refreshCounts } from './api.js';
import { MapPicker } from './MapPicker.js';
import { shrink } from './shrink.js';

// Отметка монтёра на месте: геометка, фото объекта, ПСУ (фото или PDF).
// Всё уходит одним запросом инженерам РИРУ своего РЭС.
// Геометка — по телефону («Моё место») или нажатием на карте: геолокацию может не
// дать браузер, телефон или платформа (фрейм), карта работает всегда.
// accuracy: null — место указано на карте вручную.
type Geo = { lat: number; lon: number; accuracy: number | null };
const inFrame = window.parent !== window;
interface Picked { file: File; url: string }
// Дом по адресу реестра (сервер спрашивает геокодер, как в Web_abonent).
interface Place { lat: number; lon: number; label: string; exact: boolean; sameHouse: boolean; level: 'house' | 'street' | 'place' }

const MAX = 10;
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

export function VisitForm({ recordId, onSent }: { recordId: number; onSent: () => void }) {
  const toast = useToast();
  const [geo, setGeo] = useState<Geo | null>(null);
  const [locating, setLocating] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [stage, setStage] = useState('');
  const [places, setPlaces] = useState<{ query: string; list: Place[] } | null>(null);
  const [finding, setFinding] = useState(false);
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

  // Адрес из реестра → дом на карте. Одно точное совпадение — ставим метку сразу,
  // иначе — список: та же улица бывает в разных посёлках.
  const findHouse = async () => {
    setShowMap(true);
    setFinding(true);
    try {
      const { query, places: list } = await api<{ query: string; places: Place[] }>(`/api/consumers/records/${recordId}/places`);
      const exact = list.filter(p => p.exact);
      setPlaces({ query, list });
      if (exact.length === 1) {
        setGeo({ lat: exact[0].lat, lon: exact[0].lon, accuracy: null });
        toast('Дом найден по адресу — проверьте метку на карте');
      } else if (!list.length) toast('Адрес не нашёлся — нажмите на дом на карте', 'error');
      // Дома в OSM нет, есть улица или посёлок — открываем карту там, дом укажет монтёр.
      else if (list[0].level !== 'house' && !geo) setGeo({ lat: list[0].lat, lon: list[0].lon, accuracy: null });
    } catch (e) { toast((e as Error).message, 'error'); } finally { setFinding(false); }
  };

  const locate = () => {
    if (!navigator.geolocation) { toast('Телефон не даёт координаты — ищем дом по адресу', 'error'); findHouse(); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      p => { setGeo({ lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), accuracy: Math.round(p.coords.accuracy) }); setLocating(false); },
      e => {
        setLocating(false);
        toast(e.code !== e.PERMISSION_DENIED ? 'Не удалось определить место — ищем дом по адресу'
          : inFrame ? 'Платформа не передала геолокацию — ищем дом по адресу'
            : 'Геолокация запрещена в браузере — ищем дом по адресу', 'error');
        if (!places) findHouse(); else setShowMap(true);
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
    if (geo) {
      form.set('lat', String(geo.lat)); form.set('lon', String(geo.lon));
      if (geo.accuracy !== null) form.set('accuracy', String(geo.accuracy));
    }
    if (comment.trim()) form.set('comment', comment.trim());
    setBusy(true);
    try {
      // Фото уменьшаем на телефоне: отправка и скачивание у инженера — в разы быстрее.
      setStage('Сжимаем фото…');
      for (const f of await Promise.all(photos.map(p => shrink(p.file, 'photo')))) form.append('photo', f, f.name);
      for (const f of await Promise.all(psu.map(p => shrink(p.file, 'psu')))) form.append('psu', f, f.name);
      setStage('Отправляем…');
      await api('/api/consumers/visits', { method: 'POST', body: form });
      toast('Отправлено инженеру РИРУ');
      [...photos, ...psu].forEach(p => URL.revokeObjectURL(p.url));
      setGeo(null); setShowMap(false); setPlaces(null); setPhotos([]); setPsu([]); setComment('');
      refreshCounts();
      onSent();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); setStage(''); }
  };
  const pickOnMap = (lat: number, lon: number) => setGeo({ lat, lon, accuracy: null });

  return (
    <Card title="Отметка на месте" className="cs-visit">
      <div className="cs-visit__step">
        <div className="cs-visit__label"><IconMap size={20} /><b>Геометка</b></div>
        {geo ? (
          <p className="cs-visit__geo">
            <a className="cs-link" href={mapUrl(geo)} target="_blank" rel="noreferrer">{geo.lat}, {geo.lon}</a>
            <span className="muted"> · {geo.accuracy === null ? 'указано на карте' : `точность ±${geo.accuracy} м`}</span>
          </p>
        ) : <p className="muted">Встаньте у объекта и нажмите «Моё место». Не получается — найдите дом по адресу или укажите его на карте.</p>}
        <div className="cs-visit__geo-actions">
          <Button icon={<IconTarget size={18} />} onClick={locate} disabled={locating}>{locating ? 'Определяем…' : 'Моё место'}</Button>
          <Button icon={<IconSearch size={18} />} onClick={findHouse} disabled={finding}>{finding ? 'Ищем дом…' : 'Найти по адресу'}</Button>
          <Button variant="ghost" icon={<IconMap size={18} />} onClick={() => setShowMap(v => !v)}>{showMap ? 'Скрыть карту' : 'Указать на карте'}</Button>
        </div>
        {places && places.list.length > 0 && (
          <div className="cs-places">
            <span className="muted">По адресу «{places.query}» {places.list.length > 1 ? 'нашлось несколько мест — выберите нужное:' : 'нашлось:'}</span>
            {places.list.map(p => (
              <button key={`${p.lat},${p.lon}`} type="button" onClick={() => setGeo({ lat: p.lat, lon: p.lon, accuracy: null })}
                className={`cs-place${geo?.lat === p.lat && geo?.lon === p.lon ? ' is-on' : ''}`}>
                <IconMap size={16} /><span>{p.label}</span>
                <em>{p.exact ? 'точно' : p.sameHouse ? 'тот же № дома' : p.level === 'street' ? 'улица — дом укажите на карте' : p.level === 'place' ? 'посёлок — дом укажите на карте' : ''}</em>
              </button>
            ))}
          </div>
        )}
        {showMap && (
          <>
            <MapPicker value={geo} onPick={pickOnMap} />
            <p className="muted cs-map__hint">Нажмите на дом потребителя — метку можно перетащить.</p>
          </>
        )}
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
        <Button variant="primary" icon={<IconCheck size={18} />} onClick={send} disabled={busy}>{busy ? stage || 'Отправляем…' : 'Отправить инженеру'}</Button>
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
