import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  LOCKED_ROLE, PERMISSIONS, PERMISSION_GROUPS, PERMISSION_IDS, ROLES, ROLE_IDS,
  type Permission, type PermissionGroup, type Role,
} from '../../../api/src/core/access.js';
import { useAuth, useMe } from '../auth/AuthContext.js';
import { api } from '../auth/session.js';
import { Badge, Button, Card, Checkbox, Empty, Input, PageHeader, Select, Switch, useToast } from '../ui/kit.js';
import { IconCheck, IconPlus, IconSearch, IconTrash } from '../ui/icons.js';

interface Res { id: number; name: string; sort: number }
interface UserRow {
  id: number; username: string | null; email: string | null; fullName: string | null;
  role: Role | null; resId: number | null; resName: string | null; extraPermissions: Permission[];
  isActive: boolean; isSuper: boolean; lastLoginAt: string | null;
}
type Matrix = Record<Role, Permission[]>;

const GROUPS = Object.keys(PERMISSION_GROUPS) as PermissionGroup[];
const permsOf = (group: PermissionGroup) => PERMISSION_IDS.filter(p => PERMISSIONS[p].group === group);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export function AdminPage({ page }: { page: string }) {
  if (page === 'roles') return <RolesPage />;
  if (page === 'res') return <ResPage />;
  return <UsersPage />;
}

// ── Пользователи ──────────────────────────────────────────────────────
function UsersPage() {
  const me = useMe();
  const { can, reload: reloadMe } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [res, setRes] = useState<Res[]>([]);
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'blocked'>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<number, { role: Role | null; resId: number | null }>>({});

  const load = useCallback(() => {
    Promise.all([
      api<UserRow[]>('/api/admin/users'),
      api<Res[]>('/api/res'),
      can('admin.permissions') ? api<Matrix>('/api/admin/roles') : Promise.resolve(null),
    ]).then(([u, r, m]) => { setUsers(u); setRes(r); setMatrix(m); })
      .catch(e => toast(e.message, 'error'));
  }, [can, toast]);
  useEffect(load, [load]);

  const patch = async (user: UserRow, body: Record<string, unknown>) => {
    try {
      await api(`/api/admin/users/${user.id}`, { method: 'PATCH', json: body });
      setDraft(d => { const n = { ...d }; delete n[user.id]; return n; });
      toast('Сохранено');
      if (user.id === me.id) reloadMe();
      load();
    } catch (e) { toast((e as Error).message, 'error'); load(); }
  };

  const setRoleOrRes = (user: UserRow, next: { role?: Role | null; resId?: number | null }) => {
    const cur = draft[user.id] ?? { role: user.role, resId: user.resId };
    const merged = { ...cur, ...next };
    const needsRes = merged.role && ROLES[merged.role].scope === 'res';
    if (needsRes && !merged.resId) {
      setDraft(d => ({ ...d, [user.id]: merged }));
      toast(`Для роли «${ROLES[merged.role!].title}» выберите РЭС`, 'error');
      return;
    }
    void patch(user, merged);
  };

  const counts = useMemo(() => ({
    all: users?.length ?? 0,
    pending: users?.filter(u => !u.role && !u.isSuper).length ?? 0,
    blocked: users?.filter(u => !u.isActive).length ?? 0,
  }), [users]);

  const shown = (users ?? []).filter(u =>
    (filter === 'all' || (filter === 'pending' ? !u.role && !u.isSuper : !u.isActive))
    && (!query || [u.fullName, u.username, u.email, u.resName].some(v => v?.toLowerCase().includes(query.toLowerCase()))));

  const canAdmin = me.isSuper || me.role === LOCKED_ROLE;

  return (
    <>
      <PageHeader crumbs={['ЭнергоСфера', 'Администрирование']} title="Пользователи"
        subtitle="Сотрудник появляется здесь после первого входа через платформу. Назначьте роль и РЭС — доступ откроется сразу." />
      <div className="toolbar">
        <div className="tabs" role="tablist">
          {([['all', 'Все'], ['pending', 'Ожидают роли'], ['blocked', 'Заблокированы']] as const).map(([id, title]) => (
            <button key={id} type="button" role="tab" aria-selected={filter === id} className={`tab ${filter === id ? 'is-active' : ''}`}
              onClick={() => setFilter(id)}>{title}<span className="tab__count">{counts[id]}</span></button>
          ))}
        </div>
        <span className="search"><IconSearch size={18} /><Input placeholder="ФИО, логин, e-mail, РЭС" value={query} onChange={e => setQuery(e.target.value)} /></span>
      </div>
      <Card className="card--flush">
        {users === null ? <p className="muted pad">Загрузка…</p> : !shown.length ? (
          <Empty title={filter === 'pending' ? 'Все сотрудники распределены' : 'Никого не найдено'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Сотрудник</th><th>Роль</th><th>РЭС</th><th>Доступ</th><th>Последний вход</th><th /></tr></thead>
              <tbody>
                {shown.map(u => {
                  const d = draft[u.id] ?? { role: u.role, resId: u.resId };
                  const allRes = d.role ? ROLES[d.role].scope === 'all' : false;
                  const locked = u.isSuper || (!canAdmin && u.role === LOCKED_ROLE) || (u.id === me.id && !me.isSuper);
                  const extra = u.extraPermissions ?? [];
                  return (
                    <Fragment key={u.id}>
                      <tr className={!u.role && !u.isSuper ? 'is-pending' : ''}>
                        <td>
                          <div className="who"><strong>{u.fullName || u.username}</strong>
                            <span>{[u.username, u.email].filter(Boolean).join(' · ')}</span></div>
                          {u.isSuper && <Badge tone="accent">Суперадмин</Badge>}
                          {!u.role && !u.isSuper && <Badge tone="warn">Ожидает роли</Badge>}
                        </td>
                        <td>
                          <Select value={d.role ?? ''} disabled={locked} aria-label="Роль"
                            onChange={e => setRoleOrRes(u, { role: (e.target.value || null) as Role | null })}>
                            <option value="">— не назначена —</option>
                            {ROLE_IDS.filter(r => r !== LOCKED_ROLE || canAdmin).map(r => <option key={r} value={r}>{ROLES[r].title}</option>)}
                          </Select>
                        </td>
                        <td>
                          {allRes ? <span className="muted">Все РЭС</span> : (
                            <Select value={d.resId ?? ''} disabled={locked} aria-label="РЭС"
                              className={draft[u.id] && !d.resId ? 'is-invalid' : ''}
                              onChange={e => setRoleOrRes(u, { resId: e.target.value ? Number(e.target.value) : null })}>
                              <option value="">— выберите РЭС —</option>
                              {res.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </Select>
                          )}
                        </td>
                        <td><Switch checked={u.isActive} disabled={locked} label={u.isActive ? 'Доступ открыт' : 'Заблокирован'}
                          onChange={v => void patch(u, { isActive: v })} /></td>
                        <td className="muted nowrap">{fmtDate(u.lastLoginAt)}</td>
                        <td className="nowrap">
                          {matrix && !u.isSuper && (
                            <Button variant="ghost" disabled={locked} onClick={() => setOpen(open === u.id ? null : u.id)}>
                              Доп. права{extra.length ? ` (${extra.length})` : ''}
                            </Button>
                          )}
                        </td>
                      </tr>
                      {open === u.id && matrix && (
                        <tr className="row-expand"><td colSpan={6}>
                          <ExtraPermissions role={u.role} matrix={matrix} extra={extra}
                            onSave={perms => { setOpen(null); void patch(u, { extraPermissions: perms }); }} />
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function ExtraPermissions({ role, matrix, extra, onSave }: { role: Role | null; matrix: Matrix; extra: Permission[]; onSave: (p: Permission[]) => void }) {
  const [value, setValue] = useState(new Set(extra));
  const fromRole = new Set(role ? matrix[role] : []);
  return (
    <div className="extra">
      <p className="muted">Права роли отмечены и недоступны для снятия — их меняют в «Правах ролей». Здесь — дополнительно лично этому сотруднику.</p>
      <div className="extra__groups">
        {GROUPS.map(g => (
          <div key={g} className="extra__group">
            <h4>{PERMISSION_GROUPS[g]}</h4>
            {permsOf(g).map(p => (
              <label key={p} className="extra__item">
                <Checkbox checked={fromRole.has(p) || value.has(p)} disabled={fromRole.has(p)}
                  onChange={on => setValue(s => { const n = new Set(s); on ? n.add(p) : n.delete(p); return n; })} />
                <span>{PERMISSIONS[p].title}{fromRole.has(p) && <em> · по роли</em>}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
      <Button variant="primary" icon={<IconCheck size={18} />} onClick={() => onSave([...value].filter(p => !fromRole.has(p)))}>Сохранить права</Button>
    </div>
  );
}

// ── Матрица «роль × право» ───────────────────────────────────────────
function RolesPage() {
  const toast = useToast();
  const { reload: reloadMe } = useAuth();
  const [saved, setSaved] = useState<Matrix | null>(null);
  const [edit, setEdit] = useState<Matrix | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Matrix>('/api/admin/roles').then(m => { setSaved(m); setEdit(m); }).catch(e => toast(e.message, 'error'));
  }, [toast]);
  useEffect(load, [load]);

  const dirty = useMemo(() => saved && edit
    ? ROLE_IDS.filter(r => [...saved[r]].sort().join() !== [...edit[r]].sort().join()) : [], [saved, edit]);

  const toggle = (role: Role, p: Permission, on: boolean) =>
    setEdit(m => m && ({ ...m, [role]: on ? [...m[role], p] : m[role].filter(x => x !== p) }));

  const save = async () => {
    setBusy(true);
    try {
      for (const role of dirty) await api(`/api/admin/roles/${role}`, { method: 'PUT', json: { permissions: edit![role] } });
      toast('Права ролей сохранены — действуют в течение 30 секунд');
      reloadMe();
      load();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader crumbs={['ЭнергоСфера', 'Администрирование']} title="Права ролей"
        subtitle="Роль определяет, какие РЭС видит сотрудник; отметки ниже — что он может делать в каждом разделе."
        actions={<>
          <Button disabled={!dirty.length || busy} onClick={() => setEdit(saved)}>Отменить</Button>
          <Button variant="primary" icon={<IconCheck size={18} />} disabled={!dirty.length || busy} onClick={save}>
            {busy ? 'Сохраняем…' : dirty.length ? `Сохранить (${dirty.length})` : 'Сохранить'}
          </Button>
        </>} />
      <Card className="card--flush">
        {!edit ? <p className="muted pad">Загрузка…</p> : (
          <div className="table-wrap">
            <table className="table matrix">
              <thead>
                <tr>
                  <th className="matrix__perm">Право</th>
                  {ROLE_IDS.map(r => (
                    <th key={r} className={`matrix__role ${dirty.includes(r) ? 'is-dirty' : ''}`}>
                      <span>{ROLES[r].title}</span>
                      <em>{ROLES[r].scope === 'all' ? 'все РЭС' : 'свой РЭС'}</em>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GROUPS.map(g => (
                  <Fragment key={g}>
                    <tr className="matrix__group"><td colSpan={ROLE_IDS.length + 1}>{PERMISSION_GROUPS[g]}</td></tr>
                    {permsOf(g).map(p => (
                      <tr key={p}>
                        <td className="matrix__perm">{PERMISSIONS[p].title}</td>
                        {ROLE_IDS.map(r => (
                          <td key={r} className="matrix__cell">
                            <Checkbox checked={edit[r].includes(p)} disabled={r === LOCKED_ROLE}
                              label={`${ROLES[r].title}: ${PERMISSIONS[p].title}`} onChange={on => toggle(r, p, on)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

// ── Справочник РЭС ────────────────────────────────────────────────────
function ResPage() {
  const toast = useToast();
  const [list, setList] = useState<Res[] | null>(null);
  const [names, setNames] = useState<Record<number, string>>({});
  const [added, setAdded] = useState('');
  const [confirm, setConfirm] = useState<number | null>(null);

  const load = useCallback(() => { api<Res[]>('/api/res').then(r => { setList(r); setNames({}); }).catch(e => toast(e.message, 'error')); }, [toast]);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok); load(); } catch (e) { toast((e as Error).message, 'error'); }
  };

  return (
    <>
      <PageHeader crumbs={['ЭнергоСфера', 'Администрирование']} title="Список РЭС"
        subtitle="РЭС, по которым разграничивается доступ сотрудников с ролью «свой РЭС»." />
      <Card className="card--narrow">
        {!list ? <p className="muted">Загрузка…</p> : (
          <ul className="res-list">
            {list.map(r => {
              const name = names[r.id] ?? r.name;
              return (
                <li key={r.id}>
                  <Input value={name} aria-label="Название РЭС" onChange={e => setNames(n => ({ ...n, [r.id]: e.target.value }))} />
                  {name !== r.name && (
                    <Button variant="primary" icon={<IconCheck size={18} />}
                      onClick={() => run(() => api(`/api/admin/res/${r.id}`, { method: 'PATCH', json: { name } }), 'Переименовано')}>Сохранить</Button>
                  )}
                  {confirm === r.id ? (
                    <Button variant="danger" onClick={() => { setConfirm(null); void run(() => api(`/api/admin/res/${r.id}`, { method: 'DELETE' }), 'РЭС удалён'); }}>
                      Точно удалить?
                    </Button>
                  ) : (
                    <Button variant="ghost" icon={<IconTrash size={18} />} aria-label="Удалить" title="Удалить" onClick={() => setConfirm(r.id)} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <form className="res-add" onSubmit={e => {
          e.preventDefault();
          if (added.trim()) void run(() => api('/api/admin/res', { method: 'POST', json: { name: added.trim() } }), 'РЭС добавлен').then(() => setAdded(''));
        }}>
          <Input placeholder="Новый РЭС, например «Адлерский РЭС»" value={added} onChange={e => setAdded(e.target.value)} />
          <Button variant="primary" type="submit" icon={<IconPlus size={18} />} disabled={!added.trim()}>Добавить</Button>
        </form>
      </Card>
    </>
  );
}
