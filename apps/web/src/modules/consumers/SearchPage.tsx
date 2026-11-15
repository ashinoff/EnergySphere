import { useEffect, useState, type FormEvent } from 'react';
import { useAuth, useMe } from '../../auth/AuthContext.js';
import { api } from '../../auth/session.js';
import { Badge, Button, Card, Empty, Input, PageHeader, Select, useToast } from '../../ui/kit.js';
import { IconArrowLeft, IconMap, IconSearch } from '../../ui/icons.js';
import type { MenuItem, ModuleMeta } from '../registry.js';
import { fmtTime, loadRes, mapUrl, type Card as CardData, type Found, type ResInfo } from './api.js';
import { VisitForm } from './VisitForm.js';

// Поиск потребителя по № ПУ или ЛС (часть номера тоже подходит) и карточка со
// всеми полями реестра. Монтёр здесь же ставит отметку на месте.
export function SearchPage({ module, page }: { module: ModuleMeta; page: MenuItem }) {
  const me = useMe();
  const { can } = useAuth();
  const toast = useToast();
  const [resList, setResList] = useState<ResInfo[] | null>(null);
  const [res, setRes] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ items: Found[]; more: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<CardData | null>(null);

  useEffect(() => { loadRes().then(setResList).catch(e => toast(e.message, 'error')); }, [toast]);

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    if (query.replace(/\s/g, '').length < 3) { toast('Введите не меньше 3 знаков номера ПУ или ЛС', 'error'); return; }
    setBusy(true);
    try {
      const params = new URLSearchParams({ q: query });
      if (res) params.set('res', res);
      const result = await api<{ items: Found[]; more: boolean }>(`/api/consumers/search?${params}`);
      setFound(result);
      setCard(null);
      if (result.items.length === 1) await open(result.items[0].id);
    } catch (err) { toast((err as Error).message, 'error'); } finally { setBusy(false); }
  };
  const open = async (id: number) => {
    try { setCard(await api<CardData>(`/api/consumers/records/${id}`)); window.scrollTo(0, 0); }
    catch (err) { toast((err as Error).message, 'error'); }
  };

  const withRegistry = resList?.filter(r => r.registry) ?? [];
  const noRegistry = resList !== null && !withRegistry.length;

  return (
    <>
      <PageHeader crumbs={['ЭнергоСфера', module.title]} title={page.title} subtitle={page.about} />
      <form className="cs-search" onSubmit={search}>
        {me.allRes && (resList?.length ?? 0) > 1 && (
          <Select value={res} onChange={e => setRes(e.target.value)} aria-label="РЭС">
            <option value="">Все РЭС</option>
            {resList!.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        )}
        <span className="search cs-search__field">
          <IconSearch size={18} />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Номер ПУ или лицевой счёт" inputMode="search" autoFocus enterKeyHint="search" />
        </span>
        <Button variant="primary" type="submit" icon={<IconSearch size={18} />} disabled={busy}>{busy ? 'Ищем…' : 'Найти'}</Button>
      </form>

      {noRegistry && (
        <Card><Empty image={module.image} title="Реестр ещё не загружен"
          text={can('consumers.registry') ? 'Загрузите расширенный список своего РЭС в разделе «Реестр РЭС».' : 'Инженер РИРУ вашего РЭС ещё не загрузил реестр потребителей.'} /></Card>
      )}

      {card ? (
        <ConsumerCard card={card} multiple={(found?.items.length ?? 0) > 1} onBack={() => setCard(null)}
          onSent={() => open(card.id)} canField={can('consumers.field')} />
      ) : found && (
        !found.items.length
          ? <Card><Empty title="Ничего не найдено" text="Проверьте номер. Можно ввести часть номера ПУ или лицевого счёта — от 3 знаков." /></Card>
          : (
            <Card className="card--flush">
              <ul className="cs-results">
                {found.items.map(f => (
                  <li key={f.id}>
                    <button type="button" className="cs-result" onClick={() => open(f.id)}>
                      <span className="cs-result__ids">
                        {f.meter && <span className="cs-chip">ПУ {f.meter}</span>}
                        {f.account && <span className="cs-chip">ЛС {f.account}</span>}
                        {me.allRes && <span className="cs-result__res">{f.resName}</span>}
                      </span>
                      <span className="cs-result__title">{f.title || 'Без наименования'}</span>
                      {f.address && <span className="cs-result__addr">{f.address}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              {found.more && <p className="muted cs-more">Показаны первые 50 — уточните номер.</p>}
            </Card>
          )
      )}
    </>
  );
}

function ConsumerCard({ card, multiple, onBack, onSent, canField }:
  { card: CardData; multiple: boolean; onBack: () => void; onSent: () => void; canField: boolean }) {
  return (
    <div className="cs-card">
      {multiple && <Button variant="ghost" icon={<IconArrowLeft size={18} />} onClick={onBack}>К результатам поиска</Button>}
      <Card>
        <div className="cs-card__head">
          <div className="cs-result__ids">
            {card.meter && <span className="cs-chip">ПУ {card.meter}</span>}
            {card.account && <span className="cs-chip">ЛС {card.account}</span>}
            <span className="cs-result__res">{card.resName}</span>
          </div>
          <h2 className="cs-card__title">{card.title || 'Без наименования'}</h2>
          {card.address && <p className="cs-card__addr">{card.address}</p>}
        </div>
        <dl className="cs-fields">
          {card.cells.map(([label, value], i) => (
            <div key={i} className="cs-fields__row"><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      </Card>

      {card.visits.length > 0 && (
        <Card title="Отметки по этому потребителю">
          <ul className="cs-history">
            {card.visits.map(v => (
              <li key={v.id}>
                <Badge tone={v.status === 'new' ? 'accent' : 'ok'}>{v.status === 'new' ? 'У инженера' : 'Завершена'}</Badge>
                <span>{fmtTime(v.createdAt)} · {v.author ?? 'монтёр'}</span>
                {v.geo && <a className="cs-link" href={mapUrl(v.geo)} target="_blank" rel="noreferrer"><IconMap size={16} />на карте</a>}
                <span className="muted">{v.files.filter(f => f.kind === 'photo').length} фото{v.files.some(f => f.kind === 'psu') ? ' · ПСУ' : ''}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canField && <VisitForm recordId={card.id} onSent={onSent} />}
    </div>
  );
}
