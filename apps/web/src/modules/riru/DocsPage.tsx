import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthContext.js';
import { api, apiBlob } from '../../auth/session.js';
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, useToast } from '../../ui/kit.js';
import { IconDoc, IconDownload, IconPlus, IconSearch, IconTrash, IconUpload } from '../../ui/icons.js';
import type { MenuItem, ModuleMeta } from '../registry.js';

// Нормативные документы и законодательные акты (PDF). Открыть/скачать может
// каждый с доступом к разделу, добавлять и удалять — с правом riru.docs.
interface DocFile { title: string; size: number }
interface Doc { id: number; category: 'normative' | 'laws'; num: string; docDate: string | null; name: string; fullName: string | null; code: string | null; files: DocFile[] }

const CATEGORIES = { normative: 'Нормативные документы', laws: 'Законодательные акты' } as const;
type Category = keyof typeof CATEGORIES;
const mb = (n: number) => `${(n / 1048576).toFixed(n > 1048576 ? 1 : 2)} МБ`;
const fileUrl = (d: Doc, n: number) => `/api/riru/docs/${d.id}/files/${n}`;

export function DocsPage({ module, page }: { module: ModuleMeta; page: MenuItem }) {
  const { can } = useAuth();
  const toast = useToast();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [tab, setTab] = useState<Category>('normative');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<number | null>(null);

  const load = useCallback(() => { api<Doc[]>('/api/riru/docs').then(setDocs).catch(e => toast(e.message, 'error')); }, [toast]);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (docs ?? []).filter(d => d.category === tab
      && (!q || [d.num, d.name, d.fullName, d.code, d.docDate].some(v => v?.toLowerCase().includes(q))));
  }, [docs, tab, query]);

  // PDF открываем в новой вкладке: окно — сразу по клику (иначе браузер сочтёт
  // его всплывающим), файл — следом, с токеном. Нет окна — просто скачиваем.
  const openFile = async (d: Doc, n: number) => {
    const win = window.open('', '_blank');
    try {
      const url = URL.createObjectURL(await apiBlob(fileUrl(d, n)));
      if (win) win.location.href = url; else saveAs(url, d, n);
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (e) { win?.close(); toast((e as Error).message, 'error'); }
  };
  const download = async (d: Doc, n: number) => {
    try {
      const url = URL.createObjectURL(await apiBlob(`${fileUrl(d, n)}?download=1`));
      saveAs(url, d, n);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  const saveAs = (url: string, d: Doc, n: number) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${d.num} ${d.files[n]?.title ?? 'Документ'}.pdf`;
    a.click();
  };

  const remove = async (d: Doc) => {
    setConfirm(null);
    try { await api(`/api/riru/docs/${d.id}`, { method: 'DELETE' }); toast('Документ удалён'); load(); } catch (e) { toast((e as Error).message, 'error'); }
  };

  const counts = { normative: docs?.filter(d => d.category === 'normative').length ?? 0, laws: docs?.filter(d => d.category === 'laws').length ?? 0 };

  return (
    <>
      <PageHeader crumbs={['ЭнергоСфера', module.title]} title={page.title} subtitle="Внутренние регламенты ПАО «Россети Юг», федеральные законы и постановления — в PDF."
        actions={can('riru.docs') && !adding ? <Button variant="primary" icon={<IconPlus size={18} />} onClick={() => setAdding(true)}>Добавить документ</Button> : undefined} />
      {adding && <AddDoc category={tab} onDone={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}
      <div className="toolbar">
        <div className="tabs" role="tablist">
          {(Object.keys(CATEGORIES) as Category[]).map(c => (
            <button key={c} type="button" role="tab" aria-selected={tab === c} className={`tab ${tab === c ? 'is-active' : ''}`} onClick={() => setTab(c)}>
              {CATEGORIES[c]}<span className="tab__count">{counts[c]}</span>
            </button>
          ))}
        </div>
        <span className="search"><IconSearch size={18} /><Input placeholder="Номер, название, код" value={query} onChange={e => setQuery(e.target.value)} /></span>
      </div>
      {!docs ? <p className="muted">Загрузка…</p> : !shown.length ? <Card><Empty title="Документов не найдено" /></Card> : (
        <div className="docs">
          {shown.map(d => (
            <Card key={d.id} className="doc">
              <div className="doc__top">
                <span className="doc__icon"><IconDoc size={22} /></span>
                <span className="doc__num">{d.category === 'normative' ? `№ ${d.num}${d.docDate ? ` от ${d.docDate}` : ''}` : d.name}</span>
                {can('riru.docs') && (confirm === d.id
                  ? <Button variant="danger" onClick={() => remove(d)}>Удалить?</Button>
                  : <Button variant="ghost" icon={<IconTrash size={18} />} title="Удалить документ" aria-label="Удалить документ" onClick={() => setConfirm(d.id)} />)}
              </div>
              <h3 className="doc__name">{d.category === 'normative' ? d.name : d.fullName}</h3>
              {d.category === 'normative' && d.fullName && <p className="doc__full">{d.fullName}</p>}
              {d.code && <Badge>{d.code}</Badge>}
              <ul className="doc__files">
                {d.files.length ? d.files.map((f, n) => (
                  <li key={n}>
                    <button type="button" className="doc__file" onClick={() => openFile(d, n)}>
                      <span>{d.files.length > 1 ? f.title : 'Открыть документ'}</span><em>{mb(f.size)}</em>
                    </button>
                    <Button variant="ghost" icon={<IconDownload size={18} />} title="Скачать" aria-label="Скачать" onClick={() => download(d, n)} />
                  </li>
                )) : <li className="muted">Файл не загружен</li>}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function AddDoc({ category, onDone, onCancel }: { category: Category; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ category, num: '', docDate: '', name: '', fullName: '', code: '' });
  const [busy, setBusy] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const list = [...(files.current?.files ?? [])];
    if (list.some(f => f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf'))) { toast('Можно загрузить только PDF', 'error'); return; }
    setBusy(true);
    try {
      const { id } = await api<{ id: number }>('/api/riru/docs', { method: 'POST', json: form });
      for (const f of list) {
        const title = list.length > 1 ? f.name.replace(/\.pdf$/i, '') : 'Документ';
        await api(`/api/riru/docs/${id}/files`, {
          method: 'POST', body: f, headers: { 'Content-Type': 'application/pdf', 'X-File-Title': encodeURIComponent(title) },
        });
      }
      toast('Документ добавлен');
      onDone();
    } catch (err) { toast((err as Error).message, 'error'); setBusy(false); }
  };

  return (
    <Card title="Новый документ" className="doc-add">
      <form onSubmit={submit} className="doc-add__grid">
        <Field label="Раздел">
          <Select value={form.category} onChange={set('category')}>
            {(Object.keys(CATEGORIES) as Category[]).map(c => <option key={c} value={c}>{CATEGORIES[c]}</option>)}
          </Select>
        </Field>
        <Field label="Номер"><Input value={form.num} onChange={set('num')} required placeholder="например, 594" /></Field>
        <Field label="Дата"><Input value={form.docDate} onChange={set('docDate')} placeholder="03.10.2023" /></Field>
        <Field label="Краткое название"><Input value={form.name} onChange={set('name')} required /></Field>
        <Field label="Полное название"><Input value={form.fullName} onChange={set('fullName')} /></Field>
        <Field label="Код документа"><Input value={form.code} onChange={set('code')} /></Field>
        <Field label="Файлы PDF" hint="Несколько файлов — как приложения, названия берутся из имён файлов">
          <input ref={files} type="file" accept="application/pdf,.pdf" multiple className="input input--file" />
        </Field>
        <div className="doc-add__actions">
          <Button onClick={onCancel} disabled={busy}>Отменить</Button>
          <Button variant="primary" type="submit" icon={<IconUpload size={18} />} disabled={busy || !form.num.trim() || !form.name.trim()}>
            {busy ? 'Загружаем…' : 'Добавить'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
