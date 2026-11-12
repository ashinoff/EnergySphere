import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext.js';
import { api } from '../../auth/session.js';
import { Badge, Button, Card, Checkbox, Empty, Input, PageHeader, Progress, TextArea, useToast } from '../../ui/kit.js';
import { IconBook, IconCheck, IconChevronDown, IconClock, IconEdit, IconPlus, IconTrash } from '../../ui/icons.js';
import type { MenuItem, ModuleMeta } from '../registry.js';

// Планы РИРУ: стратегический (год), тактический (месяц), оперативный (день).
// Отметки личные и действуют в пределах периода — новый период начинается с
// чистого листа. Тот, у кого riru.edit, правит план прямо на странице.

export type PlanKind = 'strategic' | 'tactical' | 'operational';
interface Task { id: string; title: string; desc?: string; deadline?: string; norm?: string }
interface Category { id: string; title: string; desc?: string; tasks: Task[] }
interface OpItem { id: string; title: string; desc?: string; req?: boolean }
interface OpSection { title: string; resp?: string; items: OpItem[] }
interface Phase { id: string; title: string; time?: string; sections: OpSection[] }
type PlanData = Category[] | Phase[];
interface PlanResponse { data: PlanData; period: { label: string; resets: string }; done: string[] }

const PREFIX: Record<PlanKind, string> = { strategic: 'С', tactical: 'Т', operational: 'О' };
const itemIds = (kind: PlanKind, data: PlanData) => kind === 'operational'
  ? (data as Phase[]).flatMap(p => p.sections.flatMap(s => s.items.map(i => i.id)))
  : (data as Category[]).flatMap(c => c.tasks.map(t => t.id));
const nextId = (kind: PlanKind, data: PlanData) => {
  const max = Math.max(0, ...itemIds(kind, data).map(i => Number(/(\d+)$/.exec(i)?.[1] ?? 0)));
  return `${PREFIX[kind]}-${String(max + 1).padStart(2, '0')}`;
};
const uid = () => Math.random().toString(36).slice(2, 9);

export function PlanPage({ kind, module, page }: { kind: PlanKind; module: ModuleMeta; page: MenuItem }) {
  const { can } = useAuth();
  const toast = useToast();
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [draft, setDraft] = useState<PlanData | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    api<PlanResponse>(`/api/riru/plan/${kind}`).then(setPlan).catch(e => toast(e.message, 'error'));
  }, [kind, toast]);
  useEffect(load, [load]);

  const done = useMemo(() => new Set(plan?.done ?? []), [plan]);
  const total = plan ? itemIds(kind, plan.data).length : 0;

  const toggle = async (itemId: string, value: boolean) => {
    setPlan(p => p && { ...p, done: value ? [...p.done, itemId] : p.done.filter(i => i !== itemId) });
    try { await api(`/api/riru/plan/${kind}/progress`, { method: 'POST', json: { itemId, done: value } }); } catch (e) {
      toast((e as Error).message, 'error'); load();
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await api(`/api/riru/plan/${kind}`, { method: 'PUT', json: { data: draft } });
      toast('План сохранён');
      setDraft(null);
      load();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setSaving(false); }
  };

  const editing = draft !== null;
  const actions = can('riru.edit') ? (editing ? <>
    <Button onClick={() => setDraft(null)} disabled={saving}>Отменить</Button>
    <Button variant="primary" icon={<IconCheck size={18} />} onClick={save} disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить план'}</Button>
  </> : <Button icon={<IconEdit size={18} />} onClick={() => plan && setDraft(structuredClone(plan.data))} disabled={!plan}>Редактировать</Button>) : null;

  return (
    <>
      <PageHeader crumbs={['ЭнергоСфера', module.title]} title={page.title} subtitle={page.about} actions={actions} />
      {!plan ? <p className="muted">Загрузка…</p> : (
        <>
          {!editing && (
            <Card className="plan-summary">
              <div className="plan-summary__row">
                <strong>Выполнено {done.size} из {total}</strong>
                <span className="muted">Отметки за {plan.period.label} · обновляются {plan.period.resets}</span>
              </div>
              <Progress value={done.size} total={total} />
            </Card>
          )}
          {editing && <p className="plan-hint muted">Правка плана: изменения увидят все после сохранения. Личные отметки сохраняются.</p>}
          {kind === 'operational'
            ? <Operational data={(draft ?? plan.data) as Phase[]} done={done} toggle={toggle} editing={editing}
                onChange={d => setDraft(d)} newId={() => nextId(kind, draft ?? [])} />
            : <Categories data={(draft ?? plan.data) as Category[]} done={done} toggle={toggle} editing={editing}
                open={open} setOpen={setOpen} onChange={d => setDraft(d)} newId={() => nextId(kind, draft ?? [])} />}
          {!editing && !total && <Empty title="План пока пуст" text={can('riru.edit') ? 'Нажмите «Редактировать», чтобы добавить пункты.' : undefined} />}
        </>
      )}
    </>
  );
}

function TaskMeta({ deadline, norm }: { deadline?: string; norm?: string }) {
  if (!deadline && !norm) return null;
  return (
    <span className="task__meta">
      {deadline && <span><IconClock size={15} />{deadline}</span>}
      {norm && <span><IconBook size={15} />{norm}</span>}
    </span>
  );
}

// ── Стратегический и тактический: направления → задачи ────────────────
function Categories({ data, done, toggle, editing, open, setOpen, onChange, newId }: {
  data: Category[]; done: Set<string>; toggle: (id: string, v: boolean) => void; editing: boolean;
  open: Set<string>; setOpen: (s: Set<string>) => void; onChange: (d: Category[]) => void; newId: () => string;
}) {
  const update = (ci: number, patch: Partial<Category>) => onChange(data.map((c, i) => (i === ci ? { ...c, ...patch } : c)));
  const updateTask = (ci: number, ti: number, patch: Partial<Task>) =>
    update(ci, { tasks: data[ci].tasks.map((t, i) => (i === ti ? { ...t, ...patch } : t)) });

  return (
    <div className="plan-grid">
      {data.map((c, ci) => {
        const doneCount = c.tasks.filter(t => done.has(t.id)).length;
        const expanded = editing || open.has(c.id);
        return (
          <Card key={c.id} className={`plan-cat ${expanded ? 'is-open' : ''}`}>
            {editing ? (
              <div className="edit-head">
                <Input value={c.title} placeholder="Направление" aria-label="Название направления" onChange={e => update(ci, { title: e.target.value })} />
                <TextArea value={c.desc ?? ''} placeholder="Описание (необязательно)" aria-label="Описание направления" onChange={e => update(ci, { desc: e.target.value })} />
                <Button variant="ghost" icon={<IconTrash size={18} />} title="Удалить направление" aria-label="Удалить направление"
                  onClick={() => onChange(data.filter((_, i) => i !== ci))} />
              </div>
            ) : (
              <button type="button" className="plan-cat__head" aria-expanded={expanded}
                onClick={() => { const n = new Set(open); expanded ? n.delete(c.id) : n.add(c.id); setOpen(n); }}>
                <span className="plan-cat__title">{c.title}</span>
                <span className="plan-cat__count">{doneCount}/{c.tasks.length}<IconChevronDown size={18} /></span>
                {c.desc && <span className="plan-cat__desc">{c.desc}</span>}
                <Progress value={doneCount} total={c.tasks.length} />
              </button>
            )}
            {expanded && (
              <ul className="tasks">
                {c.tasks.map((t, ti) => editing ? (
                  <li key={t.id} className="task task--edit">
                    <span className="task__id">{t.id}</span>
                    <div className="task__fields">
                      <Input value={t.title} placeholder="Задача" aria-label="Задача" onChange={e => updateTask(ci, ti, { title: e.target.value })} />
                      <TextArea value={t.desc ?? ''} placeholder="Что сделать" aria-label="Описание" onChange={e => updateTask(ci, ti, { desc: e.target.value })} />
                      <div className="task__pair">
                        <Input value={t.deadline ?? ''} placeholder="Срок" aria-label="Срок" onChange={e => updateTask(ci, ti, { deadline: e.target.value })} />
                        <Input value={t.norm ?? ''} placeholder="Норматив" aria-label="Норматив" onChange={e => updateTask(ci, ti, { norm: e.target.value })} />
                      </div>
                    </div>
                    <Button variant="ghost" icon={<IconTrash size={18} />} title="Удалить задачу" aria-label="Удалить задачу"
                      onClick={() => update(ci, { tasks: c.tasks.filter((_, i) => i !== ti) })} />
                  </li>
                ) : (
                  <li key={t.id} className={`task ${done.has(t.id) ? 'is-done' : ''}`}>
                    <Checkbox checked={done.has(t.id)} onChange={v => toggle(t.id, v)} label={t.title} />
                    <div className="task__body">
                      <span className="task__title"><em>{t.id}</em>{t.title}</span>
                      {t.desc && <span className="task__desc">{t.desc}</span>}
                      <TaskMeta deadline={t.deadline} norm={t.norm} />
                    </div>
                  </li>
                ))}
                {editing && (
                  <li><Button icon={<IconPlus size={18} />} onClick={() => update(ci, { tasks: [...c.tasks, { id: newId(), title: '' }] })}>Добавить задачу</Button></li>
                )}
              </ul>
            )}
          </Card>
        );
      })}
      {editing && (
        <Button icon={<IconPlus size={18} />} className="plan-add"
          onClick={() => onChange([...data, { id: `cat-${uid()}`, title: '', tasks: [] }])}>Добавить направление</Button>
      )}
    </div>
  );
}

// ── Оперативный: этапы дня → разделы → действия ───────────────────────
function Operational({ data, done, toggle, editing, onChange, newId }: {
  data: Phase[]; done: Set<string>; toggle: (id: string, v: boolean) => void; editing: boolean;
  onChange: (d: Phase[]) => void; newId: () => string;
}) {
  const setPhase = (pi: number, patch: Partial<Phase>) => onChange(data.map((p, i) => (i === pi ? { ...p, ...patch } : p)));
  const setSection = (pi: number, si: number, patch: Partial<OpSection>) =>
    setPhase(pi, { sections: data[pi].sections.map((s, i) => (i === si ? { ...s, ...patch } : s)) });
  const setItem = (pi: number, si: number, ii: number, patch: Partial<OpItem>) =>
    setSection(pi, si, { items: data[pi].sections[si].items.map((it, i) => (i === ii ? { ...it, ...patch } : it)) });

  return (
    <div className="phases">
      {data.map((p, pi) => {
        const ids = p.sections.flatMap(s => s.items.map(i => i.id));
        const doneCount = ids.filter(i => done.has(i)).length;
        return (
          <Card key={p.id} className="phase">
            {editing ? (
              <div className="edit-head edit-head--phase">
                <Input value={p.title} placeholder="Этап дня" aria-label="Этап дня" onChange={e => setPhase(pi, { title: e.target.value })} />
                <Input value={p.time ?? ''} placeholder="Время, например 07:30–10:00" aria-label="Время" onChange={e => setPhase(pi, { time: e.target.value })} />
                <Button variant="ghost" icon={<IconTrash size={18} />} title="Удалить этап" aria-label="Удалить этап"
                  onClick={() => onChange(data.filter((_, i) => i !== pi))} />
              </div>
            ) : (
              <header className="phase__head">
                <h2>{p.title}</h2>
                {p.time && <Badge>{p.time}</Badge>}
                <span className="phase__count">{doneCount}/{ids.length}</span>
              </header>
            )}
            {p.sections.map((s, si) => (
              <section key={si} className="op-section">
                {editing ? (
                  <div className="edit-head">
                    <Input value={s.title} placeholder="Раздел" aria-label="Раздел" onChange={e => setSection(pi, si, { title: e.target.value })} />
                    <Input value={s.resp ?? ''} placeholder="Ответственный" aria-label="Ответственный" onChange={e => setSection(pi, si, { resp: e.target.value })} />
                    <Button variant="ghost" icon={<IconTrash size={18} />} title="Удалить раздел" aria-label="Удалить раздел"
                      onClick={() => setPhase(pi, { sections: p.sections.filter((_, i) => i !== si) })} />
                  </div>
                ) : (
                  <h3 className="op-section__title">{s.title}{s.resp && <span>{s.resp}</span>}</h3>
                )}
                <ul className="tasks">
                  {s.items.map((it, ii) => editing ? (
                    <li key={it.id} className="task task--edit">
                      <span className="task__id">{it.id}</span>
                      <div className="task__fields">
                        <Input value={it.title} placeholder="Действие" aria-label="Действие" onChange={e => setItem(pi, si, ii, { title: e.target.value })} />
                        <TextArea value={it.desc ?? ''} placeholder="Пояснение" aria-label="Пояснение" onChange={e => setItem(pi, si, ii, { desc: e.target.value })} />
                        <label className="task__req"><Checkbox checked={!!it.req} onChange={v => setItem(pi, si, ii, { req: v })} /> обязательно</label>
                      </div>
                      <Button variant="ghost" icon={<IconTrash size={18} />} title="Удалить действие" aria-label="Удалить действие"
                        onClick={() => setSection(pi, si, { items: s.items.filter((_, i) => i !== ii) })} />
                    </li>
                  ) : (
                    <li key={it.id} className={`task ${done.has(it.id) ? 'is-done' : ''}`}>
                      <Checkbox checked={done.has(it.id)} onChange={v => toggle(it.id, v)} label={it.title} />
                      <div className="task__body">
                        <span className="task__title"><em>{it.id}</em>{it.title}{it.req && <Badge tone="warn">обязательно</Badge>}</span>
                        {it.desc && <span className="task__desc">{it.desc}</span>}
                      </div>
                    </li>
                  ))}
                  {editing && (
                    <li><Button icon={<IconPlus size={18} />} onClick={() => setSection(pi, si, { items: [...s.items, { id: newId(), title: '' }] })}>Добавить действие</Button></li>
                  )}
                </ul>
              </section>
            ))}
            {editing && (
              <Button icon={<IconPlus size={18} />} onClick={() => setPhase(pi, { sections: [...p.sections, { title: '', items: [] }] })}>Добавить раздел</Button>
            )}
          </Card>
        );
      })}
      {editing && (
        <Button icon={<IconPlus size={18} />} className="plan-add"
          onClick={() => onChange([...data, { id: `phase-${uid()}`, title: '', sections: [] }])}>Добавить этап дня</Button>
      )}
    </div>
  );
}
