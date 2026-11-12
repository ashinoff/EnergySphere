import { useMe } from '../../auth/AuthContext.js';
import { Button, Card, Empty, PageHeader } from '../../ui/kit.js';
import { go } from '../../shell/route.js';
import type { MenuItem, ModuleMeta } from '../registry.js';

// Раздел «Актов ТП», которого нет у этого человека в маршруте TP: вместо пустого
// или чужого экрана — объяснение, кто здесь работает и что делать.
export const TP_ROLE_INFO: Record<string, { title: string; text: string }> = {
  upload: {
    title: 'Загружает документы инженер реализации',
    text: 'ТУ и акт ТП (АВТУ, уведомление) в PDF загружает инженер реализации своего РЭС — он же сверяет их и отправляет на согласование. Если загружать нужно вам, попросите администратора назначить роль «Инженер реализации» и РЭС.',
  },
  approval: {
    title: 'Очередь согласующих',
    text: 'Здесь работают согласующие: начальник РИРУ и начальник РЭС своего РЭС, затем параллельно начальники СТП и СУЭ и Главный инженер (ТЕХБЛОК). Документ появляется в очереди, когда доходит до вашего этапа.',
  },
};

export function TpRoleInfo({ module, page }: { module: ModuleMeta; page: MenuItem }) {
  const me = useMe();
  const info = TP_ROLE_INFO[page.id];
  return (
    <>
      <PageHeader crumbs={['ЭнергоСфера', module.title]} title={page.title} subtitle={page.about} />
      <Card>
        <Empty image={module.image} title={info.title} text={info.text}
          action={<>
            <p className="muted">Ваша роль: {me.roleTitle ?? 'не назначена'}{me.res ? ` · ${me.res.name}` : me.allRes ? ' · все РЭС' : ''}</p>
            <Button variant="primary" onClick={() => go({ view: 'module', id: 'tp', page: 'registry' })}>Открыть реестр актов</Button>
          </>} />
      </Card>
    </>
  );
}
