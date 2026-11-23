import type { MenuItem, ModuleMeta } from './registry.js';
import { Card, Empty, PageHeader } from '../ui/kit.js';
import { PlanPage } from './riru/PlanPage.js';
import { TechCards } from './riru/TechCards.js';
import { DocsPage } from './riru/DocsPage.js';
import { TP_ROLE_INFO, TpRoleInfo } from './tp/TpRoleInfo.js';
import { ActBuilder } from './tp/ActBuilder.js';
import { SearchPage } from './consumers/SearchPage.js';
import { VisitsPage } from './consumers/VisitsPage.js';
import { RegistryPage } from './consumers/RegistryPage.js';

// Страница модуля по пункту меню. Модуль 01 (анализ) живёт во фрейме —
// его показывает Shell (AnalysisHost). Ещё не сделанные модули — заглушка.
export function ModulePage({ module, page }: { module: ModuleMeta; page: MenuItem }) {
  if (module.id === 'consumers') {
    if (page.id === 'search') return <SearchPage module={module} page={page} />;
    if (page.id === 'field') return <VisitsPage key="mine" kind="mine" module={module} page={page} />;
    if (page.id === 'inbox') return <VisitsPage key="new" kind="new" module={module} page={page} />;
    if (page.id === 'done') return <VisitsPage key="done" kind="done" module={module} page={page} />;
    if (page.id === 'registry') return <RegistryPage module={module} page={page} />;
  }
  if (module.id === 'riru') {
    if (page.id === 'strategic' || page.id === 'tactical' || page.id === 'operational') {
      return <PlanPage key={page.id} kind={page.id} module={module} page={page} />;
    }
    if (page.id === 'technology') return <TechCards module={module} page={page} />;
    if (page.id === 'docs') return <DocsPage module={module} page={page} />;
  }
  if (module.id === 'tp' && page.id === 'create') return <ActBuilder module={module} page={page} />;
  // Раздел «Актов ТП», которого нет у человека в маршруте, — объяснение вместо экрана TP.
  if (module.id === 'tp' && TP_ROLE_INFO[page.id]) return <TpRoleInfo module={module} page={page} />;
  return (
    <>
      <PageHeader crumbs={['ЭнергоСфера', module.title]} title={page.title} subtitle={page.about} />
      <Card>
        <Empty image={module.image} title="Раздел в разработке" text="Каркас готов — содержимое появится на следующих этапах." />
      </Card>
    </>
  );
}
