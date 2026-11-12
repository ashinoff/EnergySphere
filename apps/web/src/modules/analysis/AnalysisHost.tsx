import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../../ui/kit.js';
import { go } from '../../shell/route.js';
import type { MenuItem, ModuleMeta } from '../registry.js';

// Модуль 01 «Анализ потребления» — портативный анализатор v5.x (public/analysis,
// импорт: scripts/import-analyzer.mjs). Работает полностью в браузере, на сервер
// ничего не уходит. Открыт во фрейме того же сайта, чтобы его стили и код не
// пересекались с оболочкой. Фрейм создаётся один раз и живёт, пока открыта
// Сфера: при переходах между разделами загруженный файл и расчёт не теряются.
// Вкладки анализатора переключает меню модуля (и наоборот) — es-bridge.js.
export function AnalysisHost({ module, page, visible }: { module: ModuleMeta; page: MenuItem; visible: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const data = e.data as { type?: string; tab?: string };
      if (data?.type === 'es-analysis-ready') setReady(true);
      // Анализатор сам сменил вкладку (например, клик по кандидату в балансе).
      if (data?.type === 'es-analysis-tab-changed' && data.tab && module.menu.some(i => i.id === data.tab)) {
        go({ view: 'module', id: 'analysis', page: data.tab });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [module]);

  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage({ type: 'es-analysis-tab', tab: page.id }, window.location.origin);
  }, [ready, page.id]);

  return (
    <div className="analysis" hidden={!visible}>
      <PageHeader crumbs={['ЭнергоСфера', module.title]} title={page.title} subtitle={page.about} />
      <iframe ref={frame} className="analysis__frame" src="/analysis/index.html" title="Анализ потребления" />
    </div>
  );
}
