/* ================= ИНТЕРФЕЙС ================= */
const S = { tpContexts:Object.create(null),presetScope:'*',presetDraft:null,presetDraftDirty:false,presetUndo:null,presetLastChange:'',rankQuery:'', data:null, an:null, tariff:null, open:{}, tab:'rank', source:'', loadedAt:null,
  balSel:{}, balOpen:{}, balGroup:0, gran:'auto', balGran:'day', balWin:{day:null,month:null}, balSmooth:0, detailWin:{}, lastAoa:null, lastSource:null, lastLoadedAt:null, lastError:null,
  cal:{levels:{}, red:45, amber:20, boosts:{}, zone:'score', lossRed:5000, lossAmber:1000, balPct:10},
  view:{peaks:true} };
const $ = sel => document.querySelector(sel);
const el = (tag, cls, html) => { const e=document.createElement(tag); if(cls) e.className=cls; if(html!=null) e.innerHTML=html; return e; };
const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const CLS_RU = {red:'проверка в приоритете', amber:'наблюдение', green:'нет явных признаков', dead:'нулевой ряд'};

/* ---------- калибровка: состояние и хранение ---------- */
const CAL_KEY = 'pu_tp_calibration_v50';
const CAL_PREV_KEY = 'pu_tp_calibration_v49';
const CAL_LEGACY_KEY='pu_tp_calibration_v1';
function defaultCal(){ return {levels:{}, red:45, amber:20, boosts:{}, algOff:{}, zone:'score', groupScope:'tp', lossRed:5000, lossAmber:1000, balPct:10,context:defaultContext(),useAskue:true,tariff:null}; }
function loadCal(){
  try{
    const raw = localStorage.getItem(CAL_KEY)||localStorage.getItem(CAL_PREV_KEY)||localStorage.getItem(CAL_LEGACY_KEY);
    if(raw){
      const c = JSON.parse(raw) || {};
      const d = defaultCal();
      return {
        context:normalizeContext(c.context),useAskue:c.useAskue!==false,
        levels: c.levels||{},
        red: isFinite(c.red)?c.red:d.red,
        amber: isFinite(c.amber)?c.amber:d.amber,
        boosts: c.boosts||{},
        algOff: c.algOff||{},
        zone: c.zone==='loss'?'loss':'score',
        groupScope: c.groupScope==='file'?'file':'tp',
        lossRed: (isFinite(c.lossRed)&&c.lossRed>0)?c.lossRed:d.lossRed,
        lossAmber: (isFinite(c.lossAmber)&&c.lossAmber>0)?c.lossAmber:d.lossAmber,
        balPct: (isFinite(c.balPct)&&c.balPct>=0&&c.balPct<=50)?c.balPct:d.balPct,
        tariff: (isFinite(c.tariff)&&c.tariff>0)?c.tariff:null,
      };
    }
  }catch(e){}
  return defaultCal();
}
function saveCal(){ try{ localStorage.setItem(CAL_KEY, JSON.stringify(S.cal)); }catch(e){} }
function calDirty(){
  return S.cal.red!==45 || S.cal.amber!==20 || Object.values(S.cal.levels).some(v=>v) ||
    Object.values(S.cal.boosts||{}).some(Boolean) || Object.values(S.cal.algOff||{}).some(Boolean);
}
function applyCal(){
  setTune(S.cal.levels, {red:S.cal.red, amber:S.cal.amber});
  setBoosts(S.cal.boosts);
  setAlgOff(S.cal.algOff);
  setZoneMode(S.cal.zone, S.cal.lossRed, S.cal.lossAmber);
  setGroupScope(S.cal.groupScope);
  setAnalysisContext(S.cal.context,S.tpContexts,S.cal.useAskue);
  setBalanceNorm(S.cal.balPct!=null?S.cal.balPct:10);
  S.tariff = S.cal.tariff||null;
}
function markCal(){ const d=document.getElementById('calDot'); if(d) d.hidden = !calDirty(); }
/* v5.5: настройки вида графиков (не калибровка — на расчёт не влияют, «Вернуть базовые настройки» их не трогает) */
const VIEW_KEY = 'pu_tp_view_v55';
function loadView(){ try{ const v=JSON.parse(localStorage.getItem(VIEW_KEY)||'{}')||{}; return {peaks:v.peaks!==false}; }catch(e){ return {peaks:true}; } }
function saveView(){ try{ localStorage.setItem(VIEW_KEY, JSON.stringify(S.view)); }catch(e){} }

/* ---------- загрузка ---------- */
function boot(){
  S.cal = loadCal();
  S.view = loadView();
  applyCal();
  bindUI();
  renderTuner();
  renderBooster();
  syncZoneUI();
  markCal();
  renderPresetEditor();renderTpStatistics();
  bootDemo();
  syncActionAvailability();
}

function syncActionAvailability(){
  const csv=document.getElementById('btnCsv'),reset=document.getElementById('btnReset');
  if(csv){csv.disabled=!S.an;csv.title=S.an?'Выгрузить рейтинг всех ПУ в CSV':'Сначала загрузите данные';}
  if(reset){reset.disabled=!S.data&&!S.lastAoa;reset.title=reset.disabled?'Нет загруженных данных':'Очистить загруженные данные';}
}
function syncZoneUI(){
  document.querySelectorAll('#zoneSeg button').forEach(b=>b.classList.toggle('on', b.dataset.zone===S.cal.zone));
  document.querySelectorAll('#scopeSeg button').forEach(b=>b.classList.toggle('on', b.dataset.scope===(S.cal.groupScope||'tp')));
  const thr=document.getElementById('rmthr');
  if(thr) thr.hidden = S.cal.zone!=='loss';
  const r=document.getElementById('lossRedInp'), a=document.getElementById('lossAmberInp');
  if(r) r.value=S.cal.lossRed;
  if(a) a.value=S.cal.lossAmber;
}

function bootDemo(){
  try{
    const parsed = parseAOA(EMBEDDED_MATRIX, {gran:S.gran});
    if(!parsed.error){
      S.lastAoa = EMBEDDED_MATRIX; S.lastSource = 'встроенный демо-файл'; S.lastLoadedAt = null; S.lastError = null;
      S.data = parsed; S.source = 'встроенный демо-файл'; S.loadedAt = null; S.open = {}; S.detailWin = {};
      recompute();
      return;
    }
  }catch(e){ console.error(e); }
  $('#meta').textContent = 'Данные не загружены — перетащите файл выгрузки.';
}

/* суточный демо-набор: месячное демо (последние 24 мес.) раскладывается по дням
   с недельным ритмом (юр — тише в выходные, быт — наоборот) и шумом; суммы месяцев сохраняются */
function buildDailyDemo(){
  const H=EMBEDDED_MATRIX[0];
  const firstM=H.findIndex(h=>parseMonthHeader(h));
  const mHdr=H.slice(firstM), nM=mHdr.length, keepFrom=Math.max(0,nM-24);
  const mons=mHdr.slice(keepFrom).map(parseMonthHeader);
  let seed=20240101; const rnd=()=>{ seed=(seed*1664525+1013904223)%4294967296; return seed/4294967296; };
  const days=[]; mons.forEach(ym=>{ const dim=daysInMonth(ym.y,ym.m); for(let d=1;d<=dim;d++) days.push({y:ym.y,m:ym.m,d}); });
  const head=H.slice(0,firstM).concat(days.map(d=>String(d.d).padStart(2,'0')+'.'+String(d.m+1).padStart(2,'0')+'.'+d.y));
  const out=[head];
  for(const row of EMBEDDED_MATRIX.slice(1)){
    const svc=row.slice(0,firstM), mv=row.slice(firstM).slice(keepFrom);
    const isUl=/юр/.test(String(row[3]||'')), isSup=/отпуск/i.test(String(row[0]||''));
    const vals=[];
    mons.forEach((ym,mi)=>{
      const dim=daysInMonth(ym.y,ym.m), M=mv[mi];
      if(M==null || M===''){ for(let d=0;d<dim;d++) vals.push(null); return; }
      const w=[];
      for(let d=1;d<=dim;d++){
        const wd=new Date(ym.y,ym.m,d).getDay(), we=(wd===0||wd===6);
        let f=isSup?1:(isUl?(we?0.7:1.1):(we?1.15:0.95));
        f*=0.85+0.3*rnd(); w.push(f);
      }
      const ws=w.reduce((a,b)=>a+b,0);
      for(let d=0;d<dim;d++) vals.push(Math.round(M*w[d]/ws*10)/10);
    });
    out.push(svc.concat(vals));
  }
  return out;
}
function loadDailyDemo(){
  try{
    const aoa=buildDailyDemo();
    if(S.gran==='month') S.gran='auto';   // набор заведомо суточный — ручные «месяцы» его не должны блокировать
    const parsed=parseAOA(aoa, {gran:S.gran});
    if(parsed.error){ $('#notes').innerHTML=''; $('#notes').append(note(parsed.error,'bad')); return; }
    S.lastAoa=aoa; S.lastSource='встроенный демо-файл (сутки)'; S.lastLoadedAt=null; S.lastError=null;
    S.data=parsed; S.source=S.lastSource; S.loadedAt=null; S.open={}; S.detailWin={};
    recompute();
  }catch(e){ console.error(e); }
}
// перечитать последний загруженный массив с запрошенным форматом периодов;
// S.gran меняется только если разбор прошёл (иначе подсветка и данные разойдутся)
function reparse(gran){
  if(!S.lastAoa){ S.gran=gran; syncGranUI(); return; }   // данных нет — формат применится к следующему файлу
  let parsed;
  try{ parsed=parseAOA(S.lastAoa, {gran}); }catch(e){ parsed={error:'Не смог разобрать данные: '+e.message}; }
  if(parsed.error){
    S.lastError = (S.lastSource ? 'Файл «'+S.lastSource+'»' : 'Данные')+' в формате «'+(gran==='day'?'сутки':gran==='month'?'месяцы':'авто')+'» не разобраны: '+parsed.error+(S.data&&S.source!==S.lastSource?' На экране пока прежние данные.':'');
    if(S.data) renderAll(); else { $('#notes').innerHTML=''; $('#notes').append(note(S.lastError,'bad')); }
    return;
  }
  S.lastError=null; S.gran=gran; S.data=parsed; S.open={}; S.detailWin={};
  if(S.lastSource!=null){ S.source=S.lastSource; S.loadedAt=S.lastLoadedAt||null; }
  recompute();
}
function syncGranUI(){
  document.querySelectorAll('#granSel button').forEach(b=>b.classList.toggle('on', b.dataset.gran===S.gran));
}

function resetAll(){
  S.tpContexts=Object.create(null);S.presetScope='*';S.presetDraft=null;S.presetDraftDirty=false;S.presetUndo=null;
  S.rankQuery=''; const sr=document.getElementById('rankSearch');if(sr)sr.value='';
  S.data=null; S.an=null; S.open={}; S.detailWin={}; S.source=''; S.loadedAt=null; S.lastAoa=null; S.lastSource=null; S.lastLoadedAt=null; S.lastError=null;
  S.balSel={}; S.balOpen={}; S.balGroup=0; S.balWin={day:null,month:null};
  ['#kpi','#balance','#rank','#bal','#review'].forEach(sel=>{ $(sel).innerHTML=''; });
  syncActionAvailability();
  $('#meta').innerHTML = 'Данные <b>сброшены</b> — загрузите новую выгрузку.';
  renderPresetEditor();renderTpStatistics();
  const notes = $('#notes'); notes.innerHTML='';
  const n = el('div','note ok','Данные очищены — рейтинг, карта и показатели пусты. Перетащите новый файл в область загрузки, и всё пересчитается с нуля. Либо <a href="#" id="loadDemo">верните встроенный демо-файл</a>.');
  notes.append(n);
  n.querySelector('#loadDemo').addEventListener('click', e=>{ e.preventDefault(); bootDemo(); });
}

function bindUI(){
  const drop = $('#drop'), input = $('#file');
  drop.tabIndex=0;drop.setAttribute('role','button');drop.setAttribute('aria-label','Загрузить файл потребления');
  drop.addEventListener('click', ()=>input.click());
  document.addEventListener('keydown',e=>{
    if(e.key!=='Enter'&&e.key!==' ')return;
    const target=e.target;if(!target.matches('[role="button"]')||target.getAttribute('aria-disabled')==='true')return;
    e.preventDefault();target.click();
  });
  input.addEventListener('change', e=>{ if(e.target.files[0]) loadFile(e.target.files[0]); input.value=''; });
  ;['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev, e=>{e.preventDefault(); drop.classList.add('hot');}));
  ;['dragleave','drop'].forEach(ev=>drop.addEventListener(ev, e=>{e.preventDefault(); drop.classList.remove('hot');}));
  drop.addEventListener('drop', e=>{ const f=e.dataTransfer.files[0]; if(f) loadFile(f); });

  const rankSearch=document.getElementById('rankSearch');
  if(rankSearch)rankSearch.addEventListener('input',()=>{S.rankQuery=rankSearch.value.trim().toLowerCase();if(S.an)renderRank();});
  $('#btnTpl').addEventListener('click', downloadTemplate);
  $('#btnReset').addEventListener('click', resetAll);
  $('#btnDemoDay').addEventListener('click', loadDailyDemo);
  document.querySelectorAll('#granSel button').forEach(b=>b.addEventListener('click', ()=>reparse(b.dataset.gran)));
  $('#btnCsv').addEventListener('click', exportCSV);
  document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click', ()=>{
    S.tab = t.dataset.tab;
    document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on', x===t));
    document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('show', p.id==='pane-'+S.tab));
  }));

  // переключатель зон рейтинга (по риску / по объёму недоучёта)
  document.querySelectorAll('#zoneSeg button').forEach(b=>b.addEventListener('click', ()=>{
    S.cal.zone = b.dataset.zone==='loss' ? 'loss' : 'score';
    syncZoneUI();
    saveCal(); applyCal();
    if(S.data) recompute(true);
  }));
  // v5.2: медиана соседей — по своей ТП или по всему реестру
  document.querySelectorAll('#scopeSeg button').forEach(b=>b.addEventListener('click', ()=>{
    const v = b.dataset.scope==='file' ? 'file' : 'tp';
    if(v===S.cal.groupScope) return;
    S.cal.groupScope = v;
    syncZoneUI();
    saveCal(); applyCal();
    if(S.data) recompute(true);
  }));
  const thrBind = (id, key) => {
    document.getElementById(id).addEventListener('change', e=>{
      const v = parseInt(String(e.target.value).replace(/[\s ]/g,''),10);
      if(isFinite(v) && v>0){
        if(key==='lossRed'){ S.cal.lossRed=v; if(S.cal.lossAmber>v) S.cal.lossAmber=v; }
        else S.cal.lossAmber=Math.min(v, S.cal.lossRed);
      }
      syncZoneUI();
      saveCal(); applyCal();
      if(S.data) recompute(true);
    });
  };
  thrBind('lossRedInp','lossRed');
  thrBind('lossAmberInp','lossAmber');
  // v5.0: тариф — оценки недоучёта в рублях (раньше поля в интерфейсе не было)
  const tInp=document.getElementById('tariffInp');
  if(tInp){
    tInp.value = S.cal.tariff ? String(S.cal.tariff).replace('.',',') : '';
    tInp.addEventListener('change',()=>{
      const v=parseFloat(String(tInp.value).replace(/\s/g,'').replace(',','.'));
      S.cal.tariff = isFinite(v)&&v>0 ? v : null;
      tInp.value = S.cal.tariff ? String(S.cal.tariff).replace('.',',') : '';
      saveCal(); applyCal();
      if(S.data) recompute(true);
    });
  }
}

/* ---------- бусты приоритета (чек-боксы) ---------- */
function renderBooster(){
  const host=document.getElementById('booster');
  if(!host) return;
  host.innerHTML='';
  const box=el('div','boostbox');
  BOOST_DEFS.forEach(b=>{
    const lab=el('label','bopt'+(S.cal.boosts[b.id]?' onb':''));
    const cb=document.createElement('input');
    cb.type='checkbox';
    cb.checked=!!S.cal.boosts[b.id];
    cb.addEventListener('change', ()=>{
      S.cal.boosts[b.id]=cb.checked;
      lab.classList.toggle('onb', cb.checked);
      tuneChanged();
    });
    lab.append(cb, document.createTextNode(b.label), el('span','pts','+'+b.pts+' б.'));
    box.append(lab);
  });
  host.append(box);
}

function loadFile(f){
  const err = m => { $('#notes').innerHTML=''; $('#notes').append(note(m,'bad')); };
  if(typeof XLSX === 'undefined'){
    err('Библиотека чтения Excel не загрузилась (нет интернета или доступ к cdn.sheetjs.com закрыт). Для работы без интернета скачайте файл xlsx.full.min.js (cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js) и положите его рядом с анализатором. Встроенные демо-данные работают и без неё.');
    return;
  }
  const isCsv = /\.(csv|txt)$/i.test(f.name);
  const reader = new FileReader();
  reader.onload = e=>{
    try{
      const wb = isCsv ? XLSX.read(e.target.result, {type:'string'}) : XLSX.read(e.target.result, {type:'array', cellDates:true,cellNF:true});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null});
      // v5.0: строки/колонки массива отсчитываются от начала используемого диапазона листа, а не от A1
      const rng = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : {s:{r:0,c:0}};
      for(let hr=0;hr<Math.min(12,aoa.length);hr++){
        const pc=(aoa[hr]||[]).findIndex(h=>/опрос|успешн.*связ|процент.*аскуэ/i.test(String(h??'')));
        if(pc<0)continue;
        for(let ri=hr+1;ri<aoa.length;ri++){if(!aoa[ri])continue;const cell=ws[XLSX.utils.encode_cell({r:rng.s.r+ri,c:rng.s.c+pc})];if(cell)aoa[ri][pc]=pollCellValue(aoa[ri][pc],cell.z);}
        break;
      }
      if(wb.SheetNames.length>1) S.sheetNote='В книге '+wb.SheetNames.length+' листов — анализируется первый («'+wb.SheetNames[0]+'»).'; else S.sheetNote=null;
      S.lastAoa = aoa; S.lastSource = f.name; S.lastLoadedAt = new Date();   // попытка запоминается ДО разбора
      const parsed = parseAOA(aoa, {gran:S.gran});
      if(parsed.error){
        S.lastError = 'Файл «'+f.name+'» не разобран: '+parsed.error+' Переключатель «Формат» разбирает его заново; на экране пока прежние данные.';
        if(S.data) renderAll(); else err(S.lastError);
        return;
      }
      S.lastError = null;
      S.data = parsed; S.source = f.name; S.open = {}; S.detailWin = {}; S.loadedAt = S.lastLoadedAt;
      recompute();
    }catch(ex){ err('Не смог прочитать «'+f.name+'»: '+ex.message); }
  };
  if(isCsv) reader.readAsText(f, 'utf-8'); else reader.readAsArrayBuffer(f);
}

function recompute(keepOpen){
  if(!S.data) return;
  if(!keepOpen){ S.rankQuery='';const sr=document.getElementById('rankSearch');if(sr)sr.value='';S.open = {}; S.balSel = {}; S.balOpen = {}; S.balGroup = 0; S.balWin = {day:null,month:null}; S.detailWin = {};S.tpContexts=Object.create(null);S.presetScope='*';S.presetDraft=null;S.presetDraftDirty=false;S.presetUndo=null;S.presetLastChange=''; }
  applyCal();
  S.an = analyze(S.data, S.tariff);
  if(keepOpen){ // после перекалибровки у отмеченного ПУ оценка недоучёта могла исчезнуть — отметку снимаем
    const alive = new Set(S.an.results.filter(r=>r.lossKwh>0).map(balSelKey));
    Object.keys(S.balSel).forEach(k=>{ if(!alive.has(k)) delete S.balSel[k]; });
  }
  renderAll();
}

/* ---------- отрисовка ---------- */
function note(text, kind){ return el('div','note '+(kind||''), esc(text)); }

function renderAll(){
  syncActionAvailability();
  const {months} = S.data, an = S.an;
  const isDay = !!S.data.days;
  const per = isDay ? dLabel(S.data.days[0])+' — '+dLabel(S.data.days[S.data.days.length-1])
                    : ymLabel(months[0]) + ' — ' + ymLabel(months[months.length-1]);
  const cnt = isDay ? 'суток: <b>'+S.data.days.length+'</b> · полных месяцев: <b>'+months.length+'</b>' : 'месяцев: <b>'+months.length+'</b>';
  const stamp = S.loadedAt ? ' · загружен <b>'+S.loadedAt.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})+'</b>' : '';
  $('#meta').innerHTML = 'Источник: <b>'+esc(S.source)+'</b> · период <b>'+per+'</b> · '+cnt+' · ПУ: <b>'+an.totals.meters+'</b>'+stamp;
  syncGranUI();

  const notes = $('#notes'); notes.innerHTML='';
  if(S.lastError) notes.append(note(S.lastError,'bad'));   // неразобранный файл «ждёт» смены формата — напоминание держится, пока он ждёт
  if(S.loadedAt) notes.append(note('Загружен файл «'+S.source+'»: '+an.totals.meters+' ПУ, '+(isDay?S.data.days.length+' сут.':months.length+' мес.')+' ('+per+'). Прошлые данные полностью замещены — весь рейтинг пересчитан по новому файлу. Кнопка «Сбросить данные» очищает экран.','ok'));
  if(S.sheetNote && S.source===S.lastSource) notes.append(note(S.sheetNote));
  (S.data.notes||[]).forEach(n=>notes.append(note(n)));
  if(an.groupFallback) notes.append(note('Группы по ТП маленькие (меньше 6 ПУ) — сравнение «с соседями» для них веду по всему реестру, а не внутри ТП.'));
  if(an.typeSplit) notes.append(note('Юр/физ лица учтены в групповых признаках: сравнение «с соседями» ведётся внутри своего типа потребителя (там, где таких ПУ от 6).'));
  if(an.typeFileWide && an.typeFileWide.length){
    const lst=an.typeFileWide.map(x=>(x.tp||'выборка')+': '+[x.ul?x.ul+' юр.':'',x.fl?x.fl+' физ.':''].filter(Boolean).join(', ')).join('; ');
    notes.append(note('Своего типа на ТП меньше 6 ПУ ('+lst+') — такие ПУ сравниваются с тем же типом по всему реестру, а не с соседями другого типа. Общие события ТП (отключения, массовые нули) по-прежнему берутся из своей ТП.'));
  }
  if(an.heatStats && an.heatStats.n){
    const h=an.heatStats;
    notes.append(note('Г1 «исчезла отопительная нагрузка» — у '+h.n+' бытовых ПУ (в красной и жёлтой зонах — '+h.hot+'). Чаще всего это переход на газ: '+(h.reduced?'у '+h.reduced+' баллы провала снижены. ':'')+'Перед выездом сверьте эти адреса с реестром газификации; колонка «Газ (да/нет или дата)» в файле сделает это автоматически.'+(h.byBalance?' У '+h.byBalance+' снижение отменено: баланс ТП подтверждает недостачу.':'')));
  }
  {
    // v5.5: S18 — справочный сигнал о снижении пика зимы или лета: показываем, сколько таких ПУ и как их найти
    const s18=an.results.filter(r=>r.flags.some(f=>f.code==='S18'));
    if(s18.length){
      const gr=s18.filter(r=>r.cls==='green').length;
      notes.append(note('S18 «Снижение сезонных пиков» — у '+s18.length+' ПУ'+(gr?' (из них в зелёной зоне — '+gr+')':'')+': последний пик зимы или лета ниже прошлого пика того же сезона на '+fmt((1-TUNE.peaks.maxRatio)*100)+'% и больше, с поправкой на группу. Признак справочный — 0 баллов, зону не меняет. Найти эти ПУ: введите S18 в поиск над рейтингом.'));
    }
  }
  if(an.groupScope==='file') notes.append(note('Медиана соседей — по всему реестру: групповые признаки сравнивают ПУ с медианой всего файла (юр. лица — с юр., быт — с бытом), а не со своей ТП. Отключения и массовые нули подстанции по-прежнему распознаются по своей ТП. Переключатель — над таблицей рейтинга.'));
  if(S.cal.zone==='loss') notes.append(note('Зоны рейтинга построены по предполагаемому ОБЪЁМУ недоучёта: красная ≥ '+fmt(S.cal.lossRed)+' кВт·ч, жёлтая ≥ '+fmt(S.cal.lossAmber)+' кВт·ч. Балл риска показан справочно; переключатель — над таблицей рейтинга.'));
  {
    const actB = BOOST_DEFS.filter(b=>S.cal.boosts[b.id]);
    if(actB.length) notes.append(note('Включены бусты приоритета: '+actB.map(b=>b.label+' (+'+b.pts+')').join('; ')+'. Приоритет получили '+an.totals.boosted+' ПУ — они подняты выше внутри своей зоны (фиолетовый чип «+N»), зона от бустов не меняется.'));
  }
  {
    const offCodes = TUNE_ORDER.filter(k=>S.cal.algOff[k]).map(k=>ALG_META[k].code);
    if(offCodes.length) notes.append(note('Отключены признаки: '+offCodes.join(', ')+' — в анализе не участвуют (галочки во вкладке «Настройки»).'));
  }
  if(calDirty()) notes.append(note('Калибровка чувствительности изменена (вкладка «Настройки»): пороги зон риска — красная ≥'+CLS.red+', жёлтая ≥'+CLS.amber+'. Рейтинг рассчитан с этими настройками; «Вернуть базовые настройки» возвращает заводские.'));

  const contextN=an.results.filter(r=>r.policy?.active).length,infoN=an.results.filter(r=>r.flags.some(f=>f.contextReason)).length;
  if(contextN)notes.append(note('Контекст применён к '+contextN+' ПУ; у '+infoN+' ПУ сигналы оставлены справочными. Пресеты/АСКУЭ не являются надбавкой риска. Индивидуальная логика раскрывается в карточке, сводка и подсказки — во вкладке «Состав ТП».'));

  // KPI
  const t = an.totals;
  const kpi = $('#kpi'); kpi.innerHTML='';
  const card = (val, lab, cls) => { const c=el('div','kpi '+(cls||'')); c.append(el('div','kv',val), el('div','kl',lab)); return c; };
  kpi.append(
    card(fmt(t.meters),'ПУ в выборке'),
    card(fmt(t.red),'красная зона','k-red'),
    card(fmt(t.amber),'наблюдение','k-amber'),
    card(fmt(t.dead),'нулевой ряд','k-dead'),
    card('≈ '+fmt(t.lossKwh)+' кВт·ч','оценка недоучёта · красн.+жёлт.','k-loss'),
  );
  if(t.lossKwhUnchecked>0) kpi.append(card('≈ '+fmt(t.lossKwhUnchecked)+' кВт·ч','из них без сверки с балансом ТП',''));
  if(t.dataReview)kpi.append(card(fmt(t.dataReview),'ПУ: сверить исходные данные','k-amber'));
  if(t.lossRub!=null) kpi.append(card('≈ '+fmt(t.lossRub)+' ₽','по тарифу '+fmt(S.tariff,2)+' ₽/кВт·ч','k-loss'));

  // Баланс ТП
  const bal = $('#balance'); bal.innerHTML='';
  if(an.tpBalance.length){
    an.tpBalance.forEach(b=>{
      const badCls = b.pct==null ? 'mut' : b.pct>12 ? 'bad' : b.pct>7 ? 'warn' : 'ok';
      bal.append(el('div','balrow',
        '<span class="btag '+badCls+'">небаланс '+(b.pct!=null?fmt(b.pct,1)+'%':'—')+'</span>'+
        '<b>'+esc(b.label)+'</b>'+
        (b.meterIds&&b.meterIds.length?' <span class="mut">· ПУ ввода: '+b.meterIds.map(esc).join(', ')+'</span>':'')+
        ' · отпуск в сеть <b class="bv bv-sup">'+fmt(b.supply)+' кВт·ч</b>'+
        ' · полезный отпуск <b class="bv bv-use">'+fmt(b.sumMeters)+' кВт·ч</b>'+
        ' · небаланс <b class="bv bv-imb">'+fmt(b.imbalance)+' кВт·ч</b>'+
        (b.gaps&&(b.gaps.excluded||b.gaps.dayExcluded)?' <span class="mut">· исключено из баланса из-за пропусков показаний: '+[b.gaps.excluded?b.gaps.excluded+' мес.':'',b.gaps.dayExcluded?b.gaps.dayExcluded+' сут.':''].filter(Boolean).join(', ')+'</span>':'')+
        (b.gaps&&(b.gaps.imputed||b.gaps.dayImputed)?' <span class="mut">· досчитано пропусков: '+[b.gaps.imputed?b.gaps.imputed+' мес.':'',b.gaps.dayImputed?b.gaps.dayImputed+' сут.':''].filter(Boolean).join(', ')+'</span>':'')+
        (b.reconcile&&b.reconcile.profile>0?' <span class="mut">· оценки недоучёта по ТП: по профилю ≈'+fmt(b.reconcile.profile)+' → после сверки с балансом ≈'+fmt(b.reconcile.estimatedAfter)+' кВт·ч</span>':'')));
    });
  } else {
    bal.append(el('div','balrow mut','Строка «Отпуск в сеть …» в файле не найдена — небаланс ТП не считается. Добавьте её в шаблон (см. вкладку «Методика»), и появится сверка с вводом подстанции и алгоритм S11.'));
  }

  renderRank();
  renderBalance();
  renderAlgs();
  renderReview();
  renderTpStatistics();renderPresetEditor();
}

function sparkSVG(v, shiftIdx, w, h, zeroEps, st){
  w=w||130; h=h||30;
  const zeps = zeroEps!=null ? zeroEps : EPS;
  const known = v.filter(x=>x!=null);
  if(!known.length && !(st&&st.some(x=>x!=null))) return '<svg width="'+w+'" height="'+h+'"></svg>';
  const mx = Math.max(...known, 1);
  const X = i => 2 + i*(w-4)/Math.max(1,v.length-1);
  const Y = x => h-2 - (x/mx)*(h-6);
  // v5.5: сторно — в нуле, пропуски не рвут линию (в мини-графике соединяем соседние известные точки)
  const vd = st ? withStorno(v, st) : v;
  let d='', pen=false;
  vd.forEach((x,i)=>{
    if(x==null) return;
    d += (pen?'L':'M') + X(i).toFixed(1) + ' ' + Y(x).toFixed(1) + ' ';
    pen=true;
  });
  let marks='';
  v.forEach((x,i)=>{ if(x!=null&&x<=zeps) marks += '<circle cx="'+X(i).toFixed(1)+'" cy="'+(h-3)+'" r="1.3" class="spz"/>'; });
  if(st) st.forEach((x,i)=>{ if(x!=null && v[i]==null) marks += '<rect x="'+(X(i)-1.6).toFixed(1)+'" y="'+(h-5.2)+'" width="3.2" height="3.2" class="spst"/>'; });
  const sh = shiftIdx!=null ? '<line x1="'+X(shiftIdx).toFixed(1)+'" y1="2" x2="'+X(shiftIdx).toFixed(1)+'" y2="'+(h-2)+'" class="spsh"/>' : '';
  return '<svg class="spark" viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+'">'+sh+'<path d="'+d+'" class="spl"/>'+marks+'</svg>';
}

const CODE_QUERY_RX=/^(?:s\d{1,2}б?|d\d|q\dд?|б1|г1)$/i;
function renderRank(){
  const body = $('#rank'); body.innerHTML='';
  const months = S.data.months;
  const byCode = CODE_QUERY_RX.test(String(S.rankQuery||'').trim());
  let shown = 0;
  S.an.results.forEach((r,idx)=>{
    const m = r.meter;
    const query=String(S.rankQuery||'').toLowerCase();
    // v5.5: поиск и по коду признака / замечания (S18, S3б, Г1, Q8…) — например, все ПУ со снижением пиков
    if(query){
      if(byCode){ if(!r.flags.some(f=>f.code.toLowerCase()===query) && !(r.quality||[]).some(q=>q.code.toLowerCase()===query)) return; }
      else if(![m.id,m.name,m.addr,m.tp].join(' ').toLowerCase().includes(query)) return;
    }
    shown++;
    // спарклайн считаем один раз на результат анализа (r пересоздаётся в analyze → recompute)
    if(r.sparkHtml==null) r.sparkHtml = S.data.days&&m.daily
      ? sparkSVG(m.daily, r.shiftIdx!=null?(S.data.monthDays[r.shiftIdx]||[r.shiftIdx])[0]:null, null, null, EPS_D, stornoAt(m,true,m.daily.length))
      : sparkSVG(m.values, r.shiftIdx, null, null, null, stornoAt(m,false,m.values.length));
    const row = el('div','row '+r.cls+(r.needsData?' data-review':'')+(S.open[m.id+'#'+(m.dup||0)]?' openrow':''));
    row.dataset.key = m.id+'#'+(m.dup||0);
    row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-expanded',String(!!S.open[row.dataset.key]));row.title='Открыть или свернуть карточку ПУ '+m.id;
    const flagChips = (r.needsData?'<span class="chip qchip">сверить данные</span>':'')+r.flags.map(f=>'<span class="chip'+(f.weak?' weakchip':'')+'" title="'+esc(f.title)+'">'+f.code+'</span>').join('')+
      ((r.quality||[]).map(q=>'<span class="chip qchip" title="'+esc(q.title)+' · без баллов">'+q.code+'</span>').join(''))+
      (r.boostPts?'<span class="chip boostchip" title="буст приоритета: '+esc(r.boosts.map(b=>b.label).join('; '))+'">+'+r.boostPts+'</span>':'');
    row.innerHTML =
      '<div class="c-rk">'+(idx+1)+'</div>'+
      '<div class="c-id"><span class="dot '+r.cls+'"></span><span class="mono">'+esc(m.id)+'</span>'+
        (m.ctype?'<span class="chip typechip" title="тип потребителя">'+(m.ctype==='ul'?'юр':'физ')+'</span>':'')+
        (m.dup?'<span class="chip dupchip" title="в файле '+m.dupOf+' строки с этим номером">дубль '+m.dup+'/'+m.dupOf+'</span>':'')+
        (m.negNote?'<span class="chip dupchip" title="'+esc(m.negNote)+'">сторно</span>':'')+
        ((m.name||m.addr)?'<div class="sub">'+esc([m.name,m.addr].filter(Boolean).join(' · '))+'</div>':'')+
      '</div>'+
      '<div class="c-pw mono">'+(m.power!=null?fmt(m.power):'—')+'</div>'+
      '<div class="c-avg mono">'+fmt(mean(m.values))+'</div>'+
      '<div class="c-sp">'+r.sparkHtml+'</div>'+
      '<div class="c-sc"><div class="bar"><i style="width:'+r.score+'%"></i></div><span class="mono">'+r.score+'</span></div>'+
      '<div class="c-fl">'+(flagChips||'<span class="mut">—</span>')+'</div>';
    row.addEventListener('click', ()=>{
      // локальное раскрытие: не перерисовываем весь список (сотни ПУ × сотни суток = секунды)
      const k = row.dataset.key;
      S.open[k] = !S.open[k];
      row.classList.toggle('openrow', !!S.open[k]);
      row.setAttribute('aria-expanded',String(!!S.open[k]));
      const nx = row.nextElementSibling;
      if(nx && nx.classList.contains('detail')) nx.remove();
      if(S.open[k]) row.after(detailPanel(r, months));
    });
    body.append(row);
    if(S.open[row.dataset.key]) body.append(detailPanel(r, months));
  });
  const info=document.getElementById('rankSearchInfo');
  const q=String(S.rankQuery||''), code=(Object.values(ALG_META).map(a=>a.code).find(c=>c.toLowerCase()===q)) || q.toUpperCase();
  if(info) info.textContent = !q ? '' : byCode ? 'признак '+code+' — '+shown+' ПУ' : 'найдено: '+shown;
}


function shortFlagTitle(title){
  return String(title||'').replace(/\s*\([^)]*\)\s*$/,'').replace(/:.*/,'').trim();
}
/* v5.4: признаки на графике — мягкие оттенки розового, красного и фиолетового: синий остаётся за линией
   расхода, голубой и оранжевый — за сезонами. Г1 — зелёный: это объяснение падения (вероятен газ), а не подозрение. */
function toneRGB(rgb, fill, stroke, pill){
  return {fill:'rgba('+rgb+','+fill+')', stroke:'rgba('+rgb+','+stroke+')', pill:'rgba('+rgb+','+pill+')', tag:'rgba('+rgb+',.8)'};
}
function flagTone(code){
  if(code==='Г1') return toneRGB('46,140,87', .05, .38, .15);                 // зелёный — объяснение падения; заливка слабее, чтобы
                                                                              // в наложении с признаками не давать серый
  if(code==='S15') return toneRGB('214,40,52', .11, .36, .16);                // красный — короткое обнуление
  if(code==='S5') return toneRGB('234,96,96', .09, .32, .15);                 // мягкий красный — нулевые месяцы
  if(code==='S16') return toneRGB('184,64,190', .11, .34, .15);               // пурпурный — повторные провалы
  if(code==='S17') return toneRGB('128,90,213', .10, .34, .15);               // фиолетовый — падение год к году
  if(code==='S18') return toneRGB('150,40,72', .10, .40, .14);               // v5.5: винный — снижение пика сезона
  if(/^D/.test(code)) return toneRGB('108,98,200', .11, .34, .17);            // сиреневый — суточные признаки
  if(code==='S3' || code==='S3б' || code==='S13' || code==='S14') return toneRGB('232,62,146', .10, .34, .15); // розовый — ступени и провалы
  return toneRGB('168,92,136', .085, .28, .13);                               // пыльная роза — прочие
}
function idxRanges(idxs){
  const arr=[...new Set((idxs||[]).filter(Number.isFinite))].sort((a,b)=>a-b);
  const out=[]; if(!arr.length) return out;
  let a=arr[0], prev=arr[0];
  for(let i=1;i<arr.length;i++){
    if(arr[i]===prev+1){ prev=arr[i]; continue; }
    out.push({a,b:prev}); a=prev=arr[i];
  }
  out.push({a,b:prev});
  return out;
}
/* v5.3: ось времени по календарю. Месяцы — всегда одни и те же месяцы года: все, через один, начала
   кварталов, полугодий или годов (что помещается); сутки — дни, понедельники, 1 и 15 число, начала месяцев.
   Последний период больше не подписывается «принудительно», поэтому шаг подписей не скачет. */
function timeTicks(periods, isDay, maxLabels){
  maxLabels = maxLabels || 12;
  const n = periods.length, out = [];
  if(!n) return out;
  const pick = (test, lab) => { const idx=[]; periods.forEach((p,i)=>{ if(test(p)) idx.push(i); }); return {idx, lab}; };
  const monLab = d => MONTHS_RU[d.m]+' '+String(d.y).slice(2);
  const rules = !isDay
    ? [1,2,3,6,12].map(st=>pick(p=>p.m%st===0, ymLabel))
    : [pick(()=>true, dLabel), pick(d=>new Date(d.y,d.m,d.d).getDay()===1, dLabel), pick(d=>d.d===1||d.d===15, dLabel)]
        .concat([1,2,3,6,12].map(st=>pick(d=>d.d===1&&d.m%st===0, monLab)));
  let r = rules.find(x=>x.idx.length>=1 && x.idx.length<=maxLabels);
  if(!r){ r = rules[rules.length-1]; const k=Math.ceil(r.idx.length/maxLabels); r = {idx:r.idx.filter((_,j)=>j%k===0), lab:r.lab}; }
  r.idx.forEach(i=>out.push({i, label:r.lab(periods[i]), major: isDay ? (periods[i].d===1 && periods[i].m===0) : periods[i].m===0}));
  return out;
}
/* v5.3: сезонная подложка графиков — зима (дек–фев) голубая, лето (июн–авг) оранжевая (v5.4: чуть ярче),
   межсезонье серое; лёгкая, под всеми линиями и подсветкой аномалий. */
const SEASON_FILL = {winter:'rgba(0,145,230,.085)', summer:'rgba(255,140,10,.11)', off:'rgba(118,130,143,.035)'};
function seasonOfMonth(m){ return (m===11 || m<=1) ? 'winter' : (m>=5 && m<=7) ? 'summer' : 'off'; }
function seasonBandsSVG(periods, X, half, top, height, lo, hi, skipOff){
  let out='', i=0; const n=periods.length;
  while(i<n){
    const s=seasonOfMonth(periods[i].m); let j=i;
    while(j+1<n && seasonOfMonth(periods[j+1].m)===s) j++;
    if(!(skipOff && s==='off')){
      const x0=Math.max(lo, X(i)-half), x1=Math.min(hi, X(j)+half);
      if(x1>x0) out+='<rect x="'+x0.toFixed(1)+'" y="'+top+'" width="'+(x1-x0).toFixed(1)+'" height="'+height+'" fill="'+SEASON_FILL[s]+'" class="cseason"><title>'+(s==='winter'?'зима':s==='summer'?'лето':'межсезонье')+'</title></rect>';
    }
    i=j+1;
  }
  return out;
}
function seasonLegendHTML(skipOff){
  return '<span class="lgs"><i style="background:rgba(0,145,230,.26)"></i>зима</span><span class="lgs"><i style="background:rgba(255,140,10,.32)"></i>лето</span>'+
    (skipOff?'':'<span class="lgs"><i style="background:rgba(118,130,143,.16)"></i>межсезонье</span>');
}
// подписи и вертикальная сетка по календарным отметкам; годовые границы — чуть заметнее
function timeAxisSVG(periods, isDay, X, top, bottom, lo, hi){
  let grid='', xl='';
  timeTicks(periods, isDay, 12).forEach(t=>{
    const x=X(t.i);
    grid+='<line x1="'+x.toFixed(1)+'" y1="'+top+'" x2="'+x.toFixed(1)+'" y2="'+bottom+'" class="cvgrid'+(t.major?' major':'')+'"/>';
    const anchor = x>hi-24 ? 'end' : x<lo+24 ? 'start' : 'middle';
    xl+='<text x="'+x.toFixed(1)+'" y="'+(bottom+16)+'" class="cxl'+(t.major?' major':'')+'" style="text-anchor:'+anchor+'">'+t.label+'</text>';
  });
  return {grid, xl};
}
function flagAnnotations(r,useDay){
  const out=[]; const seen=new Set(); const withPill=new Set();
  const push=(f,a,b)=>{
    if(!(Number.isFinite(a)&&Number.isFinite(b))) return;
    if(b<a){ const t=a; a=b; b=t; }
    const key=[f.code,a,b].join('|'); if(seen.has(key)) return; seen.add(key);
    out.push({code:f.code,title:shortFlagTitle(f.title),a,b,pts:f.pts||0,pill:!withPill.has(f.code)});
    withPill.add(f.code);
  };
  (r.flags||[]).forEach(f=>{
    if(f.info && f.code!=='Г1' && f.code!=='S18') return; // Г1 и S18 справочные, но на графике полезны (v5.5: S18 — месяц пика)
    if(useDay){
      if(Array.isArray(f.dayIdx) && f.dayIdx.length){ idxRanges(f.dayIdx).slice(0,8).forEach(g=>push(f,g.a,g.b)); }
      return;
    }
    // v5.3: на графике — все эпизоды признака (главный — с подписью), а не только первый
    if(f.code==='S17' && Array.isArray(f.runs) && f.runs.length){
      [...f.runs].sort((x,y)=>(x.a===f.eventStart?-1:0)-(y.a===f.eventStart?-1:0)).forEach(x=>push(f,x.a,x.b));
    } else if((f.code==='S15'||f.code==='S16') && Array.isArray(f.events) && f.events.length){
      [...f.events].sort((x,y)=>(x.start===f.eventStart?-1:0)-(y.start===f.eventStart?-1:0)).forEach(e=>push(f,e.start,Number.isFinite(e.end)?e.end:e.start));
    } else if(f.code==='S5' && Array.isArray(f.monthIdx) && f.monthIdx.length){
      idxRanges(f.monthIdx).slice(0,8).forEach(g=>push(f,g.a,g.b));
    } else if(f.code==='S18' && Array.isArray(f.peakHits) && f.peakHits.length){
      f.peakHits.forEach(h=>push(f,h.idx,h.idx));
    } else if(f.code==='S3б' && Number.isFinite(f.shiftIdx) && Number.isFinite(f.endIdx)){
      push(f,f.shiftIdx,Math.max(f.shiftIdx,f.endIdx-1));
    } else if(Number.isFinite(f.eventStart)){
      push(f,f.eventStart, Number.isFinite(f.eventEnd)?f.eventEnd:f.eventStart);
    } else if(Number.isFinite(f.shiftIdx)){
      push(f,f.shiftIdx,f.shiftIdx);
    }
  });
  return out.sort((a,b)=>a.a-b.a || (b.b-b.a)-(a.b-a.a) || b.pts-a.pts).slice(0,24);
}
function periodAnnotationsMap(r,useDay,len){
  const map=Array.from({length:len},()=>[]);
  flagAnnotations(r,useDay).forEach(an=>{
    for(let i=Math.max(0,an.a);i<=Math.min(len-1,an.b);i++){
      const nm=an.code+' '+an.title;
      if(!map[i].includes(nm)) map[i].push(nm);
    }
  });
  return map;
}
/* v5.5: сторно на графиках. В расчёте признаков месяц (сутки) со сторно — пропуск, как и раньше; на графике — 0,
   с заштрихованной полосой и сноской объёма сверху. Линия не рвётся, а корректировка видна там, где она была. */
function stornoAt(m, useDay, len){
  const out=new Array(len).fill(null);
  (m.corrections||[]).forEach(c=>{ const i=useDay?c.dayIdx:c.idx; if(Number.isInteger(i) && i>=0 && i<len) out[i]=(out[i]||0)+c.value; });
  return out;
}
function withStorno(v, st){ return v.map((x,i)=>x!=null ? x : (st[i]!=null ? 0 : null)); }
// пропуски показаний внутри ряда: пары соседних известных точек, между которыми данных нет (рисуются пунктиром)
function gapPairs(arr){ const out=[]; let last=-1; arr.forEach((x,i)=>{ if(x==null) return; if(last>=0 && i-last>1) out.push([last,i]); last=i; }); return out; }
function stornoTxt(x){ return 'сторно −'+fmt(Math.abs(x))+' кВт·ч'; }
const STORNO_TONE={stroke:'rgba(71,85,105,.55)', pill:'rgba(71,85,105,.10)', tag:'rgba(51,65,85,.85)'};
let SVG_UID=0;
function hatchDefs(id){
  return '<defs><pattern id="'+id+'" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">'+
    '<rect width="6" height="6" fill="rgba(71,85,105,.06)"/><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(71,85,105,.32)" stroke-width="2.2"/></pattern></defs>';
}
/* v5.5: подписи пиков — над точкой; если место занято другой подписью, выше, ниже точки или ещё выше. */
function placePeakLabels(items, top, bottom){
  const placed=[];
  const box=(it,by)=>{ const x0=it.anchor==='end'?it.x-it.w:it.anchor==='start'?it.x:it.x-it.w/2; return {x0,x1:x0+it.w,y0:by-10,y1:by+3}; };
  const hit=b=>placed.some(p=>b.x0<p.x1+3 && b.x1>p.x0-3 && b.y0<p.y1+1 && b.y1>p.y0-1);
  return items.map(it=>{
    let by=null;
    for(const c of [it.y-12, it.y-25, it.y+19, it.y-38, it.y+32, it.y-51]){
      if(c-10<top || c+3>bottom) continue;
      const b=box(it,c); if(!hit(b)){ by=c; placed.push(b); break; }
    }
    if(by==null){ by=Math.max(top+10, it.y-12); placed.push(box(it,by)); }
    return by;
  });
}
function peakTip(e, months){
  const nm=e.kind==='winter'?'зимы':'лета';
  let t='Пик '+nm+' '+e.label+': '+ymLabel(months[e.idx])+' — '+fmt(e.val)+' кВт·ч';
  if(e.spike) t+='. Разовый всплеск: в '+fmt(e.spikeK,1)+' раза выше соседних месяцев — похоже на досчёт накопленного, сравнение с ним ненадёжно';
  if(e.storno) t+='. В сезоне было сторно (корректировка начислений) — сравнение ненадёжно';
  if(e.prev && e.ratio==null) t+='. С пиком '+e.prev.label+' не сравнивается: меньше двух общих известных месяцев';
  else if(e.prev){
    t+='. К пику '+e.prev.label+' ('+fmt(e.prev.val)+', '+ymLabel(months[e.prev.idx])+'): '+peakPct(e.ratio);
    if(e.cmpMonths) t+=' — по тем же месяцам ('+peakMonthsLabel(e.cmpMonths)+'): '+fmt(e.cmpCur)+' против '+fmt(e.cmpPrev);
    if(e.gRatio!=null) t+='; пик группы '+peakPct(e.gRatio);
    if(e.medRatio!=null) t+='; уровень сезона '+peakPct(e.medRatio);
    t+= e.decline ? ' — снижение пика (S18 смотрит на последний пик)' : (!e.reliable ? ' — несопоставимо' : '');
  }
  return t;
}
function chartSVG(r, monthsArg, windowRange){
  const useDay = !!(S.data && S.data.days && r.meter.daily);
  const zeroEps = useDay ? EPS_D : EPS;
  const vAll = useDay ? r.meter.daily : r.meter.values;
  const gAll = useDay ? r.groupMedByDay : r.groupMedByMonth;
  const monthsAll = useDay ? S.data.days : monthsArg;
  const lab = useDay ? dLabel : ymLabel;
  const baseV = useDay ? (r.dBase!=null ? r.dBase : (r.baseline!=null ? r.baseline/30.44 : null)) : r.baseline;
  const shiftAll = r.shiftIdx!=null ? (useDay ? (S.data.monthDays[r.shiftIdx]||[r.shiftIdx])[0] : r.shiftIdx) : null;
  const totalN = monthsAll.length;
  const a = windowRange && Number.isFinite(windowRange.a) ? Math.max(0, windowRange.a) : 0;
  const b = windowRange && Number.isFinite(windowRange.b) ? Math.min(totalN-1, windowRange.b) : totalN-1;
  const slice = arr => arr ? arr.slice(a,b+1) : arr;
  // v5.5: сторно — в нуле (ряд для линии), исходный ряд v — для точек и подсказок
  const stAll = stornoAt(r.meter, useDay, totalN);
  const v = slice(vAll), g = slice(gAll), months = slice(monthsAll), st = slice(stAll), vd = withStorno(v, st);
  const shiftI = (shiftAll!=null && shiftAll>=a && shiftAll<=b) ? (shiftAll-a) : null;
  const ann = flagAnnotations(r,useDay).filter(x=>x.b>=a && x.a<=b).map(x=>({
    ...x,
    a:Math.max(a,x.a)-a,
    b:Math.min(b,x.b)-a
  }));
  // v5.3: «как было бы без перелома» — ожидаемый расход гипотезы S3/S3б после точки перелома (помесячно)
  let expVis=null;
  if(!useDay){
    const fx=(r.flags||[]).find(f=>!f.info && (f.code==='S3'||f.code==='S3б') && Array.isArray(f.expected) && Number.isFinite(f.shiftIdx));
    if(fx){
      const endI = fx.code==='S3б' && Number.isFinite(fx.endIdx) ? fx.endIdx-1 : vAll.length-1;
      // v5.5: и через месяцы со сторно — пунктир «ожидалось бы» не рвётся
      const arr = vAll.map((x,i)=>(i>=fx.shiftIdx && i<=endI && fx.expected[i]!=null && (x!=null || stAll[i]!=null)) ? fx.expected[i] : null);
      // соединяем с точкой перед переломом, чтобы линия начиналась от последнего «нормального» месяца
      if(fx.shiftIdx>0 && vAll[fx.shiftIdx-1]!=null) arr[fx.shiftIdx-1]=vAll[fx.shiftIdx-1];
      expVis = slice(arr);
      if(!expVis.some((x,i)=>x!=null && i+a>=fx.shiftIdx)) expVis=null;
    }
  }
  // v5.5: пики зимы и лета у каждого ПУ (помесячно) — объём и изменение к прошлому пику того же сезона
  const peakList = (!useDay && S.view.peaks!==false && r.peaks) ? ['winter','summer'].flatMap(k=>(r.peaks[k]||[]).filter(e=>e.idx>=a && e.idx<=b)) : [];
  const dotR = v.length>180 ? 1.3 : 2.4;
  const W=1000, L=64, R=18, B=42;
  const X = i => L + i*(W-L-R)/Math.max(1,v.length-1);
  const half = (W-L-R)/Math.max(1,v.length-1)/2;
  const laneEnds=[];
  const labelText=(txt,maxChars)=>txt.length>maxChars?txt.slice(0,maxChars-1)+'…':txt;
  const pillOf=(item,label,tone)=>{
    const tw=Math.min(W-L-R,Math.max(68,label.length*6.25+18));
    const x0=Math.max(L,X(item.a)-half), x1=Math.min(W-R,X(item.b)+half);
    const lx=Math.max(L,Math.min((x0+x1-tw)/2,W-R-tw));
    return {...item,tone,label,tw,x0,x1,lx};
  };
  // сноски сторно — в тех же «дорожках» над графиком, что и подписи признаков (до 4 самых крупных; остальные — тег «сторно»)
  const stIdx = st.map((x,i)=>x!=null?i:-1).filter(i=>i>=0);
  const stPill = new Set(stIdx.slice().sort((p,q)=>st[p]-st[q]).slice(0,4));
  const positioned=ann.filter(item=>item.pill).map(item=>pillOf(item,labelText(item.code+' '+item.title,66),flagTone(item.code)))
    .concat(stIdx.filter(i=>stPill.has(i)).map(i=>pillOf({a:i,b:i,storno:st[i]},stornoTxt(st[i]),STORNO_TONE)))
    .sort((p,q)=>p.lx-q.lx);
  positioned.forEach(item=>{
    let lane=0;while(laneEnds[lane]!=null&&item.lx<laneEnds[lane]+10)lane++;
    laneEnds[lane]=item.lx+item.tw;item.lane=lane;
  });
  const T=20+laneEnds.length*24, H=290+laneEnds.length*24;
  const known = vd.filter(x=>x!=null).concat(g?g.filter(x=>x!=null):[]).concat(baseV!=null?[baseV]:[]).concat(expVis?expVis.filter(x=>x!=null):[]);
  // над пиками нужно место для подписей
  const mx = Math.max(...known, 10)*(peakList.length?1.14:1.08);

  const Y = x => T + (H-T-B)*(1 - x/mx);
  let grid='', yl='';
  for(let k=0;k<=4;k++){
    const val = mx*k/4, y=Y(val);
    grid+='<line x1="'+L+'" y1="'+y.toFixed(1)+'" x2="'+(W-R)+'" y2="'+y.toFixed(1)+'" class="cgrid"/>';
    yl+='<text x="'+(L-6)+'" y="'+(y+4).toFixed(1)+'" class="cyl">'+fmt(val)+'</text>';
  }
  const axis = timeAxisSVG(months, useDay, X, T, H-B, L, W-R);
  const seasons = seasonBandsSVG(months, X, half, T, H-T-B, L, W-R, false);
  const path = arr => { let d='',pen=false; arr.forEach((x,i)=>{ if(x==null){pen=false;return;} d+=(pen?'L':'M')+X(i).toFixed(1)+' '+Y(x).toFixed(1)+' '; pen=true; }); return d; };
  // v5.5: пропуски показаний — тонкий пунктир между соседними известными точками
  const gaps = gapPairs(vd);
  const gapPath = gaps.length ? '<path d="'+gaps.map(([i,j])=>'M'+X(i).toFixed(1)+' '+Y(vd[i]).toFixed(1)+' L'+X(j).toFixed(1)+' '+Y(vd[j]).toFixed(1)).join(' ')+'" class="cgap"><title>Нет данных за '+gaps.reduce((s,[i,j])=>s+j-i-1,0)+' '+(useDay?'сут.':'мес.')+' — пропуск показаний, в расчёте не равен нулю</title></path>' : '';
  let dots='';
  const annMap = periodAnnotationsMap(r,useDay, useDay?(r.meter.daily||[]).length:r.meter.values.length).slice(a,b+1);
  v.forEach((x,i)=>{
    if(x!=null){
      const extra = annMap[i]&&annMap[i].length ? ' · '+annMap[i].join('; ') : '';
      dots+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(x).toFixed(1)+'" r="'+dotR+'" class="cdot'+(x<=zeroEps?' czero':'')+'"><title>'+lab(months[i])+': '+fmt(x,1)+' кВт·ч'+esc(extra)+'</title></circle>';
    }
  });
  // v5.5: сторно — заштрихованная полоса и ромб в нуле; сноска с объёмом — сверху (positioned)
  let stBands='', stMarks='';
  if(stIdx.length){
    const hid='sth'+(++SVG_UID);
    stBands+=hatchDefs(hid);
    const y0=Y(0);
    stIdx.forEach(i=>{
      const x0=Math.max(L,X(i)-half), x1=Math.min(W-R,X(i)+half), xi=X(i);
      const tip=esc(lab(months[i])+': '+stornoTxt(st[i])+' — корректировка начислений. В расчёте признаков '+(useDay?'эти сутки пропущены':'этот месяц пропущен')+', на графике показан как 0.');
      stBands+='<rect x="'+x0.toFixed(1)+'" y="'+T+'" width="'+Math.max(3,x1-x0).toFixed(1)+'" height="'+(H-T-B)+'" fill="url(#'+hid+')" class="cstornoband"><title>'+tip+'</title></rect>';
      if(!stPill.has(i)) stBands+='<text x="'+xi.toFixed(1)+'" y="'+(T+11)+'" class="canomtag" style="fill:'+STORNO_TONE.tag+'">сторно</text>';
      stMarks+='<path d="M'+xi.toFixed(1)+' '+(y0-5).toFixed(1)+' L'+(xi+5).toFixed(1)+' '+y0.toFixed(1)+' L'+xi.toFixed(1)+' '+(y0+5).toFixed(1)+' L'+(xi-5).toFixed(1)+' '+y0.toFixed(1)+' Z" class="cstorno"><title>'+tip+'</title></path>';
    });
  }
  // при ожидаемой кривой плоская «база» не рисуется: у сезонного ПУ она вводит в заблуждение
  const base = (baseV!=null && !expVis) ? '<line x1="'+L+'" y1="'+Y(baseV).toFixed(1)+'" x2="'+(W-R)+'" y2="'+Y(baseV).toFixed(1)+'" class="cbase"/><text x="'+(W-R)+'" y="'+(Y(baseV)-5).toFixed(1)+'" class="cbl">база ~'+fmt(baseV)+(useDay?'/сут':'')+'</text>' : '';
  const expPath = expVis ? '<path d="'+path(expVis)+'" class="cexp"><title>Ожидаемый расход без перелома (как в те же месяцы до него)</title></path>' : '';
  const shift = shiftI!=null ? '<line x1="'+X(shiftI).toFixed(1)+'" y1="'+T+'" x2="'+X(shiftI).toFixed(1)+'" y2="'+(H-B)+'" class="cshift"/>' : '';
  const grp = g&&g.some(x=>x!=null&&x>0) ? '<path d="'+path(g)+'" class="cgroup"/>' : '';
  let annBands='', annLabels='';
  ann.forEach(item=>{
    const tone=flagTone(item.code);
    const x0=Math.max(L,X(item.a)-half), x1=Math.min(W-R,X(item.b)+half);
    const tip=esc(item.code+' '+item.title+' · '+lab(months[item.a])+(item.b!==item.a?' — '+lab(months[item.b]):''));
    annBands+='<rect x="'+x0.toFixed(1)+'" y="'+T+'" width="'+Math.max(2,x1-x0).toFixed(1)+'" height="'+(H-T-B)+'" class="canomfill" style="fill:'+tone.fill+';stroke:'+tone.stroke+'"><title>'+tip+'</title></rect>';
    if(!item.pill) annBands+='<text x="'+((x0+x1)/2).toFixed(1)+'" y="'+(T+11)+'" class="canomtag" style="fill:'+tone.tag+'">'+esc(item.code)+'</text>';
  });
  positioned.forEach(item=>{
    const {tone,x0,x1,lx,tw}=item;
    const ly=6+item.lane*24;
    const tip=esc(item.storno!=null
      ? lab(months[item.a])+': '+stornoTxt(item.storno)+' — корректировка начислений; в расчёте признаков период пропущен, на графике — 0'
      : item.code+' '+item.title+' · '+lab(months[item.a])+(item.b!==item.a?' — '+lab(months[item.b]):''));
    const cx=(x0+x1)/2;
    annLabels+='<line x1="'+cx.toFixed(1)+'" y1="'+(ly+18)+'" x2="'+cx.toFixed(1)+'" y2="'+T+'" stroke="'+tone.stroke+'" stroke-dasharray="2 3"/>'+
      '<g><title>'+tip+'</title><rect x="'+lx.toFixed(1)+'" y="'+ly+'" width="'+tw.toFixed(1)+'" height="18" rx="5" class="canompill'+(item.storno!=null?' cstornopill':'')+'" style="fill:'+tone.pill+';stroke:'+tone.stroke+'"/>'+
      '<text x="'+(lx+8).toFixed(1)+'" y="'+(ly+12.4)+'" class="canomtxt">'+esc(item.label)+'</text></g>';
  });
  // v5.5: пики сезонов — треугольник над точкой и подпись «объём · % к прошлому пику того же сезона»
  let peakMarks='', anySpike=false, anyDecline=false;
  if(peakList.length){
    const items=peakList.slice().sort((p,q)=>p.idx-q.idx).map(e=>{
      const x=X(e.idx-a), y=Y(e.val), pct=e.ratio!=null?peakPct(e.ratio):'';
      const w=(fmt(e.val).length+(pct?pct.length+3:0))*6.1+4;
      return {e,x,y,w,pct,anchor: x>W-R-w/2 ? 'end' : x<L+w/2 ? 'start' : 'middle'};
    });
    const ys=placePeakLabels(items, T+2, H-B-2);
    items.forEach((it,k)=>{
      const e=it.e, ly=ys[k];
      if(e.spike) anySpike=true;
      if(e.decline) anyDecline=true;
      const pcls=e.decline?'dn':(e.ratio!=null && !e.reliable?'nr':'');
      const lead = ly<it.y-14 ? '<line x1="'+it.x.toFixed(1)+'" y1="'+(it.y-9).toFixed(1)+'" x2="'+it.x.toFixed(1)+'" y2="'+(ly+3).toFixed(1)+'" class="cpklead"/>'
        : ly>it.y ? '<line x1="'+it.x.toFixed(1)+'" y1="'+(it.y+3).toFixed(1)+'" x2="'+it.x.toFixed(1)+'" y2="'+(ly-10).toFixed(1)+'" class="cpklead"/>' : '';
      peakMarks+='<g class="cpeak '+(e.kind==='winter'?'w':'s')+(e.spike?' sp':'')+'"><title>'+esc(peakTip(e,monthsAll))+'</title>'+lead+
        '<path d="M'+(it.x-4.5).toFixed(1)+' '+(it.y-8).toFixed(1)+' L'+(it.x+4.5).toFixed(1)+' '+(it.y-8).toFixed(1)+' L'+it.x.toFixed(1)+' '+(it.y-3).toFixed(1)+' Z"/>'+
        '<text x="'+it.x.toFixed(1)+'" y="'+ly.toFixed(1)+'" style="text-anchor:'+it.anchor+'"><tspan class="pv">'+fmt(e.val)+'</tspan>'+
        (it.pct?'<tspan class="pc '+pcls+'"> · '+it.pct+'</tspan>':'')+'</text></g>';
    });
  }
  const hasW=peakList.some(e=>e.kind==='winter'), hasS=peakList.some(e=>e.kind==='summer');
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'">'+seasons+grid+axis.grid+yl+stBands+annBands+grp+shift+base+expPath+gapPath+'<path d="'+path(vd)+'" class="cline"/>'+dots+stMarks+peakMarks+annLabels+axis.xl+'</svg>'+
    '<div class="legend"><span><i class="lg l1"></i>расход ПУ'+(useDay?' (по суткам)':'')+'</span>'+(grp?'<span><i class="lg l2"></i>медиана группы'+(r.groupLabel?' ('+esc(r.groupLabel)+')':'')+'</span>':'')+(base?'<span><i class="lg l3"></i>база</span>':'')+(expPath?'<span><i class="lg lexp"></i>ожидалось бы без перелома</span>':'')+(shift?'<span><i class="lg l4"></i>точка перелома</span>':'')+(ann.length?'<span><i class="anmi"></i>аномалии и периоды флагов</span>':'')+
    (hasW?'<span><i class="lgpk w"></i>пик зимы</span>':'')+(hasS?'<span><i class="lgpk s"></i>пик лета</span>':'')+
    (anyDecline?'<span><b class="lgdn">−%</b>снижение пика к прошлому сезону</span>':'')+(anySpike?'<span><svg width="11" height="8" aria-hidden="true"><path d="M1 1 L10 1 L5.5 7 Z" fill="#fff" stroke="#5B6B7C" stroke-width="1.2"/></svg>разовый всплеск</span>':'')+
    (stIdx.length?'<span><i class="lgst"></i>сторно: на графике 0, объём в сноске</span>':'')+(gaps.length?'<span><i class="lggap"></i>нет данных</span>':'')+
    seasonLegendHTML(false)+'</div>';
}
function yearOverlaySVG(r, monthsArg){
  const monthsAll = monthsArg || [];
  const valuesAll = r.meter.values || [];
  // v5.5: сторно — в нуле с ромбом (на суточной выгрузке — месяц, в котором было сторно)
  const stAll = stornoAt(r.meter, false, monthsAll.length);
  const yearMap = new Map(), stMap = new Map(), rawNull = new Map();
  monthsAll.forEach((ym,i)=>{
    if(!ym || !Number.isFinite(ym.y) || !Number.isFinite(ym.m)) return;
    if(!yearMap.has(ym.y)){ yearMap.set(ym.y, Array(12).fill(null)); stMap.set(ym.y, Array(12).fill(null)); rawNull.set(ym.y, Array(12).fill(true)); }
    yearMap.get(ym.y)[ym.m] = valuesAll[i]!=null ? valuesAll[i] : (stAll[i]!=null ? 0 : null);
    stMap.get(ym.y)[ym.m] = stAll[i];
    rawNull.get(ym.y)[ym.m] = valuesAll[i]==null;
  });
  const years = [...yearMap.keys()].sort((a,b)=>a-b);
  if(!years.length) return '<div class="note">Недостаточно помесячных данных для сравнения год к году.</div>';
  const lastYear = years[years.length-1];
  const monthNames=['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  const palette=['#7AA5D6','#46A2C7','#6FB58B','#8E9FCA','#C09365','#9AA8B6','#60B8A4','#A488C1'];
  const W=1000,H=286,L=58,R=18,T=18,B=42;
  const X=i=>L+i*(W-L-R)/11;
  const allVals=[]; yearMap.forEach(arr=>arr.forEach(v=>{ if(v!=null) allVals.push(v); }));
  const mx=Math.max(...allVals,10)*1.08;
  const Y=x=>T+(H-T-B)*(1-x/mx);
  let grid='', yl='';
  for(let k=0;k<=4;k++){
    const val = mx*k/4, y=Y(val);
    grid+='<line x1="'+L+'" y1="'+y.toFixed(1)+'" x2="'+(W-R)+'" y2="'+y.toFixed(1)+'" class="cgrid"/>';
    yl+='<text x="'+(L-6)+'" y="'+(y+4).toFixed(1)+'" class="cyl">'+fmt(val)+'</text>';
  }
  let xl='';
  monthNames.forEach((m,i)=>{ xl+='<text x="'+X(i).toFixed(1)+'" y="'+(H-B+16)+'" class="cxl">'+m+'</text>'; });
  // v5.3: сезонная подложка по месяцам года
  const seasons=seasonBandsSVG(monthNames.map((_,i)=>({m:i})), X, (W-L-R)/11/2, T, H-T-B, L, W-R, false);
  const path=arr=>{ let d='', pen=false; arr.forEach((x,i)=>{ if(x==null){ pen=false; return; } d+=(pen?'L':'M')+X(i).toFixed(1)+' '+Y(x).toFixed(1)+' '; pen=true; }); return d; };
  let paths='', dots='', legend='', anySt=false, anyGap=false;
  years.forEach((y,idx)=>{
    const arr=yearMap.get(y), sts=stMap.get(y), nul=rawNull.get(y);
    const isLast = y===lastYear;
    const color = isLast ? 'var(--bad)' : palette[idx % palette.length];
    const opacity = isLast ? 1 : .88;
    const gp=gapPairs(arr);
    if(gp.length){ anyGap=true; paths+='<path d="'+gp.map(([i,j])=>'M'+X(i).toFixed(1)+' '+Y(arr[i]).toFixed(1)+' L'+X(j).toFixed(1)+' '+Y(arr[j]).toFixed(1)).join(' ')+'" class="cgap" style="stroke:'+color+'"/>'; }
    paths += '<path d="'+path(arr)+'" class="yoyline'+(isLast?' last':'')+'" style="stroke:'+color+';opacity:'+opacity+'"/>';
    arr.forEach((v,i)=>{
      if(v==null) return;
      if(sts[i]!=null){
        anySt=true; const xi=X(i), yi=Y(v);
        dots+='<path d="M'+xi.toFixed(1)+' '+(yi-5).toFixed(1)+' L'+(xi+5).toFixed(1)+' '+yi.toFixed(1)+' L'+xi.toFixed(1)+' '+(yi+5).toFixed(1)+' L'+(xi-5).toFixed(1)+' '+yi.toFixed(1)+' Z" class="cstorno" style="stroke:'+color+'"><title>'+y+' · '+monthNames[i]+': '+stornoTxt(sts[i])+(nul[i]?' — на графике 0, в расчёте месяц пропущен':' в этом месяце; расход месяца — '+fmt(v,1)+' кВт·ч')+'</title></path>';
        return;
      }
      dots += '<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(v).toFixed(1)+'" r="'+(isLast?3.3:2.5)+'" class="yoydot" style="fill:'+color+';opacity:'+opacity+'"><title>'+y+' · '+monthNames[i]+': '+fmt(v,1)+' кВт·ч</title></circle>';
    });
    legend += '<span><i class="yoysw" style="border-color:'+color+'"></i>'+(isLast?'<b>'+y+'</b>':y)+(isLast?' <span class="mut">(последний год)</span>':'')+'</span>';
  });
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'">'+seasons+grid+yl+paths+dots+xl+'</svg>'+
    '<div class="yoylegend">'+legend+(anySt?'<span><i class="lgst"></i>сторно (на графике 0)</span>':'')+(anyGap?'<span><i class="lggap"></i>нет данных</span>':'')+seasonLegendHTML(false)+'</div>'+
    '<div class="detail-chart-hint">Режим «год на год»: месяцы разных лет наложены на одну ось для сравнения аналогичных периодов. Последний аналитический год всегда выделен красным.</div>';
}

function riskStripHTML(score, cls, needsData=false){
  const marker=Math.max(0,Math.min(100,score));
  return '<div class="riskcard '+cls+'">'+
    '<div class="riskhead">'+
      '<div class="riskscore mono">'+score+'<span style="font-size:13px;color:var(--mut);font-family:var(--cond);margin-left:6px">/ 100</span></div>'+
      '<div class="riskstate"><span class="riskpill '+(needsData?'data':cls)+'">'+esc(needsData?'проверить исходные данные':CLS_RU[cls])+'</span><span class="riskmeta">'+(needsData?'Низкий балл ограничен качеством данных, а не подтверждённым отсутствием нарушения.':MODE.zone==='loss'?'Зона выбрана по объёму недоучёта; шкала ниже показывает балл риска.':'Пороги риска: наблюдение от '+CLS.amber+', приоритет от '+CLS.red+'.')+' Балл не является вероятностью БУ.</span></div>'+
    '</div>'+
    '<div class="riskbar">'+
      '<span class="riskseg ok" style="width:'+CLS.amber+'%"></span>'+
      '<span class="riskseg warn" style="left:'+CLS.amber+'%;width:'+(CLS.red-CLS.amber)+'%"></span>'+
      '<span class="riskseg bad" style="left:'+CLS.red+'%;width:'+(100-CLS.red)+'%"></span>'+
      '<span class="riskneedle" style="left:'+marker+'%"></span>'+
    '</div>'+
    '<div class="riskticks"><span>0</span><span style="left:'+CLS.amber+'%">'+CLS.amber+'</span><span style="left:'+CLS.red+'%">'+CLS.red+'</span><span>100</span></div>'+
  '</div>';
}
function detailChartBlock(r, monthsArg){
  const wrap=el('div','detail-chart-shell');
  const toolbar=el('div','dchart-toolbar');
  const plot=el('div','dchart-plot');
  const useDay = !!(S.data && S.data.days && r.meter.daily);
  const periods = useDay ? S.data.days : monthsArg;
  const n = periods.length;
  const key = r.meter.id+'#'+(r.meter.dup||0);
  const viewKey = useDay ? 'day' : 'month';
  const minVisible = Math.min(n, useDay ? 14 : 6);
  const countUnit = useDay ? 'сут.' : 'мес.';
  const bucket = ()=>{ S.detailWin[key] = S.detailWin[key] || {}; return S.detailWin[key]; };
  const currentWindow = ()=>{
    const w = bucket()[viewKey];
    if(!w || !Number.isInteger(w.a) || !Number.isInteger(w.b) || w.a<0 || w.b>=n || w.b-w.a+1<minVisible) return {a:0,b:n-1};
    return w;
  };
  const currentMode = ()=> bucket().mode || 'timeline';
  const selectWindow = (start,count)=>{
    count=Math.max(minVisible,Math.min(n,Math.round(count)));
    start=Math.max(0,Math.min(n-count,Math.round(start)));
    bucket()[viewKey] = (count===n) ? null : {a:start,b:start+count-1};
    draw();
  };
  const zoom = closer=>{ const w=currentWindow(), count=w.b-w.a+1; const next=closer?Math.max(minVisible,Math.floor(count/2)):Math.min(n,Math.ceil(count*1.8)); selectWindow(w.b-next+1,next); };
  const move = dir=>{ const w=currentWindow(), count=w.b-w.a+1; selectWindow(w.a + dir*Math.max(1,Math.ceil(count/2)), count); };
  const nav=el('div','dchart-nav');
  const actions=el('div','dchart-actions');
  const mkButton=(label,tip,cb,extra)=>{ const btn=el('button','bchart-control '+(extra||''),label); btn.type='button'; btn.title=tip; btn.setAttribute('aria-label',tip); btn.addEventListener('click',cb); return btn; };
  const zOut=mkButton('−','Показать больше '+(useDay?'суток':'месяцев'),()=>zoom(false));
  const zIn=mkButton('+','Показать меньше '+(useDay?'суток':'месяцев'),()=>zoom(true));
  const left=mkButton('◀','К более ранним '+(useDay?'суткам':'месяцам'),()=>move(-1));
  const right=mkButton('▶','К более поздним '+(useDay?'суткам':'месяцам'),()=>move(1));
  const all=mkButton('Весь период','Показать весь период',()=>selectWindow(0,n),'bchart-all');
  actions.append(zOut,zIn,el('span','bchart-spacer'),left,right,all);
  nav.append(el('span','dchart-caption','Период графика:'),actions);
  toolbar.append(nav);
  const modeWrap=el('div','dchart-view');
  modeWrap.append(el('span','dchart-caption','Режим:'));
  const seg=el('div','seg');
  const canYoy = Array.isArray(monthsArg) && new Set(monthsArg.filter(Boolean).map(m=>m.y)).size>=2;
  const btTimeline=el('button', currentMode()==='timeline'?'on':'', 'Хронология');
  btTimeline.type='button';
  btTimeline.addEventListener('click',()=>{ bucket().mode='timeline'; draw(); });
  const btYoy=el('button', currentMode()==='yoy'?'on':'', 'Год на год');
  btYoy.type='button';
  btYoy.disabled=!canYoy;
  btYoy.title=canYoy?'Наложить помесячные профили по годам':'Нужны периоды хотя бы двух календарных лет';
  btYoy.addEventListener('click',()=>{ if(canYoy){ bucket().mode='yoy'; draw(); } });
  seg.append(btTimeline, btYoy);
  modeWrap.append(seg);
  toolbar.append(modeWrap);
  // v5.5: пики зимы и лета на хронологии — переключатель общий для всех карточек, запоминается в браузере
  const pkWrap=el('div','dchart-view'), pkSeg=el('div','seg');
  const btPeaks=el('button','','Пики сезонов');
  btPeaks.type='button';
  btPeaks.addEventListener('click',()=>{ S.view.peaks = S.view.peaks===false; saveView(); draw(); });
  pkSeg.append(btPeaks); pkWrap.append(pkSeg);
  toolbar.append(pkWrap);
  const winLab=el('span','dchart-period');
  toolbar.append(winLab);
  wrap.append(toolbar,plot,el('p','detail-chart-hint','Подсветка показывает найденные алгоритмом аномалии, а не доказанный период БУ. Масштаб графика не меняет расчёт риска.'));
  function draw(){
    const mode=currentMode();
    btTimeline.classList.toggle('on', mode==='timeline');
    btYoy.classList.toggle('on', mode==='yoy');
    const pkOn=S.view.peaks!==false, pkAvail=!useDay && mode!=='yoy' && !!r.peaks;
    btPeaks.classList.toggle('on', pkOn && pkAvail);
    btPeaks.disabled=!pkAvail;
    btPeaks.setAttribute('aria-pressed', String(pkOn && pkAvail));
    btPeaks.title = useDay ? 'Пики сезонов считаются по месяцам — смотрите таблицу «Пики сезонов» в карточке'
      : mode==='yoy' ? 'Пики сезонов показываются в режиме «Хронология»'
      : !r.peaks ? 'Пиков нет: нулевой ряд или нерегулярный съём показаний'
      : (pkOn?'Скрыть':'Показать')+' пики зимы и лета: объём и изменение к прошлому пику того же сезона';
    if(mode==='yoy' && canYoy){
      plot.innerHTML = yearOverlaySVG(r, monthsArg);
      zOut.disabled=true; zIn.disabled=true; left.disabled=true; right.disabled=true; all.disabled=true;
      const years=[...new Set((monthsArg||[]).map(x=>x&&x.y).filter(Boolean))].sort((a,b)=>a-b);
      winLab.textContent = 'Сравнение лет: '+years[0]+' — '+years[years.length-1]+' · месяцы янв–дек';
    } else {
      const w=currentWindow(), count=w.b-w.a+1;
      plot.innerHTML = chartSVG(r, monthsArg, w);
      zOut.disabled=count>=n; zIn.disabled=count<=minVisible; left.disabled=w.a===0; right.disabled=w.b===n-1; all.disabled=count===n;
      const allPeriods = useDay ? S.data.days : monthsArg;
      const lab = useDay ? dLabel : ymLabel;
      winLab.textContent = (count===n?'Весь период: ':'На графике: ') + lab(allPeriods[w.a])+' — '+lab(allPeriods[w.b])+' · '+count+' '+countUnit;
    }
  }
  draw();
  return wrap;
}
function exportMeterCard(r, monthsArg){
  if(typeof XLSX==='undefined'){ alert('Для выгрузки нужна библиотека Excel — откройте страницу с доступом к CDN.'); return; }
  const m=r.meter;
  const wb = XLSX.utils.book_new();
  const facts = [
    ['Параметр','Значение'],
    ['№ ПУ', m.id],
    ['Абонент', m.name||''],
    ['Адрес', m.addr||''],
    ['ТП', m.tp||''],
    ['Класс', r.needsData?'проверить исходные данные':CLS_RU[r.cls]],
    ['АСКУЭ',askueLabel(m.askue)],
    ['Опрос АСКУЭ',m.askue===false?'не применяется':m.pollPct!=null?fmt(m.pollPct,1)+'%':'не указан'],
    ['Риск, баллы', r.score],
    ['Профиль анализа',r.policy?.title||'Без контекста'],
    ['Тип потребителя', m.ctype==='ul'?'юр. лицо':m.ctype==='fl'?'физ. лицо':''],
    ['Группа сравнения', r.groupLabel||''],
    ['Газ (из файла)', m.gas==null?'не указан':m.gas?('да'+(m.gasDate?', с '+gasDateLabel(m.gasDate):'')):'нет'],
    ['Суммарно за период, кВт·ч', r.total],
    ['База, кВт·ч/мес', r.baseline!=null ? r.baseline : ''],
    ['Оценка недоучёта, кВт·ч (после сверки с балансом)', r.lossKwh||''],
    ['Оценка по профилю ПУ, кВт·ч', r.lossProfileKwh||''],
    ['Подтверждено балансом ТП, %', r.balanceTest&&isFinite(r.balanceTest.se)?Math.round(Math.max(0,Math.min(1,r.balanceTest.k))*100):''],
    ['Оценка недоучёта, ₽', r.lossRub||''],
    ['Разрешённая мощность, кВт', m.power!=null?m.power:''],
    ['Напряжение / диапазон', r.band ? (r.band.u+' кВ · '+r.band.label) : ''],
    ['Потолок объёма, кВт·ч/мес', r.band ? Math.round(r.band.capKw*730) : ''],
    ['Приоритет (буст)', r.boostPts||0],
    ['Сработавшие признаки', r.flags.map(f=>f.code+' '+f.title).join(' | ')],
    ['Замечания к качеству данных', (r.quality||[]).map(q=>q.code+' '+q.title).join(' | ')]
  ];
  const wsFacts = XLSX.utils.aoa_to_sheet(facts);
  wsFacts['!cols']=[{wch:34},{wch:46}];
  XLSX.utils.book_append_sheet(wb, wsFacts, 'Карточка');

  const addHistorySheet=(sheetName, periods, values, groupSeries, useDay)=>{
    const annMap = periodAnnotationsMap(r,useDay, periods.length);
    const st = stornoAt(m, useDay, periods.length); // v5.5: сторно — отдельной колонкой (в «Потреблении» период пустой)
    const rows = [['Период','Потребление, кВт·ч','Сторно, кВт·ч','Медиана группы'+(r.groupLabel?' ('+r.groupLabel+')':'')+', кВт·ч', useDay?'База, кВт·ч/сут':'База, кВт·ч/мес', 'Аномалии на периоде']];
    periods.forEach((p,i)=>rows.push([
      useDay ? dLabel(p) : ymLabel(p),
      values[i]!=null ? Math.round(values[i]*1000)/1000 : '',
      st[i]!=null ? st[i] : '',
      groupSeries && groupSeries[i]!=null ? Math.round(groupSeries[i]*1000)/1000 : '',
      i===0 && (useDay ? (r.dBase!=null ? r.dBase : (r.baseline!=null ? r.baseline/30.44 : '')) : (r.baseline!=null ? r.baseline : '')) || '',
      annMap[i].join(' | ')
    ]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols']=[{wch:16},{wch:16},{wch:14},{wch:18},{wch:18},{wch:42}];
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  };

  if(S.data.days && m.daily){
    addHistorySheet('Посуточно', S.data.days, m.daily, r.groupMedByDay, true);
    addHistorySheet('Помесячно', monthsArg, m.values, r.groupMedByMonth, false);
  } else {
    addHistorySheet('История', monthsArg, m.values, r.groupMedByMonth, false);
  }

  // v5.5: пики зимы и лета с изменением к прошлому пику того же сезона
  if(r.peaks && (r.peaks.winter.length || r.peaks.summer.length)){
    const pct=x=>x!=null?Math.round((x-1)*1000)/10:'';
    const pr=[['Сезон','Год сезона','Месяц пика','Пик, кВт·ч','К прошлому пику, %','Пик группы, %','С поправкой на группу, %','Уровень сезона (медиана), кВт·ч','Уровень сезона к прошлому, %','Сравнение','Снижение пика']];
    ['winter','summer'].forEach(k=>r.peaks[k].forEach(e=>pr.push([k==='winter'?'зима (ноя–мар)':'лето (июн–авг)', e.label, ymLabel(monthsArg[e.idx]), Math.round(e.val),
      pct(e.ratio), pct(e.gRatio), e.ratio!=null?pct(e.adjRatio):'', Math.round(e.med), pct(e.medRatio),
      peakCmpNote(e, r.peaks[k]),
      e.decline?'да':''])));
    const ws=XLSX.utils.aoa_to_sheet(pr); ws['!cols']=[{wch:16},{wch:11},{wch:11},{wch:11},{wch:16},{wch:13},{wch:20},{wch:22},{wch:20},{wch:24},{wch:13}];
    XLSX.utils.book_append_sheet(wb, ws, 'Пики сезонов');
  }

  const flagsRows = [['Код','Признак','Баллы','Исходные баллы','Описание']].concat(
    (r.flags||[]).map(f=>[f.code, f.title, f.pts||0, f.rawPts!=null?f.rawPts:'', (f.detail||'') + (f.scoreNote ? ' ' + f.scoreNote : '')])
  );
  const wsFlags = XLSX.utils.aoa_to_sheet(flagsRows);
  wsFlags['!cols']=[{wch:8},{wch:30},{wch:10},{wch:16},{wch:90}];
  XLSX.utils.book_append_sheet(wb, wsFlags, 'Признаки');

  if((r.quality||[]).length){
    const qRows = [['Код','Замечание','Описание']].concat((r.quality||[]).map(q=>[q.code,q.title,q.detail]));
    const wsQ = XLSX.utils.aoa_to_sheet(qRows);
    wsQ['!cols']=[{wch:8},{wch:28},{wch:90}];
    XLSX.utils.book_append_sheet(wb, wsQ, 'Качество данных');
  }

  if(r.policy?.active){
    const pr=[['Флаг','Режим','Источник','Обоснование']].concat(r.policy.rules.map(x=>[ALG_META[x.key]?.code||x.key,policyEffect(r.policy,x.key).text,x.origin,x.reason]));
    const ps=XLSX.utils.aoa_to_sheet(pr);ps['!cols']=[{wch:10},{wch:32},{wch:28},{wch:100}];XLSX.utils.book_append_sheet(wb,ps,'Контекст анализа');
  }
  const safe = String(m.id||'PU').replace(/[^0-9A-Za-zА-Яа-я_-]+/g,'_');
  XLSX.writeFile(wb, 'Kartochka_PU_'+safe+'.xlsx');
}

const CHECK = {
  common:['Осмотр пломб: госповерка, сбытовая/сетевая, антимагнитная (сработал ли индикатор)','Осмотр ввода от опоры до ПУ: отводы, скрутки, набросы, следы подключения до прибора','Сверка токоизмерительными клещами: ток на вводе против мгновенной мощности на дисплее ПУ под включённой нагрузкой','Фото- и видеофиксация; при подтверждении — акт о неучтённом потреблении (ПП РФ № 442)'],
  S1:['Поднять историю ПУ: дата установки/замены, акты допуска — было ли что-то в период нулей','Сверить месяц «пробуждения» с заменой прибора, проверкой или подключением АСКУЭ'],
  S2:['Сопоставить месяцы всплесков с журналом контрольных обходов — совпадают ли','Контрольный съём показаний сейчас и повторный через 7–10 дней'],
  S3:['Проверка на магнит/шунт, состояние счётного механизма и индикатора нагрузки','Сверить статус договора: не расторгнут ли, не обесточен ли объект официально'],
  'S3б':['Поднять акты и доначисления за период провала — если их не было, готовить расчёт за период'],
  S4:['Уточнить статус объекта (проживание, аренда, отключение) перед выездом'],
  S12:['Найти документ-основание разового объёма (акт, доначисление) и объяснение тишины после него'],
  S13:['Поднять историю ПУ: дата замены прибора/проверки — совпадает ли с точкой скачка','Запросить акты допуска и доначислений за период до скачка: был ли оформлен недоучёт','Если скачок совпал с заменой ПУ или пресечением — готовить расчёт за период «до»'],
  S14:['Сверить с состоянием объекта: не сворачивалась ли деятельность (аренда, сезонность, простой)','Инструментальная сверка клещами под рабочей нагрузкой','Журнал событий электронного ПУ: вскрытия крышки, магнитное поле, перерывы питания'],
  S15:['Сверить первичные показания за провал и восстановление; исключить перенос начислений','Сопоставить с датами установки/замены ПУ, отключений и очной проверки; дата аномалии не доказывает начало БУ'],
  S16:['Сверить каждый повторный провал с журналом событий и режимом работы объекта','Проверить регулярность съёма и распределение начислений по месяцам'],
  S17:['Сверить с теми же месяцами прошлого года, общими отключениями и изменением деятельности','Инструментально проверить учёт; снижение потребления само по себе не доказывает БУ'],
  S18:['Проверка в пиковый сезон: включить отопление, кондиционер или мощное оборудование и сверить клещами ток на вводе с мгновенной мощностью ПУ — не идёт ли пиковая нагрузка мимо учёта','Уточнить, что изменилось к сезону снижения: вид отопления (газ?), кондиционер, проживание, режим работы объекта'],
  'Б1':['Сверить дату изменения ПУ с ростом небаланса ТП (вкладка «Баланс») и зафиксировать совпадение в акте','Проверить ввод от опоры до ПУ на подключение мимо учёта — энергия шла через ввод ТП, но не через этот прибор'],
  'Г1':['До выезда: сверить адрес с реестром газификации (дата пуска газа) — если газ подключён к моменту исчезновения отопления, выезд по этому провалу не нужен','Если газа нет: выяснить, чем отапливается дом, и осмотреть подключение котла/обогревателей — не запитаны ли они до ПУ (клещи на вводе при включённом отоплении)'],
  D1:['Журнал событий ПУ за нулевые сутки: отключения, вскрытие крышки, магнитное поле','Сопоставить нулевые дни с днями недели и фактом присутствия (опрос, обход)'],
  D2:['Журнал событий ПУ за дни провала; осмотр ввода и пломб','Сверить с отключениями/ремонтами по ТП за эти дни — не общий ли это перерыв'],
  D3:['Сверить дни максимального небаланса с суточным профилем ПУ — совпадения фиксировать в акте','Инструментальная сверка клещами в день высокого небаланса'],
  dead:['Обход: запитан ли объект физически, есть ли признаки проживания/деятельности','Сверка статуса договора и показаний на дисплее ПУ','Если объект живой — проверка на бездоговорное потребление'],
  weak:['Включить в маршрут планового обхода, контрольный съём показаний'],
};

/* v5.5: таблица пиков зимы и лета в карточке — точные объёмы и изменения к прошлому пику того же сезона */
function peaksTableHTML(r, months){
  const P=r.peaks; if(!P || (!P.winter.length && !P.summer.length)) return '';
  const row=e=>{
    const cls = e.decline ? 'pk-dn' : (e.ratio!=null && !e.reliable ? 'pk-nr' : '');
    const tag = e.spike ? 'всплеск' : e.storno ? 'сторно' : e.cmpMonths ? 'по '+peakMonthsLabel(e.cmpMonths) : '';
    return '<tr title="'+esc(peakTip(e,months))+'"><td>'+e.label+'</td><td class="mono">'+fmt(e.val)+' <span class="pk-m">'+ymLabel(months[e.idx])+'</span></td>'+
      '<td class="mono '+cls+'">'+(e.ratio==null?'—':peakPct(e.ratio))+(tag?' <span class="pk-tag">'+tag+'</span>':'')+'</td><td class="mono pk-g">'+(e.gRatio!=null?peakPct(e.gRatio):'—')+'</td></tr>';
  };
  const sec=(k,title)=>P[k].length ? '<tr class="pk-h"><td colspan="4">'+title+'</td></tr>'+P[k].map(row).join('') : '';
  return '<div class="dh">Пики сезонов</div><table class="ptab"><thead><tr><th>Сезон</th><th>Пик, кВт·ч</th><th>к прошлому</th><th>группа</th></tr></thead><tbody>'+
    sec('winter','Зима · ноя–мар')+sec('summer','Лето · июн–авг')+'</tbody></table>'+
    '<div class="ptab-note">Пик — максимум месяцев сезона. <span class="pk-dn">Красным</span> — снижение к прошлому пику того же сезона на порог S18 и больше (по умолчанию 30%) с поправкой на группу, уровень сезона тоже ниже. <span class="pk-nr">Серым</span> — сравнение ненадёжно: разовый всплеск (похоже на досчёт) или сторно в сезоне. Наведите на строку — подробности.</div>';
}
function detailPanel(r, months){
  const m=r.meter;
  const box = el('div','detail '+r.cls);
  const facts = [
    ['Класс', r.needsData?'проверить исходные данные':CLS_RU[r.cls]],
    ['Тип потребителя', m.ctype==='ul'?'юр. лицо':m.ctype==='fl'?'физ. лицо':'—'],
    ...(r.groupLabel ? [['Группа сравнения', esc(r.groupLabel)]] : []),
    ...(m.gas!=null ? [['Газ (из файла)', m.gas?('да'+(m.gasDate?', с '+esc(gasDateLabel(m.gasDate)):'')):'нет']] : []),
    ['Суммарно за период', fmt(r.total)+' кВт·ч'],
    ['База (типичный месяц)', r.baseline!=null?fmt(r.baseline)+' кВт·ч':'—'],
    ['Оценка недоучёта', r.lossKwh?('≈ '+fmt(r.lossKwh)+' кВт·ч'+(r.lossRub!=null?' · ≈ '+fmt(r.lossRub)+' ₽':'')):'—'],
    ...(r.lossProfileKwh && r.lossProfileKwh!==r.lossKwh ? [['  по профилю ПУ, до сверки с балансом', '≈ '+fmt(r.lossProfileKwh)+' кВт·ч']] : []),
    ...(r.balanceTest ? [['Подтверждено балансом ТП', isFinite(r.balanceTest.se) ? '≈ '+fmt(Math.max(0,Math.min(1,r.balanceTest.k))*100)+'% ± '+fmt(r.balanceTest.se*100)+'%' : 'не выделяется']] : (r.lossProfileKwh>0 && !r.balanceChecked ? [['Сверка с балансом ТП','нет строки «Отпуск в сеть»']] : [])),
    ['Разрешённая мощность', m.power!=null?fmt(m.power)+' кВт':'—'],
  ];
  if(m.reviewLabel) facts.push(['Метка из исходного файла',m.reviewLabel==='positive'?'ВОР (не влияет на баллы)':'НЕ ВОР (не влияет на баллы)']);
  if(r.band){
    facts.push(['Напряжение / диапазон', r.band.u+' кВ'+(r.band.explicit?' (из файла)':'')+' · '+r.band.label]);
    facts.push(['Потолок объёма ('+fmt(r.band.capKw)+' кВт)', '≈ '+fmt(r.band.capKw*730)+' кВт·ч/мес']);
  }
  if(r.capClippedKwh) facts.push(['Срезано потолком мощности', '−'+fmt(r.capClippedKwh)+' кВт·ч']);
  if(r.boostPts) facts.push(['Приоритет (буст)', '+'+r.boostPts+' — порядок внутри зоны']);

  const flagsHtml = (r.flags.length
    ? r.flags.map(f=>'<div class="fl"><div class="flh"><span class="chip'+(f.weak?' weakchip':'')+'">'+f.code+'</span> '+esc(f.title)+' <span class="pts">'+(f.info?'справочно · 0 б.':('+'+f.pts+(f.rawPts!=null?' из '+f.rawPts:'')))+'</span></div><div class="fld">'+esc(f.detail)+(f.scoreNote?'<br><b>'+esc(f.scoreNote)+'</b>':'')+'</div></div>').join('')
    : '<div class="mut">Признаков вмешательства не найдено'+(r.cls==='dead'?' — но ряд полностью нулевой, см. чек-лист.':'.')+'</div>')+
    (r.boosts&&r.boosts.length
      ? '<div class="fl"><div class="flh"><span class="chip boostchip">Буст</span> Приоритет проверки (вкладка «Настройки») <span class="pts">+'+r.boostPts+'</span></div><div class="fld">'+esc(r.boosts.map(b=>b.label+' (+'+b.pts+')').join(' · '))+' — поднимает ПУ выше внутри зоны; зону и баллы риска не меняет.</div></div>'
      : '');
  let checks = [];
  // v5.1: при Г1 сверка с реестром газификации — первым пунктом, ещё до выезда
  const pre = r.flags.some(f=>f.code==='Г1') ? CHECK['Г1'] : [];
  if(r.cls==='dead') checks = CHECK.dead;
  else if(r.cls!=='green'){
    checks = [...pre, ...CHECK.common];
    r.flags.forEach(f=>{ (CHECK[f.code]||[]).forEach(x=>{ if(!checks.includes(x)) checks.push(x); }); });
  } else if(r.flags.some(f=>!f.info)) checks = [...pre, ...CHECK.weak];
  else if(r.flags.length && !pre.length) checks = CHECK.weak;
  const checksHtml = checks.length ? '<div class="dh">Чек-лист проверки</div><ol class="cl">'+checks.map(c=>'<li>'+esc(c)+'</li>').join('')+'</ol>' : '';

  const head=el('div','detail-head');
  const title=el('div','detail-title');
  title.innerHTML = '<div class="detail-id"><span class="dot '+r.cls+'"></span><span class="mono">'+esc(m.id)+'</span>'+
    (m.ctype?'<span class="chip typechip">'+(m.ctype==='ul'?'юр':'физ')+'</span>':'')+
    (m.dup?'<span class="chip dupchip">дубль '+m.dup+'/'+m.dupOf+'</span>':'')+
    (m.negNote?'<span class="chip dupchip">сторно</span>':'')+
    (r.boostPts?'<span class="chip boostchip" title="приоритет внутри зоны">+'+r.boostPts+' приоритет</span>':'')+
    '</div>'+
    '<div class="detail-sub">'+esc([m.name,m.addr,m.tp].filter(Boolean).join(' · ')||'Карточка абонента')+'</div>';
  const act=el('div','detail-actions');
  const exp=el('button','btn detail-export','<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/></svg>Карточка · Excel');
  exp.type='button';
  exp.addEventListener('click', ev=>{ ev.stopPropagation(); exportMeterCard(r, months); });
  act.append(exp);
  head.append(title,act);
  box.append(head);

  box.append(detailChartBlock(r, months));

  const grid=el('div','detail-grid');
  const left=el('div','dsummary');
  left.innerHTML = riskStripHTML(r.score, r.cls,r.needsData) + policyDetailsHTML(r) +
    '<table class="facts">'+facts.map(f=>'<tr><td>'+f[0]+'</td><td class="mono">'+f[1]+'</td></tr>').join('')+'</table>'+
    // v5.5: сторно — с периодами и объёмами; на графике они в нуле с полоской
    (m.corrections&&m.corrections.length?'<div class="note bad" style="margin-top:10px">Сторно: '+esc(m.corrections.map(c=>c.period+' −'+fmt(Math.abs(c.value))+' кВт·ч').join('; '))+'. В расчёте признаков эти периоды пропущены, на графике показаны в нуле с заштрихованной полосой.</div>':'')+
    peaksTableHTML(r, months)+
    (r.capClippedKwh?'<div class="note" style="margin-top:10px">Оценка недоучёта ограничена физическим потолком диапазона мощности ('+esc(r.band.label)+', '+esc(r.band.sip)+', '+r.band.u+' кВ): максимально возможный объём '+fmt(r.band.capKw*730)+' кВт·ч/мес минус оплаченное. Срезано '+fmt(r.capClippedKwh)+' кВт·ч.</div>':'');

  const right=el('div','dside');
  right.innerHTML = '<div class="dh">Сработавшие признаки</div>'+flagsHtml+
    ((r.quality||[]).length?'<div class="dh">Качество данных · без баллов за нарушение</div>'+r.quality.map(q=>'<div class="fl quality-note"><div class="flh"><span class="chip qchip">'+q.code+'</span> '+esc(q.title)+'</div><div class="fld">'+esc(q.detail)+'</div></div>').join(''):'')+
    checksHtml;
  grid.append(left,right);
  box.append(grid);
  return box;
}

/* ---------- тепловая карта ---------- */
function renderHeat(){
  const host = $('#heat'); host.innerHTML='';
  if(!S.an) return;
  // суточная выгрузка до 3 месяцев — карта по дням; длиннее — по месячным суммам
  const byDay = !!(S.data.days && S.data.days.length<=92);
  const months = byDay ? S.data.days : S.data.months;
  const lab = byDay ? dLabel : ymLabel;
  const sm = months.length>40 ? ' hc-sm' : '';
  const labStep = months.length>40 ? (byDay?7:6) : 2;
  if(S.data.days) host.append(el('div','balrow mut', byDay
    ? 'Суточная выгрузка: карта по дням (цвет — доля от собственной суточной базы ПУ).'
    : 'Суточная выгрузка длиннее 3 месяцев: карта построена по месячным суммам (суточная детализация — в карточке ПУ и во вкладке «Баланс»).'));
  const head = el('div','hrow hhead');
  head.append(el('div','hid','№ ПУ'));
  months.forEach((ym,i)=>head.append(el('div','hcell hm'+sm, i%labStep===0?lab(ym):'')));
  host.append(head);
  const shown = S.an.results.slice(0,150);
  shown.forEach(r=>{
    let base = r.baseline!=null&&r.baseline>0 ? r.baseline : null;
    if(byDay){ const act=r.meter.daily.filter(x=>x!=null&&x>EPS_D); base=act.length?median(act):null; }
    const vals = byDay ? r.meter.daily : r.meter.values;
    const zeroEps = byDay ? EPS_D : EPS;
    const st = stornoAt(r.meter, byDay, vals.length); // v5.5: сторно — отдельной штриховкой, а не «нет данных»
    const row = el('div','hrow');
    const idc = el('div','hid mono','<span class="dot '+r.cls+'"></span>'+esc(r.meter.id)+(r.meter.dup?' ('+r.meter.dup+')':''));
    idc.title='риск '+r.score;
    row.append(idc);
    vals.forEach((v,i)=>{
      const c = el('div','hcell'+sm);
      let bg='var(--panel2)', tip=lab(months[i])+': ';
      if(v==null && st[i]!=null){ bg=''; tip+=stornoTxt(st[i])+' (корректировка; в расчёте пропуск)'; c.classList.add('hstorno'); }
      else if(v==null){ bg='transparent'; tip+='нет данных'; c.classList.add('hnull'); }
      else {
        tip+=fmt(v,1)+' кВт·ч';
        if(v<=zeroEps){ bg='rgba(240,91,74,.55)'; }
        else if(base){
          const rr=v/base;
          if(rr<0.35) bg='rgba(240,91,74,.4)';
          else if(rr<0.7) bg='rgba(242,182,60,.35)';
          else if(rr>2.5) bg='rgba(111,179,255,.35)';
        }
      }
      if(bg) c.style.background=bg;
      c.title=r.meter.id+' · '+tip;
      row.append(c);
    });
    row.addEventListener('click', ()=>{
      S.tab='rank';
      document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on', x.dataset.tab==='rank'));
      document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('show', p.id==='pane-rank'));
      S.open = {}; S.open[r.meter.id+'#'+(r.meter.dup||0)] = true;
      renderRank();
      setTimeout(()=>{ const t=document.querySelector('.openrow'); if(t) t.scrollIntoView({behavior:'smooth', block:'center'}); }, 30);
    });
    host.append(row);
  });
  if(S.an.results.length>shown.length) host.append(el('div','balrow mut','Показаны первые 150 ПУ по уровню риска (всего '+S.an.results.length+') — полный список во вкладке «Рейтинг риска» и в CSV-экспорте.'));
  host.append(el('div','hleg','<span><i style="background:rgba(240,91,74,.55)"></i>ноль / &lt;35% базы</span><span><i style="background:rgba(242,182,60,.35)"></i>35–70% базы</span><span><i style="background:var(--panel2)"></i>норма</span><span><i style="background:rgba(111,179,255,.35)"></i>&gt;250% базы</span><span><i style="background:transparent;border:1px dashed var(--line)"></i>нет данных</span><span><i class="hstorno"></i>сторно</span>'));
}

/* ---------- вкладка «Баланс» ---------- */
function balSelKey(r){ return r.meter.id+'#'+(r.meter.dup||0); }

/* v5.6: заливки потерь на графике баланса — по точным точкам пересечения линий. Отрезок между соседними
   периодами режется там, где пересекаются отпуск в сеть, граница норматива и полезный отпуск; на каждом куске
   порядок линий постоянный, поэтому края заливок идут ровно по линиям (раньше на отрезке с пересечением край
   красной заливки шёл по хорде и не совпадал с пунктиром). Каждая заливка — один path: без «швов» на стыках.
   Нормативные потери — от границы норматива (или от полезного отпуска, если он выше неё) до отпуска в сеть;
   сверхнормативные — от полезного отпуска до границы норматива. Вместе они закрывают весь небаланс. */
function lossBandPaths(sup, allow, use, ok, X, Y){
  let norm='', exc='';
  const P=(i,u,v)=>X(i+u).toFixed(1)+' '+Y(v).toFixed(1);
  const quad=(i,u0,u1,t0,t1,b0,b1)=>'M'+P(i,u0,t0)+' L'+P(i,u1,t1)+' L'+P(i,u1,b1)+' L'+P(i,u0,b0)+' Z ';
  const at=(v0,v1,u)=>v0+(v1-v0)*u;
  for(let i=0;i<sup.length-1;i++){
    if(!ok[i]||!ok[i+1]) continue;
    const S0=sup[i], S1=sup[i+1], A0=allow[i], A1=allow[i+1], U0=use[i], U1=use[i+1];
    if(S0==null||S1==null||A0==null||A1==null||U0==null||U1==null) continue;
    const cuts=[0,1];
    const cross=(p0,p1,q0,q1)=>{ const d0=p0-q0, d1=p1-q1; if(d0*d1<0) cuts.push(d0/(d0-d1)); };
    cross(S0,S1,A0,A1); cross(S0,S1,U0,U1); cross(A0,A1,U0,U1);
    cuts.sort((a,b)=>a-b);
    for(let k=0;k<cuts.length-1;k++){
      const u0=cuts[k], u1=cuts[k+1];
      if(u1-u0<1e-9) continue;
      const um=(u0+u1)/2, sM=at(S0,S1,um), aM=at(A0,A1,um), uM=at(U0,U1,um);
      const s0=at(S0,S1,u0), s1=at(S0,S1,u1), a0=at(A0,A1,u0), a1=at(A0,A1,u1), w0=at(U0,U1,u0), w1=at(U0,U1,u1);
      if(aM>uM) exc+=quad(i,u0,u1,a0,a1,w0,w1);                       // полезный отпуск ниже границы норматива
      const lowA=aM>=uM;
      if(sM>Math.max(aM,uM)) norm+=quad(i,u0,u1,s0,s1,lowA?a0:w0,lowA?a1:w1); // до отпуска в сеть
    }
  }
  return {norm, exc};
}
function balChartSVG(months, sup, useVals, allowLine, scn, analyzed, lab, pct){
  lab = lab || ymLabel;
  pct = pct!=null ? pct : 10;
  const p = pct/100, pctTxt = fmt(pct)+'%';
  const dotR = months.length>200 ? 1.5 : 2.4;
  const W=880, H=300, L=64, R=14, T=16, B=42;
  const n=months.length;
  const known=[...sup,...useVals].filter(x=>x!=null).concat(scn?scn.filter(x=>x!=null):[]);
  const mx=Math.max(...known,10)*1.06;
  const X=i=>L+i*(W-L-R)/Math.max(1,n-1);
  const Y=x=>T+(H-T-B)*(1-x/mx);
  const half=(W-L-R)/Math.max(1,n-1)/2;
  let grid='', yl='';
  for(let k=0;k<=4;k++){
    const val=mx*k/4, y=Y(val);
    grid+='<line x1="'+L+'" y1="'+y.toFixed(1)+'" x2="'+(W-R)+'" y2="'+y.toFixed(1)+'" class="cgrid"/>';
    yl+='<text x="'+(L-6)+'" y="'+(y+4).toFixed(1)+'" class="cyl">'+fmt(val)+'</text>';
  }
  // v5.3: подписи по календарю (кварталы/полугодия; для суток — недели/месяцы) и сезонная подложка;
  // межсезонье здесь не закрашивается — серым на этом графике отмечены периоды без данных
  const isDayAxis = n>0 && months[0] && months[0].d!=null;
  const axis=timeAxisSVG(months, isDayAxis, X, T, H-B, L, W-R);
  let xl=axis.xl;
  grid+=axis.grid;
  const seasons=seasonBandsSVG(months, X, half, T, H-T-B, L, W-R, true);
  // серые полосы: периоды без тех. учёта (не анализируем)
  let bands='';
  for(let i=0;i<n;i++){
    if(analyzed[i]) continue;
    const x0=Math.max(L, X(i)-half), x1=Math.min(W-R, X(i)+half);
    const why=sup[i]==null?'нет данных тех. учёта':'нет данных ПУ';
    bands+='<rect x="'+x0.toFixed(1)+'" y="'+T+'" width="'+(x1-x0).toFixed(1)+'" height="'+(H-T-B)+'" class="bnull"><title>'+lab(months[i])+': '+why+' — период не анализируется</title></rect>';
  }
  // заливки по сегментам соседних анализируемых месяцев
  const seg=(a,b2,cls)=>{ // между рядами a (верх) и b (низ), только где a>b
    let out='';
    for(let i=0;i<n-1;i++){
      if(!analyzed[i]||!analyzed[i+1]) continue;
      if(a[i]==null||a[i+1]==null||b2[i]==null||b2[i+1]==null) continue;
      if(a[i]<=b2[i] && a[i+1]<=b2[i+1]) continue;
      const aa0=Math.max(a[i],b2[i]), aa1=Math.max(a[i+1],b2[i+1]);
      out+='<polygon points="'+X(i).toFixed(1)+','+Y(aa0).toFixed(1)+' '+X(i+1).toFixed(1)+','+Y(aa1).toFixed(1)+' '+X(i+1).toFixed(1)+','+Y(b2[i+1]).toFixed(1)+' '+X(i).toFixed(1)+','+Y(b2[i]).toFixed(1)+'" class="'+cls+'"/>';
    }
    return out;
  };
  // v5.6: нормативные потери (штриховка: граница норматива → отпуск) и сверхнормативные (красная: полезный → граница)
  const fills=lossBandPaths(sup, allowLine, useVals, analyzed, X, Y);
  const hid='bnh'+(++SVG_UID);
  const normFill=fills.norm ? '<defs><pattern id="'+hid+'" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">'+
      '<rect width="6" height="6" fill="rgba(24,163,111,.07)"/><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(24,163,111,.48)" stroke-width="1.5"/></pattern></defs>'+
      '<path d="'+fills.norm+'" class="bnorm" fill="url(#'+hid+')"><title>Нормативные потери: от границы норматива до отпуска в сеть (до '+pctTxt+' отпуска)</title></path>' : '';
  const exc=fills.exc ? '<path d="'+fills.exc+'" class="bexc"><title>Сверхнормативные потери: полезный отпуск ниже границы норматива (отпуск − '+pctTxt+')</title></path>' : '';
  // прирост сценария: между факт. полезным и «мог бы быть»
  const gain=scn?seg(scn, useVals.map((x,i)=>analyzed[i]?x:null), 'bgain'):'';
  const path=(arr,onlyAnalyzed)=>{
    let d='',pen=false;
    arr.forEach((x,i)=>{
      if(x==null||(onlyAnalyzed&&!analyzed[i])){pen=false;return;}
      d+=(pen?'L':'M')+X(i).toFixed(1)+' '+Y(x).toFixed(1)+' ';
      pen=true;
    });
    return d;
  };
  let dots='';
  months.forEach((ym,i)=>{
    if(sup[i]!=null) dots+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(sup[i]).toFixed(1)+'" r="'+dotR+'" class="bdot"><title>'+lab(ym)+' · отпуск в сеть: '+fmt(sup[i])+' кВт·ч · норматив потерь '+pctTxt+' = '+fmt(sup[i]*p)+' кВт·ч</title></circle>';
    if(useVals[i]!=null){
      // v5.6: небаланс периода, разложенный на нормативные и сверхнормативные потери
      let t=lab(ym)+' · полезный отпуск: '+fmt(useVals[i])+' кВт·ч';
      if(sup[i]!=null){
        const imb=sup[i]-useVals[i], nrm=sup[i]*p;
        t+=' · небаланс '+fmt(imb)+(sup[i]>0?' ('+fmt(imb/sup[i]*100,1)+'%)':'');
        if(analyzed[i] && imb>0) t+=' = нормативные '+fmt(Math.min(imb,nrm))+' + сверхнормативные '+fmt(Math.max(0,imb-nrm));
      }
      dots+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(useVals[i]).toFixed(1)+'" r="'+dotR+'" class="budot"><title>'+t+'</title></circle>';
    }
    if(scn&&analyzed[i]&&scn[i]!=null&&useVals[i]!=null&&scn[i]>useVals[i]+0.5) dots+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(scn[i]).toFixed(1)+'" r="2" fill="var(--ok)"><title>'+lab(ym)+' · со сценарием: '+fmt(scn[i])+' кВт·ч (+'+fmt(scn[i]-useVals[i])+')</title></circle>';
  });
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'">'+seasons+bands+grid+yl+xl+normFill+exc+gain+
    '<path d="'+path(allowLine,true)+'" class="ballow"/>'+
    '<path d="'+path(sup)+'" class="bsup"/>'+
    '<path d="'+path(useVals)+'" class="buse"/>'+
    (scn?'<path d="'+path(scn,true)+'" class="bscn"/>':'')+
    dots+'</svg>'+
    '<div class="legend">'+
      '<span><i class="lg" style="border-color:var(--warn)"></i>отпуск в сеть (тех. учёт)</span>'+
      '<span><i class="lg" style="border-color:var(--acc)"></i>полезный отпуск (по ПУ)</span>'+
      '<span><i class="lg" style="border-color:#8fa0b3;border-top-style:dashed"></i>граница норматива потерь (отпуск − '+pctTxt+')</span>'+
      (scn?'<span><i class="lg" style="border-color:var(--ok);border-top-style:dashed"></i>полезный отпуск со сценарием</span>':'')+
      '<span><i class="lgnorm"></i>нормативные потери (до '+pctTxt+' отпуска)</span>'+
      '<span><i style="width:12px;height:12px;background:rgba(240,91,74,.16);display:inline-block"></i>сверхнормативные потери</span>'+
      (scn?'<span><i style="width:12px;height:12px;background:rgba(70,192,138,.16);display:inline-block"></i>закрыто сценарием</span>':'')+
      '<span><i style="width:12px;height:12px;background:rgba(100,116,139,.12);display:inline-block"></i>нет данных (тех. учёт / ПУ)</span>'+
      seasonLegendHTML(true)+
    '</div>';
}

function renderBalance(keepFocus){
  const host=$('#bal');
  host.innerHTML='';
  if(!S.an) return;
  const tb=S.an.tpBalance;
  if(!tb.length){
    (S.an.tpOverview?.rows||[]).forEach(x=>host.append(tpCompositionCard(x,{compact:true,recommend:false})));
    host.append(el('div','note','Для вкладки «Баланс» нужна строка <b>«Отпуск в сеть ТП-…»</b> с расходом по вводу подстанции (тех. учёт) по тем же периодам, что и у ПУ — месяцам или суткам. Добавьте её в файл — появится график «отпуск в сеть − полезный отпуск», настраиваемый норматив потерь и подбор сценариев: кто из потребителей мог бы закрывать разницу. Пример строки есть в шаблоне .xlsx.'));
    return;
  }
  if(S.balGroup>=tb.length) S.balGroup=0;
  const b=tb[S.balGroup];

  if(tb.length>1){
    const segw=el('div','rmode');
    segw.append(el('span',null,'Подстанция:'));
    const seg=el('div','seg');
    tb.forEach((x,i)=>{
      const bt=el('button', i===S.balGroup?'on':'', esc(x.group));
      bt.addEventListener('click',()=>{ S.balGroup=i; S.balSel={}; S.balOpen={}; S.balWin={day:null,month:null}; renderBalance(); });
      seg.append(bt);
    });
    segw.append(seg);
    host.append(segw);
  }
  if(b.note) host.append(el('div','note bad',esc(b.note)));
  {
    const idsTxt = b.meterIds&&b.meterIds.length ? ' · № ПУ ввода: <b>'+b.meterIds.map(esc).join(', ')+'</b>' : '';
    if(b.inputCount>1) host.append(el('div','note','Отпуск в сеть = <b>сумма '+b.inputCount+' вводов</b>: '+b.inputs.map(x=>esc(x.label)).join(' + ')+idsTxt+'. Месяц анализируется, только если данные есть по каждому вводу.'));
    else if(idsTxt) host.append(el('div','note','Тех. учёт ввода'+idsTxt+'.'));
  }
  // разрез: по суткам (если выгрузка суточная) или по месяцам
  const hasDay = !!(S.data.days && b.daily);
  if(hasDay){
    const gw=el('div','rmode');
    gw.append(el('span',null,'Разрез:'));
    const gs2=el('div','seg');
    [['day','по суткам'],['month','по месяцам']].forEach(([k,t])=>{
      const bt=el('button', S.balGran===k?'on':'', t);
      bt.addEventListener('click',()=>{ S.balGran=k; renderBalance(); });
      gs2.append(bt);
    });
    gw.append(gs2, el('span','mut','суточный разрез точнее сопоставляет провалы ПУ с ростом небаланса по дням; разрез «по месяцам» — только полные календарные месяцы'));
    host.append(gw);
  }
  const useDay = hasDay && S.balGran==='day';
  const periods = useDay ? S.data.days : S.data.months;
  const lab = useDay ? dLabel : ymLabel;
  const unit = useDay ? 'сут.' : 'мес.';
  const defOf = r => useDay ? r.dailyDeficit : r.deficitSeries;
  const sup = useDay ? b.daily.supplySeries : b.supplySeries;
  const useVals = useDay ? b.daily.usefulSeries : b.usefulSeries;
  const analyzed=periods.map((_,i)=>sup[i]!=null&&useVals[i]!=null);
  const summaryKey=b.key==='__all__'&&!S.an.tpOverview.rows.some(x=>x.automation.key==='__all__')?'*':b.key;
  const ov=S.an.tpOverview.rows.find(x=>x.automation.key===summaryKey);
  if(ov)host.append(tpCompositionCard(ov,{energy:tpEnergySummary(S.data,summaryKey,useDay,b),compact:true,recommend:false}));
  const nAn=analyzed.filter(Boolean).length;
  if(!nAn){
    host.append(el('div','note bad','В строке «'+esc(b.label)+'» нет ни одного периода с данными тех. учёта — анализировать нечего.'));
    return;
  }
  const p=(S.cal.balPct!=null?S.cal.balPct:10)/100;
  const allowLine=periods.map((_,i)=>analyzed[i]?sup[i]*(1-p):null);
  // корзины нормирования: норматив потерь — доля отпуска за МЕСЯЦ, поэтому в суточном разрезе
  // сверхнорматив считаем по календарным месяцам (посуточный max(0,·) завышал бы его шумом
  // времени съёма: дни с отрицательным небалансом обнуляются, положительные — целиком)
  const buckets = useDay
    ? [...periods.reduce((mp,d,i)=>{ if(analyzed[i]){ const k=d.y*12+d.m; if(!mp.has(k)) mp.set(k,[]); mp.get(k).push(i); } return mp; }, new Map()).values()]
    : periods.map((_,i)=>analyzed[i]?[i]:[]);
  const bSum=(arr,ix)=>ix.reduce((s,i)=>s+arr[i],0);
  const excess=buckets.map(ix=>ix.length?Math.max(0,(bSum(sup,ix)-bSum(useVals,ix))-p*bSum(sup,ix)):0);
  const excessSum=excess.reduce((a,c)=>a+c,0);
  const supSum=periods.reduce((a,_,i)=>a+(analyzed[i]?sup[i]:0),0);
  const useSum=periods.reduce((a,_,i)=>a+(analyzed[i]?useVals[i]:0),0);
  const imbSum=supSum-useSum;

  // кандидаты группы с помесячной оценкой недоучёта
  const cands=S.an.results
    .filter(r=>defOf(r) && (b.key==='__all__' || (r.meter.tp||'__all__')===b.key))
    .map(r=>({r, key:balSelKey(r), contrib:periods.reduce((s,_,i)=>s+(analyzed[i]?defOf(r)[i]:0),0)}))
    .filter(c=>c.contrib>=1)
    .sort((a,c)=>c.contrib-a.contrib);

  // отмеченные (обычно в другом разрезе) ПУ, чей недоучёт целиком вне периодов этого разреза
  const candKeys=new Set(cands.map(c=>c.key));
  const ghosts=S.an.results.filter(r=>S.balSel[balSelKey(r)] && r.lossKwh>0 && !candKeys.has(balSelKey(r)) && (b.key==='__all__' || (r.meter.tp||'__all__')===b.key));
  const recOf=set=>{
    const keys=new Set(set.map(c=>c.key));
    return buckets.map(ix=>cands.reduce((s,c)=>s+(keys.has(c.key)?bSum(defOf(c.r),ix):0),0));
  };
  const covOf=recArr=>buckets.reduce((s,_,k)=>s+Math.min(recArr[k],excess[k]),0);
  const selected=cands.filter(c=>S.balSel[c.key]);
  const rec=recOf(selected);
  const recSum=rec.reduce((a,c)=>a+c,0);
  const covered=covOf(rec);
  // для графика — добавка сценария по периодам
  const recP=periods.map((_,i)=>analyzed[i]?selected.reduce((s,c)=>s+defOf(c.r)[i],0):0);
  const scn=selected.length?periods.map((_,i)=>analyzed[i]?useVals[i]+recP[i]:null):null;

  // KPI
  const kwrap=el('div','balkpis');
  const card=(val,lab,cls)=>{ const c=el('div','kpi '+(cls||'')); c.append(el('div','kv',val), el('div','kl',lab)); return c; };
  const pctVal=supSum>0?imbSum/supSum*100:null;
  // v5.6: нормативные потери — небаланс минус сверхнормативные (по месяцам: min(небаланс, норматив × отпуск));
  // считаем из округлённых чисел, чтобы на карточках небаланс = нормативные + сверхнормативные без расхождения в 1 кВт·ч
  const normSum=Math.round(imbSum)-Math.round(excessSum);
  const normCard=card(fmt(normSum)+' кВт·ч','нормативные потери (в пределах '+fmt(S.cal.balPct)+'%)','k-norm');
  normCard.title='Потери в пределах норматива: небаланс минус сверхнормативные потери. По месяцам — min(небаланс, '+fmt(S.cal.balPct)+'% отпуска). '+
    'Это меньше '+fmt(S.cal.balPct)+'% всего отпуска ('+fmt(Math.round(p*supSum))+' кВт·ч), если в части месяцев потери были ниже норматива или полезный отпуск превышал отпуск в сеть.';
  // v5.7: у сверхнормативных потерь — их доля от отпуска в сеть (как у небаланса), а не порог норматива.
  // Считается по месяцам, поэтому может быть больше, чем «небаланс − норматив» за период в целом:
  // неиспользованный норматив месяцев с низкими потерями на другие месяцы не переносится.
  const excPct=supSum>0?excessSum/supSum*100:null;
  const excCard=card(fmt(Math.round(excessSum))+' кВт·ч'+(excPct!=null?' ('+fmt(excPct,1)+'%)':''),'сверхнормативные потери','k-red');
  if(excPct!=null){
    const netPct=Math.max(0,pctVal-S.cal.balPct);
    excCard.title='Сверхнормативные потери — '+fmt(excPct,1)+'% отпуска в сеть ('+fmt(Math.round(excessSum))+' из '+fmt(supSum)+' кВт·ч). '+
      'Считаются по месяцам: в каждом месяце — небаланс сверх '+fmt(S.cal.balPct)+'% отпуска этого месяца.'+
      (Math.abs(excPct-netPct)>=0.05?' Неиспользованный норматив месяцев с низкими потерями на другие месяцы не переносится, поэтому это больше, чем «небаланс − норматив» за период в целом ('+fmt(pctVal,1)+'% − '+fmt(S.cal.balPct)+'% = '+fmt(netPct,1)+'%).':'');
  }
  kwrap.append(
    card(fmt(supSum)+' кВт·ч','отпуск в сеть · '+nAn+' '+unit),
    card(fmt(useSum)+' кВт·ч','полезный отпуск'),
    card(fmt(imbSum)+' кВт·ч'+(pctVal!=null?' ('+fmt(pctVal,1)+'%)':''),'небаланс','k-amber'),
    normCard,
    excCard,
  );
  if(selected.length||ghosts.length) kwrap.append(
    card('+'+fmt(Math.round(recSum))+' кВт·ч','добавит сценарий ('+selected.length+' ПУ'+(ghosts.length?' + '+ghosts.length+' вне разреза':'')+')','k-loss'),
    card(excessSum>0?fmt(covered/excessSum*100)+'%':'—','сверхнормативных потерь закрыто', covered/Math.max(1,excessSum)>=0.7?'k-loss':''),
  );
  host.append(kwrap);
  if(ghosts.length) host.append(el('div','note',ghosts.length+' отмеченных ПУ ('+ghosts.map(r=>esc(r.meter.id)).join(', ')+') в разрезе «'+(useDay?'по суткам':'по месяцам')+'» не участвуют: их недоучёт ('+fmt(ghosts.reduce((s,r)=>s+r.lossKwh,0))+' кВт·ч) целиком приходится на периоды вне этого разреза (например, на дни неполного месяца). Переключите разрез, чтобы увидеть их вклад.'));
  if(hasDay && !useDay){
    // суточная выгрузка, разрез «по месяцам»: дни неполных (отброшенных) месяцев в ось не входят,
    // а суточные оценки D1–D2 их учитывают — показываем, сколько объёма осталось за кадром
    let outside=0, nOut=0;
    S.an.results.forEach(r=>{ if(r.deficitPartial>=1 && (b.key==='__all__' || (r.meter.tp||'__all__')===b.key)){ outside+=r.deficitPartial; nOut++; } });
    if(nOut) host.append(el('div','note','В разрез «по месяцам» входят только полные календарные месяцы: у '+nOut+' ПУ ≈ '+fmt(Math.round(outside))+' кВт·ч оценки недоучёта приходится на дни неполных месяцев и здесь не показано. Полная картина — в разрезе «по суткам».'));
  }

  // норматив потерь (v5.6: подписи — норматив, нормативные и сверхнормативные потери)
  const pr=el('div','bpct');
  pr.append(el('span',null,'Норматив потерь:'));
  const rng=document.createElement('input');
  rng.type='range'; rng.min=0; rng.max=30; rng.step=1; rng.value=S.cal.balPct; rng.className='tr tr-num';
  const vl=el('span','val',fmt(S.cal.balPct)+'%');
  // input — только подпись (иначе слайдер пересоздаётся под зажатой мышью и драг рвётся);
  // полный пересчёт — по change (отпускание мыши / шаг с клавиатуры)
  rng.addEventListener('input',()=>{ S.cal.balPct=+rng.value; vl.textContent=fmt(S.cal.balPct)+'%'; });
  rng.addEventListener('change',()=>{ saveCal(); applyCal(); S.balFocus=true; recompute(true); });
  pr.append(rng, vl, el('span','mut','доля отпуска в сеть, которую допустимо потерять. Пунктир — граница норматива: от него до отпуска в сеть — нормативные потери (зелёная штриховка), от полезного отпуска до него — сверхнормативные (красная заливка)'+(useDay?'; на графике заливка показана по суткам, а в KPI и сценариях сверхнорматив считается по календарным месяцам (дни с отрицательным небалансом взаимозачитываются), поэтому площадь заливки может быть чуть больше цифры':'')));
  host.append(pr);
  if(keepFocus || S.balFocus){ rng.focus(); S.balFocus=false; }

  // График: единые кнопки масштаба и перемещения для суточных И помесячных рядов.
  // Меняется только видимый интервал SVG; баланс, KPI, подбор и сценарии всегда
  // рассчитываются по всем загруженным периодам.
  const ch=el('div','bchart');
  const toolbar=el('div','bchart-toolbar');
  const plot=el('div','bchart-plot');
  const n=periods.length, viewKey=useDay?'day':'month';
  const minVisible=Math.min(n,useDay?7:3);
  const countUnit=useDay?'сут.':'мес.';
  const currentWindow=()=>{
    const w=S.balWin[viewKey];
    if(!w || !Number.isInteger(w.a) || !Number.isInteger(w.b) || w.a<0 || w.b>=n || w.b-w.a+1<minVisible) return {a:0,b:n-1};
    return w;
  };
  const selectWindow=(start,count)=>{
    count=Math.max(minVisible,Math.min(n,Math.round(count)));
    start=Math.max(0,Math.min(n-count,Math.round(start)));
    S.balWin[viewKey]=(count===n)?null:{a:start,b:start+count-1};
    draw();
  };
  // «+» увеличивает масштаб (меньше дат, крупнее); «−» показывает больше дат.
  // Правый край сохраняется, чтобы при увеличении видеть последние периоды.
  const zoom=(closer)=>{
    const w=currentWindow(), count=w.b-w.a+1;
    const next=closer?Math.max(minVisible,Math.floor(count/2)) : Math.min(n,count*2);
    selectWindow(w.b-next+1,next);
  };
  const move=dir=>{
    const w=currentWindow(), count=w.b-w.a+1;
    selectWindow(w.a+dir*Math.max(1,Math.ceil(count/2)),count);
  };
  const nav=el('div','bchart-nav');
  const actions=el('div','bchart-actions');
  const mkButton=(label,action,tip,cb,extra)=>{
    const btn=el('button','bchart-control '+(extra||''),label);
    btn.type='button'; btn.dataset.chartAction=action;
    btn.title=tip; btn.setAttribute('aria-label',tip);
    btn.addEventListener('click',cb);
    return btn;
  };
  const zOut=mkButton('−','zoom-out','Уменьшить масштаб: показать больше '+(useDay?'суток':'месяцев'),()=>zoom(false));
  const zIn=mkButton('+','zoom-in','Увеличить масштаб: показать меньше '+(useDay?'суток':'месяцев'),()=>zoom(true));
  const left=mkButton('◀','move-left','Переместиться к более ранним '+(useDay?'суткам':'месяцам'),()=>move(-1));
  const right=mkButton('▶','move-right','Переместиться к более поздним '+(useDay?'суткам':'месяцам'),()=>move(1));
  const all=mkButton('Весь период','show-all','Показать весь загруженный период',()=>selectWindow(0,n),'bchart-all');
  actions.append(zOut,zIn,el('span','bchart-spacer'),left,right,all);
  nav.append(el('span','bchart-caption','Масштаб и перемещение:'),actions);
  toolbar.append(nav);
  const winLab=el('span','bchart-period');
  // Сглаживание есть только для суточной выгрузки, сам баланс оно не меняет.
  if(useDay){
    const smoothBox=el('div','bchart-smoothing');
    const seg=el('div','seg');
    [['0','оригинал'],['7','7 сут.'],['30','30 сут.']].forEach(([k,t])=>{
      const bt=el('button',String(S.balSmooth)===k?'on':'',t);
      bt.type='button'; bt.title=k==='0'?'Исходные суточные значения':'Скользящее среднее за '+k+' суток (только график)';
      bt.addEventListener('click',()=>{
        S.balSmooth=+k;
        seg.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===bt));
        draw();
      });
      seg.append(bt);
    });
    smoothBox.append(el('span','bchart-caption','Сглаживание:'),seg);
    toolbar.append(smoothBox);
  }
  toolbar.append(winLab);
  const smooth=(arr,k)=>{
    if(!useDay||!k) return arr;
    const h=Math.floor(k/2);
    return arr.map((x,i)=>{
      if(x==null) return null;
      let sum=0,c=0;
      for(let j=Math.max(0,i-h);j<=Math.min(arr.length-1,i+h);j++){
        if(arr[j]!=null){ sum+=arr[j]; c++; }
      }
      return c?sum/c:null;
    });
  };
  function draw(){
    const w=currentWindow(), count=w.b-w.a+1;
    const visible=arr=>arr.slice(w.a,w.b+1);
    // Сглаживание считаем по полному ряду ДО выделения окна: края при
    // пролистывании не должны искусственно меняться из-за обрезки соседних дат.
    const k=useDay?S.balSmooth:0;
    plot.innerHTML=balChartSVG(visible(periods),visible(smooth(sup,k)),visible(smooth(useVals,k)),
      visible(smooth(allowLine,k)),scn?visible(smooth(scn,k)):null,visible(analyzed),lab,S.cal.balPct!=null?S.cal.balPct:10);
    zOut.disabled=count>=n;
    zIn.disabled=count<=minVisible;
    left.disabled=w.a===0;
    right.disabled=w.b===n-1;
    all.disabled=count===n;
    winLab.textContent=(count===n?'Весь период: ':'На графике: ')+lab(periods[w.a])+' — '+lab(periods[w.b])+ ' · '+count+' '+countUnit;
    winLab.title='Всего в выгрузке '+n+' '+countUnit+'; окно графика можно менять кнопками −/+, ◀/▶.';
  }
  ch.append(toolbar,plot);
  host.append(ch);
  draw();
  const noSup=periods.filter((_,i)=>sup[i]==null).length;
  const noUse=periods.filter((_,i)=>sup[i]!=null&&useVals[i]==null).length;
  if(noSup||noUse) host.append(el('div','balrow mut',
    [noSup?'Без тех. учёта: '+noSup+' '+unit:null, noUse?'без данных ПУ: '+noUse+' '+unit:null].filter(Boolean).join(', ')+
    ' — серые полосы на графике, из сумм и подбора исключены.'));

  // авто-сценарии
  const scenarios=[];
  if(excessSum>0){
    const remv=excess.slice(); const pick=[]; const pool=cands.slice();
    for(let it=0; it<8 && pool.length; it++){
      // выбираем ПУ с максимальным «полезным» вкладом, штрафуя перелёт:
      // закрыть разницу точнее важнее, чем закрыть её с многократным запасом
      let best=null, bg=0, bi=-1;
      pool.forEach((c,idx)=>{
        const gain=buckets.reduce((s,ix,k)=>s+Math.min(bSum(defOf(c.r),ix),remv[k]),0);
        const score=gain-0.2*Math.max(0,c.contrib-gain);
        if(score>bg){ bg=score; best=c; bi=idx; }
      });
      if(!best || bg<Math.max(50,excessSum*0.02)) break;
      pick.push(best); pool.splice(bi,1);
      buckets.forEach((ix,k)=>{ remv[k]=Math.max(0,remv[k]-bSum(defOf(best.r),ix)); });
      if(1-remv.reduce((a,c)=>a+c,0)/excessSum>=0.95) break;
    }
    if(pick.length) scenarios.push({name:'Автоподбор под сверхнорматив', hint:'жадный алгоритм: добирает ПУ, пока разница не закрыта', set:pick});
  }
  const sync=cands.filter(c=>{
    const d=periods.map((_,i)=>analyzed[i]?defOf(c.r)[i]:null);
    const im=periods.map((_,i)=>analyzed[i]?(sup[i]-useVals[i]):null);
    return pearson(d,im)>=0.5;
  });
  if(sync.length) scenarios.push({name:'Синхронные с небалансом', hint:'дефицит этих ПУ растёт в те же '+(useDay?'дни':'месяцы')+', что и небаланс', set:sync});
  const reds=cands.filter(c=>c.r.cls==='red');
  if(reds.length) scenarios.push({name:'Красная зона целиком', hint:'все кандидаты из красной зоны рейтинга', set:reds});
  const top3=cands.slice(0,Math.min(3,cands.length));
  if(top3.length) scenarios.push({name:'Топ-'+top3.length+' по объёму', hint:'самые крупные оценки недоучёта', set:top3});

  if(excessSum>0 && cands.length){
    const covAll=covOf(recOf(cands));
    if(covAll/excessSum<0.5) host.append(el('div','note','Даже все кандидаты вместе закрывают лишь '+fmt(covAll/excessSum*100)+'% сверхнорматива — остальное, скорее всего, вне этого списка: потребители, которых нет в выгрузке, бездоговорные подключения, ошибка тех. учёта ввода или технические потери выше норматива. Проверьте состав ТП и показания ввода.'));
  }
  host.append(el('div','dh','Авто-сценарии — кто мог бы закрывать разницу'));
  if(excessSum<=0 && !selected.length){
    host.append(el('div','note ok','При пороге '+fmt(S.cal.balPct)+'% сверхнормативных потерь нет — небаланс подстанции в допуске. Можно снизить порог и посмотреть, кто «съедает» остаток, или работать по рейтингу.'));
  } else if(!cands.length){
    host.append(el('div','note','Кандидатов нет: ни у одного ПУ этой подстанции нет оценки недоучёта. Сценарии появятся, когда рейтинг найдёт признаки с оценкой объёма (S1–S3, S13, S14 и др.).'));
  }
  if(cands.length && scenarios.length){
    const sb=el('div','scenbox');
    scenarios.forEach(sc=>{
      const recS=recOf(sc.set), covS=covOf(recS), addS=recS.reduce((a,c)=>a+c,0);
      const active=selected.length===sc.set.length && sc.set.every(c=>S.balSel[c.key]);
      const card2=el('div','scen'+(active?' onb':''));
      card2.tabIndex=0;card2.setAttribute('role','button');card2.setAttribute('aria-pressed',String(active));card2.title=active?'Снять выбранный сценарий':'Применить сценарий';
      card2.innerHTML='<b>'+esc(sc.name)+'</b><div class="meta">'+sc.set.length+' ПУ · +'+fmt(Math.round(addS))+' кВт·ч'+(excessSum>0?' · закрывает '+fmt(covS/excessSum*100)+'% сверхнорматива':'')+'<br>'+esc(sc.hint)+' — '+esc(sc.set.slice(0,4).map(c=>c.r.meter.id).join(', '))+(sc.set.length>4?'…':'')+'</div>';
      card2.addEventListener('click',()=>{
        S.balSel={};
        if(!active) sc.set.forEach(c=>S.balSel[c.key]=true);
        renderBalance();
      });
      sb.append(card2);
    });
    host.append(sb);
  }

  // ручной список кандидатов. v5.2: галочка — в сценарий; клик по строке раскрывает ту же карточку ПУ,
  // что в рейтинге (график с аномалиями, признаки, чек-лист), — без перехода на другую вкладку
  if(cands.length){
    host.append(el('div','dh','Кандидаты на проверку'));
    host.append(el('div','balrow mut','Галочка — добавить в сценарий. Клик по строке — карточка ПУ: график с аномалиями, признаки и чек-лист, как в рейтинге.'));
    const maxShow=40;
    const visible=cands.filter((c,i)=>i<maxShow || S.balSel[c.key] || S.balOpen[c.key]);
    const months=S.data.months;
    visible.forEach(c=>{
      const on=!!S.balSel[c.key], r=c.r, m=r.meter;
      const row=el('div','bcand '+r.cls+(on?' onb':'')+(S.balOpen[c.key]?' openrow':''));
      row.dataset.key=c.key;
      row.tabIndex=0; row.setAttribute('role','button'); row.setAttribute('aria-expanded',String(!!S.balOpen[c.key]));
      row.title='Открыть или свернуть карточку ПУ '+m.id;
      // отдельная зона галочки: её клик выбирает ПУ в сценарий и не раскрывает карточку
      const pick=el('label','bpick');
      pick.title='Добавить в сценарий / убрать из сценария';
      const cb=document.createElement('input');
      cb.type='checkbox'; cb.checked=on; cb.setAttribute('aria-label','В сценарий: ПУ '+m.id);
      cb.addEventListener('change',()=>{
        if(cb.checked) S.balSel[c.key]=true; else delete S.balSel[c.key];
        renderBalance();
      });
      pick.append(cb);
      pick.addEventListener('click',e=>e.stopPropagation());
      const alone=excessSum>0?covOf(recOf([c]))/excessSum*100:null;
      const chips=r.flags.map(f=>'<span class="chip'+(f.weak?' weakchip':'')+'" title="'+esc(f.title)+(f.info?' · справочно':'')+'">'+f.code+'</span>').join('');
      row.append(pick);
      row.append(el('div','binfo','<div><span class="dot '+r.cls+'"></span><span class="mono">'+esc(m.id)+'</span>'+
        (m.ctype?'<span class="chip typechip">'+(m.ctype==='ul'?'юр':'физ')+'</span>':'')+
        (m.dup?'<span class="chip dupchip">дубль '+m.dup+'</span>':'')+'</div>'+
        ((m.name||m.addr)?'<div class="sub">'+esc([m.name,m.addr].filter(Boolean).join(' · '))+'</div>':'')));
      row.append(el('div','bchips',chips||'<span class="mut">—</span>'));
      row.append(el('div','bscore','<div class="bar"><i style="width:'+r.score+'%"></i></div><span class="mono">'+r.score+'</span>'));
      row.append(el('div','bamt','<span class="amt">+'+fmt(Math.round(c.contrib))+' кВт·ч</span>'+(alone!=null?'<span class="cov">один закрывает '+fmt(alone)+'%</span>':'')));
      const toggle=()=>{
        // локальное раскрытие, как в рейтинге: список и график баланса не перерисовываются
        S.balOpen[c.key]=!S.balOpen[c.key];
        if(!S.balOpen[c.key]) delete S.balOpen[c.key];
        row.classList.toggle('openrow',!!S.balOpen[c.key]);
        row.setAttribute('aria-expanded',String(!!S.balOpen[c.key]));
        const nx=row.nextElementSibling;
        if(nx && nx.classList.contains('detail')) nx.remove();
        if(S.balOpen[c.key]) row.after(detailPanel(r, months));
      };
      row.addEventListener('click',toggle); // Enter/пробел — общий обработчик role="button" вызывает click
      host.append(row);
      if(S.balOpen[c.key]) host.append(detailPanel(r, months));
    });
    if(cands.length>visible.length) host.append(el('div','balrow mut','Показаны первые '+maxShow+' кандидатов по объёму + все выбранные и раскрытые (всего '+cands.length+').'));
  }
  host.append(el('div','note',(useDay?'Суточные объёмы недоучёта — оценки из рейтинга, разложенные по дням пропорционально суточной недостаче (нормированы к итоговой оценке каждого ПУ).':(hasDay?'Помесячные объёмы недоучёта — суммы суточной раскладки по дням полных месяцев (дни неполных месяцев не входят).':'Помесячные объёмы недоучёта — оценки из рейтинга (нормированы к итоговой оценке каждого ПУ).'))+' Сценарий — это гипотеза для проверки на местах, а не расчёт для доначисления: совпадение объёмов и месяцев указывает, где искать, но подтверждает только акт.'));
}

/* ---------- вкладка «Алгоритмы» ---------- */
const ALG_DOC = [
 ['S1','Начальные нули → начало активности','До первой активности идут нулевые значения. Без даты установки/подключения этот префикс неоднозначен.','Возможны новый ПУ, неполный архив или отключённый объект. Префикс исключён из динамических признаков; исходный график и суммы сохранены.','0 · справочно','По начальному нулевому префиксу оценка недоучёта не формируется.'],
 ['S2','Рваный профиль','20–85% нулей чередуются со всплесками; максимум ≥4× среднего расхода с учётом нулей, ≥3 перехода «ноль↔расход». v5.0: сначала проверка сохранения объёма — средний расход вместе со всплесками ≥50% типичного для группы или всплески растут пропорционально паузе перед ними.','Если объём сохраняется, всплеск — это накопленный расход «нулевых» месяцев (съём раз в несколько месяцев): энергия не потеряна, признак справочный (метка Q8), уровни ряда не анализируются. Если не сохраняется — большую часть времени энергия идёт мимо ПУ.','до 45','Недоучёт ≈ (80% типичного уровня группы − средний расход ПУ) × число месяцев.'],
 ['S3','Ступенчатое падение','Существует точка, после которой уровень падает до ≤80% прежнего и держится (глубокая ступень — по доле месяцев или медианам годовых блоков; неглубокая — только при выдержке от года). v5.0: ряд приводится к сезонному профилю группы, окно «до» — не короче года; точка перелома — по минимуму отклонений от двух уровней. v5.3: уровень «до» — по всем известным месяцам от начала активности до перелома (без «спящего» начала, когда дом ещё не жилой); до ступени нужен год истории (известно ≥75% месяцев), и ступень не переносится на более позднюю дату — иначе признак не срабатывает. Если своя сезонность ПУ сильнее групповой (электроотопление, кондиционер; минимум две зимы с летом рядом), перелом ищется по наибольшему годовому падению к тем же месяцам годом раньше, зима и лето сравниваются отдельно, в описании и на графике — пики сезонов с изменением к прошлому сезону.','Магнит, шунт или обвод дают именно ступень: резко вниз — и новый «потолок» надолго. Либо объект обесточен или сменил режим — это различает проверка балансом ТП (Б1).','12–50','Недоучёт ≈ Σ(прежний уровень × сезонный профиль месяца − факт) после точки перелома; у ПУ со своей сезонностью ожидаемый расход — тот же месяц до перелома (на графике — фиолетовый пунктир «ожидалось бы»); затем × подтверждённая балансом доля.'],
 ['S3б','Провал с восстановлением','Окно 4–24 мес. с уровнем ≤50% от уровня по обе стороны (оба «берега» ≥100 кВт·ч); длинный провал весит больше. v5.0: с поправкой на сезон группы; провал, повторяющий те же месяцы прошлого года, — собственный сезон, не признак. v5.3: сезонность проверяется помесячно — каждый месяц окна против тех же месяцев других лет, до и после провала (лето у дома с электроотоплением больше не «провал»).','Классика «вмешательство → контрольная проверка»: до и после провала расход нормальный. Если доначисления за провал не было — его пора считать.','16–34','Недоучёт ≈ Σ(уровень до провала × сезонный профиль − факт) внутри окна.'],
 ['S4','Затухание расхода','Медиана последних 4 мес. ≤35% собственной базы (база ≥40 кВт·ч), с поправкой на сезон группы. v5.0: если те же месяцы год назад были примерно такими же (≥60%), это собственный сезон, не затухание.','Плавное сползание к нулю без сезонной причины — либо начали воровать, либо объект пустеет. Требует уточнения статуса.','8–14',''],
 ['S5','Нули при живой группе','≥3 нулевых месяца, когда медиана группы ≥25 кВт·ч; нули зимой весят больше.','Когда все соседи по ТП потребляют, а этот ПУ — нет, «нет данных» превращается в «нет учёта».','до 14',''],
 ['S6','Замороженные показания','≥4 мес. подряд одно и то же ненулевое значение, либо разброс CV ≤3% при ≥8 мес. v5.0: вес растёт с длиной серии (год одинаковых показаний — 24 б.); при округлении показаний до 50 повторы ожидаемы — тогда работает только S7.','Живая нагрузка так себя не ведёт: либо счётный механизм стоит, либо из месяца в месяц переписывают одну цифру (начисление по среднему).','11–24',''],
 ['S7','Круглые числа','≥70% значений кратны 50 при ≥8 ненулевых мес.','Показания передаются «на глаз», без съёма — сам по себе не криминал, но повод для контрольного обхода.','6 (слабый)',''],
 ['S8','Ниже соседей','Средний расход <30% медианы группы и ниже 10-го перцентиля (группа ≥8 ПУ, медиана ≥60).','Возможно пустующее жильё, а возможно — обвод. Работает только в связке с другими признаками.','8 (слабый)',''],
 ['S9','Против сезона','Отношение зима/лето ≤60% от группового при выраженной зимней сезонности группы.','У соседей зимой расход растёт, здесь проваливается — типично для сезонного «прикручивания» учёта.','10',''],
 ['S10','Мощность простаивает','Разрешённая мощность ≥10 кВт при фактических ≤15 кВт·ч/мес; либо для крупных подключений расход — мизерная доля мощности (от 30 кВт — <1,5%, от 100 кВт — <3%, от 200 кВт — <5% теоретического потолка).','Подключение есть, расхода почти нет: либо мощность «бумажная», либо часть нагрузки запитана мимо ПУ. Проверить договор и схему присоединения.','7–8 (слабый)',''],
 ['S11','Синхронность с небалансом ТП','v5.0: только при сверхфоновом небалансе ТП (небаланс выше min(норматив, фон ТП) хотя бы на 1% отпуска). Изменения ПУ к тем же месяцам прошлого года против изменений сверхфонового небаланса — корреляция ≥0,6; на рядах короче двух лет — по уровням, порог 0,7.','Украденное не исчезает — оно всплывает в потерях ТП. Сравнение год к году убирает сезонность: раньше ПУ с летним пиком (кафе, базы отдыха) «совпадали» с зимним ростом техпотерь. S11, D3 и Б1 — одно свидетельство: засчитывается сильнейшее.','12',''],
 ['S12','Разовый всплеск в мёртвом ряду','≥60% нулей, 1–2 крупных значения (суммарно ≥500 кВт·ч) и тишина вокруг.','Похоже на доначисление по акту или съём накопленного при проверке — поднять документы и понять, почему после снова ноль.','12 (слабый)',''],
 ['S13','Ступенчатый рост с низкой базы','Долгий стабильно низкий уровень, затем устойчивый рост в ≥2,5 раза. Резкий скачок (за 4 мес. более чем вдвое) — сильный признак; плавный многолетний рост в ≥4 раза — умеренный; плавный меньше — слабый (бизнес мог вырасти).','Зеркало ступенчатого падения: объект, который «вдруг» стал потреблять в разы больше, чаще всего потреблял столько и раньше — мимо учёта. Точку скачка сверить с заменой ПУ/проверкой: недоучёт был ДО неё. По выборке подтверждённых случаев — второй по частоте признак.','12–28','Недоучёт ≈ (новый уровень − старый) × месяцы до скачка.'],
 ['S14','Многолетнее угасание','Годовые медианы ползут вниз без резкой ступени: минимум 4 года данных, падение с пикового года на ≥40% (сильный сигнал ≥70%), снижение подтверждается минимум два года подряд. Если группа просела так же — балл снижается.','Ловит «аккуратное» хищение, наращиваемое постепенно, которое не даёт ступени и потому невидимо для S3. Альтернатива — медленное сворачивание деятельности: проверяется состоянием объекта на месте.','16–28','За последний год ≈ (пиковый уровень − текущий) × 12.'],
 ['S15','Короткое обнуление с восстановлением','База предшествующих 12 мес. ≥100 кВт·ч и ≥6 известных месяцев; 2–3 мес. до ≤5% базы; восстановление до ≥80% за следующие 3 мес.','Повторяющаяся сезонная низкая нагрузка и массовые провалы группы отфильтрованы при наличии данных. Компенсирующий всплеск отдельно отмечается как возможный перенос начислений.','40','Добавляет приоритет проверки, но не придумывает объём или дату начала нарушения.'],
 ['S16','Повторные локальные провалы','От 3 отдельных провалов на 1–3 мес. до ≤15% предшествующей базы ≥100 кВт·ч с восстановлением до ≥80%.','Один длинный простой не считается несколькими событиями. Сезонные повторения и массовые провалы отфильтрованы; нерегулярные начисления всё равно требуют проверки.','до 36','Объём недоучёта не рассчитывается.'],
 ['S17','Устойчивое падение год к году','От 4 последовательных месяцев до ≤50% тех же месяцев предыдущего года, прежние значения ≥100 кВт·ч; спад группы учитывается.','Сравнение одинаковых календарных месяцев снижает влияние сезонности. Простой и изменение деятельности не исключены. Неизвестный месяц разрывает серию. v5.3: на графике и в описании — все такие эпизоды, баллы — по самому длинному.','до 40','Объём недоучёта не рассчитывается.'],
 ['D1','Нулевые сутки при живой группе','[Суточные выгрузки] ≥4 суток с нулём (≤0,3 кВт·ч) при медиане соседей ≥1 кВт·ч/сут; объект активен ≥7 дней, нулевых не больше 60% (иначе это дача выходного дня).','Дом, который «выключается» на сутки, пока соседи потребляют, — либо обвод/отключение учёта, либо отъезды: журнал событий ПУ расставит точки.','до 16','Недоучёт ≈ суточная база × число нулевых суток.'],
 ['D2','Суточный провал','[Суточные выгрузки] ≥5 дней подряд ниже 30% собственной суточной базы после ≥5 активных дней.','Ступень S3 на суточном масштабе: вмешательство или отключение учёта видно за дни, а не за месяцы.','10–28','Недоучёт ≈ Σ(база − факт) за дни провала.'],
 ['D3','Синхронность с суточным небалансом','[Суточные выгрузки] Недельные суммы недостачи ПУ против недельного сверхфонового небаланса ТП (≥6 полных недель), корреляция ≥0,6.','Недельные суммы убирают ритм «будни/выходные»: раньше любое юрлицо с пониженным потреблением в выходные «совпадало» с небалансом.','12',''],
 ['Б1','Изменение подтверждено балансом ТП','v5.0: небаланс ТП по месяцам раскладывается на техпотери (a + b·отпуск + c·отпуск², все ≥0) и вклады всех подозрительных ПУ одновременно. Б1 — если в небалансе видно ≥60% предполагаемой недостачи ПУ и это заметно больше погрешности. Если видно ≤20% (и верхняя граница ниже 75%), баллы описаний этого изменения снижаются ×0,3–0,5.','Если ввод ТП изменился вместе с ПУ — потребление действительно упало (арендатор съехал), а не ушло мимо учёта. Совместная оценка не путает одновременные события в одной ТП; постоянную с начала ряда недостачу балансом от техпотерь не отличить — она отмечается как «не выделяется».','12','Оценка недоучёта × подтверждённая доля; сумма оценок по ТП за месяц не больше небаланса сверх техпотерь.'],
 ['S18','Снижение сезонных пиков (справочно)','v5.5. Пик зимы (максимум месяцев ноя–мар) и пик лета (июн–авг) сравниваются с пиком того же сезона в прошлый раз. Срабатывает, если последний пик (не старше 15 мес. от конца ряда) ниже прошлого на ≥30% и с поправкой на группу, а уровень сезона (медиана его месяцев) тоже ниже (≤90%); или второй сезон подряд ниже позапрошлого пика на ≥30%. Прошлый пик — не меньше 100 кВт·ч. Сезоны сравниваются по одним и тем же календарным месяцам: если выгрузка начинается или кончается посреди сезона, неполный сезон сравнивается с теми же месяцами прошлого (для вывода нужно не меньше трёх общих месяцев, иначе берётся предыдущий полный сезон). Через разовый всплеск (пик ≥2,5× соседних месяцев — похоже на досчёт) и через сезоны со сторно сравнения не делаются.','Часть схем обходит учёт только под большой нагрузкой — электроотопление, кондиционер, мощное оборудование: база идёт через ПУ, а сезонная «добавка» пропадает или срезается. Ступень (S3) и падение год к году (S17) такое видят поздно или не видят, если остальные месяцы в норме. Тот же след оставляют тёплая зима, отъезд жильцов, замена техники, переход на газ (тогда же Г1) — поэтому это повод проверить, а не доказательство.','0 · справочно','Объём не оценивает. На графике карточки — все пики зимы и лета с объёмом и % к прошлому пику того же сезона, в карточке — таблица пиков. Вес признака будет подобран после проверки на выгрузке.'],
 ['Г1','Исчезла отопительная нагрузка (вероятен газ)','v5.1, только быт (физ. лица; при неизвестном типе — до 15 кВт). Зима = дек–фев, лето = июн–авг. Была зима с электроотоплением: медиана трёх зимних месяцев ≥2× лета и выше его на ≥300 кВт·ч/мес. После неё каждая зима без отопительной добавки (≤1,5× лета или добавка ≤20% прежней), опустилась к прежней базе и не пустая (≥35% прежнего лета); лето тоже сохранилось (≥35%). В карточке — последний месяц с отоплением и первый месяц сезона без него.','Самая частая законная причина резкого зимнего спада в частном секторе — переход с электроотопления на газ. Хищение обычно снижает расход во все сезоны, здесь пропадает только сезонная добавка. Так же выглядит котёл или обогреватели, подключённые помимо ПУ, поэтому признак не снимает ПУ с контроля, а ставит первым пунктом сверку с реестром газификации.','0 / +12','Свой объём не оценивает. Баллы и оценка недоучёта провалов S3, S4, S14, S17, начавшихся с последней зимы с отоплением, ×0,5 (×0,25, если в колонке «Газ» да и дата рядом с переходом) — когда после перехода видна хотя бы одна полная зима. Не снижаются, если баланс ТП подтвердил недостачу (Б1). При «Газ = нет» Г1 сам даёт +12.'],
];
function renderAlgs(){
  const host=$('#algs');
  host.innerHTML = '<div class="note">Скоринг 0–100: сумма баллов признаков с ограничением зависимых сигналов. Это приоритет проверки, не вероятность БУ. <b>≥'+CLS.red+' — красная зона</b> (проверка в приоритете), <b>'+CLS.amber+'–'+(CLS.red-1)+' — наблюдение</b>, ниже — норма.'+(calDirty()?' <b>Пороги и веса изменены калибровкой</b> (вкладка «Настройки») — ниже описаны базовые значения.':' Ужесточить или смягчить любой признак можно во вкладке «Настройки».')+' Полностью нулевые ряды вынесены в отдельный класс. Слабые признаки (S7, S8, S10, S12, плавный S13) поодиночке дают не больше 15 баллов. Описания одного провала (S2–S5, S14–S17, D1, D2) к самому сильному добавляют не больше 10 баллов; S11, D3 и Б1 — одно свидетельство баланса, засчитывается сильнейшее. <b>v5.0:</b> если в файле есть строка «Отпуск в сеть», каждая гипотеза с оценкой объёма проверяется балансом ТП (Б1): подтверждённая усиливается, опровергнутая понижается, а оценка недоучёта умножается на подтверждённую долю. Сумма оценок по ТП за месяц не превышает небаланс сверх технических потерь. Итог «оценка недоучёта» считается только по красной и жёлтой зонам. Оценки ориентировочные, для приоритизации, а не для доначисления; сверху они ограничены и потолком диапазона техприсоединения (верхняя граница диапазона мощности × 730 ч − оплаченный объём).</div>' +
  ALG_DOC.map(a=>{
    const off = TUNE_ORDER.some(k=>S.cal.algOff[k] && ALG_META[k].code===a[0]);
    return '<div class="alg'+(off?' algoff':'')+'"><div class="algh"><span class="chip">'+a[0]+'</span><b>'+a[1]+'</b>'+(off?'<span class="chip dupchip">отключён</span>':'')+'<span class="pts">'+a[4]+' б.</span></div>'+
    '<div class="algrow"><span>Критерий</span><div>'+a[2]+'</div></div>'+
    '<div class="algrow"><span>Почему работает</span><div>'+a[3]+'</div></div>'+
    (a[5]?'<div class="algrow"><span>Оценка объёма</span><div>'+a[5]+'</div></div>':'')+
  '</div>'; }).join('');
}

/* ---------- калибровка: «крутилки» в Методике ---------- */
const LEVEL_NAMES = {'-2':'намного мягче','-1':'мягче','0':'базовый','1':'строже','2':'намного строже'};
const TUNE_ORDER = ['sleeper','ragged','step','valley','fade','zeroAlive','frozen','round','peers','season','idle','imb','lone','stepup','slow','blackout','repeatdip','yearrel','peaks','dzero','ddip','dsync','bal','gas'];
const TUNE_HINT = {
  sleeper:  p=>'справочно: от '+p.minZeros+' начальных нулевых мес.; без даты установки — 0 баллов и без оценки объёма',
  ragged:   p=>'всплеск ≥'+fmt(p.minSpike,1)+'× типичного, переходов «ноль↔расход» ≥'+p.minTrans,
  step:     p=>'ступень засчитывается при падении до ≤'+Math.round(p.rMax*100)+'% прежнего уровня',
  valley:   p=>'провал засчитывается при уровне ≤'+Math.round(p.rMax*100)+'% от «берегов»',
  fade:     p=>'последние месяцы ≤'+Math.round(p.rMax*100)+'% собственной базы',
  zeroAlive:p=>'от '+p.minZeros+' нулевых мес. при живом потреблении группы',
  frozen:   p=>'от '+p.minRun+' мес. одинаковых показаний, либо разброс CV ≤'+fmt(p.maxCV,1)+'%',
  round:    p=>'кратных 50 должно быть ≥'+Math.round(p.minShare*100)+'% значений',
  peers:    p=>'средний расход ниже '+Math.round(p.maxFrac*100)+'% медианы группы',
  season:   p=>'зима/лето ≤'+Math.round(p.maxOwn*100)+'% от группового отношения',
  idle:     p=>'порог «почти нет расхода» — '+p.maxAvg+' кВт·ч/мес (для крупных мощностей масштабируется)',
  imb:      p=>'корреляция провалов с небалансом ТП ≥'+fmt(p.minCorr,2),
  lone:     p=>'разовый объём от '+fmt(p.minSum)+' кВт·ч',
  stepup:   p=>'устойчивый рост уровня в ≥'+fmt(p.minJump,1)+' раза',
  slow:     p=>'падение годовых уровней до ≤'+Math.round(p.rMax*100)+'%',
  blackout: p=>'S15: '+p.minRun+'–3 мес. до ≤'+fmt(p.lowRatio*100)+'% базы; восстановление в течение 3 мес.; базовый вес 40',
  repeatdip:p=>'S16: от '+p.minEvents+' отдельных провалов до ≤'+fmt(p.lowRatio*100)+'% базы с восстановлением; максимум 36 б.',
  yearrel:  p=>'S17: от '+p.minRun+' мес. подряд до ≤'+fmt(p.maxRatio*100)+'% прошлого года; поправка на группу; максимум 40 б.',
  peaks:    p=>'S18: последний пик зимы или лета ниже прошлого пика того же сезона на ≥'+fmt((1-p.maxRatio)*100)+'% (и с поправкой на группу), прошлый пик ≥'+fmt(p.minPeak)+' кВт·ч; справочно — 0 баллов, порог меняет и красную разметку % на графике',
  dzero:    p=>'[сутки] от '+p.minDays+' нулевых суток при живой группе',
  ddip:     p=>'[сутки] провал от '+p.minRun+' дней подряд ниже 30% суточной базы',
  dsync:    p=>'[сутки] корреляция недельной недостачи со сверхфоновым небалансом ≥'+fmt(p.minCorr,2),
  bal:      p=>'Б1: подтверждено, если в небалансе ТП видно ≥'+fmt(p.minSupport*100)+'% предполагаемой недостачи ПУ (и это заметно больше погрешности)',
  gas:      p=>'Г1: зима с отоплением — ≥'+fmt(p.minRatio,1)+'× лета и выше его на ≥'+fmt(p.minExcess)+' кВт·ч/мес; после — без отопительной добавки; провалы после перехода ×0,5',
};

function tuneChanged(){
  saveCal(); applyCal(); markCal();
  if(S.data) recompute(true); else renderAlgs();
}

function tunerNumRow(title, key, min, max, hintText){
  const row = el('div','trow');
  const head = el('div','th','<b>'+title+'</b><span class="tlev mono" style="letter-spacing:0;font-size:13px">'+S.cal[key]+'</span>');
  const range = document.createElement('input');
  range.type='range'; range.min=min; range.max=max; range.step=1; range.value=S.cal[key]; range.className='tr tr-num';
  const hint = el('div','thint', hintText);
  range.addEventListener('input', ()=>{
    let v = +range.value;
    if(key==='red'){ S.cal.red = v; if(S.cal.amber > v-5) S.cal.amber = v-5; }
    else { v = Math.min(v, S.cal.red-5); range.value = v; S.cal.amber = v; }
    head.querySelector('.tlev').textContent = String(+range.value);
  });
  // v5.0: пересчёт — когда слайдер отпущен (раньше на каждом шаге перетаскивания).
  // Порог red может утянуть за собой amber — тогда блок перерисовывается целиком.
  range.addEventListener('change', ()=>{ tuneChanged(); if(key==='red') renderTuner(); });
  row.append(head, range, hint);
  return row;
}

function tunerAlgRow(key){
  const meta = ALG_META[key];
  const off0 = !!S.cal.algOff[key];
  const row = el('div','trow'+(off0?' toff':''));
  const head = el('div','th');
  const cb = document.createElement('input');
  cb.type='checkbox'; cb.checked=!off0; cb.className='talg';
  cb.title='Включить / исключить признак из анализа — адаптация методики под район (промзона, газ и т.п.)';
  head.append(cb, el('span',null,'<span class="chip">'+meta.code+'</span> <b>'+esc(meta.title)+'</b>'), el('span','tlev'));
  const range = document.createElement('input');
  range.type='range'; range.min=-2; range.max=2; range.step=1; range.value=S.cal.levels[key]||0; range.className='tr';
  range.disabled = off0;
  const scale = el('div','tscale','<span>мягче</span><span>базовый</span><span>строже</span>');
  const hint = el('div','thint');
  const paint = ()=>{
    const s = +range.value;
    const p = buildTune({[key]:s})[key];
    const lab = head.querySelector('.tlev');
    if(S.cal.algOff[key]){ lab.textContent='отключён'; lab.className='tlev off'; }
    else { lab.textContent = LEVEL_NAMES[String(s)]; lab.className = 'tlev'+(s<0?' soft':s>0?' hard':''); }
    hint.textContent = TUNE_HINT[key](p)+' · вес признака ×'+String(p.ptsF).replace('.',',')+' · ручной уровень; профиль может ужесточить его или перевести сигнал в справочный режим';
  };
  paint();
  range.addEventListener('input', ()=>{
    S.cal.levels[key] = +range.value;
    paint();
  });
  range.addEventListener('change', tuneChanged);
  cb.addEventListener('change', ()=>{
    if(cb.checked) delete S.cal.algOff[key]; else S.cal.algOff[key]=true;
    row.classList.toggle('toff', !cb.checked);
    range.disabled = !cb.checked;
    paint();
    tuneChanged();
  });
  row.append(head, range, scale, hint);
  return row;
}

function renderTuner(){
  const host = document.getElementById('tuner');
  if(!host) return;
  host.innerHTML = '';
  const glob = el('div','tglob');
  glob.append(
    tunerNumRow('Порог красной зоны (риск ≥)','red',30,70,'выше порог — меньше красная зона; базовое значение — 45'),
    tunerNumRow('Порог жёлтой зоны (риск ≥)','amber',10,40,'всё, что ниже, — «норма»; базовое значение — 20 (держится минимум на 5 ниже красного)')
  );
  host.append(glob);
  TUNE_ORDER.forEach(key=>host.append(tunerAlgRow(key)));
  const foot = el('div','treset');
  const rb = el('button','btn','Вернуть базовые настройки');
  rb.addEventListener('click', ()=>{
    const bp = S.cal.balPct; // норматив потерь — настройка вкладки «Баланс», кнопка её не обещает сбрасывать
    S.cal = defaultCal();S.tpContexts=Object.create(null);S.presetDraft=null;S.presetDraftDirty=false;S.presetUndo=null;
    S.cal.balPct = bp;
    renderTuner();
    renderBooster();
    syncZoneUI();
    tuneChanged();
  });
  foot.append(rb, el('span','mut','Настройки хранятся локально в этом браузере и применяются сразу. Кнопка сбрасывает пороги, веса, бусты приоритета и режим зон.'));
  host.append(foot);
}

/* Метки проверок — только контроль результата, никакого участия в скоринге. */
function renderReview(){
  const host=document.getElementById('review'); if(!host) return;
  host.innerHTML=''; if(!S.an) return;
  const stats=S.an.review;
  host.append(el('div','note','Колонка «Признак» / «Метка» используется только здесь, <b>после</b> расчёта риска. Метки «ВОР» и «НЕ ВОР» не влияют на баллы, признаки и порядок ПУ. Без дат актов это проверка обнаружения исторических аномалий, а не доказательство, что нарушение можно было предсказать до проверки.'));
  if(!stats || !stats.positive.n&&!stats.negative.n){
    host.append(el('div','note','В этой выгрузке нет распознанных контрольных меток. Для проверки качества добавьте отдельную колонку «Признак»: «ВОР», «НЕ ВОР» или пусто. Пустая/неизвестная метка не считается отсутствием нарушения.'));
    return;
  }
  const table=(x,title)=>{
    const box=el('div','review-block'); box.append(el('div','dh',title));
    const tbl=el('table','review-table');
    tbl.innerHTML='<thead><tr><th>Метка из файла</th><th>Всего</th><th>Красная</th><th>Жёлтая</th><th>Без явных признаков</th><th>Нулевой ряд</th></tr></thead><tbody>'+['positive','negative'].map(k=>'<tr><td>'+(k==='positive'?'ВОР':'НЕ ВОР')+'</td><td>'+x[k].n+'</td><td>'+x[k].red+'</td><td>'+x[k].amber+'</td><td>'+x[k].green+'</td><td>'+x[k].dead+'</td></tr>').join('')+'</tbody>';
    box.append(tbl); return box;
  };
  host.append(table(stats,'Все размеченные ПУ'));
  const p=stats.positive, neg=stats.negative;
  const pct=(a,b)=>b?fmt(a/b*100,1)+'%':'—';
  const k=el('div','balkpis');
  [[pct(p.red,p.n),'ВОР в красной зоне'],[pct(p.red+p.amber,p.n),'ВОР в красной или жёлтой'],[pct(neg.red,neg.n),'НЕ ВОР в красной зоне'],[String(stats.unknown),'ПУ без известной метки']].forEach(([v,t])=>{const card=el('div','kpi');card.append(el('div','kv',v),el('div','kl',t));k.append(card);});
  host.append(k);
  host.append(el('div','note','Это показатели на <b>текущем загруженном файле</b> при текущих настройках, не независимая оценка точности. Красный ПУ с меткой «НЕ ВОР» — расхождение с разметкой, а не автоматически доказанная ошибка проверки. Нулевые ряды учитываются отдельно, не скрываются из числа пропущенных «ВОР». Балл — индекс приоритета, не вероятность нарушения.'));
  const filterText=S.cal.zone==='loss'?'Режим зон: по объёму недоучёта. Новые S15–S17 сами по себе не рассчитывают объём; для сравнения обнаружения используйте зоны «по риску».':'Режим зон: по риску. Красная ≥'+CLS.red+', жёлтая ≥'+CLS.amber+'; бусты '+(Object.values(S.cal.boosts||{}).some(Boolean)?'включены':'выключены')+'.';
  host.append(el('div','note',esc(filterText)));
  for(const [type,t] of Object.entries(stats.byType)) host.append(table(t,type==='ul'?'Юридические лица':type==='fl'?'Физические лица':'Неизвестный тип потребителя'));
  const missed=S.an.results.filter(r=>r.meter.reviewLabel==='positive' && (r.cls==='green'||r.cls==='dead'));
  if(missed.length){
    host.append(el('div','dh','Метка «ВОР», но недостаточно баллов: '+missed.length));
    host.append(el('div','note','Отсутствие аномальной динамики не исключает постоянный неучёт с начала доступной истории. Для таких объектов нужны баланс ввода, контрольные измерения, журналы событий и история установки ПУ.'));
    const list=el('div','review-missed');
    missed.forEach(r=>{const bt=el('button','btn',esc(r.meter.id)+' · '+r.score+' б.');bt.type='button';bt.addEventListener('click',()=>openMeterFromReview(r));list.append(bt);});host.append(list);
  }
}
function openMeterFromReview(r){
  S.tab='rank';S.rankQuery=r.meter.id;
  const search=document.getElementById('rankSearch'); if(search)search.value=S.rankQuery;
  S.open={};S.open[r.meter.id+'#'+(r.meter.dup||0)]=true;
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x.dataset.tab==='rank'));
  document.querySelectorAll('.pane').forEach(x=>x.classList.toggle('show',x.id==='pane-rank'));
  renderRank();
  const card=document.querySelector('.openrow');if(card)card.scrollIntoView({behavior:'smooth',block:'start'});
}


/* ---------- экспорт ---------- */
// v5.5: последний пик зимы и лета с изменением к прошлому — для фильтра в Excel
function peaksCsvText(r){
  if(!r.peaks) return '';
  const M=S.an.months;
  return ['winter','summer'].map(k=>{
    const arr=r.peaks[k]; if(!arr.length) return null;
    const e=arr[arr.length-1];
    const cmp=!e.prev ? '' : e.ratio==null ? ', не сравнивается с '+e.prev.label : ', '+peakPct(e.ratio)+' к '+e.prev.label+(e.reliable?(e.cmpMonths?' по '+peakMonthsLabel(e.cmpMonths):''):' — '+peakCmpNote(e,arr));
    return (k==='winter'?'зима ':'лето ')+e.label+' '+fmt(e.val)+' ('+ymLabel(M[e.idx])+cmp+')';
  }).filter(Boolean).join('; ').replace(/\u00A0/g,' ');
}
function exportCSV(){
  if(!S.an) return;
  const rows = [['Место','Класс','№ ПУ','ТП','Абонент','Адрес','Тип','Дубль','Мощность кВт','Средний кВт·ч/мес','Сумма кВт·ч','Риск 0-100','Приоритет (буст)','Признаки','Оценка недоучёта кВт·ч (после сверки с балансом)','Оценка по профилю ПУ кВт·ч','Подтверждено балансом ТП, %','Комментарий','Метка проверки (не участвует в риске)','Качество данных','Баллы признаков','АСКУЭ','Опрос АСКУЭ, %','Профиль анализа','Г1: отопление / газ','Группа сравнения (медиана соседей)','Пики сезонов: последнее изменение (зима / лето)']];
  const g1Text = r => {
    const f=r.flags.find(x=>x.algoKey==='gas'); if(!f||!f.heat) return '';
    const H=f.heat, M=S.an.months, gm=r.meter;
    return 'отопление исчезло: последний месяц с ним '+ymLabel(M[H.hot]).replace(/ /g,' ')+', с '+ymLabel(M[H.to]).replace(/ /g,' ')+' нет; газ по файлу: '+(gm.gas===true?'да'+(gm.gasDate?' ('+gasDateLabel(gm.gasDate).replace(/ /g,' ')+')':''):gm.gas===false?'нет':'не указан')+
      (f.heatFactor?'; баллы провала ×'+String(f.heatFactor).replace('.',','):'')+'; до выезда сверить с реестром газификации';
  };
  // текст из файла, начинающийся с = + - @, Excel принял бы за формулу — экранируем апострофом
  const safe = v => { const t=String(v??''); return /^[=+\-@]/.test(t) ? "'"+t : t; };
  S.an.results.forEach((r,i)=>{
    const bt=r.balanceTest;
    rows.push([i+1, r.needsData?'проверить исходные данные':CLS_RU[r.cls], '="'+r.meter.id+'"', safe(r.meter.tp), safe(r.meter.name), safe(r.meter.addr), r.meter.ctype==='ul'?'юр':r.meter.ctype==='fl'?'физ':'', r.meter.dup?(r.meter.dup+'/'+r.meter.dupOf):'', r.meter.power??'', Math.round(mean(r.meter.values)??0), r.total, r.score, r.boostPts||'',
      r.flags.map(f=>f.code+' '+f.title).join(' | '), r.lossKwh||'', r.lossProfileKwh||'', bt&&isFinite(bt.se)?Math.round(Math.max(0,Math.min(1,bt.k))*100):(r.lossProfileKwh>0?(r.balanceChecked?'не выделяется':'нет баланса ТП'):''),
      r.flags.map(f=>f.detail).join(' || ').replace(/\u00A0/g,' '), safe(r.meter.reviewText), (r.quality||[]).map(q=>q.code+' '+q.detail).join(' || '), r.flags.map(f=>f.code+': '+f.pts+(f.rawPts!=null?' (исходно '+f.rawPts+')':'')).join('; '),askueLabel(r.meter.askue),r.meter.pollPct??'',r.policy?.title||'Без контекста',g1Text(r),r.groupLabel||'',peaksCsvText(r)]);
  });
  const csv = '\uFEFF' + rows.map(r=>r.map(c=>{ const s=String(c??''); return /[;"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
  a.download = 'reiting_riska_PU.csv';
  a.click(); URL.revokeObjectURL(a.href);
}

function downloadTemplate(){
  if(typeof XLSX === 'undefined'){ alert('Для генерации шаблона нужна библиотека Excel — откройте страницу с интернетом.'); return; }
  const now = new Date();
  const head = ['№ ПУ','ТП','Разрешенная мощность, кВт','Тип (юр/физ)','Напряжение, кВ (0,22 / 0,4; пусто = авто)','Абонент','Адрес'];
  const start = new Date(now.getFullYear()-3, now.getMonth(), 1);
  const monthCnt = 37;
  for(let i=0;i<monthCnt;i++){
    const d = new Date(start.getFullYear(), start.getMonth()+i, 1);
    head.push(['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'][d.getMonth()]+' '+d.getFullYear()+', кВт·ч');
  }
  const ex1 = ['230102000001','ТП-000',15,'физ. лицо','','Пример: обычный абонент (напряжение пусто — авто: 0,4)','ул. Примерная, 1', ...Array.from({length:monthCnt},(_,i)=>200+Math.round(80*Math.cos((i%12)/12*2*Math.PI)))];
  const ex2 = ['230102000002','ТП-000',30,'юр. лицо','0,4','Пример: ООО «Организация»','ул. Примерная, 2', ...Array.from({length:monthCnt},(_,i)=>900+Math.round(150*Math.cos((i%12)/12*2*Math.PI)))];
  const ex3 = ['230102000003','ТП-000',15,'физ. лицо','0,22','Пример: однофазный ввод, несмотря на 15 кВт','ул. Примерная, 3', ...Array.from({length:monthCnt},(_,i)=>150+Math.round(60*Math.cos((i%12)/12*2*Math.PI)))];
  const ex4 = ['Отпуск в сеть ТП-000 Т1 ПУ № 100200301','ТП-000','','','','ввод 1 (тех. учёт) — номер ПУ пишите прямо в этой строке','', ...Array.from({length:monthCnt},()=> '')];
  const ex5 = ['Отпуск в сеть ТП-000 Т2 ПУ № 100200302','ТП-000','','','','ввод 2 — при двух тех. учётах строки Т1 и Т2 суммируются','', ...Array.from({length:monthCnt},()=> '')];
  head.splice(7,0,'АСКУЭ (да/нет)','Опрос АСКУЭ, % (0–100)');
  ex1.splice(7,0,'да',92);ex2.splice(7,0,'да',45);ex3.splice(7,0,'нет','');ex4.splice(7,0,'','');ex5.splice(7,0,'','');
  // v5.1: необязательная колонка для признака Г1 (из реестра газификации): да / нет / дата пуска газа
  head.splice(9,0,'Газ (да/нет или дата подключения)');
  ex1.splice(9,0,'да');ex2.splice(9,0,'');ex3.splice(9,0,'03.2024');ex4.splice(9,0,'');ex5.splice(9,0,'');
  const ws = XLSX.utils.aoa_to_sheet([head, ex1, ex2, ex3, ex4, ex5]);
  ws['!cols'] = head.map((h,i)=>({wch: i<10?24:12}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Потребление');
  XLSX.writeFile(wb, 'Shablon_potrebleniya_PU.xlsx');
}

/* Контекстные пресеты: редактирование → объяснение → явное применение.
   Глобальный профиль сохраняется в браузере; назначения по ТП живут только в текущей выгрузке. */
function deepCopy(x){return JSON.parse(JSON.stringify(x));}
function selectedContext(){
  if(S.presetScope==='*')return normalizeContext(S.cal.context);
  return normalizeContext(Object.prototype.hasOwnProperty.call(S.tpContexts,S.presetScope)?S.tpContexts[S.presetScope]:S.cal.context);
}
function updatePresetDraft(patch){
  S.presetDraft=normalizeContext({...S.presetDraft,...patch});S.presetDraftDirty=true;renderPresetEditor();
}
function preparePreset(scope,patch){
  S.presetScope=scope;S.presetDraft=normalizeContext({...selectedContext(),...patch,enabled:true});S.presetDraftDirty=true;
  S.tab='settings';document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.tab==='settings'));
  document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('show',p.id==='pane-settings'));
  renderPresetEditor();document.getElementById('presetEditor')?.scrollIntoView({block:'start',behavior:'smooth'});
}
function policyEffect(p,key){
  if(p.off?.[key])return {text:'Выключен',cls:'offmode'};
  if(p.info?.[key])return {text:'Справочно · 0 баллов',cls:'infomode'};
  if(key==='sleeper')return {text:'Справочно · S1',cls:'infomode'};
  if(key==='frozen'&&p.flatInfo)return {text:'Точные повторы: '+(p.levels[key]||0)+'; низкий CV: справочно',cls:'infomode'};
  const v=p.levels?.[key]||0;
  return {text:(v>0?'+':'')+v+' · '+(v===0?'базовый':v>0?'строже':'мягче'),cls:v>0?'strictmode':''};
}
function renderPresetEditor(){
  const host=document.getElementById('presetEditor');if(!host)return;
  const open=host.querySelector('.preset-logic')?.open||false;
  if(!S.presetDraft)S.presetDraft=selectedContext();
  const d=S.presetDraft;host.innerHTML='';host.className='context-editor';
  const top=el('div','context-top'),label=el('label',null,'Область применения');
  const scope=document.createElement('select');scope.id='presetScope';scope.setAttribute('aria-label','Область применения пресета');
  const opt=(value,text)=>{const o=document.createElement('option');o.value=value;o.textContent=text;scope.append(o);};
  opt('*','Вся выборка · общий профиль');
  (S.an?.tpOverview?.rows||[]).forEach(x=>opt(x.automation.key,x.automation.group));scope.value=S.presetScope;
  scope.addEventListener('change',()=>{S.presetScope=scope.value;S.presetDraft=selectedContext();S.presetDraftDirty=false;renderPresetEditor();});
  label.append(scope);top.append(label);host.append(top);
  host.append(el('div','context-current','Применён: '+esc(contextLabel(selectedContext()))+(S.presetScope!=='*'&&!Object.prototype.hasOwnProperty.call(S.tpContexts,S.presetScope)?' · наследуется общий профиль':'')));
  const en=el('label','context-toggle');const chk=document.createElement('input');chk.type='checkbox';chk.checked=d.enabled;chk.id='presetEnabled';
  chk.addEventListener('change',()=>updatePresetDraft({enabled:chk.checked}));en.append(chk,document.createTextNode('Применять контекстный профиль для выбранной области'));host.append(en);
  host.append(el('div','context-hint','Профиль не снижает порог красной зоны и не добавляет бусты. Противоречащие условиям сигналы становятся строже, справочными или отключаются. Ручное отключение алгоритма сохраняется. Настройки по ТП сбрасываются при загрузке нового файла.'));
  host.append(el('div','context-label','1 · Назначение территории / объектов'));
  const cards=el('div','territory-grid');
  Object.entries(PRESET_TERRITORIES).forEach(([key,p])=>{
    const card=el('div','territory-card'+(d.territory===key?' selected':''));
    const bt=el('button','context-choice'+(d.territory===key?' on':''),esc(p.title));bt.type='button';bt.dataset.territory=key;bt.setAttribute('aria-pressed',String(d.territory===key));
    bt.addEventListener('click',()=>updatePresetDraft({territory:key,activeMonths:[],enabled:true}));
    const why=el('details');why.innerHTML='<summary>Когда применять</summary><div>'+esc(p.scope)+'. '+esc(p.desc)+'</div>';
    card.append(bt,why);cards.append(card);
  });host.append(cards);
  function choices(title,field,list){
    host.append(el('div','context-label',title));const group=el('div','context-options');group.setAttribute('aria-label',title);
    Object.entries(list).forEach(([key,v])=>{const b=el('button','context-choice'+(d[field]===key?' on':''),esc(v.title));b.type='button';b.dataset[field]=key;b.setAttribute('aria-pressed',String(d[field]===key));b.title=v.desc;b.addEventListener('click',()=>updatePresetDraft({[field]:key,enabled:true}));group.append(b);});
    host.append(group,el('p','context-description',esc(list[d[field]].desc)));
  }
  choices('2 · Отопление бытовых объектов','heating',PRESET_HEATING);
  if((d.territory==='gas'&&d.heating==='electric')||(d.territory==='cold'&&d.heating==='gas'))host.append(el('div','context-hint context-warning','Выбраны противоречащие признаки отопления. Уточните назначение: при конфликте ожидание зимнего роста отключается, а более осторожные пороги сохраняются.'));
  if(['sntSeasonal','agro','school','resort'].includes(d.territory)){
    host.append(el('div','context-label','Активные месяцы · подтвердите фактический календарь'));
    const months=el('div','context-options'),selected=activeMonthsFor(d);
    MONTHS_RU.forEach((name,i)=>{const bt=el('button','context-choice'+(selected.includes(i)?' on':''),name);bt.type='button';bt.dataset.activeMonth=i;bt.setAttribute('aria-pressed',String(selected.includes(i)));bt.addEventListener('click',()=>{
      const next=selected.includes(i)?selected.filter(x=>x!==i):selected.concat(i).sort((a,b)=>a-b);
      if(!next.length){host.querySelector('.context-prep-status').textContent='Оставьте хотя бы один активный месяц.';return;}
      updatePresetDraft({activeMonths:next,enabled:true});});months.append(bt);});host.append(months);
    host.append(el('p','context-description','Период полностью вне активных месяцев рассматривается как вопрос режима работы, а не автоматически как БУ. Смешанные эпизоды и собственная история продолжают анализироваться.'));
  }
  choices('3 · Состав потребителей','population',PRESET_POPULATIONS);
  choices('4 · Успешность опроса АСКУЭ в этой области','poll',PRESET_POLLS);
  host.append(el('p','context-description','Диапазоны: [0;30), [30;50), [50;80), [80;100]. Это доля успешных опросов за анализируемый период, не доля оснащённых ПУ. Индивидуальная колонка «Опрос АСКУЭ, %» уточняет общий профиль; для АСКУЭ «нет» общий процент не применяется.'));
  choices('5 · Происхождение объёмов','source',PRESET_SOURCES);
  const meta=el('label','context-toggle');const auto=document.createElement('input');auto.type='checkbox';auto.checked=S.cal.useAskue!==false;auto.id='useAskueMetadata';
  auto.addEventListener('change',()=>{
    S.presetUndo={cal:deepCopy(S.cal),tp:deepCopy(S.tpContexts)};S.cal.useAskue=auto.checked;
    const before=S.an?.totals.red;saveCal();applyCal();if(S.data)recompute(true);else renderPresetEditor();
    S.presetLastChange='Учёт метаданных АСКУЭ '+(auto.checked?'включён':'выключен')+(before!=null?'. Красных ПУ: '+before+' → '+S.an.totals.red:'')+'.';renderPresetEditor();
  });meta.append(auto,document.createTextNode('Учитывать «АСКУЭ» и «Опрос АСКУЭ, %» из файла автоматически (для всех ПУ)'));host.append(meta);
  host.append(el('p','context-description','Пустое поле — неизвестно. «Да» не означает успешный опрос, а «нет» не означает нарушение. Даже без территориального профиля явные метаданные включают осторожные правила качества для конкретного ПУ.'));
  const logic=el('details','preset-logic');logic.open=open;
  logic.append(el('summary',null,'Почему флаги будут настроены именно так · '+Object.keys(ALG_META).length+' алгоритмов'));
  logic.append(el('p','context-description','Предварительные правила по типу потребителя. После применения в карточке ПУ видны также его АСКУЭ, полнота истории, сезонный эпизод и качество группы. Баллы и оценки объёма у справочных сигналов равны нулю. Численные границы — инженерные стартовые настройки, не норматив и не обученная вероятность.'));
  const f=compileContext(d,'fl',S.cal.levels,S.cal.algOff),u=compileContext(d,'ul',S.cal.levels,S.cal.algOff),table=el('table','context-table');
  table.innerHTML='<thead><tr><th>Флаг</th><th>Физлица</th><th>Юрлица</th><th>Обоснование</th></tr></thead><tbody>'+Object.entries(ALG_META).map(([k,a])=>{
    const ef=policyEffect(f,k),eu=policyEffect(u,k),reasons=[...new Set(f.rules.concat(u.rules).filter(x=>x.key===k).map(x=>x.origin+': '+x.reason))];
    return '<tr><td><b>'+esc(a.code)+'</b><br>'+esc(a.title)+'</td><td class="'+ef.cls+'">'+esc(ef.text)+(TUNE_HINT[k]?'<small>'+esc(TUNE_HINT[k](buildTune(f.levels)[k]))+'</small>':'')+'</td><td class="'+eu.cls+'">'+esc(eu.text)+(TUNE_HINT[k]?'<small>'+esc(TUNE_HINT[k](buildTune(u.levels)[k]))+'</small>':'')+'</td><td>'+reasons.map(esc).join('<br>')+(reasons.length?'':'Без контекстного изменения. Сохраняются ручные настройки и ограничения базовой методики.')+'</td></tr>';
  }).join('')+'</tbody>';const tw=el('div','context-table-wrap');tw.append(table);logic.append(tw);host.append(logic);
  const status=el('div','context-prep-status',S.presetDraftDirty?'Есть неподтверждённые изменения. Расчёт пока прежний.':esc(S.presetLastChange||'Выберите условия, проверьте логику и нажмите «Применить».'));status.setAttribute('role','status');host.append(status);
  const actions=el('div','context-actions');
  const apply=el('button','btn context-apply','Применить пресет');apply.type='button';apply.id='applyContextPreset';apply.addEventListener('click',()=>{
    S.presetUndo={cal:deepCopy(S.cal),tp:deepCopy(S.tpContexts)};const before=S.an?deepCopy(S.an.totals):null;
    if(S.presetScope==='*')S.cal.context=normalizeContext(S.presetDraft);else S.tpContexts[S.presetScope]=normalizeContext(S.presetDraft);
    S.presetDraftDirty=false;saveCal();applyCal();if(S.data)recompute(true);
    S.presetLastChange='Пресет применён '+(S.presetScope==='*'?'к общей области':'к '+S.presetScope)+'.'+(before?' Красных ПУ: '+before.red+' → '+S.an.totals.red+'; жёлтых: '+before.amber+' → '+S.an.totals.amber+'. Это изменение приоритета, не проверка точности.':'');renderPresetEditor();
  });actions.append(apply);
  const neutral=el('button','btn','Подготовить базовый профиль');neutral.type='button';neutral.addEventListener('click',()=>{S.presetDraft=defaultContext();S.presetDraftDirty=true;renderPresetEditor();});actions.append(neutral);
  if(S.presetScope!=='*'){
    const inherit=el('button','btn','Вернуть наследование');inherit.type='button';inherit.addEventListener('click',()=>{S.presetUndo={cal:deepCopy(S.cal),tp:deepCopy(S.tpContexts)};delete S.tpContexts[S.presetScope];S.presetDraft=selectedContext();S.presetDraftDirty=false;applyCal();if(S.data)recompute(true);renderPresetEditor();});actions.append(inherit);
  }
  const undo=el('button','btn','Отменить применение');undo.type='button';undo.disabled=!S.presetUndo;undo.addEventListener('click',()=>{
    const prev=S.presetUndo;if(!prev)return;S.cal=prev.cal;S.tpContexts=Object.assign(Object.create(null),prev.tp);S.presetUndo=null;S.presetDraft=selectedContext();S.presetDraftDirty=false;S.presetLastChange='Предыдущие настройки восстановлены.';saveCal();applyCal();syncZoneUI();renderTuner();renderBooster();if(S.data)recompute(true);else renderPresetEditor();
  });actions.append(undo);host.append(actions);
  const sources=el('details');sources.innerHTML='<summary>Основания и ограничения методики</summary><p class="context-description">Учитываются три независимых фактора: назначение объекта, происхождение/полнота данных и сопоставимость группы. Численные пороги пресетов выбраны как консервативная инженерная отправная точка. Они не валидированы как классификатор БУ для отдельных СНТ, ГСК и отраслей. Нужны результаты проверок и даты актов; текущая размеченная выборка позволяет сравнивать профили, но не гарантирует переносимость.</p><p class="context-description">Общие основания: <a href="https://www.eia.gov/energyexplained/use-of-energy/homes.php" target="_blank" rel="noopener">EIA: сезонность и виды отопления</a>; <a href="https://bscdocs.elexon.co.uk/bsc-module/guidance-notes/load-profiles-and-their-use-in-electricity-settlement" target="_blank" rel="noopener">Elexon: профили по типам и календарю</a>; <a href="https://docs.oracle.com/en/industries/utilities/rate-cloud/264/rcs-user-guides/Topics/D1_BG_About_VEE.html" target="_blank" rel="noopener">Oracle: проверка и оценка пропущенных измерений</a>. Зарубежные источники подтверждают общий подход, а не российские нормативы или наши конкретные пороги.</p>';
  host.append(sources);
}
function shareText(n){return n==null?'не определено':fmt(n,1)+'%';}
function energyPeriodText(e){
  if(!e.first)return 'Нет сопоставимых периодов';const lab=e.byDay?dLabel:ymLabel;
  return lab(e.first)+' — '+lab(e.last)+' · '+e.n+(e.byDay?' сут.':' мес.')+' · '+(e.basis==='balance'?'те же периоды, что в балансе':'известные объёмы ПУ, ввод ТП не сопоставлен');
}
function tpCompositionCard(item,options={}){
  const a=item.automation,e=options.energy||item.day||item.month,box=el('section','tp-stat'+(options.compact?' tp-stat-compact':''));
  const head=el('div','context-title-row');head.append(el('h3',null,esc(a.group)));
  const configure=el('button','btn','Настроить профиль ТП');configure.type='button';configure.addEventListener('click',()=>preparePreset(a.key,{}));head.append(configure);box.append(head);
  box.append(el('div','tp-period',esc(energyPeriodText(e))));
  const pctAll=v=>a.n?v/a.n*100:0;
  const metrics=el('div','tp-metrics');
  const bar=(fl,ul,un)=>'<div class="tp-bar" aria-hidden="true"><span class="tp-fl" style="width:'+fl+'%"></span><span class="tp-ul" style="width:'+ul+'%"></span><span class="tp-unknown" style="width:'+un+'%"></span></div>';
  metrics.innerHTML='<div class="tp-metric"><div class="tp-metric-label">Полезный отпуск · по объёму</div><div class="tp-metric-value">'+fmt(e.total)+' <small>кВт·ч</small></div>'+bar(e.flPct||0,e.ulPct||0,e.unknownPct||0)+'<div class="tp-breakdown"><span>ФИЗ: <b>'+shareText(e.flPct)+'</b> · '+fmt(e.fl)+' кВт·ч</span><br><span>ЮР: <b>'+shareText(e.ulPct)+'</b> · '+fmt(e.ul)+' кВт·ч</span><br><span>Тип не определён: <b>'+shareText(e.unknownPct)+'</b> · '+fmt(e.unknown)+' кВт·ч</span></div></div>'+
    '<div class="tp-metric"><div class="tp-metric-label">Состав · по числу ПУ</div><div class="tp-metric-value">'+fmt(a.n)+' <small>уникальных ПУ</small></div>'+bar(pctAll(a.fl),pctAll(a.ul),pctAll(a.typeUnknown))+'<div class="tp-breakdown">ФИЗ: <b>'+a.fl+'</b> · '+shareText(a.n?pctAll(a.fl):null)+'<br>ЮР: <b>'+a.ul+'</b> · '+shareText(a.n?pctAll(a.ul):null)+'<br>Тип не определён: <b>'+a.typeUnknown+'</b> · '+shareText(a.n?pctAll(a.typeUnknown):null)+'</div></div>'+
    '<div class="tp-metric"><div class="tp-metric-label">Автоматизация · АСКУЭ</div><div class="tp-metric-value">'+(a.pct==null?'Неизвестно':fmt(a.pct,1)+'%')+' <small>'+(a.partial&&a.pct!=null?'подтверждено минимум':'по числу ПУ')+'</small></div>'+bar(pctAll(a.yes),pctAll(a.no),pctAll(a.unknown))+'<div class="tp-breakdown">Да: <b>'+a.yes+'</b> · нет: <b>'+a.no+'</b> · неизвестно: <b>'+a.unknown+'</b><br>Доля заполненных статусов: '+fmt(a.knownPct,1)+'%<br>Индивидуальный % опроса указан: '+a.pollKnown+' ПУ</div></div>';
  box.append(metrics);
  const warns=[];
  if(e.total<=0)warns.push('Доли объёма не определены: знаменатель равен нулю'+(!e.n?' или нет сопоставимых данных':'')+'.');
  if(a.partial)warns.push('Автоматизация = ПУ «да» / все уникальные ПУ. Неизвестные входят в знаменатель, но не считаются «нет».');
  if(a.duplicates)warns.push('Дубли: '+a.duplicates+' строк. В числе ПУ учтены один раз; в объёмах сохранена логика исходного баланса, где строки суммируются. Проверьте дубли до выводов.');
  if(a.conflicts)warns.push('Противоречивый статус АСКУЭ у '+a.conflicts+' номеров: отнесены к неизвестным.');
  if(e.missing)warns.push('Пропуски: '+e.missing+' значений в расчётных периодах. Доли рассчитаны по известным объёмам, не по восстановленной нагрузке.');
  if(a.pollIgnored)warns.push('У '+a.pollIgnored+' ПУ «АСКУЭ = нет» указан опрос: он не используется.');
  if(warns.length)box.append(el('p','tp-note',esc(warns.join(' '))));
  box.append(el('p','tp-note','Доли ФИЗ/ЮР относятся к полезному отпуску, а не к отпуску в сеть. Вводной техучёт в статистику потребителей не входит. Номер без данных расхода может входить в число ПУ, но не добавляет объём.'));
  if(options.recommend!==false){
    const det=el('details','tp-recommendations');det.open=!options.compact;det.append(el('summary',null,'Подсказки по пресетам · требуют подтверждения'));
    tpRecommendations(item,S.data).forEach(rec=>{const row=el('div','tp-recommendation'),txt=el('div');txt.append(el('b',null,esc(rec.title)),el('p',null,esc(rec.evidence)));row.append(txt);
      if(rec.patch){const bt=el('button','btn','Подготовить пресет');bt.type='button';bt.addEventListener('click',()=>preparePreset(a.key,rec.patch));row.append(bt);}det.append(row);});box.append(det);
  }
  return box;
}
function renderTpStatistics(){
  const host=document.getElementById('tpStats'),quick=document.getElementById('tpOverviewQuick');if(!host||!quick)return;
  host.innerHTML='';quick.innerHTML='';quick.hidden=!S.an;
  if(!S.an){host.append(el('div','note','Загрузите данные: здесь появятся автоматизация и состав полезного отпуска по каждой ТП.'));return;}
  const overview=S.an.tpOverview,total=overview.automation.total;
  const desc=el('span',null,'<b>Состав ТП:</b> '+overview.rows.length+' групп · '+fmt(total.n)+' уникальных ПУ · АСКУЭ: '+(total.pct==null?'неизвестно':fmt(total.pct,1)+'%'+(total.partial?' подтверждено минимум':'')));
  const go=el('button','btn','Доли ФИЗ / ЮР и пресеты →');go.type='button';go.addEventListener('click',()=>document.querySelector('.tab[data-tab="context"]').click());quick.append(desc,go);
  const heading=el('div','context-title-row');heading.append(el('div','dh','Структура полезного отпуска и автоматизация по ТП'));
  const exportBtn=el('button','btn','Свод ТП · Excel');exportBtn.type='button';exportBtn.addEventListener('click',exportTpOverview);heading.append(exportBtn);host.append(heading);
  host.append(el('div','note','Проценты объёма и числа ПУ показаны отдельно. АСКУЭ «да/нет» не описывает успешность опроса. Подсказки основаны на текущем составе и истории, не меняют настройки до вашего подтверждения.'));
  overview.rows.forEach(item=>host.append(tpCompositionCard(item)));
}
function policyDetailsHTML(r){
  const p=r.policy,m=r.meter;let out='<div class="context-policy"><b>АСКУЭ: '+esc(askueLabel(m.askue))+'</b> · опрос: '+(m.pollPct==null?'не указан':fmt(m.pollPct,1)+'%')+'<br>';
  if(!p?.active)return out+'Контекстный профиль не применяется.</div>';
  out+='<details><summary>Почему эти флаги настроены так</summary><p>'+esc(p.title)+'</p><p>Источник процента опроса: '+esc(p.pollOrigin||'неизвестно')+'.'+(p.coverage!=null?' Заполненность месячной истории: '+fmt(p.coverage*100,1)+'%.':'')+'</p>';
  const keys=[...new Set((p.rules||[]).map(x=>x.key))];
  out+='<div class="context-table-wrap"><table class="context-table"><thead><tr><th>Флаг</th><th>Режим</th><th>Причина</th></tr></thead><tbody>'+keys.map(k=>{const ef=policyEffect(p,k);return '<tr><td>'+esc(ALG_META[k]?.code||k)+'</td><td class="'+ef.cls+'">'+esc(ef.text)+'</td><td>'+[...new Set(p.rules.filter(x=>x.key===k).map(x=>x.reason))].map(esc).join('<br>')+'</td></tr>';}).join('')+'</tbody></table></div><p>Дополнительные причины конкретного эпизода указаны рядом со сработавшим флагом. Справочные сигналы не добавляют объём недоучёта.</p></details></div>';
  return out;
}
function exportTpOverview(){
  if(!S.an)return;if(typeof XLSX==='undefined'){alert('Библиотека Excel не загружена. Для экспорта откройте HTML с доступом к интернету.');return;}
  const rows=[['ТП','Всего уникальных ПУ','АСКУЭ да','АСКУЭ нет','АСКУЭ неизвестно','Подтверждённая автоматизация','ФИЗ ПУ','ЮР ПУ','Тип неизвестен ПУ','Период','Полезный отпуск кВт·ч','ФИЗ кВт·ч','ЮР кВт·ч','Тип неизвестен кВт·ч','Доля ФИЗ','Доля ЮР','Доля неизвестного типа','Основание периодов','Дубли строк','Профиль']];
  S.an.tpOverview.rows.forEach(x=>{const a=x.automation,e=x.day||x.month,c=contextForMeter({tp:a.key==='__all__'?'':a.key});rows.push([a.group,a.n,a.yes,a.no,a.unknown,a.pct==null?null:a.pct/100,a.fl,a.ul,a.typeUnknown,energyPeriodText(e),e.total,e.fl,e.ul,e.unknown,e.flPct==null?null:e.flPct/100,e.ulPct==null?null:e.ulPct/100,e.unknownPct==null?null:e.unknownPct/100,e.basis,a.duplicates,contextLabel(c)]);});
  const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=rows[0].map((_,i)=>({wch:i===9||i===19?55:i===0?22:19}));
  for(let row=1;row<rows.length;row++)for(const col of [5,14,15,16]){const cell=ws[XLSX.utils.encode_cell({r:row,c:col})];if(cell)cell.z='0.0%';}
  ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length-1,c:19}})};XLSX.utils.book_append_sheet(wb,ws,'Состав ТП');
  const notes=XLSX.utils.aoa_to_sheet([['Правило','Описание'],['Автоматизация','Уникальные номера ПУ «да» / все уникальные номера ПУ. Противоречивые и неизвестные статусы не принимаются за «нет». При неизвестных результат — подтверждённый минимум.'],['Доли полезного отпуска','Объёмы типа / все известные объёмы потребителей за те же периоды. Не доли отпуска в сеть. При нулевом знаменателе доли пусты.'],['Дубли','Число ПУ очищено от дублей; энергообъёмы сохраняют суммирование исходного анализатора. Перед выводами сверить дубли.'],['АСКУЭ и опрос','Автоматизация и успешный опрос не взаимозаменяемы.'],['Профили','Инженерные настройки; не норматив и не вероятность БУ. Метки проверок не участвуют в выборе профиля.']]);notes['!cols']=[{wch:27},{wch:100}];XLSX.utils.book_append_sheet(wb,notes,'Пояснения');XLSX.writeFile(wb,'Sostav_TP_v5_7.xlsx');
}


document.addEventListener('DOMContentLoaded', boot);
