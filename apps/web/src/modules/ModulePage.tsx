import type { MenuItem, ModuleMeta } from './registry.js';
import { Card, Empty, PageHeader } from '../ui/kit.js';
import { PlanPage } from './riru/PlanPage.js';
import { TechCards } from './riru/TechCards.js';
import { DocsPage } from './riru/DocsPage.js';

// Страница модуля по пункту меню. Модуль 01 (анализ) живёт во фрейме —
// его показывает Shell (AnalysisHost). Ещё не сделанные модули — заглушка.
export function ModulePage({ module, page }: { module: ModuleMeta; page: MenuItem }) {
  if (module.id === 'riru') {
    if (page.id === 'strategic' || page.id === 'tactical' || page.id === 'operational') {
      return <PlanPage key={page.id} kind={page.id} module={module} page={page} />;
    }
    if (page.id === 'technology') return <TechCards module={module} page={page} />;
    if (page.id === 'docs') return <DocsPage module={module} page={page} />;
  }
  return (
    <>
      <PageHeader crumbs={['ЭнергоСфера', module.title]} title={page.title} subtitle={page.about} />
      <Card>
        <Empty image={module.image} title="Раздел в разработке" text="Каркас готов — содержимое появится на следующих этапах." />
      </Card>
    </>
  );
}
