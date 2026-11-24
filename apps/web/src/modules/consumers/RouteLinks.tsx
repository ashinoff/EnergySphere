import { IconMap, IconTarget } from '../../ui/icons.js';
import { isPhone, naviUrl, routeUrl } from './api.js';

// Координаты → маршрут от текущего места: кнопки цвета модуля — «Маршрут» (Яндекс
// Карты, в телефоне откроется приложение) и на телефоне «Навигатор».
export function RouteLinks({ geo, label }: { geo: { lat: number; lon: number }; label?: string }) {
  return (
    <span className="cs-route">
      {label && <span className="cs-route__coords">{label}</span>}
      <span className="cs-route__btns">
        <a className="btn btn--primary cs-route__btn" href={routeUrl(geo)} target="_blank" rel="noreferrer">
          <span className="btn__icon"><IconMap size={18} /></span><span>Маршрут</span>
        </a>
        {isPhone() && (
          <a className="btn btn--secondary cs-route__btn cs-route__btn--navi" href={naviUrl(geo)}>
            <span className="btn__icon"><IconTarget size={18} /></span><span>Навигатор</span>
          </a>
        )}
      </span>
    </span>
  );
}
