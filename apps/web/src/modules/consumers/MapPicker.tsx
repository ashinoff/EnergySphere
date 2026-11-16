import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';

// Карта для геометки «вручную» — как в Web_abonent: нажать на дом потребителя,
// метку можно перетащить. Нужна, когда телефон или платформа не дают геолокацию.
// Leaflet и подложка OpenStreetMap грузятся только при открытии карты.
const SOCHI: [number, number] = [43.585, 39.723];
const loadLeaflet = () => import('leaflet').then(m => m.default);
type LeafletLib = Awaited<ReturnType<typeof loadLeaflet>>;

export function MapPicker({ value, onPick }: { value: { lat: number; lon: number } | null; onPick: (lat: number, lon: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const marker = useRef<Leaflet.Marker | null>(null);
  const lib = useRef<LeafletLib | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([loadLeaflet(), import('leaflet/dist/leaflet.css')]).then(([L]) => {
      if (!alive || !box.current) return;
      lib.current = L;
      const m = L.map(box.current, { center: SOCHI, zoom: 12 });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      }).addTo(m);
      m.on('click', e => pick.current(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)));
      map.current = m;
      place(true);
    }).catch(() => alive && setFailed(true));
    return () => { alive = false; map.current?.remove(); map.current = null; marker.current = null; };
  }, []);

  // Метка — там, где отметка; при первом показе карта встаёт на неё.
  const place = (center: boolean) => {
    const L = lib.current, m = map.current;
    if (!L || !m) return;
    if (!value) { marker.current?.remove(); marker.current = null; return; }
    const at: [number, number] = [value.lat, value.lon];
    if (!marker.current) {
      const pin = L.marker(at, {
        draggable: true,
        icon: L.divIcon({ className: 'cs-map__pin', html: '<span></span>', iconSize: [30, 30], iconAnchor: [15, 30] }),
      }).addTo(m);
      pin.on('dragend', () => { const p = pin.getLatLng(); pick.current(+p.lat.toFixed(6), +p.lng.toFixed(6)); });
      marker.current = pin;
    } else marker.current.setLatLng(at);
    if (center || !m.getBounds().contains(at)) m.setView(at, Math.max(m.getZoom(), 17));
  };
  useEffect(() => place(false), [value?.lat, value?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <p className="muted">Карта не загрузилась — проверьте интернет и откройте её ещё раз.</p>;
  return <div ref={box} className="cs-map" />;
}
