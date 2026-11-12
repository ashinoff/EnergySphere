import type { MenuItem, ModuleMeta } from './registry.js';
import { Card, Empty, PageHeader } from '../ui/kit.js';

// Этап 0: у модулей пока только каркас. Каждый модуль позже заменит эту
// заглушку своими страницами (modules/<id>/...), не трогая оболочку.
export function ModulePage({ module, page }: { module: ModuleMeta; page: MenuItem }) {
  return (
    <>
      <PageHeader crumbs={['ЭнергоСфера', module.title]} title={page.title} subtitle={page.about} />
      <Card>
        <Empty image={module.image} title="Раздел в разработке" text="Каркас готов — содержимое появится на следующих этапах." />
      </Card>
    </>
  );
}
