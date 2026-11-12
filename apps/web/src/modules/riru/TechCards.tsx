import { useEffect, useMemo, useState } from 'react';
import { api } from '../../auth/session.js';
import { Card, Empty, Input, PageHeader, useToast } from '../../ui/kit.js';
import { IconChevronDown, IconSearch } from '../../ui/icons.js';
import type { MenuItem, ModuleMeta } from '../registry.js';

// Технологические карты: по группам, карточка раскрывается на месте.
interface TechCard { id: number | string; group: string; title: string; fullTitle?: string; sections: { name: string; text: string }[] }

const GROUPS: { id: string; title: string }[] = [
  { id: 'install', title: 'Установка и замена оборудования' },
  { id: 'check', title: 'Проверка схем учёта' },
  { id: 'other', title: 'Прочие работы' },
];

export function TechCards({ module, page }: { module: ModuleMeta; page: MenuItem }) {
  const toast = useToast();
  const [cards, setCards] = useState<TechCard[] | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { api<TechCard[]>('/api/riru/techcards').then(setCards).catch(e => toast(e.message, 'error')); }, [toast]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (cards ?? []).filter(c => !q || [c.title, c.fullTitle, ...c.sections.map(s => s.text)].some(v => v?.toLowerCase().includes(q)));
  }, [cards, query]);

  return (
    <>
      <PageHeader crumbs={['ЭнергоСфера', module.title]} title={page.title}
        subtitle={cards ? `${cards.length} технологических карт: назначение, условия, подготовка, выполнение и завершение работ.` : page.about} />
      <div className="toolbar">
        <span className="search"><IconSearch size={18} /><Input placeholder="Поиск по картам" value={query} onChange={e => setQuery(e.target.value)} /></span>
      </div>
      {!cards ? <p className="muted">Загрузка…</p> : !shown.length ? <Card><Empty title="Ничего не найдено" /></Card> : GROUPS.map(g => {
        const list = shown.filter(c => c.group === g.id);
        if (!list.length) return null;
        return (
          <section key={g.id} className="tc-group">
            <h2 className="tc-group__title">{g.title}<span>{list.length}</span></h2>
            <div className="tc-list">
              {list.map(c => {
                const key = String(c.id);
                const expanded = open === key;
                return (
                  <Card key={key} className={`tc ${expanded ? 'is-open' : ''}`}>
                    <button type="button" className="tc__head" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : key)}>
                      <span className="tc__num">{c.id}</span>
                      <span className="tc__title">{c.title}</span>
                      <IconChevronDown size={20} />
                    </button>
                    {expanded && (
                      <div className="tc__body">
                        {c.fullTitle && <p className="tc__full">{c.fullTitle}</p>}
                        {c.sections.map(s => (
                          <section key={s.name} className="tc__section"><h3>{s.name}</h3><p>{s.text}</p></section>
                        ))}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
