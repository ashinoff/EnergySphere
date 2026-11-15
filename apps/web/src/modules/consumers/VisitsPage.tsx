import { useCallback, useEffect, useState } from 'react';
import { useAuth, useMe } from '../../auth/AuthContext.js';
import { api } from '../../auth/session.js';
import { Badge, Button, Card, Empty, PageHeader, Select, useToast } from '../../ui/kit.js';
import { IconCamera, IconCheck, IconDoc, IconDownload, IconMap } from '../../ui/icons.js';
import type { MenuItem, ModuleMeta } from '../registry.js';
import { fmtSize, fmtTime, loadRes, mapUrl, refreshCounts, saveFile, type ResInfo, type Visit } from './api.js';

// Отметки монтёров: new — ждут инженера РИРУ (скачать и «Завершить»), done —
// завершённые (хранятся 3 дня), mine — что отправил сам монтёр.
type Kind = 'new' | 'done' | 'mine';
const EMPTY: Record<Kind, { title: string; text: string }> = {
  new: { title: 'Новых отметок нет', text: 'Когда монтёр поставит геометку и приложит фото или ПСУ, отметка появится здесь.' },
  done: { title: 'Завершённых нет', text: 'Завершённые отметки хранятся 3 дня, потом удаляются вместе с файлами.' },
  mine: { title: 'Вы ещё ничего не отправляли', text: 'Найдите потребителя в «Поиске» и поставьте отметку на месте.' },
};

export function VisitsPage({ module, page, kind }: { module: ModuleMeta; page: MenuItem; kind: Kind }) {
  const me = useMe();
  const { can } = useAuth();
  const toast = useToast();
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [resList, setResList] = useState<ResInfo[]>([]);
  const [res, setRes] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams({ status: kind });
    if (res) params.set('res', res);
    api<Visit[]>(`/api/consumers/visits?${params}`).then(setVisits).catch(e => toast(e.message, 'error'));
  }, [kind, res, toast]);
  useEffect(load, [load]);
  useEffect(() => { if (me.allRes && kind !== 'mine') loadRes().then(setResList).catch(() => {}); }, [me.allRes, kind]);
  // Новые отметки приходят сами — обновляем список раз в минуту.
  useEffect(() => {
    if (kind !== 'new') return;
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [kind, load]);

  const complete = async (v: Visit) => {
    try {
      await api(`/api/consumers/visits/${v.id}/complete`, { method: 'POST' });
      toast('Отметка завершена — хранится 3 дня в «Завершённых»');
      setVisits(list => list?.filter(x => x.id !== v.id) ?? null);
      refreshCounts();
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  return (
    <>
      <PageHeader crumbs={['ЭнергоСфера', module.title]} title={page.title} subtitle={page.about}
        actions={me.allRes && resList.length > 1 ? (
          <Select value={res} onChange={e => setRes(e.target.value)} aria-label="РЭС">
            <option value="">Все РЭС</option>
            {resList.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        ) : undefined} />
      {!visits ? <p className="muted">Загрузка…</p>
        : !visits.length ? <Card><Empty image={module.image} {...EMPTY[kind]} /></Card>
          : (
            <div className="cs-visits">
              {visits.map(v => (
                <VisitCard key={v.id} v={v} kind={kind} showRes={me.allRes}
                  onComplete={kind === 'new' && can('consumers.complete') ? () => complete(v) : undefined} />
              ))}
            </div>
          )}
    </>
  );
}

function VisitCard({ v, kind, showRes, onComplete }: { v: Visit; kind: Kind; showRes: boolean; onComplete?: () => void }) {
  const toast = useToast();
  const photos = v.files.filter(f => f.kind === 'photo');
  const psu = v.files.find(f => f.kind === 'psu');
  const download = (path: string, name: string) => saveFile(path, name).catch(e => toast((e as Error).message, 'error'));
  const fileUrl = (id: number) => `/api/consumers/visits/${v.id}/files/${id}?download=1`;

  return (
    <Card className="cs-visit-card">
      <div className="cs-visit-card__head">
        <div className="cs-result__ids">
          {v.account && <span className="cs-chip">ЛС {v.account}</span>}
          {v.meter && <span className="cs-chip">ПУ {v.meter}</span>}
          {showRes && <span className="cs-result__res">{v.res.name}</span>}
        </div>
        {kind === 'mine'
          ? <Badge tone={v.status === 'new' ? 'accent' : 'ok'}>{v.status === 'new' ? 'У инженера' : 'Завершена'}</Badge>
          : kind === 'done' && v.deleteAt ? <Badge>удалится {fmtTime(v.deleteAt)}</Badge> : null}
      </div>
      <h3 className="cs-visit-card__title">{v.title || 'Без наименования'}</h3>
      {v.address && <p className="cs-card__addr">{v.address}</p>}

      <dl className="cs-visit-card__facts">
        <div><dt>Геометка</dt><dd>{v.geo
          ? <a className="cs-link" href={mapUrl(v.geo)} target="_blank" rel="noreferrer"><IconMap size={16} />{v.geo.lat}, {v.geo.lon}{v.geo.accuracy ? ` · ±${v.geo.accuracy} м` : ''}</a>
          : <span className="muted">не ставили</span>}</dd></div>
        <div><dt>Отправил</dt><dd>{v.author ?? 'монтёр'} · {fmtTime(v.createdAt)}</dd></div>
        {v.doneAt && <div><dt>Завершил</dt><dd>{v.doneBy ?? '—'} · {fmtTime(v.doneAt)}</dd></div>}
        {v.comment && <div className="cs-visit-card__comment"><dt>Комментарий</dt><dd>{v.comment}</dd></div>}
      </dl>

      <div className="cs-files">
        {photos.map((f, i) => (
          <button key={f.id} type="button" className="cs-file" onClick={() => download(fileUrl(f.id), f.name)}>
            <IconCamera size={18} /><span>Фото {i + 1}</span><em>{fmtSize(f.size)}</em>
          </button>
        ))}
        {psu && (
          <button type="button" className="cs-file cs-file--psu" onClick={() => download(fileUrl(psu.id), psu.name)}>
            <IconDoc size={18} /><span>ПСУ (PDF)</span><em>{fmtSize(psu.size)}</em>
          </button>
        )}
        {!v.files.length && <span className="muted">Файлов нет — только геометка</span>}
      </div>

      {(v.files.length > 1 || onComplete) && (
        <div className="cs-visit-card__actions">
          {v.files.length > 1 && (
            <Button icon={<IconDownload size={18} />} onClick={() => download(`/api/consumers/visits/${v.id}/archive`, `${v.meter || v.account || 'отметка'}.zip`)}>
              Скачать всё
            </Button>
          )}
          {onComplete && <Button variant="primary" icon={<IconCheck size={18} />} onClick={onComplete}>Завершить</Button>}
        </div>
      )}
    </Card>
  );
}
