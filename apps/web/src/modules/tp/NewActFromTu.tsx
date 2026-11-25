import { useEffect, useRef, useState } from 'react';
import { api } from '../../auth/session.js';
import { Badge, Button, Field, Input, Select, useToast } from '../../ui/kit.js';
import { IconUpload } from '../../ui/icons.js';

// «Новый акт по ТУ»: инженер развития загружает ТУ (PDF или Word) и, если есть, ПСУ. Из ТУ
// достаются реквизиты договора (запрос TP extract-tu), инженер их проверяет и жмёт
// «Создать» — по шагам: карточка договора (акт ТП или уведомление) → ТУ → ПСУ → поля
// карточки из ТУ (мощность, напряжение, фазность). Дальше — анкета акта (ActBuilder).

type Area = { id: string; name: string };
type Extracted = { fields: Record<'contractNumber' | 'contractDate' | 'applicant' | 'address', { value: string; status: string }>;
  card?: Record<string, { value: string; status: string }>; preparedFile?: { base64: string } };
type Step = { label: string; state: 'wait' | 'run' | 'ok' | 'fail' };

const CONTRACT = /^\d{5}-\d{2}-\d{8}-\d$/;
const normalize = (v: string) => v.replace(/ /g, ' ').replace(/[‐-―−]/g, '-').trim().replace(/\s*-\s*/g, '-');
const key = () => ({ 'Idempotency-Key': crypto.randomUUID() });
const STATUS: Record<string, string> = { FOUND: 'из ТУ', AMBIGUOUS: 'в ТУ несколько — выберите', NOT_FOUND: 'нет в ТУ — впишите', INVALID_FORMAT: 'проверьте формат' };

export function NewActFromTu({ onCreated }: { onCreated: (actId: string) => void }) {
  const toast = useToast();
  const [areas, setAreas] = useState<Area[] | null>(null);
  const [resId, setResId] = useState('');
  const [tu, setTu] = useState<File | null>(null);
  const [psu, setPsu] = useState<File | null>(null);
  const [report, setReport] = useState<Extracted | null>(null);
  const [reading, setReading] = useState(false);
  const [values, setValues] = useState({ contractNumber: '', contractDate: '', applicant: '', address: '' });
  const [actType, setActType] = useState<'ACT_TP' | 'NOTICE'>('ACT_TP');
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState('');
  const tuInput = useRef<HTMLInputElement>(null);
  const psuInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Area[]>('/tp/api/v1/act-builder/areas').then(a => { setAreas(a); if (a[0]) setResId(a[0].id); })
      .catch(e => { setAreas([]); toast(e.message, 'error'); });
  }, [toast]);

  // ТУ выбрали — читаем реквизиты
  const pickTu = async (file: File | undefined) => {
    if (!file) return;
    setTu(file); setReport(null); setError(''); setReading(true);
    try {
      const data = new FormData();
      data.append('resId', resId);
      data.append('file', file);
      const r = await api<Extracted>('/tp/api/v1/documents/extract-tu', { method: 'POST', body: data });
      // Word с ссылкой на локальный шаблон: сервер вернул очищенную копию — загружаем её
      if (r.preparedFile) setTu(new File([Uint8Array.from(atob(r.preparedFile.base64), c => c.charCodeAt(0))], file.name, { type: file.type }));
      setReport(r);
      setValues(v => ({
        contractNumber: r.fields.contractNumber.value || v.contractNumber, contractDate: r.fields.contractDate.value || v.contractDate,
        applicant: r.fields.applicant.value || v.applicant, address: r.fields.address.value || v.address,
      }));
    } catch (e) { setError((e as Error).message); } finally { setReading(false); }
  };

  const contractNumber = normalize(values.contractNumber);
  const ready = !!resId && !!tu && CONTRACT.test(contractNumber) && !!values.applicant.trim() && !!values.address.trim() && !steps?.some(s => s.state === 'run');

  const create = async () => {
    setError('');
    const plan: Step[] = [
      { label: `Карточка договора ${contractNumber}`, state: 'wait' },
      { label: 'ТУ', state: 'wait' },
      ...(psu ? [{ label: 'ПСУ', state: 'wait' as const }] : []),
      { label: 'Поля карточки из ТУ', state: 'wait' },
    ];
    setSteps(plan);
    let i = 0;
    const step = async <T,>(fn: () => Promise<T>) => {
      setSteps(s => s!.map((x, k) => (k === i ? { ...x, state: 'run' } : x)));
      try { const r = await fn(); setSteps(s => s!.map((x, k) => (k === i ? { ...x, state: 'ok' } : x))); i++; return r; }
      catch (e) { setSteps(s => s!.map((x, k) => (k === i ? { ...x, state: 'fail' } : x))); throw e; }
    };
    try {
      const act = await step(() => api<{ id: string }>('/tp/api/v1/acts', { method: 'POST', headers: key(),
        json: { resId, contractNumber, contractDate: values.contractDate || null, actNumber: contractNumber, applicant: values.applicant.trim(), address: values.address.trim(), actType } }));
      await step(() => { const d = new FormData(); d.append('documentType', 'TU'); d.append('file', tu!); return api(`/tp/api/v1/acts/${act.id}/files`, { method: 'POST', body: d }); });
      if (psu) await step(() => { const d = new FormData(); d.append('documentType', 'PSU'); d.append('file', psu); return api(`/tp/api/v1/acts/${act.id}/files`, { method: 'POST', body: d }); });
      await step(async () => {
        const card = Object.entries(report?.card ?? {}).filter(([, v]) => v?.value).map(([code, v]) => ({ code, value: v.value, origin: 'TU' as const }));
        if (card.length) await api(`/tp/api/v1/acts/${act.id}/card`, { method: 'POST', headers: key(), json: { values: card } });
      });
      toast(`Карточка ${contractNumber} создана — заполните акт`);
      onCreated(act.id);
    } catch (e) { setError((e as Error).message); }
  };

  if (!areas) return <p className="muted">Загрузка…</p>;
  if (!areas.length) return <p className="muted">Создавать акты может инженер развития своего РЭС. Если это вы — попросите администратора назначить роль и РЭС.</p>;
  const field = (name: keyof typeof values, label: string, type = 'text', wide = false) => {
    const st = report?.fields[name]?.status;
    return (
      <div className={wide ? 'ab-new__wide' : ''}>
        <Field label={label} hint={st ? STATUS[st] : undefined}>
          <Input type={type} value={values[name]} onChange={e => setValues(v => ({ ...v, [name]: e.target.value }))} />
        </Field>
      </div>
    );
  };

  return (
    <div className="ab-new">
      <div className="ab-new__files">
        {areas.length > 1 && (
          <Field label="РЭС"><Select value={resId} onChange={e => { setResId(e.target.value); setReport(null); }}>{areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        )}
        <div className="ab-drop">
          <b>ТУ</b><span className="muted">PDF или Word — реквизиты прочитаются сами</span>
          <Button icon={<IconUpload />} onClick={() => tuInput.current?.click()} disabled={reading}>{reading ? 'Читаю ТУ…' : tu ? 'Заменить ТУ' : 'Загрузить ТУ'}</Button>
          {tu && <span className="ab-drop__file">{tu.name}</span>}
          <input ref={tuInput} type="file" accept=".pdf,.docx" hidden onChange={e => { pickTu(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <div className="ab-drop">
          <b>ПСУ</b><span className="muted">PDF, если есть — приложится к договору</span>
          <Button variant="ghost" icon={<IconUpload />} onClick={() => psuInput.current?.click()}>{psu ? 'Заменить ПСУ' : 'Приложить ПСУ'}</Button>
          {psu && <span className="ab-drop__file">{psu.name} <button type="button" className="link" onClick={() => setPsu(null)}>убрать</button></span>}
          <input ref={psuInput} type="file" accept=".pdf" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f && !/\.pdf$/i.test(f.name)) { toast('ПСУ загружается в PDF', 'error'); return; } setPsu(f ?? null); }} />
        </div>
      </div>

      {tu && (
        <div className="ab-new__form">
          {field('contractNumber', 'Номер договора')}
          {field('contractDate', 'Дата договора', 'date')}
          <Field label="Документ">
            <Select value={actType} onChange={e => setActType(e.target.value as 'ACT_TP' | 'NOTICE')}>
              <option value="ACT_TP">Акт ТП</option><option value="NOTICE">Уведомление (ЭЦП)</option>
            </Select>
          </Field>
          {field('applicant', 'Заявитель', 'text', true)}
          {field('address', 'Адрес объекта', 'text', true)}
          {report?.card && Object.values(report.card).some(v => v?.value) && (
            <p className="ab-new__wide muted">Из ТУ: {[report.card.power_kw?.value && `мощность ${report.card.power_kw.value} кВт`, report.card.voltage_kv?.value && `${report.card.voltage_kv.value} кВ`, report.card.phases?.value].filter(Boolean).join(' · ')}</p>
          )}
        </div>
      )}
      {values.contractNumber && !CONTRACT.test(contractNumber) && <p className="error">Номер договора — в виде 10202-26-01086196-1.</p>}

      {steps && <ul className="ab-steps">{steps.map((s, k) => <li key={k} className={`is-${s.state}`}><Badge tone={s.state === 'ok' ? 'ok' : s.state === 'fail' ? 'danger' : 'neutral'}>{s.state === 'ok' ? 'готово' : s.state === 'fail' ? 'ошибка' : s.state === 'run' ? '…' : 'ждёт'}</Badge>{s.label}</li>)}</ul>}
      {error && <p className="error">{error}</p>}
      {tu && <div><Button variant="primary" onClick={create} disabled={!ready}>Создать карточку и заполнить акт</Button></div>}
    </div>
  );
}
