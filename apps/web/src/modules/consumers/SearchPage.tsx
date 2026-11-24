import { useEffect, useState, type FormEvent } from 'react';
import { useAuth, useMe } from '../../auth/AuthContext.js';
import { api } from '../../auth/session.js';
import { Badge, Button, Card, Empty, Input, PageHeader, Select, useToast } from '../../ui/kit.js';
import { IconArrowLeft, IconMap, IconSearch } from '../../ui/icons.js';
import type { MenuItem, ModuleMeta } from '../registry.js';
import { fmtTime, loadRes, mapUrl, parseCoords, type Card as CardData, type Found, type ResInfo } from './api.js';
import { RouteLinks } from './RouteLinks.js';
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
              {groups(found.items).map(g => (
                <div key={g.key} className={`cs-block ${g.items.length > 1 ? 'cs-group' : ''}`}>
                  {g.items.length > 1 && (
                    <div className="cs-group__head">
                      <span className="cs-result__ids">
                        <span className="cs-chip">ЛС {g.items[0].account}</span>
                        <b>{g.items.length} {plural(g.items.length, 'точка учёта', 'точки учёта', 'точек учёта')}</b>
                        {me.allRes && <span className="cs-result__res">{g.items[0].resName}</span>}
                      </span>
                      <span className="cs-result__title">{g.items[0].title || 'Без наименования'}</span>
                    </div>
                  )}
                  <ul className="cs-results">
                    {g.items.map(f => (
                      <li key={f.id}>
                        <button type="button" className="cs-result" onClick={() => open(f.id)}>
                          <span className="cs-result__ids">
                            {f.meter ? <span className="cs-chip">ПУ {f.meter}</span> : <span className="cs-chip cs-chip--soft">без № ПУ</span>}
                            {g.items.length === 1 && f.account && <span className="cs-chip">ЛС {f.account}</span>}
                            {f.zones > 1 && <span className="cs-result__zones">{f.zones} {plural(f.zones, 'тарифная зона', 'тарифные зоны', 'тарифных зон')}</span>}
                            {g.items.length === 1 && me.allRes && <span className="cs-result__res">{f.resName}</span>}
                          </span>
                          {g.items.length === 1 && <span className="cs-result__title">{f.title || 'Без наименования'}</span>}
                          {f.address && <span className="cs-result__addr">{f.address}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {found.more && <p className="muted cs-more">Показаны первые 100 — уточните номер.</p>}
            </Card>
          )
      )}
    </>
  );
}

const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};

// Результаты одного ЛС с разными ПУ (юрлицо: несколько точек учёта) — под общим
// заголовком ЛС; остальные — по одному, в порядке выдачи.
function groups(items: Found[]) {
  const out: { key: string; items: Found[] }[] = [];
  const byAccount = new Map<string, { key: string; items: Found[] }>();
  for (const f of items) {
    const key = f.account ? `${f.resId}/${f.account}` : `id${f.id}`;
    const g = byAccount.get(key);
    if (g) g.items.push(f);
    else { const n = { key, items: [f] }; byAccount.set(key, n); out.push(n); }
  }
  return out;
}

// Тарифные зоны: поля, которые у зон различаются (код ТУ, зона суток, мощность…).
// «№ п/п» — номер строки выгрузки, к потребителю отношения не имеет.
const shortLabel = (l: string) => { const i = l.lastIndexOf(' · '); return i < 0 ? l : l.slice(i + 3); };
const ROW_NUMBER = /^№\s*п\/п$/i;
function zoneDiff(zones: [string, string][][]) {
  const labels = [...new Set(zones.flatMap(z => z.map(([l]) => l)))];
  const value = (z: [string, string][], l: string) => z.find(([x]) => x === l)?.[1] ?? '';
  const differ = labels.filter(l => new Set(zones.map(z => value(z, l))).size > 1);
  // Порядок зон — по «Дифференциации по зонам суток» (1, 2, 3), если она есть.
  const zoneLabel = labels.find(l => /зонам суток/i.test(l));
  const order = zoneLabel ? [...zones].sort((a, b) => (Number(value(a, zoneLabel)) || 99) - (Number(value(b, zoneLabel)) || 99)) : zones;
  return { differ, shown: differ.filter(l => !ROW_NUMBER.test(shortLabel(l))), value, order };
}

// Поля по разделам шапки реестра: «Прибор учета · Номер счетчика» → раздел
// «Прибор учета», поле «Номер счетчика». Порядок разделов — как в файле.
function sections(cells: [string, string][]) {
  const out: { title: string; rows: [string, string][] }[] = [];
  for (const [label, value] of cells) {
    const cut = label.lastIndexOf(' · ');
    const title = cut > 0 ? label.slice(0, cut) : '';
    const name = cut > 0 ? label.slice(cut + 3) : label;
    let sec = out.find(x => x.title === title);
    if (!sec) { sec = { title, rows: [] }; out.push(sec); }
    sec.rows.push([name, value]);
  }
  return out;
}

// Координаты из реестра — сразу маршрут до потребителя (в телефоне — Навигатор).
function fieldValue(label: string, value: string) {
  const geo = /координат/i.test(label) ? parseCoords(value) : null;
  return geo ? <RouteLinks geo={geo} label={value} /> : value;
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
        {sections(card.zones.length > 1 ? card.cells.filter(([l]) => !zoneDiff(card.zones).differ.includes(l)) : card.cells).map(sec => (
          <section key={sec.title} className="cs-section">
            {sec.title && <h3 className="cs-section__title">{sec.title}</h3>}
            <dl className="cs-fields">
              {sec.rows.map(([label, value], i) => (
                <div key={i} className="cs-fields__row"><dt>{label}</dt><dd>{fieldValue(label, value)}</dd></div>
              ))}
            </dl>
          </section>
        ))}
      </Card>

      {card.zones.length > 1 && <ZonesCard zones={card.zones} />}

      {card.visits.length > 0 && (
        <Card title="Отметки по этому потребителю">
          <ul className="cs-history">
            {card.visits.map(v => (
              <li key={v.id}>
                <Badge tone={v.status === 'new' ? 'accent' : 'ok'}>{v.status === 'new' ? 'У инженера' : 'Завершена'}</Badge>
                <span>{fmtTime(v.createdAt)} · {v.author ?? 'монтёр'}</span>
                {v.geo && <a className="btn btn--secondary cs-route__btn cs-route__btn--navi" href={mapUrl(v.geo)} target="_blank" rel="noreferrer"><span className="btn__icon"><IconMap size={18} /></span><span>На карте</span></a>}
                {v.geo && <RouteLinks geo={v.geo} />}
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

// Строки реестра одного ПУ — тарифные зоны: общее показано в карточке выше,
// здесь — только то, чем зоны различаются.
function ZonesCard({ zones }: { zones: [string, string][][] }) {
  const { shown, value, order } = zoneDiff(zones);
  return (
    <Card title={`Тарифные зоны · ${zones.length}`} className="card--flush cs-zones">
      <div className="cs-zones__scroll">
        <table className="table">
          <thead><tr><th>Поле</th>{order.map((_, i) => <th key={i}>Зона {i + 1}</th>)}</tr></thead>
          <tbody>
            {shown.map(l => (
              <tr key={l}><td>{shortLabel(l)}</td>{order.map((z, i) => <td key={i}>{value(z, l) || '—'}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
