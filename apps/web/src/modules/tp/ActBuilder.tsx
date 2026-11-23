import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, apiFetch } from '../../auth/session.js';
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, TextArea, useToast } from '../../ui/kit.js';
import { IconCheckCircle, IconDownload, IconUpload } from '../../ui/icons.js';
import type { MenuItem, ModuleMeta } from '../registry.js';

// «Создание акта по ТУ»: акт ТП / уведомление из шаблонов отдела по карточке договора.
// Анкета заполняется из карточки и ТУ (сервер: modules/tp/acts), инженер проверяет,
// дописывает своё (№ акта, стоимость, кабель, монтёр), выбирает подписанта и ПУ
// (из «Учёт ПУ» или вручную). «Сформировать» — Word уходит версией акта в маршрут
// обычными запросами TP (файл → версия), уведомление ЭЦП — скачивается.

const BASE = '/tp/api/v1/act-builder';

type Kind = 'paper' | 'ecp' | 'change';
type Point = 'pole' | 'pole_low' | 'pole_line' | 'ru' | 'vu';
type Metering = 'direct' | 'ct';
type Template = { id: string; title: string; kind: Kind; point: Point; metering: Metering; power?: 'le15' | 'gt15'; request?: 'new' | 'increase'; losses?: boolean; fields: string[]; extra: string[] };
type FieldInfo = { name: string; label: string; source: 'tu' | 'engineer' | 'meter' | 'computed'; input: { path: string; type: 'text' | 'number' | 'date' | 'int' | 'long' } | null };
type Attorney = { number: string; date: string; person: string; position: string; validUntil: string | null; expired: boolean; phrase: string; signature: string };
type Catalog = { templates: Template[]; kinds: Record<Kind, string>; points: Record<Point, string>; meterings: Record<Metering, string>; fields: FieldInfo[]; attorneys: Attorney[]; cableBrands: string[]; svetlyachok: boolean };
type ActRow = { id: string; res_name: string; act_type: string; state: string; contract_number: string; contract_date: string; applicant: string; address: string; has_tu: boolean; versions: number };
type Input = Record<string, unknown> & { meter?: Record<string, unknown>; ct?: Record<string, unknown>; overrides?: Record<string, string> };
type Prefill = { act: { id: string; actType: string; contractNumber: string }; input: Input; tu: Record<string, unknown> & { note?: string; pointText?: string }; suggestion: { kind: Kind; point: Point | null; metering: Metering } };
type Losses = { input: { powerKw: number; lengthM: number; sectionMm2: number; material: 'Al' | 'Cu' }; result: { yearKwh: number; yearPercent: number; monthAvgKwh: number; resistanceOhm: number } };
type Preview = { computed: Record<string, string | undefined>; losses: Losses | null };
type Meter = Record<string, unknown>;
type Choice = { kind: Kind; point: Point; metering: Metering; request: 'new' | 'increase' };

const STATES: Record<string, string> = { DRAFT: 'Черновик', RETURNED: 'Возвращён', REVISING: 'На доработке' };
const SOURCE_TITLES = { tu: 'Из ТУ и договора', engineer: 'Заполняет инженер', meter: 'Прибор учёта и ТТ' } as const;
const fmt = (n: number, d = 2) => n.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
const day = (iso: string) => iso ? iso.slice(0, 10).split('-').reverse().join('.') : '';

const getPath = (o: Input, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], o);
function setPath(o: Input, path: string, value: unknown): Input {
  const [head, tail] = path.split('.');
  if (!tail) return { ...o, [head]: value };
  return { ...o, [head]: { ...(o[head] as Record<string, unknown> | undefined), [tail]: value } };
}
/** Шаблон по выбору инженера (как pickTemplates на сервере). */
function pickTemplate(list: Template[], c: Choice, powerKw?: number): Template | null {
  const base = list.filter(t => t.kind === c.kind && t.point === c.point && t.metering === c.metering);
  const power = powerKw == null || Number.isNaN(powerKw) ? undefined : powerKw <= 15 ? 'le15' : 'gt15';
  const byPower = power ? base.filter(t => !t.power || t.power === power) : base;
  const byRequest = byPower.filter(t => !t.request || t.request === c.request);
  return byRequest[0] ?? byPower[0] ?? base[0] ?? null;
}

// Пиктограммы точек присоединения: опора, ПУ на ней, линия к дому, ТП, ВУ.
const POINT_ICONS: Record<Point, ReactNode> = {
  pole: <><path d="M20 6v36M13 12h14" /><rect x="22" y="15" width="10" height="9" rx="1.5" /><path d="M27 24v4" /></>,
  pole_low: <><path d="M20 6v36M13 12h14" /><rect x="22" y="28" width="10" height="9" rx="1.5" /><path d="M20 15c3 2 5 7 7 13" /></>,
  pole_line: <><path d="M10 6v36M4 12h12" /><path d="M10 13c8 2 14 6 20 11" /><path d="M27 42V27l8-6 8 6v15z" /><rect x="32" y="31" width="6" height="5" rx="1" /></>,
  ru: <><rect x="6" y="12" width="20" height="26" rx="2" /><path d="M11 20h10M11 26h10M16 12V6" /><path d="M26 30c6 0 8 2 12 6" /><rect x="35" y="33" width="8" height="7" rx="1.5" /></>,
  vu: <><rect x="6" y="14" width="16" height="22" rx="2" /><path d="M10 21h8M10 27h8" /><path d="M22 28c6 0 8 2 12 6" /><rect x="32" y="31" width="10" height="8" rx="1.5" /><path d="M14 14V8" /></>,
};

export function ActBuilder({ module, page }: { module: ModuleMeta; page: MenuItem }) {
  const toast = useToast();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [acts, setActs] = useState<ActRow[] | null>(null);
  const [actId, setActId] = useState('');
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [input, setInput] = useState<Input>({});
  const [choice, setChoice] = useState<Choice>({ kind: 'paper', point: 'pole', metering: 'direct', request: 'new' });
  const [attorney, setAttorney] = useState('');
  const [lossesOverride, setLossesOverride] = useState<{ material?: 'Al' | 'Cu' }>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [meters, setMeters] = useState<Meter[] | null>(null);
  const [busy, setBusy] = useState<'' | 'download' | 'send' | 'meters'>('');
  const [confirmMissing, setConfirmMissing] = useState(false);
  const [saved, setSaved] = useState<{ version: number } | null>(null);

  const loadActs = useCallback(() => api<ActRow[]>(`${BASE}/acts`).then(setActs).catch(e => { setActs([]); toast(e.message, 'error'); }), [toast]);
  useEffect(() => {
    api<Catalog>(`${BASE}/catalog`).then(c => { setCatalog(c); const valid = c.attorneys.filter(a => !a.expired); if (valid.length === 1) setAttorney(valid[0].number); })
      .catch(e => toast(e.message, 'error'));
    loadActs();
  }, [toast, loadActs]);

  const open = async (id: string) => {
    setActId(id); setPrefill(null); setMeters(null); setSaved(null); setConfirmMissing(false);
    if (!id) return;
    try {
      const p = await api<Prefill>(`${BASE}/acts/${id}/prefill`);
      setPrefill(p); setInput(p.input);
      setChoice(c => ({ ...c, kind: p.suggestion.kind, point: p.suggestion.point ?? c.point, metering: p.suggestion.metering }));
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  const template = useMemo(() => catalog ? pickTemplate(catalog.templates, choice, Number(input.powerAllowedKw)) : null, [catalog, choice, input.powerAllowedKw]);
  const points = useMemo(() => catalog ? [...new Set(catalog.templates.filter(t => t.kind === choice.kind).map(t => t.point))] : [], [catalog, choice.kind]);
  const meterings = useMemo(() => catalog ? [...new Set(catalog.templates.filter(t => t.kind === choice.kind && t.point === choice.point).map(t => t.metering))] : [], [catalog, choice.kind, choice.point]);
  const hasRequest = !!catalog?.templates.some(t => t.kind === choice.kind && t.point === choice.point && t.request);
  // выбор вида / точки, которых нет в каталоге, поправляем на ближайший доступный
  useEffect(() => { if (points.length && !points.includes(choice.point)) setChoice(c => ({ ...c, point: points[0] })); }, [points, choice.point]);
  useEffect(() => { if (meterings.length && !meterings.includes(choice.metering)) setChoice(c => ({ ...c, metering: meterings[0] })); }, [meterings, choice.metering]);

  // предпросмотр посчитанного (прописью, НДС, склонение, потери) — с паузой после ввода
  const seq = useRef(0);
  useEffect(() => {
    if (!prefill) return;
    const n = ++seq.current;
    const t = setTimeout(() => {
      api<Preview>(`${BASE}/preview`, { method: 'POST', json: { input: clean(input), losses: lossesOverride.material ? lossesOverride : null } })
        .then(p => { if (n === seq.current) setPreview(p); }).catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [input, lossesOverride, prefill]);

  const fields = useMemo(() => {
    if (!catalog || !template) return [];
    return catalog.fields.filter(f => f.input && template.fields.includes(f.name) && (f.source !== 'meter' || choice.metering === 'ct' || !f.input.path.startsWith('ct.')));
  }, [catalog, template, choice.metering]);
  const missing = fields.filter(f => { const v = getPath(input, f.input!.path); return v === undefined || v === null || String(v).trim() === ''; });
  const needsAmount = !!template?.fields.includes('сумма');
  const needsSigner = !!template?.fields.includes('Подписант');
  const problems = [
    ...missing.map(f => f.label),
    ...(needsAmount && !(Number(input.amountRub) > 0) ? ['Стоимость ТП с НДС'] : []),
    ...(needsSigner && !attorney && !input.overrides?.Подписант ? ['Подписант'] : []),
  ];

  const loadMeters = async () => {
    setBusy('meters');
    try {
      const r = await api<{ items: Meter[] }>(`${BASE}/acts/${actId}/meters`);
      setMeters(r.items);
      if (r.items.length === 1) applyMeter(r.items[0]);
      else if (!r.items.length) toast('В «Учёт ПУ» нет ПУ по этому договору — заполните вручную.', 'error');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  };
  const applyMeter = (m: Meter) => {
    setInput(i => ({ ...i, meter: { ...i.meter, type: m.puType ?? i.meter?.type, number: m.serialNumber ?? i.meter?.number } }));
    if (m.connectionType === 'transformer') setChoice(c => ({ ...c, metering: 'ct' }));
    if (m.connectionType === 'direct') setChoice(c => ({ ...c, metering: 'direct' }));
    if (m.formFactor === 'split' && choice.kind !== 'change') setChoice(c => ({ ...c, point: 'pole' }));
    toast(`ПУ ${String(m.serialNumber ?? '')} подставлен`);
  };

  const render = async () => {
    const r = await apiFetch(`${BASE}/acts/${actId}/render`, { method: 'POST', json: { templateId: template!.id, input: clean(input), attorneyNumber: attorney || null, losses: lossesOverride.material ? lossesOverride : null } });
    return r.blob();
  };
  const fileName = () => `${template!.kind === 'ecp' ? 'Уведомление' : 'Акт ТП'} ${prefill!.act.contractNumber}.docx`;
  const download = async () => {
    setBusy('download');
    try {
      const url = URL.createObjectURL(await render());
      const a = document.createElement('a'); a.href = url; a.download = fileName(); a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  };
  const send = async () => {
    if (problems.length && !confirmMissing) { setConfirmMissing(true); return; }
    setBusy('send');
    try {
      const blob = await render();
      const data = new FormData();
      data.append('documentType', 'ACT_TP');
      data.append('file', new File([blob], fileName(), { type: blob.type }));
      const stored = await api<{ id: string }>(`/tp/api/v1/acts/${actId}/files`, { method: 'POST', body: data, headers: { 'Idempotency-Key': crypto.randomUUID() } });
      const act = await api<{ revision: number }>(`/tp/api/v1/acts/${actId}`);
      const version = await api<{ number: number }>(`/tp/api/v1/acts/${actId}/versions`, { method: 'POST', json: { fileId: stored.id, expectedRevision: act.revision }, headers: { 'Idempotency-Key': crypto.randomUUID() } });
      setSaved({ version: version.number }); setConfirmMissing(false);
      toast(`Версия ${version.number} акта создана`);
      loadActs();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  };

  const set = (path: string, value: unknown) => { setInput(i => setPath(i, path, value)); setConfirmMissing(false); setSaved(null); };
  const fieldInput = (f: FieldInfo) => {
    const { path, type } = f.input!;
    const raw = getPath(input, path);
    const value = raw === undefined || raw === null ? '' : String(raw);
    const num = (v: string) => v.trim() === '' ? undefined : Number(v.replace(/\s/g, '').replace(',', '.'));
    const control = type === 'long'
      ? <TextArea value={value} onChange={e => set(path, e.target.value)} />
      : path === 'cableBrand' && catalog?.cableBrands.length
        ? <><Input list="act-cable-brands" value={value} onChange={e => set(path, e.target.value)} /><datalist id="act-cable-brands">{catalog.cableBrands.map(b => <option key={b} value={b} />)}</datalist></>
        : <Input type={type === 'date' ? 'date' : 'text'} inputMode={type === 'number' || type === 'int' ? 'decimal' : undefined} value={value}
          onChange={e => set(path, type === 'number' || type === 'int' ? num(e.target.value) : e.target.value)} />;
    return <Field key={f.name} label={f.label}>{control}</Field>;
  };

  const actions = prefill && template ? (
    <>
      <Button icon={<IconDownload />} onClick={download} disabled={!!busy}>{busy === 'download' ? 'Готовлю…' : 'Скачать Word'}</Button>
      {template.kind !== 'ecp' && (
        <Button variant={confirmMissing ? 'danger' : 'primary'} icon={<IconUpload />} onClick={send} disabled={!!busy}>
          {busy === 'send' ? 'Отправляю…' : confirmMissing ? `Отправить без ${problems.length} полей?` : 'Сформировать и отправить в маршрут'}
        </Button>
      )}
    </>
  ) : undefined;

  return (
    <>
      <PageHeader crumbs={['ЭнергоСфера', module.title]} title={page.title} subtitle={page.about} actions={actions} />
      {!catalog || !acts ? <p className="muted">Загрузка…</p> : (
        <div className="ab">
          <Card title="1. Карточка договора">
            {!acts.length ? (
              <Empty image={module.image} title="Нет карточек для подготовки акта"
                text="Акт формируется по карточке договора в черновике, на возврате или на доработке. Создайте карточку и приложите ТУ в разделе «Загрузка на проверку»." />
            ) : (
              <div className="ab-act">
                <Field label="Договор" hint="Черновики, возвращённые и на доработке — по вашим РЭС">
                  <Select value={actId} onChange={e => open(e.target.value)}>
                    <option value="">— выберите карточку —</option>
                    {acts.map(a => <option key={a.id} value={a.id}>{a.contract_number} от {day(a.contract_date)} — {a.applicant} ({STATES[a.state] ?? a.state}{a.versions ? `, версий: ${a.versions}` : ''})</option>)}
                  </Select>
                </Field>
                {prefill && (
                  <div className="ab-act__meta">
                    {prefill.tu.note ? <Badge tone="warn">{prefill.tu.note}</Badge> : <Badge tone="ok">ТУ прочитаны</Badge>}
                    {prefill.tu.pointText && <span className="muted">Точка присоединения по ТУ: {prefill.tu.pointText}</span>}
                  </div>
                )}
              </div>
            )}
          </Card>

          {prefill && (
            <>
              <Card title="2. Схема присоединения" aside={template && <span className="ab-chip">{template.title}</span>}>
                <div className="ab-axes">
                  <div className="tabs" role="tablist" aria-label="Вид документа">
                    {(Object.keys(catalog.kinds) as Kind[]).map(k => (
                      <button key={k} type="button" className={`tab${choice.kind === k ? ' is-active' : ''}`} onClick={() => setChoice(c => ({ ...c, kind: k }))}>{catalog.kinds[k]}</button>
                    ))}
                  </div>
                  <div className="ab-points">
                    {points.map(p => (
                      <button key={p} type="button" className={`ab-point${choice.point === p ? ' is-active' : ''}`} onClick={() => setChoice(c => ({ ...c, point: p }))}>
                        <svg viewBox="0 0 48 48" aria-hidden="true">{POINT_ICONS[p]}</svg>
                        <span>{catalog.points[p]}</span>
                        {prefill.suggestion.point === p && <em>по ТУ</em>}
                      </button>
                    ))}
                  </div>
                  <div className="ab-row">
                    <div className="tabs" role="tablist" aria-label="Учёт">
                      {meterings.map(m => <button key={m} type="button" className={`tab${choice.metering === m ? ' is-active' : ''}`} onClick={() => setChoice(c => ({ ...c, metering: m }))}>{catalog.meterings[m]}</button>)}
                    </div>
                    {hasRequest && (
                      <div className="tabs" role="tablist" aria-label="Заявка">
                        {(['new', 'increase'] as const).map(r => <button key={r} type="button" className={`tab${choice.request === r ? ' is-active' : ''}`} onClick={() => setChoice(c => ({ ...c, request: r }))}>{r === 'new' ? 'Новое присоединение' : 'Увеличение мощности'}</button>)}
                      </div>
                    )}
                    {template?.power && <span className="muted">Мощность {template.power === 'le15' ? 'до 15 кВт' : 'свыше 15 кВт'} — по анкете</span>}
                    {template?.losses && <Badge tone="accent">с расчётом потерь</Badge>}
                  </div>
                  {template?.kind === 'ecp' && <p className="muted ab-note">Уведомление подписывается ЭЦП: скачайте Word, подпишите и загрузите PDF в «Загрузка на проверку».</p>}
                </div>
              </Card>

              <div className="ab-grid">
                {(['tu', 'engineer', 'meter'] as const).map(source => {
                  const list = fields.filter(f => f.source === source);
                  const extra = source === 'engineer' ? (
                    <>
                      {needsAmount && (
                        <Field label="Стоимость ТП с НДС, руб." hint="Прописью и НДС 22% — сами">
                          <Input inputMode="decimal" value={input.amountRub === undefined ? '' : String(input.amountRub)}
                            onChange={e => set('amountRub', e.target.value.trim() === '' ? undefined : Number(e.target.value.replace(/\s/g, '').replace(',', '.')))} />
                        </Field>
                      )}
                      {needsSigner && (
                        <Field label="Подписант от сетевой организации" hint={catalog.attorneys.length ? 'Из справочника доверенностей' : 'Справочник доверенностей пуст — заполните в «Справочниках»'}>
                          <Select value={attorney} onChange={e => { setAttorney(e.target.value); setConfirmMissing(false); }}>
                            <option value="">— выберите доверенность —</option>
                            {catalog.attorneys.map(a => <option key={a.number} value={a.number} disabled={a.expired}>{a.person} — №{a.number} от {day(a.date)}{a.expired ? ' (срок истёк)' : ''}</option>)}
                          </Select>
                        </Field>
                      )}
                      {template?.extra.map(name => (
                        <Field key={name} label={name} hint="Поле шаблона без автозаполнения">
                          <Input value={input.overrides?.[name] ?? ''} onChange={e => set('overrides', { ...input.overrides, [name]: e.target.value })} />
                        </Field>
                      ))}
                    </>
                  ) : null;
                  if (!list.length && !extra) return null;
                  return (
                    <Card key={source} title={SOURCE_TITLES[source]} className={`ab-block ab-block--${source}`}
                      aside={source === 'meter' && (
                        <Button variant="ghost" onClick={loadMeters} disabled={!catalog.svetlyachok || !!busy}
                          title={catalog.svetlyachok ? 'ПУ по номеру договора из «Учёт ПУ»' : 'Связь с «Учёт ПУ» не настроена'}>
                          {busy === 'meters' ? 'Ищу…' : 'Взять из «Учёт ПУ»'}
                        </Button>
                      )}>
                      {source === 'meter' && meters && meters.length > 1 && (
                        <div className="ab-meters">
                          {meters.map((m, i) => <Button key={i} variant="ghost" onClick={() => applyMeter(m)}>{String(m.puType ?? 'ПУ')} № {String(m.serialNumber ?? '')}</Button>)}
                        </div>
                      )}
                      <div className="ab-fields">{list.map(fieldInput)}{extra}</div>
                    </Card>
                  );
                })}

                <Card title="Посчитано" className="ab-block ab-block--computed">
                  <dl className="ab-computed">
                    {template?.fields.includes('ФИО') && <><dt>Заявитель кратко</dt><dd>{preview?.computed.ФИО || '—'}</dd></>}
                    {template?.fields.includes('склонен') && (
                      <><dt>Заявитель, род. падеж</dt><dd>
                        <Input value={input.overrides?.склонен ?? preview?.computed.склонен ?? ''} onChange={e => set('overrides', { ...input.overrides, склонен: e.target.value })} />
                      </dd></>
                    )}
                    {template?.fields.includes('прописью') && <><dt>Мощность прописью</dt><dd>{preview?.computed.прописью || '—'}</dd></>}
                    {needsAmount && <><dt>Стоимость</dt><dd>{preview?.computed.сумма || '—'}</dd></>}
                    {needsSigner && <><dt>Подписант</dt><dd>{catalog.attorneys.find(a => a.number === attorney)?.phrase ?? '—'}</dd></>}
                    {template?.fields.includes('Подписант_подпись') && <><dt>Подпись</dt><dd>{catalog.attorneys.find(a => a.number === attorney)?.signature ?? '—'}</dd></>}
                  </dl>
                  {template?.losses && (
                    <div className="ab-losses">
                      <div className="ab-row">
                        <strong>Расчёт потерь в линии</strong>
                        <div className="tabs" aria-label="Материал жил">
                          {(['Al', 'Cu'] as const).map(m => (
                            <button key={m} type="button" className={`tab${(lossesOverride.material ?? preview?.losses?.input.material) === m ? ' is-active' : ''}`}
                              onClick={() => setLossesOverride({ material: m })}>{m === 'Al' ? 'Алюминий' : 'Медь'}</button>
                          ))}
                        </div>
                      </div>
                      {preview?.losses ? (
                        <p>{fmt(preview.losses.input.powerKw, 1)} кВт · {fmt(preview.losses.input.lengthM, 0)} м · {preview.losses.input.sectionMm2} мм² · R = {fmt(preview.losses.result.resistanceOhm, 4)} Ом<br />
                          За год: <b>{fmt(preview.losses.result.yearKwh)} кВт·ч</b> ({fmt(preview.losses.result.yearPercent, 3)} %), в месяц в среднем {fmt(preview.losses.result.monthAvgKwh, 3)} кВт·ч.
                          Лист расчёта приложится к акту.</p>
                      ) : <p className="muted">Укажите мощность, марку и сечение кабеля и длину линии — расчёт приложится к акту отдельным листом.</p>}
                    </div>
                  )}
                </Card>
              </div>

              {(problems.length > 0 || saved) && (
                <Card className="ab-status">
                  {saved ? (
                    <p className="ab-saved"><IconCheckCircle /> Версия {saved.version} акта создана и лежит в карточке договора. Проверьте её в реестре и отправьте на согласование.</p>
                  ) : (
                    <p><b>Не заполнено ({problems.length}):</b> {problems.join(', ')}. Пустые поля в документе останутся пустыми.</p>
                  )}
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Анкета для сервера: без пустых значений и NaN. */
function clean(input: Input): Input {
  const out: Input = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null || v === '' || (typeof v === 'number' && Number.isNaN(v))) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const inner = clean(v as Input);
      if (Object.keys(inner).length) out[k] = inner;
    } else out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}
