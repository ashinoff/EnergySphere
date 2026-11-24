import { IconMap } from '../../ui/icons.js';
import { isPhone, naviUrl, routeUrl } from './api.js';

// Координаты → маршрут от текущего места: Яндекс Карты (в телефоне откроется
// приложение) и, на телефоне, Яндекс Навигатор.
export function RouteLinks({ geo, label }: { geo: { lat: number; lon: number }; label?: string }) {
  return (
    <span className="cs-route">
      {label && <span>{label}</span>}
      <a className="cs-link" href={routeUrl(geo)} target="_blank" rel="noreferrer"><IconMap size={16} />Маршрут</a>
      {isPhone() && <a className="cs-link" href={naviUrl(geo)}>Навигатор</a>}
    </span>
  );
}
