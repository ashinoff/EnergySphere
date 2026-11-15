import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext.js';
import { api } from '../../auth/session.js';
import { Badge, Button, Card, Empty, PageHeader, Progress, useToast } from '../../ui/kit.js';
import { IconFolder, IconUpload } from '../../ui/icons.js';
import type { MenuItem, ModuleMeta } from '../registry.js';
import { fmtTime, loadRes, type ResInfo } from './api.js';
import { chunks, parseRegistry, type ParsedRegistry } from './parse.js';

// Реестр потребителей у каждого РЭС свой. Инженер РИРУ загружает расширенный
// список своего РЭС: файл читается здесь же, в браузере, на сервер уходят только
// найденные строки. Новая загрузка целиком заменяет прежний реестр этого РЭС.
export function RegistryPage({ module, page }: { module: ModuleMeta; page: MenuItem }) {
  const { can } = useAuth();
  const toast = useToast();
  const [list, setList] = useState<ResInfo[] | null>(null);
  const load = useCallback(() => { loadRes().then(setList).catch(e => toast(e.message, 'error')); }, [toast]);
  useEffect(load, [load]);

  return (
    <>
      <PageHeader crumbs={['ЭнергоСфера', module.title]} title={page.title} subtitle={page.about} />
      {!list ? <p className="muted">Загрузка…</p> : !list.length ? <Card><Empty title="Нет доступных РЭС" /></Card> : (
        <div className="cs-registries">
          {list.map(r => <ResRegistry key={r.id} res={r} canUpload={can('consumers.registry')} onDone={load} />)}
        </div>
      )}
    </>
  );
}

type Step =
  | { phase: 'idle' }
  | { phase: 'reading'; name: string }
  | { phase: 'ready'; file: File; parsed: ParsedRegistry }
  | { phase: 'sending'; done: number; total: number };

function ResRegistry({ res, canUpload, onDone }: { res: ResInfo; canUpload: boolean; onDone: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ phase: 'idle' });

  const pick = async () => {
    const file = input.current?.files?.[0];
    if (input.current) input.current.value = '';
    if (!file) return;
    setStep({ phase: 'reading', name: file.name });
    try { setStep({ phase: 'ready', file, parsed: await parseRegistry(file) }); }
    catch (e) { toast((e as Error).message, 'error'); setStep({ phase: 'idle' }); }
  };

  const send = async (file: File, parsed: ParsedRegistry) => {
    setStep({ phase: 'sending', done: 0, total: parsed.rows.length });
    try {
      const { uploadId } = await api<{ uploadId: string }>(`/api/consumers/registry/${res.id}/start`, { method: 'POST', json: { fileName: file.name } });
      let done = 0;
      for (const part of chunks(parsed.rows)) {
        await api(`/api/consumers/registry/uploads/${uploadId}/rows`, { method: 'POST', json: { rows: part } });
        done += part.length;
        setStep({ phase: 'sending', done, total: parsed.rows.length });
      }
      const result = await api<{ rows: number }>(`/api/consumers/registry/uploads/${uploadId}/finish`, { method: 'POST' });
      toast(`Реестр ${res.name} обновлён: ${result.rows.toLocaleString('ru-RU')} строк`);
      setStep({ phase: 'idle' });
      onDone();
    } catch (e) { toast((e as Error).message, 'error'); setStep({ phase: 'idle' }); }
  };

  const reg = res.registry;
  return (
    <Card className="cs-registry">
      <div className="cs-registry__head">
        <h2 className="cs-registry__name">{res.name}</h2>
        {reg ? <Badge tone="ok">{reg.rows.toLocaleString('ru-RU')} строк</Badge> : <Badge tone="warn">не загружен</Badge>}
      </div>
      {reg ? (
        <p className="cs-registry__meta"><IconFolder size={16} />{reg.fileName} · {fmtTime(reg.uploadedAt)}{reg.uploadedBy ? ` · ${reg.uploadedBy}` : ''}</p>
      ) : <p className="muted">Поиск по этому РЭС заработает после загрузки расширенного списка.</p>}

      {step.phase === 'reading' && <p className="muted">Читаем «{step.name}»…</p>}
      {step.phase === 'ready' && (
        <div className="cs-registry__check">
          <p><b>{step.parsed.rows.length.toLocaleString('ru-RU')}</b> строк с № ПУ или ЛС
            {step.parsed.sheets.length > 1 ? ` на листах: ${step.parsed.sheets.join(', ')}` : ''}.</p>
          <ul className="cs-registry__cols">
            <li>№ ПУ — «{step.parsed.columns.meter}»</li>
            <li>ЛС — «{step.parsed.columns.account}»</li>
            {step.parsed.columns.name && <li>Потребитель — «{step.parsed.columns.name}»</li>}
            {step.parsed.columns.address && <li>Адрес — «{step.parsed.columns.address}»</li>}
          </ul>
          {step.parsed.skipped.length > 0 && <p className="muted">Пропущены листы без шапки реестра: {step.parsed.skipped.join(', ')}.</p>}
          <div className="cs-registry__actions">
            <Button onClick={() => setStep({ phase: 'idle' })}>Отменить</Button>
            <Button variant="primary" icon={<IconUpload size={18} />} onClick={() => send(step.file, step.parsed)}>
              {reg ? 'Заменить реестр' : 'Загрузить реестр'}
            </Button>
          </div>
        </div>
      )}
      {step.phase === 'sending' && (
        <div className="cs-registry__check">
          <p>Загружаем: {step.done.toLocaleString('ru-RU')} из {step.total.toLocaleString('ru-RU')}</p>
          <Progress value={step.done} total={step.total} />
        </div>
      )}

      {canUpload && step.phase === 'idle' && (
        <>
          <input ref={input} type="file" accept=".xls,.xlsx,.xlsm,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={pick} />
          <Button icon={<IconUpload size={18} />} onClick={() => input.current?.click()}>{reg ? 'Обновить реестр' : 'Выбрать файл'}</Button>
        </>
      )}
    </Card>
  );
}
