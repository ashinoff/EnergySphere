import { useEffect, useState } from 'react';
import type { ModuleId } from '../../../api/src/core/access.js';
import { moduleById } from '../modules/registry.js';

// Маршрут хранится в адресе (#/analysis/overview) — переживает перезагрузку.
export type Route =
  | { view: 'home' }
  | { view: 'module'; id: ModuleId; page: string }
  | { view: 'admin'; page: string };

export function parse(hash: string): Route {
  const [a, b] = hash.replace(/^#\/?/, '').split('/');
  if (a === 'admin') return { view: 'admin', page: b || '' };
  const m = moduleById(a);
  return m ? { view: 'module', id: m.id, page: b || m.menu[0].id } : { view: 'home' };
}

export const go = (route: Route) => {
  window.location.hash = route.view === 'home' ? '/' : route.view === 'admin' ? `/admin/${route.page}` : `/${route.id}/${route.page}`;
};

export function useRoute() {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
