import { useEffect, useRef, useSyncExternalStore } from 'react';
import { freshToken } from '../../auth/session.js';
import { PageHeader } from '../../ui/kit.js';
import { go } from '../../shell/route.js';
import type { MenuItem, ModuleMeta } from '../registry.js';

// Модуль 04 «Акты ТП» — интерфейс TP_Approval (/tp/, импорт scripts/import-tp.mjs)
// во фрейме того же сайта. Вход: на его запрос app-ready отдаём токен Сферы
// (тот же протокол platform-auth, что у платформы); сервер TP переводит его
// в своего пользователя через мост ролей. Разделы переключает меню модуля —
// es-tp-bridge.js нажимает кнопку с нужной подписью в скрытой панели TP.

// Подписи разделов TP (у разных ролей набор разный — берётся первый найденный).
export const TP_SECTIONS: Record<string, string[]> = {
  registry: ['Все документы', 'Все в работе', 'Согласованные'],
  approval: ['На согласование'],
  upload: ['Новый документ'],
  books: ['Справочники'],
  calendar: ['Календарь'],
  fields: ['Поля карточки'],
  sync: ['Синхронизация'],
  service: ['Сервис'],
};
export const TP_FRAME_PAGES = new Set(Object.keys(TP_SECTIONS));

// Какие разделы есть у человека в TP (сообщает мост после входа). Пока не
// известно — null, и меню модуля показывает пункты по правам Сферы.
let available: string[] | null = null;
const listeners = new Set<() => void>();
function setAvailable(labels: string[] | null) {
  available = labels;
  listeners.forEach(fn => fn());
}
export function useTpAvailable() {
  return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => available);
}
export function tpPageAvailable(page: string, labels: string[] | null) {
  const wanted = TP_SECTIONS[page];
  if (!wanted || !labels) return true;
  return labels.some(l => wanted.some(w => l.startsWith(w)));
}

export function TpHost({ module, page, visible }: { module: ModuleMeta; page: MenuItem; visible: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);

  // Новый фрейм (в том числе после смены пользователя) — разделы ещё не известны.
  useEffect(() => { setAvailable(null); }, []);

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (e.origin !== window.location.origin || e.source !== win || !win) return;
      const data = e.data as { type?: string; label?: string; labels?: string[] };
      if (data?.type === 'es-tp-available' && Array.isArray(data.labels)) setAvailable(data.labels);
      if (data?.type === 'app-ready') {
        const token = await freshToken();
        if (token) win.postMessage({ type: 'platform-auth', token }, window.location.origin);
      }
      if (data?.type === 'es-tp-section' && data.label) {
        const found = Object.entries(TP_SECTIONS).find(([, labels]) => labels.some(l => data.label!.startsWith(l)));
        if (found) go({ view: 'module', id: 'tp', page: found[0] });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const labels = TP_SECTIONS[page.id];
    if (labels) frame.current?.contentWindow?.postMessage({ type: 'es-tp-go', labels }, window.location.origin);
  }, [page.id]);

  return (
    <div className="analysis" hidden={!visible}>
      <PageHeader crumbs={['ЭнергоСфера', module.title]} title={page.title} subtitle={page.about} />
      <iframe ref={frame} className="analysis__frame" src="/tp/" title="Акты ТП"
        onLoad={() => {
          const labels = TP_SECTIONS[page.id];
          if (labels) frame.current?.contentWindow?.postMessage({ type: 'es-tp-go', labels }, window.location.origin);
        }} />
    </div>
  );
}
