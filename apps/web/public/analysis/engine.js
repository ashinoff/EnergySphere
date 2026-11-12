/* ================= ЯДРО АНАЛИЗАТОРА ПУ/ТП =================
   Чистые функции без DOM — тестируются в node, встраиваются в HTML как есть. */

const MONTHS_RU = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
const MONTHS_FULL = ['январ','феврал','март','апрел','ма[йя]','июн','июл','август','сентябр','октябр','ноябр','декабр'];
const EPS = 3; // кВт·ч: всё, что ниже, считаем «практическим нулём»

/* ---------- калибровка чувствительности (v4) ----------
   Уровень s: -2 (намного мягче) … 0 (базовый) … +2 (намного строже).
   «Строже» = жёстче критерий срабатывания признака И меньший его вес в риске.
   Для каждого алгоритма задан ряд из 5 значений порогов — по уровням s+2. */
const TUNE_DEFS = {
  sleeper:  {minZeros:[4,5,6,9,12], minPost:[30,40,50,90,150]},
  ragged:   {minSpike:[2.5,3,4,6,8], minTrans:[2,2,3,4,5]},
  step:     {rMax:[0.9,0.85,0.8,0.65,0.5]},
  valley:   {rMax:[0.6,0.55,0.5,0.4,0.3]},
  fade:     {rMax:[0.45,0.4,0.35,0.25,0.15]},
  zeroAlive:{minZeros:[2,2,3,5,7]},
  frozen:   {minRun:[3,3,4,5,6], maxCV:[4,3.5,3,2,1.5]},
  round:    {minShare:[0.55,0.6,0.7,0.8,0.9]},
  peers:    {maxFrac:[0.4,0.35,0.3,0.2,0.12]},
  season:   {maxOwn:[0.7,0.65,0.6,0.5,0.4]},
  idle:     {maxAvg:[25,20,15,8,4]},
  imb:      {minCorr:[0.5,0.55,0.6,0.7,0.8]},
  lone:     {minSum:[300,400,500,800,1200]},
  stepup:   {minJump:[2,2.2,2.5,3.5,5]},
  slow:     {rMax:[0.7,0.65,0.6,0.5,0.4]},
  blackout: {minRun:[2,2,2,3,3], lowRatio:[0.12,0.08,0.05,0.03,0.02]},
  repeatdip:{minEvents:[2,3,3,4,5], lowRatio:[0.25,0.2,0.15,0.1,0.05]},
  yearrel:  {minRun:[3,4,4,5,6], maxRatio:[0.65,0.6,0.5,0.4,0.3]},
  // суточные признаки (только для суточных выгрузок)
  dzero:    {minDays:[2,3,4,6,8]},
  ddip:     {minRun:[3,4,5,7,10]},
  dsync:    {minCorr:[0.5,0.55,0.6,0.7,0.8]},
  // v5.0: проверка гипотез балансом ТП — минимальная доля изменения ПУ, подтверждённая небалансом ввода
  bal:      {minSupport:[0.4,0.5,0.6,0.7,0.8]},
  // v5.1: Г1 — исчезла отопительная нагрузка: во сколько раз зима выше лета и на сколько кВт·ч/мес
  gas:      {minRatio:[1.6,1.8,2,2.5,3], minExcess:[150,200,300,450,600]},
  // v5.5: S18 — пик сезона (зимы или лета) ниже пика того же сезона в прошлом году: доля от прошлого пика и минимальный прошлый пик
  peaks:    {maxRatio:[0.8,0.75,0.7,0.6,0.5], minPeak:[80,90,100,150,200]},
};
const PTS_FACTOR = [1.25, 1.1, 1, 0.85, 0.7]; // множитель веса признака по уровням

/* v4.9. Контекстные профили: инженерные стартовые правила, не обученная модель.
   При выключенном контексте расчёт совместим с базовым v4.6–v4.8.
   При конфликте: ручное отключение > отключение профилем > справочный режим >
   более строгий порог. Недостоверный признак не создаёт оценку недоучёта. */
const PRESET_SCHEMA = 2;
const PRESET_TERRITORIES = {
  neutral:{title:'Без территориальной поправки',scope:'Все ПУ',desc:'Базовая динамика. Качество данных и состав выборки настраиваются отдельно.'},
  gas:{title:'Газифицированный жилой район',scope:'Только физлица',desc:'Газовое отопление подтверждается пользователем. Не требуем зимнего роста электропотребления.'},
  resort:{title:'Курорт / летняя загрузка',scope:'Все ПУ выбранной территории',desc:'Ожидаемый сезон: июнь–август. Переход к лету и закрытие сезона сами по себе не означают нарушение.'},
  cold:{title:'Холодная зима / электроотопление',scope:'Только физлица',desc:'Выбирать при электрическом отоплении, а не просто по названию района. Погода в модель не загружена.'},
  rural:{title:'Село / дачи / сезонные работы',scope:'Все ПУ выбранной территории',desc:'Допускаем простои, полив и сезонное проживание. Не приравниваем всю сельскую местность к холодному климату.'},
  sntSeasonal:{title:'СНТ · сезонное проживание',scope:'Индивидуальные участки',desc:'Зимние нули и редкие визиты не считаются достаточным основанием БУ. Укажите активные месяцы; общий ввод СНТ нельзя сравнивать с участками.'},
  sntPermanent:{title:'СНТ · постоянное проживание',scope:'Индивидуальные дома',desc:'Круглогодичный быт, а не дачный режим. Отопление выбирается отдельно; название СНТ само по себе не смягчает все флаги.'},
  garage:{title:'ГСК · обычные гаражи',scope:'Отдельные гаражные боксы',desc:'Редкие включения света и инструмента. Этот режим не подходит для СТО, производства и постоянно работающей мастерской.'},
  workshop:{title:'СТО / мастерские / сменная работа',scope:'Работающие объекты',desc:'Допускает выходные, отпуск и заказы с разной нагрузкой, но не считает любой простой безопасным.'},
  agro:{title:'Полив / сезонное сельхозпроизводство',scope:'Сезонная технология',desc:'Выберите месяцы реальной работы. Мощные насосы вне сезона могут быть выключены; важнее потеря нагрузки в активный сезон.'},
  school:{title:'Школы / учреждения с каникулами',scope:'Объекты с известным расписанием',desc:'Летние каникулы и выходные допустимы. Не применять к круглосуточной больнице или к дежурному оборудованию.'},
  industrial:{title:'Промзона / постоянная нагрузка',scope:'Только юрлица',desc:'Для известных непрерывных процессов. Не назначать автоматически всем организациям.'}
};
const PRESET_HEATING = {
  unknown:{title:'Отопление не задано',desc:'Не делаем вывода об отоплении из географии.'},
  gas:{title:'Газ / неэлектрическое',desc:'Применяется к физлицам. Нет обязательного зимнего роста электрической нагрузки.'},
  electric:{title:'Электроотопление',desc:'Применяется к физлицам. Погода и теплоизоляция не нормализованы; зимние сравнения осторожные.'}
};
const PRESET_POPULATIONS = {
  mixed:{title:'Смешанная / неизвестно',desc:'Без догадки о характере нагрузки. Сравнение по типу и ТП при достаточной группе.'},
  home:{title:'Преимущественно бытовая',desc:'Неоднородные дома, площадь и состав семьи. Низкий расход относительно соседей — слабое основание.'},
  business:{title:'Преимущественно юридические',desc:'Юрлицо не равно постоянной нагрузке. Кафе, школа и завод не являются взаимозаменяемой группой.'}
};
const PRESET_POLLS = {
  unknown:{title:'Опрос неизвестен',desc:'Не вычисляется по заполненным ячейкам. Без подтверждённого источника некоторые признаки остаются справочными.'},
  lt30:{title:'Менее 30%',desc:'Основной маршрут — восстановление достоверности данных. Нули, всплески и совпадения с небалансом неоднозначны.'},
  lt50:{title:'30–49%',desc:'Короткие провалы и накопленные съёмы недостаточно надёжны; долгие изменения оцениваются строже.'},
  lt80:{title:'50–79%',desc:'Умеренная осторожность: более длительные провалы и более высокая синхронность. Не доказательство опроса каждого ПУ.'},
  ge80:{title:'80–100%',desc:'Возврат к базовой чувствительности, без надбавки риска. Пропуски конкретного ПУ и происхождение объёма всё равно проверяются.'}
};
const PRESET_SOURCES = {
  unknown:{title:'Происхождение не подтверждено',desc:'Неизвестно, это фактические интервалы, ручные передачи или расчётные начисления.'},
  actual:{title:'Фактические объёмы по периодам',desc:'Подтверждены даты/границы интервалов и отсутствие переноса объёмов. Наличие АСКУЭ само по себе этого не доказывает.'},
  billing:{title:'Начисления / нерегулярные съёмы',desc:'Возможны средние, нормативы, корректировки и накопленный объём после контрольного съёма. Сохраняем сигналы качества данных.'}
};
function defaultContext(){return {schema:PRESET_SCHEMA,enabled:false,territory:'neutral',population:'mixed',poll:'unknown',source:'unknown',heating:'unknown',activeMonths:[]};}
function normalizeContext(x){
  const d=defaultContext(); if(!x || typeof x!=='object')return d;
  d.enabled=x.enabled===true;
  for(const [k,list] of Object.entries({territory:PRESET_TERRITORIES,population:PRESET_POPULATIONS,poll:PRESET_POLLS,source:PRESET_SOURCES,heating:PRESET_HEATING}))
    if(typeof x[k]==='string' && Object.prototype.hasOwnProperty.call(list,x[k]))d[k]=x[k];
  if(Array.isArray(x.activeMonths))d.activeMonths=[...new Set(x.activeMonths.filter(m=>Number.isInteger(m)&&m>=0&&m<12))].sort((a,b)=>a-b);
  return d;
}
let ANALYSIS_CONTEXT=defaultContext();
let ANALYSIS_AUTO_ASKUE=true;
let ANALYSIS_TP_CONTEXT=Object.create(null);
function setAnalysisContext(x,byTP,useMetadata=true){
  ANALYSIS_AUTO_ASKUE=useMetadata!==false;
  ANALYSIS_CONTEXT=normalizeContext(x);ANALYSIS_TP_CONTEXT=Object.create(null);
  if(byTP&&typeof byTP==='object')for(const [key,val] of Object.entries(byTP))ANALYSIS_TP_CONTEXT[key]=normalizeContext(val);
}
function contextForMeter(m){return Object.prototype.hasOwnProperty.call(ANALYSIS_TP_CONTEXT,m.tp||'__all__')?ANALYSIS_TP_CONTEXT[m.tp||'__all__']:ANALYSIS_CONTEXT;}
function activeMonthsFor(c){
  if(c.activeMonths.length)return c.activeMonths;
  if(c.territory==='sntSeasonal')return [3,4,5,6,7,8,9];
  if(c.territory==='agro')return [3,4,5,6,7,8];
  if(c.territory==='school')return [0,1,2,3,4,8,9,10,11];
  if(c.territory==='resort')return [4,5,6,7,8];
  return Array.from({length:12},(_,i)=>i);
}
function contextLabel(x){const c=normalizeContext(x);return !c.enabled?'Без пресета':PRESET_TERRITORIES[c.territory].title+' · '+PRESET_POPULATIONS[c.population].title+' · '+PRESET_POLLS[c.poll].title+' · '+PRESET_SOURCES[c.source].title+(c.heating!=='unknown'?' · '+PRESET_HEATING[c.heating].title:'');}
function compileContext(context, type, manualLevels, manualOff){
  // v5.0: контекст, включённый ТОЛЬКО колонками АСКУЭ/опроса (пользователь пресет не выбирал),
  // не наследует правило «источник не подтверждён» — иначе колонка «АСКУЭ = да» гасила D1–D3.
  const autoMeta=!!(context && context.autoMeta);
  const c=normalizeContext(context), levels={}, off={}, info={}, rules=[];
  for(const k of Object.keys(TUNE_DEFS)){levels[k]=Math.max(-2,Math.min(2,Math.round(Number(manualLevels&&manualLevels[k])||0)));if(manualOff&&manualOff[k])off[k]=true;}
  let seasonMode='winter',flatInfo=false;
  const apply=(keys,mode,reason,origin)=>{for(const key of keys){
    if(!TUNE_DEFS[key])continue;
    if(mode==='off')off[key]=true;
    else if(mode==='info')info[key]=true;
    else levels[key]=Math.max(levels[key],mode);
    rules.push({key,mode,reason,origin});
  }};
  if(!c.enabled)return {active:false,c,levels,off,info,rules,seasonMode,flatInfo};
  // Территория: никакого автоматического смягчения порога красной зоны.
  if((c.territory==='gas'||c.heating==='gas') && type==='fl'){
    seasonMode='none';apply(['season'],'off','Газификация не требует зимнего роста расхода электричества. Проверить реальный вид отопления.','Территория');
    apply(['peers','idle'],1,'Низкий электрический расход может объясняться газовым отоплением и приготовлением пищи.','Территория');
  }
  if(c.territory==='resort'){
    seasonMode='summer';
    apply(['season'],0,'S9 сравнивает лето/зиму вместо зима/лето, по совпадающим годам и периодам с группой.','Территория');
    apply(['step','valley','fade','blackout','repeatdip','idle'],1,'Сезонное открытие/закрытие объекта может давать ступень, простой и короткий провал; требуются более строгие критерии.','Территория');
  }
  if((c.territory==='cold'||c.heating==='electric') && type==='fl'){
    apply(['step','valley','fade','peers','idle'],1,'Электроотопление и разная температура меняют зимние объёмы. Погода не нормализована: переход сезона оценивается осторожнее.','Территория');
    apply(['season'],0,'Зимний профиль проверяется только при согласованном зимнем росте сопоставимой группы; баллы не увеличиваются.','Территория');
  }
  if(c.territory==='rural'){
    seasonMode='none';apply(['season'],'off','Нет единого зимнего или летнего режима у дач, ферм и постоянно проживающих домов.','Территория');
    apply(['idle'],'info','Присоединённая мощность может простаивать вне сезона; сначала уточнить назначение и режим объекта.','Территория');
    apply(['step','valley','zeroAlive','blackout','repeatdip','dzero','ddip','peers'],1,'Сезонные работы и непостоянное проживание допускают нули и смену режима. Приоритет — устойчивым изменениям собственной истории.','Территория');
  }
  if(['sntSeasonal','agro','school'].includes(c.territory)){
    seasonMode='none';
    apply(['season'],'off','У объекта собственный календарь работы. Фиксированное сравнение зима/лето здесь не универсально.','Режим объекта');
    apply(['idle','peers','dzero'],'info','Вне сезона разрешённая мощность может простаивать; редкие визиты и выходные не доказывают вмешательство.','Режим объекта');
    apply(['ragged','step','valley','fade','zeroAlive','blackout','repeatdip','ddip'],1,'Сначала исключить сезонный простой и расписание. Короткий эпизод должен быть более выраженным; месяцы вне выбранного сезона рассматриваются отдельно.','Режим объекта');
  }
  if(c.territory==='sntPermanent'&&type==='fl')apply(['peers','idle'],1,'Постоянно проживающие дома отличаются площадью и отоплением. Нули не оправдываются одним названием СНТ.','Режим объекта');
  if(c.territory==='garage'){
    seasonMode='none';apply(['season'],'off','У редких визитов в гараж нет обязательного бытового зимнего/летнего профиля.','Режим объекта');
    apply(['ragged','zeroAlive','lone','blackout','repeatdip','dzero','ddip','idle','peers'],'info','Для обычного гаражного бокса нули, редкие включения инструмента и резерв мощности ожидаемы. Уточните использование; для СТО выберите отдельный профиль.','Режим объекта');
    apply(['step','valley','fade'],1,'При редкой нагрузке единичная поездка меняет месячный объём. Сохраняем более устойчивые изменения собственной истории.','Режим объекта');
  }
  if(c.territory==='workshop'){
    seasonMode='none';apply(['season'],'off','Календарь заказов и смен не задаёт обязательного зимнего пика.','Режим объекта');
    apply(['peers','dzero'],'info','Разные мастерские и выходные не дают сопоставимой нагрузки по одному признаку типа потребителя.','Режим объекта');
    apply(['idle','zeroAlive','blackout','repeatdip','ddip'],1,'Требуется более длительный/глубокий провал; нужно исключить выходные, отпуск и простой.','Режим объекта');
  }
  if(c.territory==='industrial' && type==='ul'){
    seasonMode='none';flatInfo=true;
    apply(['season'],'off','Для непрерывного процесса нельзя навязывать бытовую зимнюю сезонность.','Территория');
    apply(['peers'],'info','Предприятия разной мощности и технологии нельзя сравнивать лишь по юридическому статусу.','Территория');
    apply(['idle'],1,'Резерв мощности и сменность не равны недоучёту; требуется более выраженное несоответствие.','Территория');
    rules.push({key:'frozen',mode:'flatInfo',reason:'Малый разброс нагрузки допустим. Только вариант S6 «низкий CV» справочный; точное повторение значения остаётся отдельным признаком.',origin:'Территория'});
  }
  if(c.heating==='gas'&&type==='fl')seasonMode='none';
  if(c.population==='home' && type==='fl')apply(['peers','idle'],1,'Различаются площадь, проживание, оборудование и отопление домов. Доля физлиц не является самостоятельным признаком риска.','Состав');
  if(c.population==='business' && type==='ul'){
    apply(['peers'],'info','Без отрасли и сменности общий тип «юрлицо» недостаточен для сравнения абсолютного расхода.','Состав');
    apply(['idle'],1,'Разрешённая мощность не описывает фактическую загрузку предприятия.','Состав');
  }
  // Качество опроса: это внешний контекст, не вычисленная достоверность строки.
  const pollReason=PRESET_POLLS[c.poll].title+': по выборке возможны пропуски и накопленные съёмы; процент не доказывает качество отдельного ПУ.';
  if(c.poll==='lt30'){
    apply(['ragged','valley','fade','zeroAlive','frozen','round','peers','season','idle','imb','bal','lone','stepup','blackout','repeatdip','dzero','ddip','dsync'],'info',pollReason,'Опрос');
    apply(['step','slow','yearrel'],2,'При опросе <30% оставлены лишь более выраженные длительные изменения; при низкой заполненности истории они также справочные.','Опрос');
  }else if(c.poll==='lt50'){
    apply(['ragged','zeroAlive','frozen','round','imb','bal','lone','blackout','repeatdip','dzero','ddip','dsync'],'info',pollReason,'Опрос');
    apply(['step','fade','slow','yearrel','peers','season'],1,pollReason,'Опрос');
    apply(['valley','stepup'],2,'При нерегулярном опросе восстановление передачи может выглядеть как устойчивый рост/провал.','Опрос');
  }else if(c.poll==='lt80'){
    apply(['round','lone'],'info','Круглые объёмы и единичный всплеск при неполном опросе сначала требуют сверки начислений.','Опрос');
    apply(['ragged','zeroAlive','frozen','stepup','blackout','repeatdip','imb','bal','dzero','ddip','dsync'],1,pollReason,'Опрос');
  }
  if(c.source==='billing'){
    apply(['ragged','frozen','round','lone','blackout','repeatdip','imb','bal','dzero','ddip','dsync'],'info','Расчётные/перенесённые объёмы нельзя интерпретировать как физический профиль нагрузки; нужен архив фактических показаний.','Источник');
    apply(['step','valley','fade'],1,'Ступень начислений требует подтверждения первичными показаниями.','Источник');
    apply(['stepup'],2,'Разовый контрольный съём не равен новому постоянному уровню нагрузки; S13 должен видеть длительный устойчивый рост.','Источник');
  }else if(c.source==='unknown' && !autoMeta){
    apply(['round','lone','dzero','ddip','dsync'],'info','Источник и границы периодов не подтверждены; эти сигналы оставлены для проверки данных, а не для баллов БУ.','Источник');
    apply(['stepup'],1,'Рост может объясняться возобновлением съёмов; без происхождения данных нужен более сильный переход.','Источник');
  }
  return {active:true,c,levels,off,info,rules,seasonMode,flatInfo};
}
function peerContextOK(gs,m){
  // v5.2: медиана «по всему реестру» — явный выбор пользователя, такая группа считается сопоставимой
  return !!(m.ctype && gs && gs.types && gs.types.length===1 && gs.types[0]===m.ctype &&
    gs.uniqueCount>=9 && (!m.tp || gs.fileScope || gs.tpKeys && gs.tpKeys.length===1 && gs.tpKeys[0]===m.tp));
}
function detectReadCatchups(v,months){
  const out=[];
  for(let i=6;i<v.length-1;i++){
    const prev=v.slice(Math.max(0,i-12),i).filter(x=>x!=null);
    if(prev.length<6)continue;const base=median(prev);if(!(base>=30))continue;
    if(v[i]!=null && v[i]>base*0.2)continue;
    if(v[i-1]==null || v[i-1]<=base*0.2)continue;
    let end=i;while(end+1<v.length && end-i<4 && consecutiveMonth(months,end,end+1) && (v[end+1]==null||v[end+1]<=base*0.2))end++;
    const j=end+1;if(j>=v.length||end-i+1>4||!consecutiveMonth(months,end,j)||v[j]==null||v[j]<base*1.6)continue;
    const block=v.slice(i,j+1), ratio=block.reduce((s,x)=>s+(x||0),0)/(base*block.length);
    if(ratio>=0.7&&ratio<=1.4)out.push({start:i,end,recovery:j,base,ratio,missing:block.some(x=>x==null)});
    i=end;
  }
  return out;
}
function addContextRule(p,keys,mode,reason,origin){
  for(const key of keys){if(mode==='info')p.info[key]=true;else if(mode==='off')p.off[key]=true;else p.levels[key]=Math.max(p.levels[key],mode);p.rules.push({key,mode,reason,origin});}
}
function contextualizeMeter(p,m,history,months,days,gs){
  if(!p.active)return p;
  const st=history.start,span=st<months.length?months[months.length-1].y*12+months[months.length-1].m-(months[st].y*12+months[st].m)+1:0;
  const valid=history.values.filter(x=>x!=null).length;
  p.coverage=span?valid/span:null;
  if(p.autoMetadata){
    // v5.0: пресет не выбран — работают только правила самих метаданных АСКУЭ. Поиск накопленных
    // съёмов нужен лишь там, где данные могут быть ручными или неполными.
    p.peerOK=true;
    p.catchups=(m.askue===false || (m.pollPct!=null && m.pollPct<80)) ? detectReadCatchups(history.values,months) : [];
    return p;
  }
  p.peerOK=peerContextOK(gs,m);
  p.catchups=detectReadCatchups(history.values,months);
  if(!p.peerOK)addContextRule(p,['zeroAlive','peers','season','dzero'],'info',gs&&gs.fileWide
    ? 'Своего типа на этой ТП меньше 6 ПУ — сравнение идёт с тем же типом по всему реестру. В режиме контекста такое сравнение справочное: баллы не начисляются (или выберите в рейтинге «медиана по всему реестру»).'
    : 'Нет минимум 8 других ПУ того же типа в сопоставимой группе ТП. Межтиповое сравнение не даёт баллов.','Группа конкретного ПУ');
  if(p.coverage!=null&&p.coverage<0.8)addContextRule(p,['ragged','step','valley','fade','zeroAlive','frozen','season','imb','bal','lone','stepup','slow','blackout','repeatdip','yearrel'],'info','Известно менее 80% календарных месяцев активной истории. Это заполненность ряда, не процент успешного опроса.','Полнота конкретного ПУ');
  if(days&&m.daily){
    const active=m.daily.findIndex(x=>x!=null&&x>EPS_D), start=Math.max(0,active);
    const full=dayNum(days[days.length-1])-dayNum(days[start])+1;
    p.dayCoverage=full>0?m.daily.slice(start).filter(x=>x!=null).length/full:null;
    if(p.dayCoverage!=null&&p.dayCoverage<0.8)addContextRule(p,['dzero','ddip','dsync'],'info','Известно менее 80% календарных суток активной истории. Сначала восстановить суточный архив.','Полнота конкретного ПУ');
  }
  return p;
}
function contextFlagInfo(policy,key,hit){
  if(!policy.active)return null;
  const reasons=policy.rules.filter(x=>x.key===key&&x.mode==='info').map(x=>x.reason);
  if(policy.flatInfo&&key==='frozen'&&hit.frozenKind==='flat')reasons.push('Промзона: низкий CV допустим у постоянной технологической нагрузки; совпадения с округлением проверяются отдельно.');
  if(policy.c.source!=='actual' && ['blackout','repeatdip'].includes(key) && hit.events && hit.events.length && hit.events.every(h=>h.catchUp))
    reasons.push('Все найденные провалы сопровождаются возможной компенсацией объёма при восстановлении. Сначала исключить накопленный/контрольный съём, не начислять баллы за этот сценарий.');
  return reasons.length?[...new Set(reasons)].join(' '):null;
}
function contextSeason(v,months,gs,direction){
  if(direction==='none')return null;
  const years=new Map();
  months.forEach((d,i)=>{
    if(v[i]==null||!gs.medByMonth||gs.medByMonth[i]==null)return;
    const winter=isWinter(d),summer=isSummer(d);if(!winter&&!summer)return;
    if(!years.has(d.y))years.set(d.y,{w:[],s:[],gw:[],gs:[]});
    const y=years.get(d.y);y[winter?'w':'s'].push(v[i]);y[winter?'gw':'gs'].push(gs.medByMonth[i]);
  });
  const own=[],group=[];
  for(const y of years.values()){
    if(y.w.length<2||y.s.length<2)continue;
    const high=direction==='summer'?'s':'w',low=direction==='summer'?'w':'s';
    const lo=median(y[low]),glo=median(y['g'+low]);if(lo<40||glo<25)continue;
    own.push(median(y[high])/lo);group.push(median(y['g'+high])/glo);
  }
  if(!own.length)return null;
  const gr=median(group),rr=median(own);
  if(gr<1.1 || rr>TUNE.season.maxOwn*gr)return null;
  const name=direction==='summer'?'лето/зима':'зима/лето';
  return {pts:10,detail:'Сезон '+name+': отношение ПУ '+fmt(rr,2)+' против '+fmt(gr,2)+' у группы, по совпадающим периодам '+own.length+' год(а). Ожидание сезона подтверждено группой. Погода, простой и режим работы отдельно не нормализованы; требуется проверка, это не доказательство БУ.'};
}

/* Метаданные АСКУЭ: статус автоматизации, процент опроса и заполненность не взаимозаменяемы. */
function parseAskue(value){
  if(value===true||value===1)return true;if(value===false||value===0)return false;
  const s=String(value==null?'':value).trim().toLowerCase().replace(/ё/g,'е');
  if(['да','yes','true','1','+'].includes(s))return true;
  if(['нет','no','false','0','-'].includes(s))return false;
  return null;
}
// v5.1: колонка «Газ» — да/нет или дата подключения (дата означает «газ есть с этой даты»)
function parseGas(value){
  const none={gas:null,date:null};
  if(value==null||value==='') return none;
  if(value===true) return {gas:true,date:null};
  if(value===false) return {gas:false,date:null};
  if(value instanceof Date && !isNaN(value)){ const t=new Date(value.getTime()+43200000); return {gas:true,date:{y:t.getFullYear(),m:t.getMonth()}}; }
  if(typeof value==='number'){
    if(value>20000&&value<80000){ const d=excelSerialToYM(value); return d?{gas:true,date:d}:none; }
    if(value>=2000&&value<=2100) return {gas:true,date:{y:value,m:6,yearOnly:true}};
    return value===1?{gas:true,date:null}:value===0?{gas:false,date:null}:none;
  }
  const s=String(value).trim().toLowerCase().replace(/ё/g,'е');
  if(!s) return none;
  let x;
  if((x=s.match(/(?:^|\D)(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})(?!\d)/)) && +x[2]>=1 && +x[2]<=12) return {gas:true,date:{y:+x[3],m:+x[2]-1}};
  if((x=s.match(/(?:^|\D)(\d{4})[.\-\/](\d{1,2})(?!\d)/)) && +x[2]>=1 && +x[2]<=12) return {gas:true,date:{y:+x[1],m:+x[2]-1}};
  if((x=s.match(/(?:^|\D)(\d{1,2})[.\-\/](\d{4})(?!\d)/)) && +x[1]>=1 && +x[1]<=12) return {gas:true,date:{y:+x[2],m:+x[1]-1}};
  if(/^[-—–]+$/.test(s)) return none; // прочерк в реестре чаще значит «нет данных», а «газа нет» здесь даёт баллы
  if(/^(нет|no|false|0|отсутств|без)/.test(s) || /^не(\s|$)/.test(s)) return {gas:false,date:null};
  const yr=s.match(/(?:^|\D)(20\d{2})(?!\d)/);
  if(/^(да|yes|true|1|\+|есть|подключ|газифиц|с\s)/.test(s) || (yr && s.length<=6)) return {gas:true,date:yr?{y:+yr[1],m:6,yearOnly:true}:null};
  return none;
}
function pollCellValue(value,numberFormat){
  // Excel stores 80% as 0.8. A literal percent in quotes is not a percentage format.
  const format=String(numberFormat||'').replace(/"[^"]*"/g,'').replace(/\\./g,'');
  return typeof value==='number'&&format.includes('%')?Math.round(value*100*1e8)/1e8:value;
}
function parsePollPct(value){
  if(value==null||String(value).trim()==='')return null;
  const str=String(value).trim().replace(',','.');
  if(!/^\d+(?:\.\d+)?\s*%?$/.test(str))return null;
  const n=Number(str.replace('%','').trim());return Number.isFinite(n)&&n>=0&&n<=100?n:null;
}
function pollBand(v){return v<30?'lt30':v<50?'lt50':v<80?'lt80':'ge80';}
function askueLabel(v){return v===true?'да':v===false?'нет':'неизвестно';}
function contextWithMetadata(c,m){
  const out=normalizeContext(c),meta=ANALYSIS_AUTO_ASKUE&&(m.askue!=null||m.pollPct!=null||m.askueConflict);
  if(!out.enabled && meta){out.enabled=true;out.territory='neutral';out.population='mixed';out.heating='unknown';out.activeMonths=[];out.source='unknown';out.poll='unknown';out.autoMeta=true;}
  // Известный индивидуальный процент уточняет общий. На неавтоматизированный ПУ общий % не распространяется.
  if(ANALYSIS_AUTO_ASKUE){if(m.askue===false)out.poll='unknown';else if(m.pollPct!=null)out.poll=pollBand(m.pollPct);}
  return out;
}
function meterPolicy(m,history,months,days,gs,baseLevels,baseOff){
  const original=contextForMeter(m),c=contextWithMetadata(original,m);
  const p=compileContext(c,m.ctype,baseLevels,baseOff);
  p.original=original;p.autoMetadata=!original.enabled&&p.active;
  if(!p.active)return p;
  p.askue=m.askue;p.pollOrigin=ANALYSIS_AUTO_ASKUE&&m.askue===false?'не применяется':m.pollPct!=null?'колонка ПУ':original.enabled&&original.poll!=='unknown'?'настройка области':'неизвестно';
  if(ANALYSIS_AUTO_ASKUE&&m.askue===false&&c.source!=='actual'){
    addContextRule(p,['round','frozen','lone'],'info','АСКУЭ = нет: ручные, округлённые или накопленные съёмы нужно сверить. Отсутствие автоматизации само по себе не даёт баллов БУ.','Метаданные ПУ');
    addContextRule(p,['stepup','blackout','repeatdip'],1,'Неавтоматизированный ПУ: сначала исключить нерегулярные передачи и контрольный съём. Подтверждённые фактические объёмы можно указать в источнике данных.','Метаданные ПУ');
  }
  if(ANALYSIS_AUTO_ASKUE&&m.askue===true&&m.pollPct==null&&c.poll==='unknown')p.metaNote='АСКУЭ подключена, но индивидуальная успешность опроса не указана. Статус «да» не равен 100% опроса.';
  contextualizeMeter(p,m,history,months,days,gs);
  p.values=history.values;p.months=months;p.days=days;
  p.seasonMonths=activeMonthsFor(c);
  return p;
}
const originalContextFlagInfo=contextFlagInfo;
contextFlagInfo=function(policy,key,hit){
  const reasons=[];const existing=originalContextFlagInfo(policy,key,hit);if(existing)reasons.push(existing);
  if(!policy.active)return null;
  // Не выдаём предполагаемый контрольный съём за доказанный: совпадение объёмов только защитный сигнал.
  if(policy.c.source!=='actual'&&policy.catchups&&policy.catchups.length){
    const matched = key==='lone'||key==='ragged' ? true :
      ['blackout','repeatdip'].includes(key)&&hit.events&&hit.events.length&&hit.events.every(e=>policy.catchups.some(h=>e.start>=h.start&&e.end<=h.recovery));
    if(matched)reasons.push('Есть провал с последующим объёмом, сопоставимым с накоплением за пропущенные периоды. До сверки первичных показаний этот сигнал направляется на проверку данных, без баллов и объёма недоучёта.');
  }
  if(['sntSeasonal','agro','school','resort'].includes(policy.c.territory)){
    let idx=[];
    if(['blackout','repeatdip'].includes(key)&&hit.events)idx=hit.events.flatMap(e=>Array.from({length:e.end-e.start+1},(_,j)=>e.start+j));
    else if(key==='zeroAlive'&&hit.monthIdx)idx=hit.monthIdx;
    else if(key==='fade')idx=Array.from({length:Math.min(4,policy.months.length)},(_,i)=>policy.months.length-1-i);
    else if(key==='valley'&&hit.shiftIdx!=null&&hit.endIdx!=null)idx=Array.from({length:hit.endIdx-hit.shiftIdx},(_,i)=>hit.shiftIdx+i);
    else if(key==='step'&&hit.shiftIdx!=null)idx=Array.from({length:policy.months.length-hit.shiftIdx},(_,i)=>hit.shiftIdx+i);
    else if(key==='yearrel'&&hit.eventStart!=null)idx=Array.from({length:hit.eventEnd-hit.eventStart+1},(_,i)=>hit.eventStart+i);
    else if(['dzero','ddip'].includes(key)&&hit.dayIdx)idx=hit.dayIdx.map(i=>policy.days[i]).filter(Boolean).map(d=>policy.months.findIndex(m=>m.y===d.y&&m.m===d.m)).filter(i=>i>=0);
    if(idx.length && idx.every(i=>policy.months[i]&&!policy.seasonMonths.includes(policy.months[i].m)))reasons.push('Весь обнаруженный эпизод находится вне выбранных активных месяцев. Сначала подтвердить работу объекта в этот сезон; сами нули вне сезона не дают баллов.');
  }
  return reasons.length?[...new Set(reasons)].join(' '):null;
};
function contextQualityNotes(policy,m){
  const q=[];if(!policy.active)return q;
  if(m.askueConflict)q.push({code:'Q5д',title:'Конфликт АСКУЭ у дублей',detail:'В разных строках одного номера ПУ в этой ТП указаны и да, и нет. Статус и процент опроса для контекстных правил не считаются подтверждёнными. Сначала сверить дубли.'});
  if(policy.metaNote)q.push({code:'Q5',title:'АСКУЭ: качество опроса неизвестно',detail:policy.metaNote});
  if(m.askue===false&&m.pollPct!=null)q.push({code:'Q5',title:'Противоречие метаданных',detail:'АСКУЭ = нет, но указан процент опроса. Процент не используется; проверьте исходную строку.'});
  if(policy.catchups&&policy.catchups.length)q.push({code:'Q6',title:'Возможен накопленный / контрольный съём',detail:policy.catchups.map(h=>ymLabel(policy.months[h.start])+' → '+ymLabel(policy.months[h.recovery])).join('; ')+'. Сопоставимость суммы с предшествующей базой — гипотеза о распределении начислений, не доказанный факт. Требуются даты и первичные показания.'});
  if(policy.coverage!=null&&policy.coverage<0.8)q.push({code:'Q7',title:'Недостаточно известной истории',detail:'Заполненность активной месячной истории '+fmt(policy.coverage*100,1)+'%. Это не процент опроса АСКУЭ. Уязвимые сигналы оставлены справочными, без расчётного недоучёта.'});
  if(policy.dayCoverage!=null&&policy.dayCoverage<0.8)q.push({code:'Q7д',title:'Недостаточно суточных данных',detail:'Заполненность суточного ряда '+fmt(policy.dayCoverage*100,1)+'%. Суточные сигналы оставлены для проверки данных.'});
  return q;
}
function policySnapshot(p){
  if(!p.active)return {active:false,title:'Базовый профиль · без контекста',rules:[]};
  return {active:true,title:(p.autoMetadata?'Автоконтекст АСКУЭ · ':'')+contextLabel(p.c),config:p.c,levels:p.levels,off:p.off,info:p.info,rules:p.rules,
    coverage:p.coverage,dayCoverage:p.dayCoverage,peerOK:p.peerOK,pollOrigin:p.pollOrigin,seasonMode:p.seasonMode,flatInfo:p.flatInfo};
}
function automationStats(data){
  const rows=data.automationRows||data.meters||[], groups=new Map();
  for(const m of rows){const tp=m.tp||'__all__';if(!groups.has(tp))groups.set(tp,[]);groups.get(tp).push(m);}
  const collect=(items,key)=>{
    const ids=new Map();for(const m of items){if(!ids.has(m.id))ids.set(m.id,[]);ids.get(m.id).push(m);}
    let yes=0,no=0,unknown=0,conflicts=0,fl=0,ul=0,typeUnknown=0,pollKnown=0,pollIgnored=0;
    for(const copies of ids.values()){
      const statuses=new Set(copies.map(m=>m.askue).filter(v=>v===true||v===false));
      const invalid=copies.some(m=>m.askueInvalid);
      let a=null;if(statuses.size===1&&!invalid)a=[...statuses][0];
      if(statuses.size>1)conflicts++;
      if(a===true)yes++;else if(a===false)no++;else unknown++;
      const types=new Set(copies.map(m=>m.ctype).filter(Boolean));
      if(types.size===1&&types.has('fl'))fl++;else if(types.size===1&&types.has('ul'))ul++;else typeUnknown++;
      if(copies.some(m=>m.pollPct!=null)){if(a===false)pollIgnored++;else pollKnown++;}
    }
    const n=ids.size;
    return {key,group:key==='__all__'?'ТП не указана':key,n,rows:items.length,yes,no,unknown,conflicts,fl,ul,typeUnknown,pollKnown,pollIgnored,
      pct:yes+no>0&&n?yes/n*100:null,knownPct:n?(yes+no)/n*100:0,partial:unknown>0,duplicates:items.length-n};
  };
  return {groups:[...groups].map(([k,v])=>collect(v,k)).sort((a,b)=>a.group.localeCompare(b.group,'ru',{numeric:true})),total:collect(rows,'ИТОГО')};
}

/* Состав полезного отпуска: тот же набор строк и допустимых периодов, что в балансе.
   Дубли не удаляются из энергии молча: текущий баланс сохраняет обе строки, а
   статистика уникальных ПУ считается отдельно. Неизвестный тип — отдельная доля. */
function tpEnergySummary(data,key,byDay,balance){
  const periods=byDay?(data.days||[]):data.months;
  const rows=data.meters.filter(m=>key==='*'||(m.tp||'__all__')===key);
  const series=byDay&&balance?balance.daily:balance;
  const mask=periods.map((_,i)=>series?series.supplySeries[i]!=null&&series.usefulSeries[i]!=null:rows.some(m=>(byDay?m.daily:m.values)?.[i]!=null));
  const totalByType={fl:0,ul:0,unknown:0},vals=periods.map(()=>null),contributors=periods.map(()=>0);
  let cells=0,missing=0;
  rows.forEach(m=>{
    const v=byDay?m.daily:m.values, type=m.ctype==='fl'?'fl':m.ctype==='ul'?'ul':'unknown';
    mask.forEach((ok,i)=>{if(!ok)return;const x=v?.[i];if(x!=null&&Number.isFinite(x)){totalByType[type]+=x;cells++;vals[i]=(vals[i]??0)+x;contributors[i]++;}else missing++;});
  });
  const n=mask.filter(Boolean).length,total=totalByType.fl+totalByType.ul+totalByType.unknown,valid=mask.map((v,i)=>v?i:-1).filter(i=>i>=0);
  const rawIds=new Set(rows.map(m=>m.id));
  return {key,byDay,total,fl:totalByType.fl,ul:totalByType.ul,unknown:totalByType.unknown,
    flPct:total>0?totalByType.fl/total*100:null,ulPct:total>0?totalByType.ul/total*100:null,unknownPct:total>0?totalByType.unknown/total*100:null,
    n,first:valid.length?periods[valid[0]]:null,last:valid.length?periods[valid[valid.length-1]]:null,
    mask,values:vals,contributors,rows:rows.length,duplicates:rows.length-rawIds.size,cells,missing,
    completeness:cells+missing?cells/(cells+missing):null,basis:series?'balance':'available'};
}
function buildTpOverview(data,balances){
  const automation=automationStats(data);
  const rows=automation.groups.map(a=>{
    const b=balances.find(x=>x.key===a.key);
    return {automation:a,month:tpEnergySummary(data,a.key,false,b),day:data.days?tpEnergySummary(data,a.key,true,b&&b.daily?b:null):null};
  });
  return {automation,rows};
}
function tpRecommendations(item,data){
  const a=item.automation,e=item.day||item.month,out=[];
  const add=(title,evidence,patch,kind='profile')=>out.push({title,evidence,patch,kind});
  const countFl=a.n?a.fl/a.n:0,countUl=a.n?a.ul/a.n:0;
  if(e.total>0&&countFl>=0.9&&e.ulPct>=50){
    add('Смешанная ТП: разделить бытовой и деловой анализ',fmt(countFl*100)+'% ПУ — физлица, но '+fmt(e.ulPct,1)+'% известного полезного отпуска дают юрлица. Один общий «бытовой» профиль исказит картину.',{population:'mixed'});
  }else if(countFl>=0.9&&e.flPct!=null&&e.flPct>=70){
    add('Бытовой состав',fmt(countFl*100)+'% уникальных ПУ и '+fmt(e.flPct,1)+'% известного отпуска — физлица. Это повод осторожнее сравнивать абсолютные объёмы соседних домов, а не ожидать обязательной динамики.',{population:'home'});
  }else if((countUl>=0.7||e.ulPct>=80)&&a.ul>0){
    add('Юридические потребители: уточнить режим работы',fmt(countUl*100)+'% уникальных ПУ; '+(e.ulPct==null?'объём не определён':fmt(e.ulPct,1)+'% известного отпуска')+' — юрлица. Предлагается только деловой состав; непрерывное производство автоматически не назначается.',{population:'business'});
  }else add('Смешанная выборка', 'Доли по числу и по объёму не дают основания назначить один бытовой или промышленный режим. Выберите назначение объектов вручную.',{population:'mixed'});
  if(e.completeness!=null&&e.completeness<0.8)add('Сначала проверить полноту данных',fmt(e.completeness*100,1)+'% ожидаемых значений известны в выбранных периодах. Это заполненность выгрузки, не процент опроса АСКУЭ.',null,'data');
  if(a.unknown>0)add('Уточнить автоматизацию',fmt(a.unknown)+' ПУ без однозначного статуса АСКУЭ. При частично известных статусах автоматизация является подтверждённым минимумом; при полностью неизвестных не рассчитывается. Успешный опрос из неё не выводится.',null,'data');
  if(a.no>a.n/2)add('Проверить происхождение месячных объёмов','АСКУЭ = нет у '+fmt(a.no)+' из '+fmt(a.n)+' уникальных ПУ. Ручной съём может быть достоверным, но круглые числа и всплески требуют первичных показаний.',{source:'unknown'},'data');
  const rows=data.meters.filter(m=>(m.tp||'__all__')===a.key);
  const text=[a.group,...rows.map(m=>m.name)].join(' ').toLowerCase();
  if(/\bснт\b|садовод|садовое товарищество/iu.test(text)||/(?:^|\s|[«(])снт(?:\s|[»)]|$)/i.test(text))
    add('Проверить режим СНТ','Название содержит признак СНТ. Подсказка не устанавливает сезонность. Выберите сезонное или постоянное проживание; общий ввод не сравнивается с участками.',{territory:'sntSeasonal'},'confirm');
  if(/гараж|(?:^|\s|[«(])(?:п?гск)(?:\s|[»)]|$)/i.test(text))
    add('Проверить назначение гаражей','Есть указание на ГСК/гаражи. Для обычных боксов и работающей СТО нужны разные режимы; подтвердите назначение.',{territory:'garage'},'confirm');
  // Подсказка о наблюдаемом сезоне, без вывода о географии или виде отопления.
  const month=item.month;
  if(!month.duplicates&&month.completeness>=0.9){
    const ys=new Map();data.months.forEach((d,i)=>{if(month.values[i]==null||!month.contributors[i])return;
      if(!ys.has(d.y))ys.set(d.y,{w:[],s:[]});if(isWinter(d))ys.get(d.y).w.push(month.values[i]/month.contributors[i]);if(isSummer(d))ys.get(d.y).s.push(month.values[i]/month.contributors[i]);});
    const ratios=[];for(const y of ys.values())if(y.w.length>=2&&y.s.length>=2&&median(y.w)>3&&median(y.s)>3)ratios.push(median(y.s)/median(y.w));
    if(ratios.length>=2&&median(ratios)>=1.6&&ratios.filter(x=>x>=1.2).length/ratios.length>=0.75)
      add('Выраженный летний профиль','За '+ratios.length+' сопоставимых года медиана отношения лето/зима = '+fmt(median(ratios),2)+'. Предлагается летний профиль; это может быть курорт, охлаждение, дачи или полив, назначение нужно подтвердить.',{territory:'resort'},'confirm');
    else if(ratios.length>=2&&median(ratios)<=0.625&&ratios.filter(x=>x<=0.83).length/ratios.length>=0.75)
      add('Выраженный зимний профиль','В сопоставимых годах зимние объёмы выше летних примерно в '+fmt(1/median(ratios),1)+' раза. Газификация и вид отопления по одному графику не определяются.',{heating:'electric'},'confirm');
  }
  return out;
}


/* ---------- диапазоны техприсоединения (реестр СИП 0,22 / 0,4 кВ) ----------
   Разрешённая мощность попадает в диапазон; ВЕРХНЯЯ граница диапазона — это
   максимально возможная мощность потребителя, она даёт физический потолок
   месячного объёма (кВт × 730 ч). Оценка недоучёта не может превышать этот
   потолок за вычетом уже оплаченного (учтённого) объёма.
   Правило напряжения: ≤10 кВт — однофазное 0,22 кВ (типовой диапазон до 15 кВт,
   СИП-4 2×16); свыше 10 кВт — 0,4 кВ по умолчанию, диапазоны по длительно
   допустимому току СИП (ГОСТ 31946-2012, cos φ = 0,9). */
const POWER_BANDS = [
  {max:15,  u:'0,22', sip:'СИП-4 2×16'},
  {max:59,  u:'0,4',  sip:'СИП-4 4×16'},
  {max:77,  u:'0,4',  sip:'СИП-4 4×25'},
  {max:95,  u:'0,4',  sip:'СИП-4 4×35'},
  {max:116, u:'0,4',  sip:'СИП-4 4×50'},
  {max:142, u:'0,4',  sip:'СИП-4 4×70'},
  {max:178, u:'0,4',  sip:'СИП-4 4×95'},
  {max:201, u:'0,4',  sip:'СИП-4 4×120'},
  {max:225, u:'0,4',  sip:'СИП-4 4×150'},
  {max:258, u:'0,4',  sip:'СИП-4 4×185'},
  {max:305, u:'0,4',  sip:'СИП-4 4×240'},
];
const HOURS_MONTH = 730; // среднее число часов в месяце
function powerBand(power, voltage){
  // voltage — явное значение из колонки файла ('0,22' | '0,4'), если задано;
  // иначе правило по умолчанию: ≤10 кВт → 0,22 кВ, выше → 0,4 кВ
  if(power==null || !isFinite(power) || power<=0) return null;
  const explicit = voltage==='0,22' || voltage==='0,4';
  const u = explicit ? voltage : (power<=10 ? '0,22' : '0,4');
  if(u==='0,22'){
    const b=POWER_BANDS[0];
    return {u, explicit, capKw:Math.max(b.max, power), sip:b.sip,
      label: power<=b.max ? 'до '+b.max+' кВт (1ф)' : 'свыше '+b.max+' кВт (1ф)'};
  }
  let prev=null;
  for(const b of POWER_BANDS.slice(1)){
    if(power<=b.max) return {u, explicit, capKw:b.max, sip:b.sip, label:(prev==null?'до ':prev+' – ')+b.max+' кВт'};
    prev=b.max;
  }
  return {u, explicit, capKw:power, sip:'вне таблицы СИП', label:'свыше 305 кВт'};
}

function buildTune(levels){
  levels = levels || {};
  const out = {};
  for(const [k,def] of Object.entries(TUNE_DEFS)){
    const s = Math.max(-2, Math.min(2, Math.round(levels[k]||0)));
    const p = {level:s, ptsF:PTS_FACTOR[s+2]};
    for(const [name,arr] of Object.entries(def)) p[name] = arr[s+2];
    out[k] = p;
  }
  return out;
}
let TUNE = buildTune({});
function setTune(levels, cls){
  TUNE = buildTune(levels);
  if(cls){
    if(isFinite(cls.red)) CLS.red = cls.red;
    if(isFinite(cls.amber)) CLS.amber = Math.min(cls.amber, CLS.red - 5);
  }
}

/* ---------- режим зон рейтинга ----------
   'score' — зоны по риску 0–100 (стандарт);
   'loss'  — зоны по предполагаемому объёму недоучёта, кВт·ч. */
const MODE = { zone:'score', lossRed:5000, lossAmber:1000, norm:0.10 };
function setZoneMode(zone, lossRed, lossAmber){
  MODE.zone = zone==='loss' ? 'loss' : 'score';
  if(isFinite(lossRed) && lossRed>0) MODE.lossRed = lossRed;
  if(isFinite(lossAmber) && lossAmber>0) MODE.lossAmber = Math.min(lossAmber, MODE.lossRed);
}
/* v5.2: откуда брать медиану «соседей» для групповых признаков (S3/S4/S14/S17 — сезонный профиль,
   S5, S8, S9, D1): 'tp' — своя ТП (юр/физ отдельно, как раньше), 'file' — весь загруженный реестр
   (юр/физ отдельно). Отключения и массовые нули ТП в обоих режимах распознаются по своей подстанции. */
let GROUP_SCOPE = 'tp';
function setGroupScope(scope){ GROUP_SCOPE = scope==='file' ? 'file' : 'tp'; }
/* v5.0: норматив потерь ТП (доля отпуска в сеть). Всё, что выше, — «сверхнормативный
   небаланс»: в его пределах распределяются оценки недоучёта, он же нужен S11/D3/Б1. */
function setBalanceNorm(pct){
  if(isFinite(pct) && pct>=0 && pct<=50) MODE.norm = pct/100;
}

/* ---------- бусты приоритета (чек-боксы в Настройках) ----------
   v5.0: буст — управленческий приоритет, а не доказательство. Он поднимает
   подходящих ПУ выше ВНУТРИ их зоны, но не переводит в более «горячую» зону. */
const BOOST_DEFS = [
  {id:'ul',        pts:10, label:'Юридические лица',                     test:c=>c.ctype==='ul'},
  {id:'fl',        pts:10, label:'Физические лица (быт)',                test:c=>c.ctype==='fl'},
  {id:'power30',   pts:10, label:'Разрешённая мощность ≥ 30 кВт',        test:c=>c.power!=null && c.power>=30},
  {id:'bigloss',   pts:10, label:'Оценка недоучёта ≥ 3000 кВт·ч',        test:c=>c.lossKwh>=3000},
  {id:'winterzero',pts:8,  label:'Есть нули в зимние месяцы',            test:c=>c.winterZeros>=1},
  {id:'shift',     pts:8,  label:'Есть точка перелома на графике',       test:c=>c.shiftIdx!=null},
  {id:'dup',       pts:6,  label:'Дубль номера ПУ в файле',              test:c=>!!c.dup},
];
let BOOSTS_ON = {};
function setBoosts(on){ BOOSTS_ON = on || {}; }

/* ---------- включение/исключение алгоритмов ----------
   Отключённый признак не срабатывает вовсе и не гейтит остальные —
   методика адаптируется под район (промзона / газ / электроотопление…). */
let ALG_OFF = {};
function setAlgOff(off){ ALG_OFF = off || {}; }

function median(arr){
  const a = arr.filter(v => v != null && isFinite(v)).slice().sort((x,y)=>x-y);
  if(!a.length) return null;
  const m = Math.floor(a.length/2);
  return a.length % 2 ? a[m] : (a[m-1]+a[m])/2;
}
function mean(arr){
  const a = arr.filter(v => v != null && isFinite(v));
  return a.length ? a.reduce((s,v)=>s+v,0)/a.length : null;
}
function stdev(arr){
  const a = arr.filter(v => v != null && isFinite(v));
  if(a.length < 3) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length);
}
function pearson(x, y){
  const idx = [];
  for(let i=0;i<x.length;i++) if(x[i]!=null && y[i]!=null) idx.push(i);
  if(idx.length < 6) return 0;
  const xs = idx.map(i=>x[i]), ys = idx.map(i=>y[i]);
  const mx = mean(xs), my = mean(ys);
  let num=0, dx=0, dy=0;
  for(let i=0;i<xs.length;i++){
    num += (xs[i]-mx)*(ys[i]-my);
    dx += (xs[i]-mx)**2; dy += (ys[i]-my)**2;
  }
  return (dx>0 && dy>0) ? num/Math.sqrt(dx*dy) : 0;
}
/* v5.0: медианы всех префиксов и суффиксов ряда за O(n²) вместо O(n³):
   pre[t] = median(v[0..t-1]), suf[t] = median(v[t..n-1]); null/NaN пропускаются, как в median(). */
function runningMedians(v){
  const n=v.length, pre=new Array(n+1).fill(null), suf=new Array(n+1).fill(null);
  const ins=(arr,x)=>{ let lo=0,hi=arr.length; while(lo<hi){ const mid=(lo+hi)>>1; if(arr[mid]<x) lo=mid+1; else hi=mid; } arr.splice(lo,0,x); };
  const med=a=>{ if(!a.length) return null; const m=a.length>>1; return a.length%2?a[m]:(a[m-1]+a[m])/2; };
  let s=[];
  for(let i=0;i<n;i++){ pre[i]=med(s); const x=v[i]; if(x!=null&&isFinite(x)) ins(s,x); }
  pre[n]=med(s);
  s=[];
  for(let i=n-1;i>=0;i--){ const x=v[i]; if(x!=null&&isFinite(x)) ins(s,x); suf[i]=med(s); }
  return {pre,suf};
}
/* v5.0: сезонный профиль группы. Делим ряд ПУ на него, чтобы общий для группы сезон
   (и общие спады) не выглядели как ступень/провал у конкретного прибора. */
function groupSeasonalFactors(gMed, gCnt){
  if(!gMed || !(gCnt>=6)) return null;
  const known=gMed.filter(x=>x!=null && x>0);
  if(known.length < Math.max(6, Math.ceil(gMed.length*0.7))) return null;
  const gm=median(known);
  if(!(gm>=20)) return null;
  return gMed.map(x=>(x!=null && x>0) ? Math.max(0.4, Math.min(2.5, x/gm)) : 1);
}
function fmt(n, digits){
  if(n == null || !isFinite(n)) return '—';
  return n.toLocaleString('ru-RU', {maximumFractionDigits: digits==null?0:digits});
}
function isWinter(ym){ return ym.m === 11 || ym.m === 0 || ym.m === 1; }
function isSummer(ym){ return ym.m >= 5 && ym.m <= 7; }
function ymLabel(ym){ return MONTHS_RU[ym.m] + '\u00A0' + String(ym.y).slice(2); }
/* ---------- сутки ---------- */
function dLabel(d){ return String(d.d).padStart(2,'0')+'.'+String(d.m+1).padStart(2,'0')+'.'+String(d.y).slice(2); }
function daysInMonth(y,m){ return new Date(y, m+1, 0).getDate(); }
function dayAdd(d, n){ const t=new Date(d.y, d.m, d.d+n); return {y:t.getFullYear(), m:t.getMonth(), d:t.getDate(), hasYear:d.hasYear}; }
function dayNum(d){ return Math.round(Date.UTC(d.y, d.m, d.d)/86400000); }
// заголовок-дата: Date, Excel-серийное число, «01.01.2025», «2025-01-01», «1 янв 25», «01.01»
function parseDayHeader(v){
  if(v == null) return null;
  // даты Excel из SheetJS в часовых поясах восточнее Гринвича приходят как «предыдущий день 23:59:43»
  // (историческое смещение 1899 г.) — берём ближайшие сутки (+12 ч), а не календарную дату объекта
  if(v instanceof Date && !isNaN(v)){ const t=new Date(v.getTime()+43200000); return {y:t.getFullYear(), m:t.getMonth(), d:t.getDate(), hasYear:true}; }
  if(typeof v === 'number'){
    if(v > 20000 && v < 80000){ const t=new Date(Math.round((v-25569)*86400*1000)); return {y:t.getUTCFullYear(), m:t.getUTCMonth(), d:t.getUTCDate(), hasYear:true}; }
    return null;
  }
  const s = String(v).trim().toLowerCase();
  if(!s) return null;
  let m;
  if((m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})(?!\d)/))){
    let y=+m[3]; if(y<100) y+=2000; const mo=+m[2], d=+m[1];
    if(mo>=1&&mo<=12&&d>=1&&d<=31) return {y, m:mo-1, d, hasYear:true};
  }
  if((m = s.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})(?!\d)/))){
    const mo=+m[2], d=+m[3];
    if(mo>=1&&mo<=12&&d>=1&&d<=31) return {y:+m[1], m:mo-1, d, hasYear:true};
  }
  if((m = s.match(/^(\d{1,2})\s+([а-яё]+)\.?(?:\s+(\d{2,4}))?/))){
    const d=+m[1], mon=m[2];
    for(let mi=0; mi<12; mi++){
      if(new RegExp('^'+MONTHS_FULL[mi],'i').test(mon) || mon.startsWith(MONTHS_RU[mi])){
        if(d<1||d>31) return null;
        if(m[3]){ let y=+m[3]; if(y<100) y+=2000; return {y, m:mi, d, hasYear:true}; }
        return {y:null, m:mi, d, hasYear:false};
      }
    }
  }
  if((m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})$/))){
    const d=+m[1], mo=+m[2];
    if(mo>=1&&mo<=12&&d>=1&&d<=31) return {y:null, m:mo-1, d, hasYear:false};
  }
  return null;
}
// сутки или месяцы? По медиане разрыва между соседними распознанными датами шапки:
// ≤3 дня — суточная выгрузка; иначе (≈30 дней, «01.01.2025 / 01.02.2025») — месячная.
function detectGran(headerVals){
  const ds=headerVals.map(parseDayHeader).filter(Boolean);
  if(ds.length<3) return 'month';
  const nums=ds.map(d=>d.hasYear?dayNum(d):dayNum({y:2001, m:d.m, d:d.d})).sort((a,b)=>a-b);
  const gaps=[]; for(let i=1;i<nums.length;i++){ const g=nums[i]-nums[i-1]; if(g>0) gaps.push(g); }
  if(gaps.length<2) return 'month';
  return median(gaps)<=3 ? 'day' : 'month';
}

/* ---------- шапка: распознавание месяцев ---------- */
function excelSerialToYM(n){
  const d = new Date(Math.round((n - 25569) * 86400 * 1000));
  return isNaN(d) ? null : {y: d.getUTCFullYear(), m: d.getUTCMonth()};
}
function parseMonthHeader(v){
  if(v == null) return null;
  if(v instanceof Date && !isNaN(v)){ const t=new Date(v.getTime()+43200000); return {y:t.getFullYear(), m:t.getMonth(), hasYear:true}; }
  if(typeof v === 'number'){
    return (v > 20000 && v < 80000) ? {...excelSerialToYM(v), hasYear:true} : null;
  }
  const s = String(v).trim().toLowerCase();
  if(!s) return null;
  let m;
  if((m = s.match(/^(\d{1,2})[.\-\/](\d{4})/)) && +m[1]>=1 && +m[1]<=12) return {y:+m[2], m:+m[1]-1, hasYear:true};
  if((m = s.match(/^(\d{4})[.\-\/](\d{1,2})/)) && +m[2]>=1 && +m[2]<=12) return {y:+m[1], m:+m[2]-1, hasYear:true};
  if((m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})/)) && +m[2]>=1 && +m[2]<=12) return {y:+m[3], m:+m[2]-1, hasYear:true};
  for(let mi=0; mi<12; mi++){
    if(new RegExp('^'+MONTHS_FULL[mi], 'i').test(s) || s.startsWith(MONTHS_RU[mi])){
      const ym = s.match(/(20\d{2}|\b\d{2}\b)/);
      if(ym){ let y=+ym[1]; if(y<100) y+=2000; return {y, m:mi, hasYear:true}; }
      return {y:null, m:mi, hasYear:false};
    }
  }
  return null;
}

/* ---------- парсинг листа (массив массивов) ---------- */
const SUPPLY_RX = /отпуск|головн|итог[а-я]*\s+по\s+тп|расход\s+тп|ввод\s+тп/i; // «головн» (головной учёт), а не «голов» — иначе ловились фамилии вроде Головихина
const TOTAL_RX = /^(?:итог[а-яё]*|всего|сумма|total)(?=$|[\s:.,(\-—])/i; // v5.0: итоговые строки выгрузки
const ID_RX = /^\d{6,18}$/;
const CONT_RX = /^(столбец|column|unnamed)/i;

function parseAOA(aoa, opts){
  opts = opts || {};
  const nowY = opts.nowY || new Date().getFullYear();
  const nowM = opts.nowM != null ? opts.nowM : new Date().getMonth();
  const notes = [];
  if(!aoa || !aoa.length) return {error:'Файл пуст или не читается.'};

  // 1. Строка шапки — максимум распознанных месяцев ИЛИ дат в первых 12 строках.
  // v5.0: строка с номером ПУ или меткой «Отпуск в сеть» — это данные, а не шапка; числа
  // 20 000–80 000 принимаются за даты Excel, только если идут монотонно (как даты), а не вразнобой
  // (как расход крупного потребителя). Раньше такая строка могла «победить» настоящую шапку.
  const isDataRow = row => row.some(v=>v!=null && ID_RX.test(String(v).trim().replace(/\.0+$/,'')))
    || SUPPLY_RX.test(row.filter(v=>typeof v==='string').join(' '));
  const serialsOK = row => {
    const nums=row.filter(v=>typeof v==='number' && v>20000 && v<80000);
    if(nums.length<3) return true;
    let up=0, down=0;
    for(let i=1;i<nums.length;i++){ if(nums[i]>nums[i-1]) up++; else if(nums[i]<nums[i-1]) down++; }
    return Math.max(up,down) >= 0.8*(nums.length-1);
  };
  let headerRow=-1, best=0, headerMapM=null, headerMapD=null;
  for(let r=0; r<Math.min(aoa.length,12); r++){
    const row=(aoa[r]||[]);
    if(isDataRow(row)) continue;
    const okSerial=serialsOK(row), mask=v=>(typeof v==='number' && !okSerial) ? null : v;
    const mapM = row.map(v=>parseMonthHeader(mask(v))), mapD = row.map(v=>parseDayHeader(mask(v)));
    const cnt = Math.max(mapM.filter(Boolean).length, mapD.filter(Boolean).length);
    if(cnt > best){ best=cnt; headerRow=r; headerMapM=mapM; headerMapD=mapD; }
  }
  if(best < 3) return {error:'Не нашёл в шапке колонки периодов (минимум 3). Подходят месяцы («Январь», «янв 25», «01.2025», даты Excel) или сутки («01.01.2025», «2025-01-01», «1 янв 25»).'};
  // формат периодов: авто (по разрывам между датами) либо задан пользователем
  const granReq = opts.gran || 'auto';
  const granAuto = detectGran(aoa[headerRow]||[]);
  let gran = granReq==='auto' ? granAuto : granReq;
  if(granReq!=='auto' && granReq!==granAuto) notes.push('Формат задан вручную («'+(granReq==='day'?'сутки':'месяцы')+'»), хотя по шапке выгрузка похожа на '+(granAuto==='day'?'суточную':'месячную')+' — проверьте, так ли задумано (переключатель «Формат» → «авто»).');
  if(gran==='day' && headerMapD.filter(Boolean).length<3){
    notes.push('Запрошен суточный формат, но дат в шапке не нашёл — разбираю как месяцы.');
    gran='month';
  }
  let headerMap = gran==='day' ? headerMapD : headerMapM;
  // месячная выгрузка с заголовками-датами («01.01.25», «1 янв 25», «01.01»): parseMonthHeader их не берёт,
  // parseDayHeader берёт, а разрывы месячные → строим месяцы из дат, отбрасывая день
  if(gran==='month' && headerMapM.filter(Boolean).length<3 && headerMapD.filter(Boolean).length>=3){
    headerMap = headerMapD.map(d => d ? {y:d.y, m:d.m, hasYear:d.hasYear} : null);
    notes.push('Заголовки периодов — даты с шагом около месяца; разобрал их как месяцы (день отброшен).');
  }

  const header = (aoa[headerRow]||[]).map(v => v==null ? '' : String(v).trim());
  const hdrLabel = c => { const v=(aoa[headerRow]||[])[c]; if(v instanceof Date || typeof v==='number'){ const d=parseDayHeader(v); if(d && d.hasYear) return dLabel(d); } return header[c]; };
  const nCols = Math.max(header.length, ...aoa.slice(headerRow+1, headerRow+30).map(r=>(r||[]).length));

  // именованные месячные колонки
  let monthCols = [];
  headerMap.forEach((ym,c)=>{ if(ym) monthCols.push({c, ym}); });
  monthCols.sort((a,b)=>a.c-b.c);
  if(!monthCols.length) return {error:'Не смог разобрать заголовки периодов в шапке как '+(gran==='day'?'сутки':'месяцы')+' (минимум 3).'};
  const lastNamed = monthCols[monthCols.length-1];
  // направление ряда в файле: обычно по возрастанию, но часть АСКУЭ выгружает «свежие слева».
  // Годы в голосовании не участвуют (в шапке они могут стоять не у всех колонок): сравниваем позицию
  // внутри года, переход через Новый год — шаг по кратчайшей дуге
  const cyc = gran==='day' ? 366 : 12;
  const posIn = ym => gran==='day' ? dayNum({y:2001, m:ym.m, d:ym.d}) - dayNum({y:2001, m:0, d:1}) : ym.m;
  const stepOf = (a,b) => { let st=posIn(b)-posIn(a); if(st>cyc/2) st-=cyc; else if(st<-cyc/2) st+=cyc; return st; };
  let fwd=0, bwd=0;
  for(let i=1;i<monthCols.length;i++){ const st=stepOf(monthCols[i-1].ym, monthCols[i].ym); if(st>0) fwd++; else if(st<0) bwd++; }
  const dir = bwd>fwd ? -1 : 1;

  // 1а. Продолжение «Столбец1…N» / пустые заголовки справа — следующие периоды подряд (в направлении ряда)
  let cont = 0;
  const dataProbe = aoa.slice(headerRow+1, headerRow+40);
  for(let c=lastNamed.c+1; c<nCols; c++){
    const h = header[c]||'';
    if(!(h==='' || CONT_RX.test(h))) break;
    const vals = dataProbe.map(r=>(r||[])[c]).filter(v=>v!=null && v!=='');
    const numeric = vals.filter(v=>isFinite(typeof v==='string' ? parseFloat(v.replace(',','.')) : v)).length;
    if(!vals.length || numeric/vals.length < 0.6) break;
    cont++;
    const prev = monthCols[monthCols.length-1].ym;
    if(gran==='day'){
      monthCols.push({c, ym: prev.hasYear ? dayAdd(prev,dir) : (()=>{ const t=new Date(2001, prev.m, prev.d+dir); return {y:null, m:t.getMonth(), d:t.getDate(), hasYear:false}; })()});
    } else {
      const nm = (prev.m+dir+12)%12, ny = prev.hasYear ? prev.y + (dir>0&&prev.m===11?1:(dir<0&&prev.m===0?-1:0)) : null;
      monthCols.push({c, ym:{y:ny, m:nm, hasYear:prev.hasYear}});
    }
  }
  if(cont) notes.push(`Колонки «Столбец1…${cont}» распознал как продолжение ${gran==='day'?'суток':'месяцев'} после «${hdrLabel(lastNamed.c)}».`);

  const colOrder = monthCols.slice();
  if(dir<0) monthCols.reverse(); // вывод годов (1б) должен идти по хронологии

  // 1б. Годы, если в шапке их не было (или были не у всех): якорь — первая колонка с явным годом
  //     («01.08.2026, 02.08, 03.08…»), иначе серия заканчивается не позже текущего месяца
  const noYear = monthCols.some(mc=>!mc.ym.hasYear);
  const anchor = noYear ? monthCols.findIndex(mc=>mc.ym.hasYear) : -1;
  if(noYear && gran==='day'){
    const seq=[]; let yOff=0;
    // откат внутри года (склейка двух выгрузок внахлёст) — не Новый год; переносом считаем шаг назад на полгода и больше
    monthCols.forEach((mc,i)=>{ if(i>0 && posIn(monthCols[i-1].ym)-posIn(mc.ym) >= cyc/2) yOff++; seq.push(yOff); });
    const last=monthCols[monthCols.length-1].ym;
    let y0=nowY;
    if(anchor>=0){ y0 = monthCols[anchor].ym.y - seq[anchor]; }
    else {
      const endsOk = y => new Date(y+seq[seq.length-1], last.m, last.d) <= new Date(nowY, nowM+1, 0);
      while(!endsOk(y0)) y0--;
    }
    monthCols.forEach((mc,i)=>{ if(!mc.ym.hasYear) mc.ym = {y:y0+seq[i], m:mc.ym.m, d:mc.ym.d, hasYear:true}; });
    const a = monthCols[0].ym, z = monthCols[monthCols.length-1].ym;
    notes.push(anchor>=0
      ? `Год указан не у всех дат шапки — для остальных взял год по дате «${hdrLabel(monthCols[anchor].c)}»: период ${dLabel(a)} — ${dLabel(z)}.`
      : `Годы в шапке не указаны — принял период ${dLabel(a)} — ${dLabel(z)} (последняя дата не позже текущего месяца).`);
  } else if(noYear){
    const n = monthCols.length;
    const seq=[]; let yOff=0;
    monthCols.forEach((mc,i)=>{ if(i>0 && monthCols[i-1].ym.m-mc.ym.m >= cyc/2) yOff++; seq.push(yOff); });
    let y0;
    if(anchor>=0) y0 = monthCols[anchor].ym.y - seq[anchor];
    else {
      const last=monthCols[n-1].ym;
      y0 = nowY;
      const endsOk = y => (y+seq[n-1])*12 + last.m <= nowY*12 + nowM;
      while(!endsOk(y0)) y0--;
    }
    monthCols.forEach((mc,i)=>{ if(!mc.ym.hasYear) mc.ym = {y:y0+seq[i], m:mc.ym.m, hasYear:true}; });
    const a = monthCols[0].ym, b = monthCols[n-1].ym;
    notes.push(anchor>=0
      ? `Год указан не у всех месяцев шапки — для остальных взял год по «${hdrLabel(monthCols[anchor].c)}»: период ${MONTHS_RU[a.m]} ${a.y} — ${MONTHS_RU[b.m]} ${b.y}.`
      : `Годы в шапке не указаны — принял период ${MONTHS_RU[a.m]} ${a.y} — ${MONTHS_RU[b.m]} ${b.y} (последний месяц ряда не позже текущего). Если сдвинуто, скажите — метки поправлю, на расчёты это не влияет.`);
  }
  // окончательный хронологический порядок (перемешанные/убывающие колонки) — значения читаются по monthCols[i].c
  {
    const key = ym => gran==='day' ? dayNum(ym) : ym.y*12+ym.m;
    monthCols = monthCols.map((mc,i)=>({mc,i})).sort((a,b)=>(key(a.mc.ym)-key(b.mc.ym)) || (a.i-b.i)).map(x=>x.mc);
    if(monthCols.some((mc,i)=>mc!==colOrder[i])) notes.push('Колонки периодов в файле шли не по возрастанию дат (например, «свежие слева») — выстроил их хронологически.');
  }
  // 1в. Одна дата/месяц в нескольких колонках. Либо ДУБЛИ (скопированный столбец, склейка двух выгрузок
  //     с включительными границами: повторов немного или значения совпадают) — оставляем одну колонку,
  //     либо ПОДПЕРИОДЫ (у большинства периодов по несколько колонок с разными числами: 1-е и 15-е число,
  //     24 часа на сутки) — суммируем. Значения дальше читаются по periodCols[i].cs
  let periodCols;
  {
    const key = ym => gran==='day' ? dayNum(ym) : ym.y*12+ym.m;
    const labOf = ym => gran==='day' ? dLabel(ym) : MONTHS_RU[ym.m]+' '+String(ym.y).slice(2);
    const rowsAll = aoa.slice(headerRow+1);
    const cellKey = v => (v==null || v==='') ? '' : String(v);
    const sameCol = (a,b) => rowsAll.every(r => cellKey((r||[])[a])===cellKey((r||[])[b]));
    const filled = c => rowsAll.reduce((n,r)=>{ const v=(r||[])[c]; return n + (v!=null && v!=='' ? 1 : 0); }, 0);
    const groups=[];
    for(const mc of monthCols){ const g=groups[groups.length-1]; if(g && key(g.ym)===key(mc.ym)) g.cols.push(mc.c); else groups.push({ym:mc.ym, cols:[mc.c]}); }
    const multi = groups.filter(g=>g.cols.length>1);
    const differ = multi.filter(g=>g.cols.some(c=>!sameCol(g.cols[0],c)));
    const avg = multi.length ? multi.reduce((n,g)=>n+g.cols.length,0)/multi.length : 1;
    // системно (у большинства периодов по несколько колонок) и либо числа в них разные, либо колонок ≥3 (часы в сутках)
    const subPeriods = multi.length*2 >= groups.length && (differ.length>0 || avg>=3);
    if(subPeriods && gran==='month' && avg>=4) return {error:'В шапке на каждый месяц приходится по '+Math.round(avg)+' колонок с датами — это суточная (или более дробная) выгрузка, как месяцы её разбирать нельзя. Выберите формат «сутки» или «авто».'};
    if(subPeriods){
      for(const g of groups) g.cs=g.cols;
      notes.push(gran==='day'
        ? 'В шапке по '+Math.round(avg)+' колонок на одни сутки (внутрисуточные интервалы) — просуммировал их по суткам.'
        : 'В шапке по '+Math.round(avg)+' колонок на один месяц (подпериоды, например 1-е и 15-е число) — просуммировал их по месяцам.');
    } else {
      const dupLabels=[]; let differN=0;
      for(const g of groups){
        if(g.cols.length===1){ g.cs=g.cols; continue; }
        g.cs=[g.cols.reduce((a,b)=>filled(b)>filled(a)?b:a)];
        dupLabels.push(labOf(g.ym)+' ×'+g.cols.length);
        if(differ.includes(g)) differN++;
      }
      if(dupLabels.length) notes.push('В шапке период повторяется: '+dupLabels.slice(0,6).join(', ')+(dupLabels.length>6?' и ещё '+(dupLabels.length-6):'')+' — оставил по одной колонке'+(differN?' (в '+differN+' из них значения различаются — взял колонку с бóльшим числом заполненных ячеек; если это склейка двух выгрузок, проверьте стык)':'')+', иначе период считался бы дважды.');
    }
    periodCols = groups;
  }
  // защита: месячный ряд длиннее 20 лет — алгоритмы квадратичны по длине ряда
  if(gran==='month' && periodCols.length>240) return {error:'В шапке '+periodCols.length+' месяцев подряд — слишком длинный ряд для месячного разбора; оставьте в выгрузке последние 10–15 лет.'};
  // «months» здесь — список ПЕРИОДОВ колонок (месяцы или сутки); для суток ниже агрегируется в месяцы
  let months = periodCols.map(g=> gran==='day' ? {y:g.ym.y, m:g.ym.m, d:g.ym.d} : {y:g.ym.y, m:g.ym.m});
  const firstMonthCol = Math.min(...monthCols.map(x=>x.c));

  // 2. Строки данных
  const dataRows = aoa.slice(headerRow+1).filter(r => r && r.some(v=>v!=null && String(v).trim()!==''));
  if(!dataRows.length) return {error:'Под шапкой нет строк с данными.'};

  // 3. Колонка номера ПУ
  let idCol=-1, idScore=-1;
  for(let c=0; c<firstMonthCol; c++){
    let score=0;
    const h=(header[c]||'').toLowerCase();
    if(/№|номер|завод|serial|\bпу\b/.test(h) && !/п\/п/.test(h)) score+=5;
    if(/п\/п/.test(h)) score-=10;
    for(const row of dataRows.slice(0,80)){
      const v=row[c];
      if(v!=null && ID_RX.test(String(v).trim().replace(/\.0+$/,''))) score += String(v).trim().length>=8 ? 2 : 0.5;
    }
    if(score>idScore){ idScore=score; idCol=c; }
  }
  if(idCol<0){ idCol=0; notes.push('Колонку номера ПУ определил как первую — проверьте.'); }

  // 3а. Служебные колонки
  let nameCol=-1, addrCol=-1, tpCol=-1, powerCol=-1, typeCol=-1, voltCol=-1, labelCol=-1, askueCol=-1, pollCol=-1, gasCol=-1;
  for(let c=0; c<firstMonthCol; c++){
    if(c===idCol) continue;
    const h=(header[c]||'').toLowerCase();
    if(pollCol<0 && /опрос|успешн.*связ|процент.*аскуэ/.test(h)) pollCol=c;
    else if(askueCol<0 && /^аскуэ(?:$|[\s(,:/])|^асуэ(?:$|[\s(,:/])|^автоматизац/.test(h)) askueCol=c;
    else if(labelCol<0 && /^(признак|метка|результат проверки|статус нарушения|подтверждение)(?:\s|$)/.test(h)) labelCol=c;
    else if(gasCol<0 && /^газ(?![а-яё])|газифик|газоснаб/.test(h)) gasCol=c; // v5.1: для признака Г1
    else if(powerCol<0 && /мощност/.test(h)) powerCol=c;
    else if(voltCol<0 && /напряж/.test(h)) voltCol=c;
    else if(typeCol<0 && /юр|физ|правов|катег.*потреб|(?:тип|вид)\s*(потреб|абон|лиц)/.test(h)) typeCol=c;
    else if(tpCol<0 && /^тп(?![а-яё])|подстанц|фидер|ктп/.test(h)) tpCol=c;
    else if(nameCol<0 && /фио|абонент|потребител|наименован|владел/.test(h)) nameCol=c;
    else if(addrCol<0 && /адрес|улиц|объект/.test(h)) addrCol=c;
  }
  // напряжение из файла: «0,22» / «220» → 0,22 кВ; «0,4» / «0,38» / «380» / «400» → 0,4 кВ
  const parseVolt = vv => {
    if(vv==null) return null;
    const sv=String(vv).replace(',','.').replace(/\s/g,'').toLowerCase();
    if(!sv) return null;
    if(/^0?\.22|^0?\.23|^220/.test(sv)) return '0,22';
    if(/^0?\.4|^0?\.38|^380|^400/.test(sv)) return '0,4';
    return null;
  };
  if(nameCol<0 && addrCol<0){
    for(let c=idCol+1; c<firstMonthCol; c++){
      if(c===powerCol||c===tpCol||c===typeCol||c===voltCol||c===labelCol||c===askueCol||c===pollCol||c===gasCol) continue;
      const sample=dataRows.slice(0,30).map(r=>r[c]).filter(v=>v!=null && String(v).trim()!=='');
      const texty=sample.filter(v=>isNaN(parseFloat(String(v).replace(',','.')))).length;
      if(sample.length && texty/sample.length>0.6){ if(nameCol<0) nameCol=c; else if(addrCol<0) addrCol=c; }
    }
  }

  // 4. Сбор ПУ и строк отпуска
  const meters=[], supplyRows=[], automationRows=[];
  const toNum = v => {
    if(v==null || v==='') return null;
    if(typeof v==='string') v = parseFloat(v.replace(/\s|\u00A0/g,'').replace(',','.'));
    return isFinite(v) ? v : null;
  };
  // \u0442\u0438\u043F \u043F\u043E\u0442\u0440\u0435\u0431\u0438\u0442\u0435\u043B\u044F: 'ul' (\u044E\u0440. \u043B\u0438\u0446\u043E) / 'fl' (\u0444\u0438\u0437. \u043B\u0438\u0446\u043E) / null (\u043D\u0435 \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0451\u043D)
  const parseCtype = v => {
    if(v==null) return null;
    const s=String(v).trim().toLowerCase();
    if(!s) return null;
    if(/\u044E\u0440|\u043E\u0440\u0433\u0430\u043D\u0438\u0437|\u043F\u0440\u0435\u0434\u043F\u0440\u0438\u044F\u0442|\u0431\u044E\u0434\u0436|\u0443\u0447\u0440\u0435\u0436\u0434|\u043A\u043E\u043C\u043C\u0435\u0440\u0447|\u0431\u0438\u0437\u043D\u0435\u0441/.test(s)) return 'ul';
    if(/\u0444\u0438\u0437|\u0431\u044B\u0442|\u043D\u0430\u0441\u0435\u043B|\u0433\u0440\u0430\u0436\u0434|\u0447\u0430\u0441\u0442\u043D/.test(s)) return 'fl';
    return null;
  };
  const UL_NAME_RX = /(^|[\s\u00AB"'(,;])(\u043E\u043E\u043E|\u043E\u0430\u043E|\u0437\u0430\u043E|\u043F\u0430\u043E|\u0430\u043E|\u043D\u0430\u043E|\u0438\u043F|\u0441\u043D\u0442|\u0442\u0441\u0436|\u0442\u0441\u043D|\u0434\u043D\u0442|\u0434\u043D\u043F|\u0433\u0441\u043A|\u043F\u0433\u043A|\u043A\u0444\u0445|\u0444\u0433\u0443\u043F|\u0444\u0433\u0431\u0443|\u0433\u0431\u0443|\u043C\u0431\u0443|\u043C\u0443\u043F|\u0433\u0443\u043F|\u043C\u0430\u0433\u0430\u0437\u0438\u043D|\u0448\u043A\u043E\u043B\u0430|\u0434\u0435\u0442\u0441\u043A|\u0431\u043E\u043B\u044C\u043D\u0438\u0446|\u043F\u043E\u043B\u0438\u043A\u043B\u0438\u043D|\u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0446|\u043A\u043E\u043E\u043F\u0435\u0440\u0430\u0442\u0438\u0432|\u0444\u0435\u0440\u043C|\u043F\u0435\u043A\u0430\u0440\u043D|\u0430\u0432\u0442\u043E\u0441\u0435\u0440\u0432\u0438\u0441|\u0441\u0442\u043E|\u0430\u0437\u0441|\u0431\u0430\u0437\u0430|\u0446\u0435\u0445|\u0437\u0430\u0432\u043E\u0434|\u0444\u0430\u0431\u0440\u0438\u043A)(?=[\s\u00BB"'),;.]|$)/i;
  const FIO_RX = /^[\u0430-\u044F\u0451-]+\s+[\u0430-\u044F\u0451]\s*\.\s*[\u0430-\u044F\u0451]\s*\.?$|^[\u0430-\u044F\u0451-]+\s+[\u0430-\u044F\u0451-]+\s+[\u0430-\u044F\u0451-]+(?:\u043D\u0430|\u0438\u0447)$/i;
  const inferCtype = name => {
    const s=String(name||'').trim();
    if(!s) return null;
    if(UL_NAME_RX.test(s)) return 'ul';
    if(FIO_RX.test(s)) return 'fl';
    return null;
  };
  let ctypeFromName=0;
  const skippedTotals=[];
  const sourceRowOf=new Map(aoa.map((row,i)=>[row,i+1]));
  for(const row of dataRows){
    const values = periodCols.map(g=>{ let acc=null; for(const c of g.cs){ const x=toNum(row[c]); if(x!=null) acc=(acc==null?0:acc)+x; } return acc; });
    const textJoin = row.slice(0,firstMonthCol).map(v=>v==null?'':String(v)).join(' ');
    // строка отпуска: есть маркер в тексте И в колонке № ПУ НЕ номер прибора —
    // у строк отпуска там текстовая метка; иначе это абонент (защита от фамилий
    // и адресов, случайно содержащих маркерные слова)
    const idRaw = row[idCol]==null ? '' : String(row[idCol]).trim().replace(/\.0+$/,'');
    // v5.0: итоговая строка («Итого», «Всего», «Сумма») без маркера отпуска — не прибор
    const firstText = row.slice(0,firstMonthCol).map(v=>v==null?'':String(v).trim()).find(Boolean)||'';
    if(!ID_RX.test(idRaw) && !SUPPLY_RX.test(textJoin) && (TOTAL_RX.test(idRaw)||TOTAL_RX.test(firstText))){
      skippedTotals.push(firstText||idRaw);
      continue;
    }
    if(SUPPLY_RX.test(textJoin) && !ID_RX.test(idRaw)){
      const lbl = idRaw ? idRaw : textJoin.trim();
      supplyRows.push({label:lbl, idsText:textJoin.trim(), tp: tpCol>=0?String(row[tpCol]||'').trim():'', values});
      continue;
    }
    const rawId = row[idCol];
    if(rawId==null || String(rawId).trim()==='') continue;
    const name = nameCol>=0?String(row[nameCol]??'').trim():'';
    let ctype = typeCol>=0 ? parseCtype(row[typeCol]) : null;
    if(ctype==null && name){ ctype = inferCtype(name); if(ctype) ctypeFromName++; }
    const askueRaw=askueCol>=0?row[askueCol]:null, pollRaw=pollCol>=0?row[pollCol]:null;
    const askue=parseAskue(askueRaw),pollPct=parsePollPct(pollRaw);
    const askueInvalid=askueRaw!=null&&String(askueRaw).trim()!==''&&askue==null;
    const pollInvalid=pollRaw!=null&&String(pollRaw).trim()!==''&&pollPct==null;
    const metadata={id:idRaw,tp:tpCol>=0?String(row[tpCol]??'').trim():'',ctype,askue,pollPct,askueInvalid,pollInvalid};
    if(values.some(v=>v!=null)||ID_RX.test(idRaw))automationRows.push(metadata);
    if(values.every(v=>v==null))continue;
    const gasP=gasCol>=0?parseGas(row[gasCol]):{gas:null,date:null};
    meters.push({
      askue,pollPct,askueInvalid,pollInvalid,
      gas:gasP.gas, gasDate:gasP.date,
      id: String(rawId).trim().replace(/\.0+$/,''),
      name,
      addr: addrCol>=0?String(row[addrCol]??'').trim():'',
      tp:   tpCol>=0?String(row[tpCol]??'').trim():'',
      power: powerCol>=0?toNum(row[powerCol]):null,
      voltage: voltCol>=0?parseVolt(row[voltCol]):null,
      ctype,
      reviewLabel: labelCol>=0?reviewLabelOf(row[labelCol]):null,
      reviewText: labelCol>=0?String(row[labelCol]??'').trim():'',
      sourceRow: sourceRowOf.get(row),
      values
    });
  }
  const invalidMeta=automationRows.filter(m=>m.askueInvalid||m.pollInvalid).length;
  if(invalidMeta)notes.push('У '+invalidMeta+' строк метаданные АСКУЭ/опроса не распознаны: статус — да/нет/пусто; опрос — число от 0 до 100. Неизвестное не заменено нулём.');
  if(automationRows.length>meters.length)notes.push('В статистику автоматизации включены '+(automationRows.length-meters.length)+' строк ПУ без расхода; в рейтинге риска они не участвуют.');
  const duplicateMeta=new Map();
  for(const m of automationRows){const k=JSON.stringify([m.tp,m.id]);if(!duplicateMeta.has(k))duplicateMeta.set(k,[]);duplicateMeta.get(k).push(m);}
  for(const m of meters){const copies=duplicateMeta.get(JSON.stringify([m.tp,m.id]))||[];const statuses=new Set(copies.map(x=>x.askue).filter(x=>x===true||x===false));
    if(statuses.size>1){m.askueOriginal=m.askue;m.pollOriginal=m.pollPct;m.askue=null;m.pollPct=null;m.askueConflict=true;}
  }
  // v5.0: строка, совпадающая с суммой приборов своей ТП (±0,5% в 70% периодов), — итог полезного
  // отпуска, а не учёт ввода и не прибор. Иначе полезный отпуск удваивается, а небаланс уходит в минус.
  {
    const isTotalOf=(vals,tp,excl)=>{
      let hit=0, chk=0;
      for(let i=0;i<vals.length;i++){
        if(vals[i]==null) continue;
        let s=0, k=0;
        for(const m of meters){ if(m===excl || (tp && m.tp!==tp)) continue; if(m.values[i]!=null){ s+=m.values[i]; k++; } }
        if(k<3 || s<=0) continue;
        chk++; if(Math.abs(vals[i]-s)<=Math.max(2,s*0.005)) hit++; // итог совпадает с суммой почти точно; ввод ТП с потерями — нет
      }
      return chk>=3 && hit/chk>=0.7;
    };
    for(let k=supplyRows.length-1;k>=0;k--){
      const s=supplyRows[k], tp=s.tp && meters.some(m=>m.tp===s.tp) ? s.tp : '';
      if(isTotalOf(s.values,tp,null)){ skippedTotals.push(s.label); supplyRows.splice(k,1); }
    }
    for(let k=meters.length-1;k>=0;k--){
      const m=meters[k];
      if(ID_RX.test(m.id)) continue;
      if(isTotalOf(m.values,m.tp,m)){
        skippedTotals.push(m.id); meters.splice(k,1);
        const ai=automationRows.findIndex(a=>a.id===m.id && a.tp===m.tp); if(ai>=0) automationRows.splice(ai,1);
      }
    }
    if(skippedTotals.length) notes.push('Итоговые строки исключены ('+skippedTotals.length+'): '+skippedTotals.slice(0,4).map(x=>'«'+String(x).slice(0,40)+'»').join(', ')+(skippedTotals.length>4?'…':'')+' — это сумма приборов, а не отдельный ПУ и не учёт ввода; иначе полезный отпуск считался бы дважды.');
  }
  if(!meters.length) return {error:'Не выделил ни одного ПУ — проверьте колонку с номерами приборов.'};
  {
    const ul=meters.filter(m=>m.ctype==='ul').length, fl=meters.filter(m=>m.ctype==='fl').length;
    if(ul||fl){
      let msg = 'Тип потребителя: юр. лиц — '+ul+', физ. лиц — '+fl+(meters.length-ul-fl?', не определён — '+(meters.length-ul-fl):'')+'.';
      if(typeCol<0 && ctypeFromName) msg += ' Колонки «Тип (юр/физ)» в файле нет — '+ctypeFromName+' определил по названию абонента (ООО/ИП/ФИО и т.п.); для точности добавьте колонку.';
      msg += ' Сравнение «с соседями» ведётся внутри своего типа — по своей ТП или по всему реестру (переключатель «Медиана соседей» над рейтингом).';
      notes.push(msg);
    }
  }
  if(voltCol>=0){
    const nv=meters.filter(m=>m.voltage).length;
    notes.push('Уровень напряжения взял из колонки файла ('+nv+' ПУ с указанным значением); там, где пусто, — по правилу: ≤10 кВт → 0,22 кВ, выше → 0,4 кВ.');
  }

  if(gasCol>=0){
    const gy=meters.filter(m=>m.gas===true).length, gn=meters.filter(m=>m.gas===false).length, gd=meters.filter(m=>m.gasDate).length;
    notes.push('Колонка «'+header[gasCol]+'»: газ есть — '+gy+(gd?' (с датой подключения — '+gd+')':'')+', газа нет — '+gn+', не указано — '+(meters.length-gy-gn)+'. Используется только признаком Г1: при «да» провал после исчезновения отопления объясняется газом, при «нет» — наоборот, становится подозрительнее.');
  }
  if(labelCol>=0) notes.push('Метки проверки прочитаны из колонки «'+header[labelCol]+'». Они используются только во вкладке «Контроль выборки» и не участвуют в расчёте риска. «НЕ ВОР» распознаётся отдельно от «ВОР».');

  // 4а. Хвостовая колонка-«Итого»: последняя колонка В ФАЙЛЕ (в ряду «свежие слева» после сортировки она
  //     стоит первой) ≈ сумме остальных почти во всех строках
  const fileLastC = colOrder[colOrder.length-1].c;
  const lastIdx = periodCols.findIndex(g=>g.cs.length===1 && g.cs[0]===fileLastC);
  let totalHits=0, checked=0;
  if(lastIdx>=0) for(const m of meters){
    const v=m.values;
    if(v[lastIdx]==null) continue;
    const rest = v.reduce((acc,x,i)=>i===lastIdx?acc:acc+(x||0),0);
    if(rest>50){ checked++; if(Math.abs(v[lastIdx]-rest) <= Math.max(2, rest*0.02)) totalHits++; }
  }
  if(checked>=3 && totalHits/checked>=0.7){
    for(const m of meters) m.values.splice(lastIdx,1);
    for(const s of supplyRows) s.values.splice(lastIdx,1);
    months.splice(lastIdx,1);
    notes.push((lastIdx===months.length?'Последнюю колонку':'Последнюю в файле колонку (по датам она встала первой)')+' распознал как «Итого» и исключил из ряда периодов.');
  }

  // 4б. Дубли номеров
  const seen={};
  for(const m of meters){ seen[m.id]=(seen[m.id]||0)+1; }
  const dups = Object.keys(seen).filter(k=>seen[k]>1);
  if(dups.length){
    let k={};
    for(const m of meters){ k[m.id]=(k[m.id]||0)+1; if(seen[m.id]>1){ m.dup=k[m.id]; m.dupOf=seen[m.id]; } }
    notes.push(`В файле дубли номеров: ${dups.join(', ')} — обе строки оставил, помечены как «дубль». Стоит выяснить, какая актуальна.`);
  }

  // 4в. Отрицательные значения → null + пометка (сторно/перерасчёт)
  for(const m of meters){
    let neg=0;
    m.corrections=[];
    // v5.5: запоминаем и позицию сторно (idx — период ряда), чтобы график и тепловая карта показали его на своём месте
    m.values = m.values.map((v,i)=>{ if(v!=null && v<0){ neg++; m.corrections.push({period:gran==='day'?dLabel(months[i]):ymLabel(months[i]), value:v, idx:i}); return null; } return v; });
    if(neg) m.negNote = `${neg} отриц. знач. (сторно/перерасчёт?) — исключены из расчёта`;
  }

  // 5. Показания vs расход
  let mono=0, chk=0;
  for(const m of meters){
    const v=m.values.filter(x=>x!=null);
    if(v.length<5) continue;
    chk++;
    let ok=0;
    for(let i=1;i<v.length;i++) if(v[i] >= v[i-1]-0.001) ok++;
    // для суток относительный порог ×1,2 не годится (показание в тысячах кВт·ч за 1–2 месяца растёт
    // на проценты) — берём абсолютный: в среднем не меньше EPS_D кВт·ч за сутки
    const grows = gran==='day' ? (v[v.length-1]-v[0]) >= EPS_D*(v.length-1) : v[v.length-1] > v[0]*1.2;
    if(ok/(v.length-1)>=0.92 && grows && v[0] > 100) mono++;
  }
  let cumulative=false;
  if(chk>=3 && mono/chk>=0.75){
    cumulative=true;
    const diff = s => { const d=[]; for(let i=1;i<s.length;i++){ const a=s[i-1],b=s[i]; d.push((a!=null&&b!=null)?Math.max(0,b-a):null); } return d; };
    for(const m of meters) m.values=diff(m.values);
    for(const s of supplyRows) s.values=diff(s.values);
    months.shift();
    // v5.5: после разностей ряд начинается со второго периода — позиции сторно сдвигаются на один
    for(const m of meters) if(m.corrections) m.corrections=m.corrections.map(c=>({...c, idx:c.idx-1})).filter(c=>c.idx>=0);
    notes.push('Похоже, в файле накопительные показания — перевёл в расход по периодам (разности).');
  }

  // 6. Суточные данные → месячные суммы для риск-алгоритмов (их калибровка — помесячная);
  //    суточные ряды сохраняются (meter.daily / supply.daily) для баланса и графиков.
  let days=null, monthDays=null;
  if(gran==='day'){
    days = months.map(pd=>({y:pd.y, m:pd.m, d:pd.d}));
    const keyOf=pd=>pd.y*12+pd.m;
    const mkeys=[], idxByKey={};
    days.forEach(pd=>{ const k=keyOf(pd); if(idxByKey[k]==null){ idxByKey[k]=mkeys.length; mkeys.push(k); } });
    const mList=mkeys.map(k=>({y:Math.floor(k/12), m:k%12}));
    const mDays=mList.map(()=>[]);
    days.forEach((pd,i)=>mDays[idxByKey[keyOf(pd)]].push(i));
    // полный месяц — есть колонки минимум на 80% календарных дней
    const need=mList.map(mm=>Math.ceil(0.8*daysInMonth(mm.y,mm.m)));
    const full=mList.map((mm,mi)=>mDays[mi].length>=need[mi]);
    // сумма известных суток досчитывается до календарного месяца пропорционально
    // (иначе месяц с 25 из 31 суток выглядел бы падением расхода на 20% → ложные S3/S11, кривой небаланс)
    let partial=0;
    const aggr=daily=>mList.map((mm,mi)=>{
      if(!full[mi]) return null;
      let s=0, known=0;
      for(const i of mDays[mi]){ if(daily[i]!=null){ s+=daily[i]; known++; } }
      if(known<need[mi]) return null;        // дыр больше 20% — месяца нет
      const dim=daysInMonth(mm.y,mm.m);
      if(known<dim){ partial++; return s*dim/known; }
      return s;
    });
    for(const m of meters){ m.daily=m.values; m.values=aggr(m.daily); }
    for(const s of supplyRows){ s.daily=s.values; s.values=aggr(s.daily); }
    if(partial) notes.push('В '+partial+' ряд-месяцах данные не за все дни (но ≥80%) — месячные суммы приведены к полному месяцу пропорционально известным дням (оценка).');
    const keep=full;
    const dropped=mList.filter((_,mi)=>!keep[mi]).map(mm=>MONTHS_RU[mm.m]+' '+String(mm.y).slice(2));
    months = mList.filter((_,mi)=>keep[mi]);
    monthDays = mDays.filter((_,mi)=>keep[mi]);
    for(const m of meters) m.values=m.values.filter((_,mi)=>keep[mi]);
    for(const s of supplyRows) s.values=s.values.filter((_,mi)=>keep[mi]);
    // v5.5: сторно суточной выгрузки: dayIdx — сутки (для суточного графика), idx — полный месяц (null, если месяц неполный)
    { const dayToMonth=new Array(days.length).fill(null); monthDays.forEach((ix,mi)=>ix.forEach(i=>{ dayToMonth[i]=mi; }));
      for(const m of meters) if(m.corrections) m.corrections=m.corrections.map(c=>({...c, dayIdx:c.idx, idx:dayToMonth[c.idx]??null})); }
    if(!months.length) return {error:'Суточных данных меньше одного полного месяца — для анализа нужен хотя бы один полный календарный месяц.'};
    notes.unshift('Формат: СУТОЧНЫЕ данные — '+days.length+' сут. ('+dLabel(days[0])+' — '+dLabel(days[days.length-1])+'). Месячные признаки S1–S14 считаются по суммам полных месяцев ('+months.length+(dropped.length?'; неполные исключены: '+dropped.join(', '):'')+')'+(months.length<6?' — их мало, основную работу делают суточные признаки D1–D3':'')+'; баланс, сценарии и графики — по суткам.');
  } else {
    notes.unshift('Формат: месячные данные — '+months.length+' мес.'+(granReq!=='auto'?' (задан вручную).':''));
  }

  if(months.length<6) notes.push('Полных месяцев меньше шести — ступенчатые и сезонные признаки менее надёжны.');
  return {meters, automationRows, months, supplyRows, notes, cumulative, gran, days, monthDays};
}

/* ================= АЛГОРИТМЫ ВЫЯВЛЕНИЯ (v3) =================
   Каждый возвращает {pts, detail, ...} либо null.
   Исходные эвристики v3, дополненные в v4.6; балл не является вероятностью:
   один сильный паттерн (S1–S3, глубокая ступень) может выводить в красную зону,
   слабые признаки (S7, S8, S10, S12) поодиночке — нет.
   Сравнение «до/после» дополнительно сверяется с динамикой группы, чтобы
   не путать вмешательство с общим спадом (сезон, экономика). */

// S1. «Спящий → пробуждение»: долгие нули с начала, затем устойчивое потребление
function algSleeper(v, months){
  const T=TUNE.sleeper;
  let z=0;
  while(z<v.length && (v[z]==null || v[z]<=EPS)) z++;
  if(z<T.minZeros || z>v.length-4) return null;
  const zeros = v.slice(0,z).filter(x=>x!=null && x<=EPS).length;
  if(zeros < T.minZeros) return null;
  const after = v.slice(z).filter(x=>x!=null);
  const post = median(after);
  if(post==null || post<T.minPost) return null;
  const sustained = after.filter(x=>x>EPS).length/after.length;
  if(sustained<0.7) return null;
  return {pts:0, info:true, weak:true, activationIdx:z,
    detail:`${zeros} начальных нулевых месяцев, затем с ${ymLabel(months[z])} появилась активность ~${fmt(post)} кВт·ч/мес. Без даты установки/подключения причина неизвестна. Признак информационный: 0 баллов, оценка недоучёта не формируется.`};
}

// S2. «Рваный профиль»: нули вперемешку со всплесками.
// v5.0: сначала проверка сохранения объёма. Если всплески содержат накопленный расход за
// «нулевые» месяцы (съём раз в несколько месяцев), энергия не потеряна: это вопрос качества
// данных, а не недоучёт — 0 баллов, без оценки объёма, а уровни ряда дальше не анализируются.
function algRagged(v, months, winterBonus=true, gs=null){
  const T=TUNE.ragged;
  const known = v.filter(x=>x!=null);
  if(known.length<10) return null;
  const zeros = known.filter(x=>x<=EPS).length;
  const zShare = zeros/known.length;
  if(zShare<0.2 || zShare>0.85) return null;
  const pos = known.filter(x=>x>EPS);
  const mp = median(pos);
  const avgAll = mean(known);
  if(mp==null || avgAll<40) return null;
  const mx = Math.max(...pos);
  // v5.0: всплеск — относительно среднего с учётом нулей. Раньше — к медиане положительных значений,
  // и чистый профиль «нули + одинаковые всплески» (каноничный рваный) не распознавался вовсе.
  const spike = mx/avgAll;
  if(spike<T.minSpike) return null;
  let trans=0;
  for(let i=1;i<v.length;i++){
    const a=v[i-1], b=v[i];
    if(a!=null && b!=null && ((a<=EPS)!==(b<=EPS))) trans++;
  }
  if(trans<T.minTrans) return null;
  // (а) средний расход вместе со всплесками сопоставим с типичным для группы;
  // (б) всплески растут пропорционально длине паузы перед ними — накопленный съём.
  const ref = (gs && gs.cnt>=6 && gs.groupMedian!=null && gs.groupMedian>=30) ? gs.groupMedian : null;
  const cyc=[]; let gap=0;
  for(const x of v){ if(x==null) continue; if(x<=EPS){ gap++; continue; } if(gap>0) cyc.push({len:gap+1, val:x}); gap=0; }
  let propR=null;
  if(cyc.length>=4){
    const L=cyc.map(c=>c.len), V=cyc.map(c=>c.val), mL=mean(L), mV=mean(V);
    const sL=Math.sqrt(L.reduce((s,x)=>s+(x-mL)**2,0)), sV=Math.sqrt(V.reduce((s,x)=>s+(x-mV)**2,0));
    if(mL>0 && stdev(L)/mL>=0.2 && sL>0 && sV>0) propR=L.reduce((s,x,i)=>s+(x-mL)*(V[i]-mV),0)/(sL*sV);
  }
  const byGroup = ref!=null && avgAll>=0.5*ref;
  const byGaps = propR!=null && propR>=0.8;
  if(byGroup || byGaps){
    const why = byGroup
      ? `средний расход вместе со всплесками ~${fmt(avgAll)} кВт·ч/мес — ${fmt(avgAll/ref*100)}% типичного для группы`
      : `всплески растут пропорционально длине паузы перед ними (корреляция ${fmt(propR,2)})`;
    return {pts:0, info:true, weak:true, irregular:true, avgAll,
      detail:`Нули чередуются со всплесками до ${fmt(mx)} кВт·ч, но объём сохраняется: ${why}. Так выглядит нерегулярный съём показаний — расход «нулевых» месяцев приходит во всплеске, а не теряется. Баллы и оценка недоучёта не начисляются. Помесячные уровни такого ряда недостоверны, поэтому ступени, провалы и нули по нему не оцениваются. Сверить график передачи показаний, снять контрольные.`};
  }
  let wz=0;
  v.forEach((x,i)=>{ if(winterBonus&&x!=null&&x<=EPS&&isWinter(months[i])) wz++; });
  const pts = Math.min(45, Math.round(24 + (zShare>=0.25&&zShare<=0.7?8:4) + Math.min(10,spike) + Math.min(7,trans) + Math.min(4,2*wz)));
  // Объём: недостача среднего (вместе со всплесками) до 80% типичного уровня группы.
  // Без группы — прежняя формула, она может завышать объём при накопленных съёмах.
  const loss = ref!=null ? Math.round(Math.max(0,0.8*ref-avgAll)*known.length) : Math.round(zeros*mp);
  return {pts, loss, base: ref!=null ? 0.8*ref : mp,
    detail:`Профиль «рваный»: ${zeros} нулевых мес. чередуются со всплесками до ${fmt(mx)} кВт·ч (в ${fmt(spike,1)} раза выше среднего), но даже вместе со всплесками средний расход ~${fmt(avgAll)} кВт·ч/мес${ref!=null?' — лишь '+fmt(avgAll/ref*100)+'% типичного для группы':' (группы для сравнения нет)'}. Объём не сохраняется: большую часть времени энергия, по-видимому, идёт мимо ПУ. Оценка недоучёта ≈ ${fmt(loss)} кВт·ч${ref!=null?' (до 80% типичного уровня группы)':''}.`};
}

// Групповая поправка «до/после»: как просела сама группа вокруг той же точки.
// Возвращает ratio группы (после/до) либо null, если посчитать нельзя.
function groupStepRatio(gMed, t){
  if(!gMed) return null;
  const gb=median(gMed.slice(0,t)), ga=median(gMed.slice(t));
  return (gb!=null && ga!=null && gb>=20) ? ga/gb : null;
}

// S3. Ступенчатое падение: расход упал и держится на низком уровне до конца ряда.
// Устойчивость проверяется двумя путями: по доле месяцев ниже порога И по медианам
// годовых блоков (второй путь не даёт сезонным пикам маскировать ступень).
function algStepDrop(v, months, gMed, gCnt){
  const T=TUNE.step;
  const n=v.length;
  // v5.0: сравнение идёт в «сезонно очищенных» единицах (ряд ÷ профиль группы), а окно «до»
  // не короче года. Раньше 3 зимних месяца в начале ряда сравнивались с многолетней медианой,
  // и «ступень» в апреле первого года находилась у чистых ПУ с выраженной сезонностью.
  const sf=groupSeasonalFactors(gMed, gCnt);
  const a=sf ? v.map((x,i)=>x==null?null:x/sf[i]) : v;
  const minBefore = n>=24 ? 12 : (sf ? 6 : Infinity);
  if(!isFinite(minBefore) || n<minBefore+3) return null;
  const {pre,suf}=runningMedians(a);
  const byMonth=new Map(months.map((m,i)=>[m.y*12+m.m,i]));
  const yearBlocksBelow = (t, thr) => { // все 12-мес. блоки после t ниже порога?
    let all=true, cnt=0;
    for(let y0=t; y0<n; y0+=12){
      const seg=a.slice(y0,Math.min(n,y0+12)).filter(x=>x!=null);
      if(seg.length<4) continue;
      cnt++;
      if(median(seg)>=thr) all=false;
    }
    return cnt>=1 && all;
  };
  // v5.3: окно «до» отсчитывается от начала активности, а не от начала файла: не короче minBefore месяцев
  // и известно ≥75% из них (раньше после пустого префикса «прежний уровень» мог браться по одному-двум
  // показаниям). Проверяется у найденной ступени: если до неё меньше года данных, признак не срабатывает,
  // а не переносится на более позднюю дату.
  const kc=[0]; for(let i=0;i<n;i++) kc.push(kc[i]+(a[i]!=null?1:0));
  let from0=0; while(from0<n && a[from0]==null) from0++;
  let bestR=null;
  // кандидаты — не раньше чем через minBefore месяцев от начала активности (не от начала файла)
  for(let t=Math.max(minBefore,from0+minBefore); t<=n-3; t++){
    const mb=pre[t], ma=suf[t];
    if(mb==null||ma==null||mb<40) continue;
    const ratio=ma/mb;
    if(ratio>T.rMax) continue; // калибровка: ступень мельче настроенного порога не считается
    // v5.3: ступень не «переносится» на более позднюю дату: 3 известных месяца перед t должны быть ещё
    // ближе к прежнему уровню, чем к новому (иначе настоящий перелом раньше — его и ищем, если до него
    // есть год истории; если нет — признак не срабатывает)
    { let c=0; const p3=[]; for(let i=t-1;i>=from0 && c<3;i--) if(a[i]!=null){ p3.push(a[i]); c++; }
      if(p3.length>=3 && median(p3) < ma+0.35*(mb-ma)) continue; }
    const aKnown=[];
    for(let i=t;i<n;i++) if(a[i]!=null) aKnown.push(a[i]);
    if(aKnown.length<3) continue;
    if(aKnown.length<12){
      // Короткий «хвост» — меньше года после точки. Без сезонной очистки не оцениваем;
      // с ней — исключаем собственную сезонность ПУ: те же месяцы год назад не должны быть такими же низкими.
      if(!sf) continue;
      const yoy=[];
      for(let i=t;i<n;i++){ const j=byMonth.get(months[i].y*12+months[i].m-12); if(j!=null && j<t && v[i]!=null && v[j]!=null && v[j]>0) yoy.push(v[i]/v[j]); }
      if(yoy.length && median(yoy)>Math.max(0.8, ratio*1.25)) continue;
    }
    let ok=false;
    if(ratio<=0.5){
      ok = aKnown.filter(x=>x<mb*0.8).length/aKnown.length >= 0.75 || yearBlocksBelow(t, mb*0.8);
    } else if(ratio<=0.65){
      ok = aKnown.filter(x=>x<mb*0.8).length/aKnown.length >= 0.85 || yearBlocksBelow(t, mb*0.8);
    } else if(ratio<=Math.max(0.8, T.rMax)){
      // неглубокая ступень: только длинная и очень устойчивая
      ok = aKnown.length>=12 && (aKnown.filter(x=>x<mb*0.9).length/aKnown.length >= 0.85 || yearBlocksBelow(t, mb*0.9));
    }
    if(!ok) continue;
    // v5.0: точка перелома — минимум суммы модулей отклонений от двух уровней (L1). Раньше бралась
    // «самая ранняя из почти одинаковых», а медианы почти не чувствуют точный месяц — перелом
    // смещался на годы раньше, и оценка объёма захватывала нормальные месяцы.
    let cost=0;
    for(let i=0;i<n;i++){ const x=a[i]; if(x!=null) cost+=Math.abs(x-(i<t?mb:ma)); }
    const cand={t,mb,ma,ratio,after:aKnown.length,cost};
    if(!bestR || cost<bestR.cost) bestR=cand;
  }
  if(!bestR || kc[bestR.t]<Math.ceil(minBefore*0.75)) return null;
  // v5.3: окно «до» — весь известный ряд от начала активности до перелома (не последние месяцы)
  let from=0; while(from<n && a[from]==null) from++;
  // v5.3: своя сезонность ПУ сильнее групповой (электроотопление, кондиционер, сезонная работа): медиана
  // «смешивает» зимы и лето, а профиль группы её не убирает. Тогда перелом ищется по годовому падению
  // к тем же месяцам годом раньше, сезоны сравниваются отдельно, а ожидаемый расход после перелома —
  // тот же месяц до перелома (а не «средний уровень»).
  const WM=[11,0,1], SM=[5,6,7];
  let grpWS=1;
  if(sf){ const gw=[], gsm=[]; months.forEach((ym,i)=>{ if(WM.includes(ym.m)) gw.push(sf[i]); else if(SM.includes(ym.m)) gsm.push(sf[i]); }); if(gw.length && gsm.length) grpWS=mean(gw)/mean(gsm); }
  // своя сезонность — устойчивая: минимум две полные зимы (медиана дек–фев) с летом рядом (медиана июн–авг),
  // оба уровня ≥30 кВт·ч/мес, и в каждой из них отношение зима/лето отличается от группового в 1,8+ раза.
  // Одиночный всплеск или «начисления по 97» сезонностью не считаются.
  const yearRatios=(lo,hi)=>{
    const Wy=new Map(), Sy=new Map();
    for(let i=lo;i<hi;i++){ if(v[i]==null) continue; const ym=months[i];
      if(WM.includes(ym.m)){ const y=ym.m===11?ym.y+1:ym.y; if(!Wy.has(y)) Wy.set(y,[]); Wy.get(y).push(v[i]); }
      else if(SM.includes(ym.m)){ if(!Sy.has(ym.y)) Sy.set(ym.y,[]); Sy.get(ym.y).push(v[i]); } }
    const out=[];
    for(const [y,w] of Wy){
      if(w.length<3) continue;
      const ss=[Sy.get(y-1),Sy.get(y)].filter(x=>x && x.length>=2).map(x=>median(x));
      if(!ss.length) continue;
      const wl=median(w), sl=mean(ss);
      if(wl>=30 && sl>=30) out.push(wl/sl);
    }
    return out;
  };
  // характер ПУ — по всему ряду: хотя бы две зимы с сильной своей сезонностью (у перешедших на газ
  // после перехода сезонности уже нет, поэтому «большинство лет» не требуется)
  const allYr=yearRatios(from,n);
  const ownKind = allYr.filter(x=>x>=1.8*grpWS).length>=2 ? 'winter' : allYr.filter(x=>x<=grpWS/1.8).length>=2 ? 'summer' : null;
  const seasonalOf=t=>{
    const ref=ownMonthProfile(v,months,from,t), cover=ref.filter(x=>x!=null).length;
    const wB=seasonMeanOf(ref,WM), sB=seasonMeanOf(ref,SM), ws=(wB!=null && sB!=null && sB>0) ? wB/sB : null;
    return {ref, cover, wB, sB, ws, own: !!ownKind && cover>=10 && kc[t]>=9 && ws!=null};
  };
  let SE=seasonalOf(bestR.t), yearRatio=null;
  if(SE.own){
    // годовое падение: сумма (расход − тот же месяц годом раньше) по 12 месяцам от точки t
    let bt=null, bs=0;
    for(let t=from+12;t<=n-3;t++){
      if(kc[t]<9) continue;
      let s=0, c=0;
      for(let i=t;i<Math.min(n,t+12);i++){ const j=byMonth.get(months[i].y*12+months[i].m-12); if(j==null||v[i]==null||v[j]==null) continue; s+=v[i]-v[j]; c++; }
      if(c>=3 && (bt==null || s<bs)){ bs=s; bt=t; }
    }
    if(bt!=null){
      let t=bt; // начало окна — первый месяц, который действительно ниже того же месяца годом раньше
      for(let k=0;k<11 && t<n-3;k++){ const j=byMonth.get(months[t].y*12+months[t].m-12); if(v[t]==null || (j!=null && v[j]!=null && v[t]>=0.8*v[j])) t++; else break; }
      const S1=seasonalOf(t);
      if(S1.own && pre[t]!=null && suf[t]!=null){
        // годовой расход после перелома к тому же по профилю «до», по годовым блокам: каждый ≤ 80%
        const blocks=[]; let sumA=0, sumB=0;
        for(let b0=t;b0<n;b0+=12){ let ba=0, bb=0, c=0; for(let i=b0;i<Math.min(n,b0+12);i++){ const p=S1.ref[months[i].m]; if(v[i]==null||p==null) continue; ba+=v[i]; bb+=p; c++; } if(c>=4 && bb>0){ blocks.push(ba/bb); sumA+=ba; sumB+=bb; } }
        const yr=sumB>0 ? sumA/sumB : null;
        if(yr!=null && yr<=T.rMax && blocks.every(x=>x<=0.8)){
          let after=0; for(let i=t;i<n;i++) if(a[i]!=null) after++;
          bestR={...bestR, t, mb:pre[t], ma:suf[t], ratio:yr, after};
          SE=S1; yearRatio=yr;
        }
      }
    }
    // у ПУ со своей сезонностью «ступень» по профилю группы ненадёжна (лето после отопительной зимы
    // выглядит падением): без подтверждения по одноимённым месяцам признак не срабатывает
    if(yearRatio==null) return null;
  }
  const r=bestR.ratio;
  let pts = r<=0.25?44 : r<=0.35?38 : r<=0.5?30 : r<=0.65?22 : 12;
  if(r<=0.5 && bestR.after>=18) pts+=6;            // глубокая ступень держится 1,5+ года
  if(r>0.65){                                       // неглубокая: вес растёт с выдержкой
    if(bestR.after>=24) pts+=4;
    if(bestR.after>=48) pts+=4;
  }
  // Общий для группы спад уже вычтен сезонной очисткой. Без неё (группа < 6 ПУ) — прежняя поправка.
  let grpNote='';
  if(!sf){
    const gr = (gCnt>=6) ? groupStepRatio(gMed, bestR.t) : null;
    if(gr!=null && gr<=0.8){
      pts=Math.max(6, Math.round(pts*0.6));
      grpNote=` Но группа вокруг той же даты тоже просела до ${fmt(gr*100)}% — часть падения может быть общей (сезонность, экономика), балл снижен.`;
    }
  }
  // ожидаемый расход без недоучёта = прежний уровень × сезонный профиль месяца
  let expected = months.map((_,i)=>bestR.mb*(sf?sf[i]:1));
  let lastBefore=bestR.t-1; while(lastBefore>from && a[lastBefore]==null) lastBefore--;
  let seasonTxt='', season=null;
  if(SE.own){
    const ref=SE.ref;
    expected = months.map((ym,i)=>ref[ym.m]!=null ? ref[ym.m] : bestR.mb*(sf?sf[i]:1));
    const refA=ownMonthProfile(v,months,bestR.t,n), wA=seasonMeanOf(refA,WM), sA=seasonMeanOf(refA,SM);
    const pct=(x,y)=>(x!=null && y!=null && y>0) ? ' ('+(x>=y?'+':'−')+fmt(Math.abs(x/y-1)*100)+'%)' : '';
    const kind = ownKind || (SE.ws>=1 ? 'winter' : 'summer');
    const peaks=seasonPeaks(v,months,from,kind);
    season={ownWS:SE.ws, grpWS, wB:SE.wB, sB:SE.sB, wA, sA, kind, yearRatio, peaks:peaks.map(p=>({i:p.i,v:p.v}))};
    seasonTxt=` У этого ПУ своя сезонность сильнее, чем у группы (зима/лето ~${fmt(SE.ws,1)}:1 против ~${fmt(grpWS,1)}:1), поэтому сезоны сравниваются отдельно: до перелома зима ~${fmt(SE.wB)}, лето ~${fmt(SE.sB)} кВт·ч/мес; после — зима ${wA!=null?'~'+fmt(wA)+pct(wA,SE.wB):'ещё не наблюдалась'}, лето ${sA!=null?'~'+fmt(sA)+pct(sA,SE.sB):'ещё не наблюдалось'}.`+
      (yearRatio!=null ? ` Перелом найден по наибольшему годовому падению к тем же месяцам годом раньше; годовой расход после него — ${fmt(yearRatio*100)}% прежнего.` : '')+
      (peaks.length>=2 ? ` Пики ${kind==='winter'?'отопительных сезонов':'летних сезонов'}: `+peaks.map((p,k)=>fmt(p.v)+' ('+ymLabel(months[p.i])+(k?', '+(p.v>=peaks[k-1].v?'+':'−')+fmt(Math.abs(p.v/peaks[k-1].v-1)*100)+'%':'')+')').join(' → ')+'.' : '')+
      ' Ожидаемый расход после перелома — тот же месяц до него.';
  }
  let loss=0;
  for(let i=bestR.t;i<n;i++) if(v[i]!=null) loss+=Math.max(0,expected[i]-v[i]);
  loss=Math.round(loss);
  let observedStart=bestR.t; while(observedStart<n-1&&v[observedStart]==null) observedStart++;
  const lvlTxt = yearRatio!=null
    ? `годовой расход (по одноимённым месяцам) снизился до ${fmt(yearRatio*100)}% прежнего (−${fmt((1-r)*100)}%; известных месяцев после границы: ${bestR.after})`
    : `${sf?'расход, приведённый к сезонному профилю группы,':'медианный расход'} снизился с ~${fmt(bestR.mb)} до ~${fmt(bestR.ma)} кВт·ч/мес (−${fmt((1-r)*100)}%; известных месяцев после границы: ${bestR.after})`;
  return {pts, loss, shiftIdx:observedStart, base:bestR.mb, expected, season, beforeFrom:from,
    change:{kind:'down', t:observedStart, delta:bestR.mb-bestR.ma},
    detail:`В части ряда с ${ymLabel(months[observedStart])} ${lvlTxt}. Уровень «до» — по всем известным месяцам с ${ymLabel(months[from])} по ${ymLabel(months[lastBefore])} (${kc[bestR.t]} мес.), «после» — с ${ymLabel(months[observedStart])} до конца ряда.${seasonTxt} Внутри периода возможны отдельные восстановления и всплески. Это кандидат для проверки учёта или изменения режима работы, не установленная дата начала БУ. Оценка недоучёта ≈ ${fmt(loss)} кВт·ч.${grpNote}`};
}

// S3b. Провал с восстановлением: «яма» посреди ряда — воровали до проверки/доначисления
function algValley(v, months, gMed, gCnt){
  const T=TUNE.valley;
  const n=v.length;
  // v5.0: сезонная очистка по группе + бегущие медианы (было O(n³) на прибор)
  const sf=groupSeasonalFactors(gMed, gCnt);
  const a=sf ? v.map((x,i)=>x==null?null:x/sf[i]) : v;
  const {pre,suf}=runningMedians(a);
  const cnt=[0]; for(let i=0;i<n;i++) cnt.push(cnt[i]+(a[i]!=null?1:0));
  const byMonth=new Map(months.map((m,i)=>[m.y*12+m.m,i]));
  // собственная сезонность: те же месяцы в другие годы (v5.3: и до, и после провала) не должны быть
  // такими же низкими — иначе это лето у дома с электроотоплением, а не провал
  const seasonalDip=(i,j,side,ratio)=>{
    // помесячно: каждый месяц «провала» против тех же месяцев других лет; длинное окно смешивает
    // зимы и лето, поэтому сравнивать надо одноимённые месяцы, а не общие медианы
    const rel=[];
    for(let k=i;k<j;k++){
      if(a[k]==null) continue;
      const other=[];
      for(const dy of [-24,-12,12,24]){ const p=byMonth.get(months[k].y*12+months[k].m+dy); if(p!=null && (p<i || p>=j) && a[p]!=null) other.push(a[p]); }
      if(other.length){ const o=median(other); if(o>0) rel.push(a[k]/o); }
    }
    if(rel.length < Math.ceil((j-i)/2)) return false;
    return median(rel) >= Math.max(0.6, ratio+0.2); // в те же месяцы других лет — так же: свой сезон, не провал
  };
  let bestV=null;
  for(let i=3;i<n-6;i++){
    const mL=pre[i];
    if(mL==null||mL<100) continue;
    for(let j=i+4;j<=Math.min(n-3,i+24);j++){
      if(cnt[j]-cnt[i]<4) continue;
      const mR=suf[j];
      if(mR==null||mR<100) continue;
      const mi=median(a.slice(i,j)), side=Math.min(mL,mR);
      if(mi==null) continue;
      const ratio=mi/side;
      if(!(ratio<=T.rMax)) continue;
      if(bestV && !(ratio<bestV.ratio || (ratio===bestV.ratio && (j-i)>(bestV.j-bestV.i)))) continue;
      if(seasonalDip(i,j,side,ratio)) continue;
      bestV={i,j,mi,mL,side,ratio};
    }
  }
  if(!bestV) return null;
  const len=bestV.j-bestV.i;
  const pts=Math.min(34, Math.round(16 + (1-bestV.ratio)*18 + (len>=12?4:0)));
  const expected=months.map((_,k)=>bestV.mL*(sf?sf[k]:1));
  let loss=0;
  for(let k=bestV.i;k<bestV.j;k++) if(v[k]!=null) loss+=Math.max(0,expected[k]-v[k]);
  loss=Math.round(loss);
  return {pts, loss, shiftIdx:bestV.i, endIdx:bestV.j, base:bestV.mL, expected,
    change:{kind:'valley', t:bestV.i, t1:bestV.j, delta:bestV.mL-bestV.mi},
    detail:`Провал ${ymLabel(months[bestV.i])} — ${ymLabel(months[bestV.j-1])} (${len} мес.): ~${fmt(bestV.mi)} кВт·ч/мес при ~${fmt(bestV.side)} по обе стороны (−${fmt((1-bestV.ratio)*100)}%${sf?', с поправкой на сезон группы':''}), затем уровень восстановился. Типичная картина «вмешательство → контрольная проверка/доначисление». Недоучёт за провал ≈ ${fmt(loss)} кВт·ч (от уровня до провала).`};
}

// S4. Затухание: последние месяцы — доли собственной базы
function algFade(v, months, gMed, gCnt){
  const T=TUNE.fade;
  const n=v.length;
  if(n<8) return null;
  const sf=groupSeasonalFactors(gMed, gCnt);
  const a=sf ? v.map((x,i)=>x==null?null:x/sf[i]) : v;
  const early=median(a.slice(0,n-4)), late=median(a.slice(-4));
  if(early==null||late==null||early<40) return null;
  const r=late/early;
  if(r>T.rMax) return null;
  // v5.0: если те же месяцы год назад были примерно такими же — это собственный сезон, не затухание
  const byMonth=new Map(months.map((m,i)=>[m.y*12+m.m,i])), yoy=[];
  for(let i=n-4;i<n;i++){ const j=byMonth.get(months[i].y*12+months[i].m-12); if(j!=null && v[i]!=null && v[j]!=null && v[j]>0) yoy.push(v[i]/v[j]); }
  if(yoy.length>=2 && median(yoy)>0.6) return null;
  const pts = r<=0.15?14:8;
  return {pts, detail:`Последние месяцы ~${fmt(late)} кВт·ч при собственной базе ~${fmt(early)} (${fmt(r*100)}%${sf?', с поправкой на сезон группы':''})${yoy.length>=2?'; к тем же месяцам прошлого года — '+fmt(median(yoy)*100)+'%':''}. Потребление «затухает» без явной сезонной причины.`};
}

// S5. Нули при живой группе
function algZeroAlive(v, months, gMed, gs, winterBonus=true){
  const T=TUNE.zeroAlive;
  const zi=[];
  v.forEach((x,i)=>{ if(x!=null && x<=EPS && gMed[i]!=null && gMed[i]>=25 && !groupMassLow(gs,i)) zi.push(i); });
  if(zi.length<T.minZeros) return null;
  const actualWz=zi.filter(i=>isWinter(months[i])).length;
  const wz=winterBonus?actualWz:0;
  return {monthIdx:zi,pts:Math.min(14, Math.round(4+2*zi.length+2*wz)),
    detail:`${zi.length} нулевых мес. (зимой — ${actualWz}${winterBonus?'':'; без сезонной надбавки'}) при живом потреблении соседей по группе. Нулевой расход требует сверки с проживанием, отключениями и достоверностью съёма.`};
}

// S6. Замороженные/неправдоподобно плоские показания
function algFrozen(v){
  const T=TUNE.frozen;
  let run=1,bestRun=1,val=null;
  for(let i=1;i<v.length;i++){
    if(v[i]!=null && v[i]===v[i-1] && v[i]>EPS){ run++; if(run>bestRun){bestRun=run; val=v[i];} }
    else run=1;
  }
  const pos=v.filter(x=>x!=null&&x>EPS);
  // v5.0: если показания передаются с округлением до 50, повторы одного числа летом — следствие
  // округления, а не «стоящего» счётчика. Такой ряд отмечает S7, а не S6.
  const rounded = pos.length>=8 && pos.filter(x=>x%50===0).length/pos.length>=0.6;
  // v5.0: вес растёт с длиной серии (год одинаковых показаний — уже повод для выезда), максимум 24
  if(!rounded && bestRun>=T.minRun) return {frozenKind:'exact',pts:Math.min(24,3*bestRun), detail:`«Замороженное» показание: ${bestRun} мес. подряд ровно ${fmt(val)} кВт·ч. Либо счётчик стоит, либо переписывают одну цифру (начисление по среднему).`};
  const m=mean(pos), sd=stdev(pos);
  if(m!=null&&sd!=null&&pos.length>=8&&m>=30&&sd/m<=T.maxCV/100)
    return {frozenKind:'flat',pts:11, detail:`Разброс аномально мал (CV=${fmt(sd/m*100,1)}%). Малый разброс требует сверки с режимом работы; у постоянной технологии он может быть нормальным.`};
  return null;
}

// S7. Круглые числа
function algRound(v){
  const T=TUNE.round;
  const pos=v.filter(x=>x!=null&&x>EPS);
  if(pos.length<8) return null;
  const r=pos.filter(x=>x%50===0).length/pos.length;
  if(r<T.minShare) return null;
  return {pts:6, weak:true, detail:`${fmt(r*100)}% значений кратны 50 — возможны округление, расчётные передачи или особенности нагрузки. Сначала сверить источник данных.`};
}

// S8. Ниже соседей по группе (слабый)
function algBelowPeers(v, gs){
  const T=TUNE.peers;
  if(gs.cnt<8||gs.groupMedian==null||gs.groupMedian<60) return null;
  const m=mean(v);
  if(m==null||m>=gs.groupMedian*T.maxFrac||(gs.p10!=null&&m>=gs.p10)) return null;
  return {pts:8, weak:true, detail:`Средний расход ${fmt(m)} кВт·ч/мес — ниже 30% медианы группы (${fmt(gs.groupMedian)}). Само по себе — слабый признак (может быть малый/пустующий объект), но в связке с другими усиливает подозрение.`};
}

// S9. Против сезона (относительно группы)
function algSeason(v, months, gWS){
  if(gWS==null||gWS<1.05) return null;
  const w=[],s=[];
  months.forEach((ym,i)=>{ if(v[i]!=null){ if(isWinter(ym))w.push(v[i]); if(isSummer(ym))s.push(v[i]); }});
  if(w.length<2||s.length<2) return null;
  const ms=median(s);
  if(ms==null||ms<40) return null;
  const own=median(w)/ms;
  if(own>TUNE.season.maxOwn*gWS) return null;
  return {pts:10, detail:`Зима/лето здесь ${fmt(own,2)} против ${fmt(gWS,2)} по группе: у соседей зимой расход растёт, тут — проваливается. Типично для сезонного «прикручивания» учёта.`};
}

// S10. Мощность простаивает (слабый): подключение есть, расхода почти нет
function algIdlePower(v, power){
  const T=TUNE.idle;
  if(power==null||power<10) return null;
  const m=mean(v);
  if(m==null) return null;
  if(m<=T.maxAvg){
    const nz=v.filter(x=>x!=null&&x>EPS).length;
    return {pts:7, weak:true, detail:`Разрешённая мощность ${fmt(power)} кВт, а фактический расход ~${fmt(m,1)} кВт·ч/мес (${nz} активных мес.). Проверить, не запитан ли объект мимо ПУ и жив ли договор.`};
  }
  if(power>=30){
    const cap=power*730; // теоретический потолок за месяц при полной загрузке
    const thr = (power>=200?0.05 : power>=100?0.03 : 0.015) * (T.maxAvg/15);
    if(m<cap*thr) return {pts:8, weak:true, detail:`Разрешённая мощность ${fmt(power)} кВт — это до ~${fmt(cap)} кВт·ч/мес, а через ПУ проходит ~${fmt(m)} (${fmt(m/cap*100,1)}% мощности). Для объекта, бравшего такую мощность, это мало: либо мощность «бумажная», либо часть нагрузки запитана мимо учёта.`};
  }
  return null;
}

// S11. Синхронность с небалансом ТП.
// v5.0: (1) учитывается только СВЕРХНОРМАТИВНЫЙ небаланс — если потери в норме, подтверждать нечем;
// (2) сезонность убрана сравнением с теми же месяцами прошлого года: раньше любой ПУ с летним
// пиком (кафе, базы отдыха) «совпадал» с зимним ростом техпотерь.
function algImbalance(v, imb, months, sup, norm){
  if(!imb || !sup) return null;
  const n=v.length;
  const ex=imb.map((x,i)=>(x!=null && sup[i]!=null) ? x-norm*sup[i] : null);
  const exKnown=ex.filter(x=>x!=null);
  if(exKnown.length<6) return null;
  const supSum=sup.reduce((s,x)=>s+(x||0),0);
  if(exKnown.reduce((s,x)=>s+Math.max(0,x),0) < 0.01*supSum) return null;
  const base=median(v.filter(x=>x!=null&&x>EPS));
  if(base==null||base<30) return null;
  const byMonth=new Map(months.map((m,i)=>[m.y*12+m.m,i]));
  const dv=[], de=[];
  for(let i=0;i<n;i++){
    const j=byMonth.get(months[i].y*12+months[i].m-12);
    dv.push(j!=null && v[i]!=null && v[j]!=null ? v[j]-v[i] : null);   // насколько ПУ потребил меньше, чем год назад
    de.push(j!=null && ex[i]!=null && ex[j]!=null ? ex[i]-ex[j] : null); // насколько вырос сверхнормативный небаланс
  }
  const pairs=dv.filter((x,i)=>x!=null&&de[i]!=null).length;
  let r, how;
  if(pairs>=8){
    r=pearson(dv,de); how='к тем же месяцам прошлого года';
    if(dv.reduce((s,x)=>s+Math.max(0,x||0),0) < base*2) return null;
  } else {
    // короткий ряд: по уровням, но строже
    const early=median(v.slice(0,Math.max(3,Math.floor(n/2))));
    if(early==null||early<30) return null;
    const deficit=v.map(x=>x==null?null:Math.max(0,early-x));
    if(deficit.reduce((s,x)=>s+(x||0),0) < early*2) return null;
    r=pearson(deficit,ex); how='по уровням (ряд короче двух лет)';
    if(r<TUNE.imb.minCorr+0.1) return null;
  }
  if(r<TUNE.imb.minCorr) return null;
  return {pts:12, detail:`Изменения этого ПУ синхронны с изменениями СВЕРХНОРМАТИВНОГО небаланса ввода ТП (корреляция ${fmt(r,2)}, ${how}). Недоучтённая энергия «всплывает» в потерях подстанции — сильный подтверждающий признак.`};
}

// S12. Разовый всплеск среди «мёртвого» ряда — похоже на доначисление/акт
function algLoneSpike(v){
  const known=v.filter(x=>x!=null);
  if(known.length<10) return null;
  const zeros=known.filter(x=>x<=EPS).length;
  if(zeros/known.length<0.6) return null;
  const pos=known.filter(x=>x>EPS);
  const big=pos.filter(x=>x>=400), small=pos.filter(x=>x<400);
  if(big.length<1||big.length>2||small.length>6) return null;
  const s=big.reduce((a,b)=>a+b,0);
  if(s<TUNE.lone.minSum) return null;
  return {pts:12, weak:true, detail:`Ряд почти полностью нулевой, но есть разовый объём ${fmt(s)} кВт·ч. Похоже на доначисление по акту или съём накопленного при проверке — до и после объект для учёта «не существует». Поднять историю: что это был за объём и почему после него снова тишина.`};
}

// S13. Ступенчатый рост с низкой базы: долго «по чуть-чуть», потом резко в разы больше.
// Зеркало S3: недоучёт был В НАЧАЛЕ ряда — до замены ПУ / проверки / пресечения.
function algStepUp(v, months){
  const n=v.length;
  const {pre:preM,suf:sufM}=runningMedians(v);
  const cnt=[0]; for(let i=0;i<n;i++) cnt.push(cnt[i]+(v[i]!=null?1:0));
  let best=null;
  for(let t=6; t<=n-6; t++){
    const preN=cnt[t], postN=cnt[n]-cnt[t];
    if(preN<5||postN<5) continue;
    const mp=preM[t], mq=sufM[t];
    if(mp==null||mq==null||mp<20||mq<200) continue; // нули с начала — это S1, не сюда
    const jump=mq/mp;
    if(jump<TUNE.stepup.minJump) continue;
    const pre=v.slice(0,t).filter(x=>x!=null), post=v.slice(t).filter(x=>x!=null);
    if(post.filter(x=>x>mp*1.5).length/post.length < 0.8) continue;  // новый уровень устойчив
    if(pre.filter(x=>x<mq*0.6).length/pre.length < 0.8) continue;    // старый был стабильно низким
    let cost=0;
    for(let i=0;i<n;i++){ const x=v[i]; if(x!=null) cost+=Math.abs(x-(i<t?mp:mq)); }
    if(!best || cost<best.cost) best={t,mp,mq,jump,preCnt:pre.length,cost};
  }
  if(!best) return null;
  // резкость перехода: медиана 4 мес. после точки против 4 мес. до неё
  const w1=v.slice(Math.max(0,best.t-4),best.t).filter(x=>x!=null);
  const w2=v.slice(best.t,best.t+4).filter(x=>x!=null);
  const sharp=(w1.length>=2&&w2.length>=2&&median(w1)>0)?median(w2)/median(w1):null;
  const isSharp = sharp!=null && sharp>=2;
  let pts, weak=false;
  if(isSharp) pts = best.jump>=8?28 : best.jump>=5?24 : best.jump>=3.5?18 : 14;
  else if(best.jump>=8) pts=24;      // рост на порядок даже «плавно» — слишком много для роста бизнеса
  else if(best.jump>=4) pts=20;
  else { pts=12; weak=true; }        // плавный умеренный рост — бизнес мог просто вырасти
  const loss=Math.round((best.mq-best.mp)*best.preCnt);
  return {pts, weak, loss, shiftIdx:best.t, base:best.mq,
    change:{kind:'up', t:best.t, delta:best.mq-best.mp},
    detail:`До ${ymLabel(months[best.t])} через ПУ шло ~${fmt(best.mp)} кВт·ч/мес, после — устойчивые ~${fmt(best.mq)} (рост в ${fmt(best.jump,1)} раза${isSharp?', скачком':', плавно'}). Объект, который «вдруг» стал потреблять в разы больше, чаще всего потреблял столько и раньше — мимо учёта. Сверить дату скачка с заменой ПУ/проверкой. Оценка недоучёта за период до скачка ≈ ${fmt(loss)} кВт·ч.`};
}

// S14. Многолетнее угасание: год за годом вниз без резкой ступени.
// Ловит «аккуратное» хищение, растянутое по времени, — на длинных рядах (2,5+ года).
function algSlowDecline(v, months, gMed, gCnt, stepPts){
  const n=v.length;
  if(n<30 || stepPts>=30) return null; // короткий ряд / резкую ступень уже взял S3
  const yearsOf = series => {
    const ys=[];
    for(let y0=0; y0+6<=series.length; y0+=12){
      const seg=series.slice(y0,Math.min(series.length,y0+12)).filter(x=>x!=null);
      ys.push(seg.length>=6?median(seg):null);
    }
    return ys;
  };
  const years=yearsOf(v);
  const idx=[]; years.forEach((x,i)=>{ if(x!=null) idx.push(i); });
  if(idx.length<4) return null;
  const yv=idx.map(i=>years[i]);
  let peakI=0; yv.forEach((x,i)=>{ if(x>yv[peakI]) peakI=i; });
  const peak=yv[peakI], last=yv[yv.length-1];
  if(peak<100 || peakI>=yv.length-2) return null; // падение должно быть видно ≥2 лет
  const r=last/peak;
  if(r>TUNE.slow.rMax) return null;
  let down=0, steps=0;
  for(let i=peakI;i<yv.length-1;i++){ steps++; if(yv[i+1]<=yv[i]*1.1) down++; }
  if(steps<2 || down/steps<0.7) return null;
  let pts = r<=0.3?28 : r<=0.5?22 : 16;
  let grpNote='';
  if(gCnt>=6 && gMed){
    const gy=yearsOf(gMed).filter(x=>x!=null);
    if(gy.length>=3){
      const gr=gy[gy.length-1]/Math.max(...gy);
      if(gr<=0.75){
        pts=Math.max(6, Math.round(pts*0.6));
        grpNote=` Но группа за эти годы тоже просела до ${fmt(gr*100)}% — часть спада может быть общей, балл снижен.`;
      }
    }
  }
  const loss=Math.round((peak-last)*12);
  return {pts, loss, base:peak,
    detail:`Годовые уровни ползут вниз: с ~${fmt(peak)} кВт·ч/мес в пиковый год до ~${fmt(last)} в последний (−${fmt((1-r)*100)}%), без резкой ступени. Так выглядит «аккуратное» хищение, наращиваемое постепенно, — или медленное сворачивание деятельности (сверить с состоянием объекта). Только за последний год недоучёт ≈ ${fmt(loss)} кВт·ч от пикового уровня.${grpNote}`};
}

/* ================= СУТОЧНЫЕ ПРИЗНАКИ (D1–D3) =================
   Работают на суточном ряду АСКУЭ, когда месячных сумм для S1–S14 мало
   (короткая выгрузка) — и как дополнение на длинных суточных рядах.
   Оценка недоучёта — недостача до собственной суточной базы в «подозрительные» дни. */
const EPS_D = 0.3; // кВт·ч/сут: ниже — «выключенный» объект (даже холодильник даёт ~1 кВт·ч/сут)

// D1. Нулевые сутки при живой группе — объект «выключается» на день, пока соседи потребляют
function algDayZero(dv, gMedD){
  const T=TUNE.dzero;
  const known=dv.filter(x=>x!=null);
  const act=known.filter(x=>x>EPS_D);
  if(act.length<7) return null;
  const dBase=median(act);
  if(dBase<1) return null;
  const zi=[];
  dv.forEach((x,i)=>{ if(x!=null && x<=EPS_D && gMedD && gMedD[i]!=null && gMedD[i]>=1) zi.push(i); });
  if(zi.length<T.minDays) return null;
  const zerosAll=known.filter(x=>x<=EPS_D).length;
  if(zerosAll/known.length>0.6) return null; // объект по большей части пуст (дача выходного дня) — не признак
  const pts=Math.min(16, 4+2*zi.length);
  const loss=Math.round(dBase*zi.length);
  return {pts, loss, dBase, dayIdx:zi,
    detail:`${zi.length} суток с нулём при живом потреблении соседей; собственная база ~${fmt(dBase,1)} кВт·ч/сут. Объект, который «выключается» на сутки, пока соседи потребляют, — либо обвод/отключение учёта, либо реальные отъезды: сверить с журналом событий ПУ. Недоучёт ≈ ${fmt(loss)} кВт·ч.`};
}

// D2. Затяжной суточный провал — серия дней ниже 30% собственной суточной базы после активного периода
function algDayDip(dv, excl){
  const T=TUNE.ddip;
  const skip = excl && excl.length ? new Set(excl) : null; // дни, уже засчитанные D1, — как «нет данных»
  const act=dv.filter(x=>x!=null&&x>EPS_D);
  if(act.length<10) return null;
  const dBase=median(act);
  if(dBase<2) return null;
  // серии подряд идущих дней ниже 30% базы; 1–2 дня без данных внутри серии её не рвут, 3 и больше — рвут
  const runs=[]; let cur=[], gap=0;
  const close=()=>{ if(cur.length>=T.minRun) runs.push(cur); cur=[]; gap=0; };
  for(let i=0;i<dv.length;i++){
    const x=(skip && skip.has(i)) ? null : dv[i];
    if(x==null){ if(cur.length && ++gap>=3) close(); continue; }
    gap=0;
    if(x<dBase*0.3) cur.push(i); else close();
  }
  close();
  // самая длинная серия из тех, перед которыми было ≥5 активных дней (провал с самого начала ряда сравнивать не с чем);
  // при равной длине — более поздняя
  let best=null, before=0;
  for(const r of runs){ const b=dv.slice(0,r[0]).filter(x=>x!=null&&x>EPS_D).length; if(b<5) continue; if(!best || r.length>=best.length){ best=r; before=b; } }
  if(!best) return null;
  const dayIdx=best.slice();
  let loss=0; for(const i of dayIdx) loss+=Math.max(0,dBase-dv[i]);
  loss=Math.round(loss);
  const pts=Math.min(28, 10+Math.round(dayIdx.length*1.2));
  return {pts, loss, dBase, dayIdx, shiftDay:dayIdx[0],
    detail:`Провал ${dayIdx.length} сут. ниже 30% собственной суточной базы (~${fmt(dBase,1)} кВт·ч/сут) после ${before} активных дней (дни без данных не в счёт). На суточном масштабе так выглядит вмешательство или отключение учёта — сверить с журналом событий ПУ и статусом объекта. Недоучёт за провал ≈ ${fmt(loss)} кВт·ч.`};
}

// D3. Синхронность с суточным небалансом ТП.
// v5.0: сравнение по НЕДЕЛЬНЫМ суммам (убирает ритм «будни/выходные», из-за которого раньше
// совпадало любое юрлицо с пониженным потреблением в выходные) и только со сверхнормативным небалансом.
function algDaySync(dv, imbD, supD, days, norm){
  if(!imbD || !supD || !days) return null;
  const T=TUNE.dsync;
  const act=dv.filter(x=>x!=null&&x>EPS_D);
  if(act.length<10) return null;
  const dBase=median(act);
  if(dBase<1) return null;
  const weeks=new Map();
  days.forEach((d,i)=>{
    const dn=dayNum(d), wk=Math.floor((dn+3)/7); // неделя пн–вс
    if(!weeks.has(wk)) weeks.set(wk,{n:0,ok:0,def:0,ex:0,sup:0});
    const w=weeks.get(wk); w.n++;
    if(dv[i]==null||imbD[i]==null||supD[i]==null) return;
    w.ok++; w.def+=Math.max(0,dBase-dv[i]); w.ex+=imbD[i]-norm*supD[i]; w.sup+=supD[i];
  });
  const full=[...weeks.values()].filter(w=>w.n===7&&w.ok===7);
  if(full.length<6) return null;
  const supSum=full.reduce((s,w)=>s+w.sup,0);
  if(full.reduce((s,w)=>s+Math.max(0,w.ex),0) < 0.01*supSum) return null; // небаланс в норме — подтверждать нечем
  const r=pearson(full.map(w=>w.def), full.map(w=>w.ex));
  const dSum=full.reduce((s,w)=>s+w.def,0);
  if(r<T.minCorr || dSum<dBase*3) return null;
  return {pts:12, dBase,
    detail:`Недостача этого ПУ по неделям совпадает с ростом сверхнормативного небаланса ТП (корреляция ${fmt(r,2)} по ${full.length} полным неделям; недельный ритм «будни/выходные» исключён). Недоучтённая энергия «всплывает» в потерях подстанции в те же недели — сильный подтверждающий признак; объём недоучёта оценивают D1/D2 и месячные признаки.`};
}

/* ================= v4.6: признаки формы ряда и качество данных =================
   Метка проверки хранится в meter.reviewLabel, но не участвует в признаках,
   группах, весах, ранжировании или оценке объёма. Номер ПУ — только идентификатор.
   Период аномалии НЕ является установленным периодом нарушения. */
function reviewLabelOf(value){
  const s=String(value==null?'':value).trim().toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ');
  if(/^(не вор|чистый|не подтверждено|нарушение не подтверждено|без нарушений)$/.test(s)) return 'negative';
  if(/^(вор|подтверждено|подтвержденное нарушение|бу|акт бу)$/.test(s)) return 'positive';
  return null;
}
function meterHistory(m){
  const raw=m.values, first=raw.findIndex(x=>x!=null&&x>EPS);
  const start=first<0?raw.length:first;
  // Нули до первой активности неоднозначны: новый ПУ, пустой архив или отключённый объект.
  // Исходный график и суммы сохраняем; в динамических признаках этот префикс не используем.
  return {start, values:raw.map((x,i)=>i<start?null:x), leadingZeros:raw.slice(0,start).filter(x=>x!=null&&x<=EPS).length};
}
/* v5.3: «спящее» начало ряда — месяцы до реального начала потребления (дом ещё не жилой, ПУ только
   поставлен): все значения не выше 1/8 типичного уровня следующих 12 известных месяцев (он ≥60 кВт·ч).
   Для признаков, сравнивающих уровни (S3, S3б, S4, S5, S8, S9), такие месяцы — не «база»: иначе прежний
   уровень занижается и ступень мельчает. S1/S13 (начало активности, рост с низкой базы) видят ряд целиком. */
function dormantPrefix(v){
  const n=v.length; let best=0, mx=-Infinity, cnt=0;
  for(let k=1;k<=Math.min(n-6,36);k++){
    const x=v[k-1]; if(x!=null){ mx=Math.max(mx,x); cnt++; }
    if(k<3 || !cnt) continue;
    const nxt=[]; for(let i=k;i<n&&nxt.length<12;i++) if(v[i]!=null) nxt.push(v[i]);
    if(nxt.length<6) continue;
    const med=median(nxt);
    if(med>=60 && mx<=med/8) best=k;
  }
  return best;
}
/* v5.3: собственный помесячный профиль ПУ на отрезке [from; to) — медиана одноимённых месяцев,
   и пики сезонов (максимум каждого отопительного сезона ноя–мар или каждого лета июн–авг). */
function ownMonthProfile(v, months, from, to){
  const b=Array.from({length:12},()=>[]);
  for(let i=Math.max(0,from);i<Math.min(v.length,to);i++) if(v[i]!=null) b[months[i].m].push(v[i]);
  return b.map(a=>a.length?median(a):null);
}
function seasonMeanOf(prof, ms){ const a=ms.map(m=>prof[m]).filter(x=>x!=null); return a.length?median(a):null; } // медиана: один необычный месяц не сдвигает уровень сезона
function seasonPeaks(v, months, from, kind){
  const inSeason = kind==='summer' ? (ym=>ym.m>=5&&ym.m<=7) : (ym=>ym.m>=10||ym.m<=2);
  const keyOf = kind==='summer' ? (ym=>ym.y) : (ym=>ym.m>=10?ym.y+1:ym.y);
  const by=new Map();
  for(let i=Math.max(0,from);i<v.length;i++){
    const ym=months[i]; if(v[i]==null||!inSeason(ym)) continue;
    const k=keyOf(ym), c=by.get(k)||{k,i,v:-Infinity,n:0};
    c.n++; if(v[i]>c.v){ c.v=v[i]; c.i=i; } by.set(k,c);
  }
  return [...by.values()].filter(p=>p.n>=2).sort((a,b)=>a.i-b.i);
}
/* v5.5: пики сезонов — для графика, карточки и признака S18 (у всех ПУ, а не только при S3 со своей сезонностью).
   Зима — отопительный сезон ноя–мар (подпись «2024/25»), лето — июн–авг. Пик — максимум известных месяцев сезона
   (нужно ≥2 известных месяца и пик выше нуля). Изменение — к прошлому пику того же сезона, «как с тем же»: только по
   календарным месяцам, известным в обоих сезонах (если выгрузка начинается или кончается посреди сезона, неполный
   сезон сравнивается с теми же месяцами прошлого, а не с его январём). Группа — пик медианы группы в тех же месяцах.
   Сравнение несопоставимо, если один из пиков — разовый всплеск (≥2,5× соседних месяцев и остальных месяцев сезона:
   похоже на досчёт накопленного), в одном из сезонов было сторно (корректировка начислений) или между сезонами
   больше двух лет. Снижение (decline) — сопоставимое сравнение, прошлый пик ≥ minPeak, пик ≤ maxRatio прошлого
   и с поправкой на группу тоже, уровень сезона (медиана тех же месяцев) ≤ 90%, общих месяцев — не меньше трёх. */
const PEAK_KINDS=[
  {kind:'winter', name:'зима', start:10, inS:ym=>ym.m>=10||ym.m<=2, keyOf:ym=>ym.m>=10?ym.y+1:ym.y, label:k=>(k-1)+'/'+String(k).slice(2)},
  {kind:'summer', name:'лето', start:5, inS:ym=>ym.m>=5&&ym.m<=7, keyOf:ym=>ym.y, label:k=>String(k)},
];
// месяцы сравнения подписью: «ноя–дек» (подряд) или «янв, мар»
function peakMonthsLabel(ms){
  if(!ms || !ms.length) return '';
  const run=ms.every((m,i)=>!i || m===(ms[i-1]+1)%12);
  return run ? MONTHS_RU[ms[0]]+(ms.length>1?'–'+MONTHS_RU[ms[ms.length-1]]:'') : ms.map(m=>MONTHS_RU[m]).join(', ');
}
function seasonPeakSeries(v, months, gMed, gCnt, stornoIdx, opt){
  opt=opt||{};
  const maxRatio=opt.maxRatio!=null?opt.maxRatio:0.7, minPeak=opt.minPeak!=null?opt.minPeak:100;
  const st=new Set(stornoIdx||[]), useGroup=!!(gMed && gCnt>=8);
  const res={winter:[], summer:[]};
  for(const K of PEAK_KINDS){
    const by=new Map(), ord=m=>(m-K.start+12)%12;
    months.forEach((ym,i)=>{ if(!K.inS(ym)) return; const k=K.keyOf(ym); if(!by.has(k)) by.set(k,[]); by.get(k).push(i); });
    let prev=null, prevMap=null;
    for(const [key,ix] of [...by.entries()].sort((a,b)=>a[0]-b[0])){
      const known=ix.filter(i=>v[i]!=null);
      if(known.length<2) continue;
      let pi=known[0]; for(const i of known) if(v[i]>v[pi]) pi=i;
      const val=v[pi]; if(!(val>EPS)) continue;
      const rest=known.filter(i=>i!==pi).map(i=>v[i]);
      const nb=[pi-1,pi+1].filter(j=>j>=0 && j<v.length && v[j]!=null && (consecutiveMonth(months,j,pi)||consecutiveMonth(months,pi,j))).map(j=>v[j]);
      const spike=nb.length>0 && nb.every(x=>val>=2.5*Math.max(x,EPS)) && val>=2.5*Math.max(median(rest)||0,EPS);
      const mapM=new Map(known.map(i=>[months[i].m,i])); // календарный месяц → период
      const e={kind:K.kind, key, label:K.label(key), idx:pi, val, n:known.length, med:median(known.map(i=>v[i])),
        spike, spikeK:spike?val/Math.max(...nb,EPS):null, storno:ix.some(i=>st.has(i)),
        prev:null, ratio:null, cmpCur:null, cmpPrev:null, cmpMonths:null, nCmp:0, gRatio:null, adjRatio:null, medRatio:null, reliable:false, decline:false};
      if(prev){
        e.prev={key:prev.key, label:prev.label, idx:prev.idx, val:prev.val};
        const common=[...mapM.keys()].filter(mm=>prevMap.has(mm)).sort((a,b)=>ord(a)-ord(b));
        if(common.length>=2){
          const cv=common.map(mm=>v[mapM.get(mm)]), pv=common.map(mm=>v[prevMap.get(mm)]);
          e.cmpCur=Math.max(...cv); e.cmpPrev=Math.max(...pv); e.nCmp=common.length;
          if(common.length<Math.max(mapM.size, prevMap.size)) e.cmpMonths=common;
          if(e.cmpPrev>0){
            e.ratio=e.cmpCur/e.cmpPrev;
            const pm=median(pv); e.medRatio=pm>0 ? median(cv)/pm : null;
            if(useGroup){
              const gc=common.map(mm=>gMed[mapM.get(mm)]).filter(x=>x!=null), gp=common.map(mm=>gMed[prevMap.get(mm)]).filter(x=>x!=null);
              if(gc.length>=2 && gp.length>=2 && Math.max(...gp)>=25) e.gRatio=Math.max(...gc)/Math.max(...gp);
            }
            // общий для группы спад объясняет часть снижения; общий рост снижение не усиливает (как в S17)
            e.adjRatio=e.ratio/Math.max(0.1,Math.min(1,e.gRatio!=null?e.gRatio:1));
            e.reliable=!e.spike && !prev.spike && !e.storno && !prev.storno && key-prev.key<=2;
            // для вывода о снижении — не меньше трёх общих месяцев: максимум двух месяцев слишком шумный
            e.decline=e.reliable && common.length>=3 && e.cmpPrev>=minPeak && e.ratio<=maxRatio && e.adjRatio<=maxRatio && e.medRatio!=null && e.medRatio<=0.9;
          }
        }
      }
      res[K.kind].push(e); prev=e; prevMap=mapM;
    }
  }
  return res;
}
function peakPct(r){ if(r==null) return ''; const p=Math.round(Math.abs(r-1)*100); return p===0 ? '0%' : (r>=1?'+':'−')+fmt(p)+'%'; }
// v5.5: почему сравнение пиков несопоставимо — для описания S18, таблицы в карточке и Excel
function peakCmpNote(e, arr){
  if(!e.prev) return 'первый сезон';
  if(e.ratio==null) return 'меньше двух общих месяцев с прошлым сезоном';
  if(e.reliable) return e.cmpMonths ? 'сопоставимо, по тем же месяцам: '+peakMonthsLabel(e.cmpMonths) : 'сопоставимо';
  const pv=(arr||[]).find(x=>x.idx===e.prev.idx)||{}, why=[];
  if(e.spike) why.push('пик — разовый всплеск');
  if(pv.spike) why.push('прошлый пик — разовый всплеск');
  if(e.storno || pv.storno) why.push('сторно в сезоне');
  if(e.key-e.prev.key>2) why.push('разрыв больше 2 лет');
  return why.join(', ') || 'несопоставимо';
}
/* v5.5: S18 «Снижение сезонных пиков». Справочный (0 баллов) — вес подбирается после проверки на выгрузке.
   Срабатывает, если последний пик зимы или лета (не старше 15 мес. от конца ряда):
   — ниже прошлого пика того же сезона на ≥30% (порог настраивается) — с поправкой на группу и при снижении уровня
     сезона (медианы его месяцев) до ≤90%;
   — или второй сезон подряд ниже позапрошлого пика на ≥30% (произведение двух шагов, тоже с поправкой на группу
     и по уровню сезона): «лестница» или снижение, которое держится (частичный отскок не спасает, если итог ≥30%).
   Через разовый всплеск или сторно сравнения не делаются. Более ранние сопоставимые снижения перечисляются
   в описании, на графике видны все. */
function algPeakDrop(peaks, months, opts){
  if(!peaks) return null;
  opts=opts||{};
  const T=TUNE.peaks, n=months.length, hits=[];
  const decidable=e=>e.ratio!=null && e.nCmp>=3 && e.reliable;
  for(const K of PEAK_KINDS){
    const arr=peaks[K.kind]; if(!arr || arr.length<2) continue;
    // последний сезон, по которому можно судить: неполный (меньше трёх общих месяцев), со сторно или со всплеском
    // пропускаем — берём предыдущий, если он не старше 15 мес. от конца ряда
    let li=arr.length-1; while(li>=1 && !decidable(arr[li])) li--;
    if(li<1) continue;
    const last=arr[li], skipped=li<arr.length-1 ? arr[arr.length-1] : null;
    if(last.idx<n-15) continue; // последний пик сезона давний — свежего сравнения нет
    if(last.decline){ hits.push({K, mode:'fresh', e:last, skipped}); continue; }
    if(li>=2){
      const mid=arr[li-1], first=arr[li-2];
      if(decidable(mid) && mid.cmpPrev>=T.minPeak && last.key-first.key<=4){
        const cum=last.ratio*mid.ratio;
        const g=(last.gRatio!=null && mid.gRatio!=null) ? last.gRatio*mid.gRatio : null;
        const adj=cum/Math.max(0.1,Math.min(1,g!=null?g:1));
        const medC=(last.medRatio!=null && mid.medRatio!=null) ? last.medRatio*mid.medRatio : null;
        if(cum<=T.maxRatio && adj<=T.maxRatio && medC!=null && medC<=0.9) hits.push({K, mode:'held', e:last, first, mid, cum, g, adj, medC, skipped});
      }
    }
  }
  if(!hits.length) return null;
  const parts=hits.map(h=>{
    const e=h.e, nm=h.K.name, drop='на '+fmt((1-e.ratio)*100)+'%';
    const skip=h.skipped ? ' Сезон '+h.skipped.label+' пока не сравнивается ('+(h.skipped.ratio!=null && h.skipped.nCmp<3 ? 'неполный' : peakCmpNote(h.skipped, peaks[h.K.kind]))+') — вывод по предыдущему.' : '';
    const grp=e.gRatio!=null ? '; пик группы '+peakPct(e.gRatio)+(e.gRatio<1?', с поправкой на неё — −'+fmt((1-e.adjRatio)*100)+'%':'') : '';
    if(h.mode==='fresh')
      return (e.cmpMonths
        ? 'Пик ('+nm+') '+e.label+' за '+peakMonthsLabel(e.cmpMonths)+' — '+fmt(e.cmpCur)+' кВт·ч ниже тех же месяцев '+e.prev.label+' — '+fmt(e.cmpPrev)+' '+drop
        : 'Пик ('+nm+') '+e.label+' — '+fmt(e.val)+' кВт·ч ('+ymLabel(months[e.idx])+') ниже прошлого пика '+e.prev.label+' — '+fmt(e.prev.val)+' ('+ymLabel(months[e.prev.idx])+') '+drop)+
        grp+'; уровень сезона (медиана месяцев) '+peakPct(e.medRatio)+'.'+skip;
    return 'Пики ('+nm+') за два сезона снизились: '+h.first.label+' — '+fmt(h.first.val)+' → '+h.mid.label+' — '+fmt(h.mid.val)+' ('+peakPct(h.mid.ratio)+') → '+e.label+' — '+fmt(e.val)+' ('+peakPct(e.ratio)+'); итого −'+fmt((1-h.cum)*100)+'%'+
      (h.g!=null ? ', пик группы '+peakPct(h.g)+(h.g<1?', с поправкой −'+fmt((1-h.adj)*100)+'%':'') : '')+'; уровень сезона '+peakPct(h.medC)+
      (e.cmpMonths||h.mid.cmpMonths ? ' (неполные сезоны сравнены по тем же месяцам)' : '')+'.'+skip;
  });
  const older=[], used=new Set(hits.flatMap(h=>h.mid?[h.e,h.mid]:[h.e]));
  for(const K of PEAK_KINDS) for(const e of peaks[K.kind]||[]) if(e.decline && !used.has(e)) older.push(K.name+' '+e.label+' '+peakPct(e.ratio)+' к '+e.prev.label);
  const gasTxt = opts.gas && hits.some(h=>h.K.kind==='winter') ? ' Снижение зимних пиков совпадает с Г1 (исчезла отопительная нагрузка): вероятна смена источника тепла.' : '';
  return {pts:0, info:true, eventStart:hits[0].e.idx, eventEnd:hits[0].e.idx, peakHits:hits.map(h=>({kind:h.K.kind, mode:h.mode, idx:h.e.idx})),
    detail:parts.join(' ')+(older.length?' Ранее сопоставимые снижения пиков: '+older.join('; ')+'.':'')+gasTxt+
      ' Пик сезона зависит от погоды, проживания и режима работы — это повод проверить, а не доказательство недоучёта. Признак справочный (v5.5): 0 баллов и без оценки объёма, вес будет подобран после проверки на выгрузке. На месте — замер клещами под пиковой нагрузкой (отопление, кондиционер, мощное оборудование): не идёт ли она мимо ПУ.'};
}
function consecutiveMonth(months, a, b){
  return b===a+1 && months[b] && months[a] && months[b].y*12+months[b].m===months[a].y*12+months[a].m+1;
}
function sameSeasonLow(v, months, start, end, base, lowRatio){
  let comparable=0, low=0;
  for(let i=start;i<=end;i++){
    const target=(months[i].y-1)*12+months[i].m;
    const j=months.findIndex(mm=>mm.y*12+mm.m===target);
    if(j<0||v[j]==null) continue;
    comparable++; if(v[j]<=base*lowRatio) low++;
  }
  return comparable>=Math.max(1,Math.ceil((end-start+1)/2)) && low/comparable>=0.75;
}
function groupMassLow(gs,i){
  return !!(gs && gs.lowCounts && gs.lowCounts[i]>=8 && gs.lowShare[i]>=0.15);
}
function shortDips(v, months, gs, opts){
  const hits=[], n=v.length;
  for(let i=6;i<n;i++){
    if(v[i]==null) continue;
    const past=v.slice(Math.max(0,i-12),i).filter(x=>x!=null);
    if(past.length<6) continue;
    const base=median(past);
    if(base<opts.minBase || v[i]>Math.max(EPS,base*opts.lowRatio)) continue;
    // Новая серия, а не хвост длинного простоя.
    if(i>0 && (!consecutiveMonth(months,i-1,i) || v[i-1]!=null&&v[i-1]<=Math.max(EPS,base*opts.lowRatio))) continue;
    let end=i;
    while(end+1<n && consecutiveMonth(months,end,end+1) && v[end+1]!=null && v[end+1]<=Math.max(EPS,base*opts.lowRatio)) end++;
    const count=end-i+1;
    if(count<opts.minRun || count>opts.maxRun){ i=end; continue; }
    // Подтверждение активности до провала: не только далёкая историческая база.
    const before=v.slice(Math.max(0,i-3),i).filter(x=>x!=null);
    if(!before.length || median(before)<base*0.4){ i=end; continue; }
    let recovery=-1;
    for(let j=end+1;j<=Math.min(n-1,end+3);j++){
      if(!consecutiveMonth(months,j-1,j)) break;
      if(v[j]!=null&&v[j]>=base*0.8){ recovery=j; break; }
    }
    if(recovery<0){ i=end; continue; }
    let shared=false; for(let j=i;j<=end;j++) if(groupMassLow(gs,j)) shared=true;
    if(shared || sameSeasonLow(v,months,i,end,base,Math.max(0.15,opts.lowRatio))){ i=end; continue; }
    const block=v.slice(i,recovery+1), complete=block.every(x=>x!=null);
    const total=block.reduce((s,x)=>s+(x||0),0);
    const catchUp=complete && v[recovery]>=base*1.8 && total>=0.85*base*block.length;
    hits.push({start:i,end,recovery,base,count,catchUp,ratio:median(v.slice(i,end+1))/base});
    i=end;
  }
  return hits;
}
// S15: локальное обнуление после активной истории с последующим восстановлением.
function algShortBlackout(v, months, gs){
  const T=TUNE.blackout;
  const hits=shortDips(v,months,gs,{minRun:T.minRun,maxRun:3,minBase:100,lowRatio:T.lowRatio});
  if(!hits.length) return null;
  const best=hits.slice().sort((a,b)=>b.count-a.count || a.ratio-b.ratio || b.start-a.start)[0];
  return {pts:40, eventStart:best.start,eventEnd:best.recovery, events:hits,
    change:{kind:'valley', t:best.start, t1:best.end+1, delta:best.base*(1-best.ratio)},
    detail:`${ymLabel(months[best.start])} — ${ymLabel(months[best.end])}: ${best.count} мес. почти нулевого расхода после базы ~${fmt(best.base)} кВт·ч/мес; в ${ymLabel(months[best.recovery])} расход восстановился до ${fmt(v[best.recovery])} кВт·ч. Сезонное повторение и массовые провалы группы отфильтрованы там, где хватает данных. Это локальная аномалия для проверки, не установленная дата нарушения.`+
    (best.catchUp?' Последующий всплеск может компенсировать провал: возможен перенос начислений или контрольный съём; нужны первичные показания и журнал событий.':'')};
}
// S16: несколько отдельных коротких провалов с восстановлением, а не один длинный простой.
function algRepeatedDips(v, months, gs){
  const T=TUNE.repeatdip;
  const hits=shortDips(v,months,gs,{minRun:1,maxRun:3,minBase:100,lowRatio:T.lowRatio});
  if(hits.length<T.minEvents) return null;
  // Если почти все провалы попали в один сезон, это не самостоятельный признак переключений.
  const bins=new Array(12).fill(0); hits.forEach(h=>bins[months[h.start].m]++);
  const seasonal=hits.length>=3 && bins.some((_,m)=>(bins[m]+bins[(m+1)%12]+bins[(m+2)%12])/hits.length>=0.8);
  if(seasonal) return null;
  const pts=Math.min(36,24+2*hits.length);
  return {pts,eventStart:hits[0].start,eventEnd:hits[hits.length-1].recovery,events:hits,
    detail:`${hits.length} отдельных провалов до ≤${fmt(T.lowRatio*100)}% предшествующей базы с возвратом к ≥80%. Периоды: ${hits.slice(0,5).map(h=>ymLabel(months[h.start])+(h.end>h.start?'–'+ymLabel(months[h.end]):'')).join('; ')}${hits.length>5?'; …':''}. Повторение может соответствовать периодическим отключениям учёта, но также нерегулярным съёмам/работе объекта; проверить первичные показания. Объём недоучёта этим признаком не рассчитывается.`};
}
// S17: устойчивый провал к тем же календарным месяцам предыдущего года с поправкой на группу.
function algYearRelativeDrop(v, months, gs){
  const T=TUNE.yearrel, byMonth=new Map(months.map((m,i)=>[m.y*12+m.m,i]));
  const runs=[]; let cur=[];
  const close=()=>{if(cur.length>=T.minRun) runs.push(cur);cur=[];};
  for(let i=0;i<v.length;i++){
    const j=byMonth.get(months[i].y*12+months[i].m-12);
    if(i>0&&!consecutiveMonth(months,i-1,i)) close();
    if(j==null||v[i]==null||v[j]==null||v[j]<100){close();continue;}
    const own=v[i]/v[j];
    const g0=gs&&gs.medByMonth[j],g1=gs&&gs.medByMonth[i];
    const groupRatio=gs&&gs.cnt>=8&&g0>=25&&g1!=null?g1/g0:1;
    // Общий спад не превращаем в индивидуальное подозрение; общий рост не усиливает балл.
    const adjusted=own/Math.max(0.1,Math.min(1,groupRatio));
    if(own<=T.maxRatio && adjusted<=T.maxRatio && !groupMassLow(gs,i)) cur.push({i,j,own,adjusted});
    else close();
  }
  close(); if(!runs.length) return null;
  const best=runs.slice().sort((a,b)=>b.length-a.length || median(a.map(x=>x.adjusted))-median(b.map(x=>x.adjusted)))[0];
  const ratio=median(best.map(x=>x.own)),adj=median(best.map(x=>x.adjusted));
  const lastI=best[best.length-1].i, dlt=median(best.map(x=>v[x.j]-v[x.i]));
  // v5.3: баллы — по самому длинному эпизоду, но на графике и в описании видны все эпизоды
  const allRuns=runs.map(r=>({a:r[0].i, b:r[r.length-1].i, len:r.length, med:median(r.map(x=>x.own))})).sort((x,y)=>x.a-y.a);
  const others=allRuns.filter(x=>x.a!==best[0].i);
  const otherTxt=others.length ? ' Другие эпизоды падения год к году: '+others.map(x=>ymLabel(months[x.a])+' — '+ymLabel(months[x.b])+' ('+x.len+' мес., медиана '+fmt(x.med*100)+'%)').join('; ')+'.' : '';
  return {pts:Math.min(40,24+Math.round((1-adj)*16)),eventStart:best[0].i,eventEnd:lastI, runs:allRuns,
    change: lastI>=v.length-1 ? {kind:'down', t:best[0].i, delta:dlt} : {kind:'valley', t:best[0].i, t1:lastI+1, delta:dlt},
    detail:`${ymLabel(months[best[0].i])} — ${ymLabel(months[best[best.length-1].i])}: ${best.length} мес. подряд расход ≤${fmt(T.maxRatio*100)}% тех же месяцев предыдущего года (медиана ${fmt(ratio*100)}%). Снижение группы учтено, если есть достаточная группа сравнения. Сезонность по календарю уменьшена, но простой, ремонт или изменение деятельности всё ещё возможны. Период аномалии не равен доказанному периоду БУ.${otherTxt}`};
}
/* v5.0: «семьи» зависимых признаков.
   DIP_FAMILY — разные описания одного провала, в т.ч. суточные D1/D2 (раньше они добавлялись сверху).
   BAL_FAMILY — одно и то же свидетельство баланса ТП на разном масштабе: засчитывается только сильнейшее. */
/* Г1 (v5.1). Исчезла отопительная нагрузка — вероятен переход на газ (или другой источник тепла).
   Только быт: физ. лица, при неизвестном типе — ПУ до 15 кВт. Зима = дек–фев, лето = июн–авг (медиана,
   ≥2 мес.; лето ниже 30 кВт·ч/мес — «пустое», в базу не берётся); «своё лето» зимы — среднее лета до и после неё.
   Зима с отоплением: медиана трёх зимних месяцев ≥ minRatio × своего лета и выше его на ≥ minExcess кВт·ч/мес
   (медиана — чтобы один месяц с накопленным съёмом не выглядел отоплением).
   Признак: после последней зимы с отоплением есть хотя бы одна зима (месяцы до перехода не учитываются) —
   и каждая без отопительной добавки (≤1,5× своего лета или добавка ≤20% прежней), опустилась к прежней базе
   (≤ лето до перехода + 30% прежней добавки) и не пустая (≥35% лета до перехода); лето после перехода —
   тоже не ниже 35% прежнего. Исчезла сезонная добавка, а не всё потребление: хищение обычно снижает расход
   во все сезоны, переход на газ — только зимой (и немного летом, если газ греет воду).
   Сам по себе баллов не даёт: снижает вес провалов S3/S4/S14/S17, которые им объясняются (см. analyze),
   если после перехода видна хотя бы одна полная зима; при «Газ = нет» в файле, наоборот, даёт баллы. */
const HEAT_EXPLAINS=new Set(['S3','S4','S14','S17']);
const GAS_FACTOR=0.5, HEAT_KEEP=0.35;
function gasDateLabel(d){ return d ? (d.yearOnly ? String(d.y) : ymLabel(d)) : ''; }
function algHeatLoss(v, months, m){
  const T=TUNE.gas;
  if(m.ctype==='ul' || (m.ctype==null && !(m.power!=null && m.power<=15))) return null;
  const n=v.length, wIdx=new Map(), sIdx=new Map();
  for(let i=0;i<n;i++){
    const ym=months[i]; if(v[i]==null) continue;
    if(isWinter(ym)){ const y=ym.m===11?ym.y+1:ym.y; if(!wIdx.has(y)) wIdx.set(y,[]); wIdx.get(y).push(i); }
    else if(isSummer(ym)){ if(!sIdx.has(ym.y)) sIdx.set(ym.y,[]); sIdx.get(ym.y).push(i); }
  }
  // лето «живое», если ≥30 кВт·ч/мес: пустое лето (ПУ ещё не работал, дом пустовал) не годится в базу
  const summer=new Map();
  for(const [y,ix] of sIdx) if(ix.length>=2){ const lvl=median(ix.map(i=>v[i])); summer.set(y,{lvl, a:ix[0], b:ix[ix.length-1], alive:lvl>=30}); }
  const sLvl=y=>{ const s=summer.get(y); return s&&s.alive?s.lvl:null; };
  const W=[...wIdx.entries()].filter(([,ix])=>ix.length>=2).sort((p,q)=>p[0]-q[0]).map(([y,ix])=>{
    const ss=[sLvl(y-1),sLvl(y)].filter(x=>x!=null), vals=ix.map(i=>v[i]);
    return {y, ix, w:mean(vals), wm:ix.length>=3?median(vals):null, l:ss.length?mean(ss):null};
  });
  if(W.length<2) return null;
  // зима с отоплением — по медиане трёх месяцев: один месяц с накопленным съёмом её не создаёт
  const heated=z=>z.wm!=null && z.l!=null && z.wm>=T.minRatio*z.l && z.wm-z.l>=T.minExcess;
  let h=-1; for(let k=W.length-1;k>=0;k--) if(heated(W[k])){ h=k; break; }
  if(h<0 || h===W.length-1) return null; // отопления не было или оно есть и в последнюю зиму
  const hz=W[h], E=hz.wm-hz.l;
  // переход: последний месяц с заметной отопительной добавкой (≥ лето + 30% прежней добавки) —
  // ищется от начала последней зимы с отоплением до конца следующей зимы
  const thr=hz.l+0.3*E, next=W[h+1], endI=next.ix[next.ix.length-1];
  let hot=-1; for(let i=hz.ix[0];i<=endI;i++) if(v[i]!=null && v[i]>=thr) hot=i;
  if(hot<0 || hot>=endI) return null; // и следующая зима до конца с отоплением — оно не исчезло
  // первый известный месяц отопительного сезона (ноя–мар) после него — отопления в нём уже нет
  const heatSeason=ym=>ym.m>=10||ym.m<=2;
  let to=-1; for(let i=hot+1;i<n;i++) if(v[i]!=null && heatSeason(months[i])){ to=i; break; }
  if(to<0) return null;
  const after=W.slice(h+1).map(z=>{ const ix=z.ix.filter(i=>i>hot); return ix.length>=2?{...z,ix,w:mean(ix.map(i=>v[i]))}:null; }).filter(Boolean);
  if(!after.length) return null;
  const sB=[...summer.values()].filter(s=>s.alive && s.b<to).sort((p,q)=>q.b-p.b).slice(0,3).map(s=>s.lvl);
  if(!sB.length) return null;
  const sBefore=median(sB);
  const sA=[...summer.values()].filter(s=>s.a>to).sort((p,q)=>p.a-q.a).slice(0,3).map(s=>s.lvl);
  for(const z of after){
    const ref=z.l!=null?z.l:sBefore;
    if(!(z.w<=1.5*ref || z.w-ref<=0.2*E)) return null; // отопительная добавка осталась или вернулась
    if(z.w>sBefore+0.3*E) return null;                   // зима не опустилась к прежней базе
    if(z.w<HEAT_KEEP*sBefore) return null;               // упало всё: дом пустует или учёт «встал»
  }
  const wAfter=median(after.map(z=>z.w)), sAfter=sA.length?median(sA):null;
  if(sAfter!=null && sAfter<HEAT_KEEP*sBefore) return null; // летом тоже упало — исчезло не только отопление
  const seasonLbl=y=>(y-1)+'/'+String(y).slice(2);
  const gasTxt = m.gas===true ? ` По файлу газ подключён${m.gasDate?' ('+gasDateLabel(m.gasDate)+')':''}.`
    : m.gas===false ? ' По файлу газа нет — исчезновение отопления без замены источника тепла подозрительно: проверить, чем отапливается дом (котёл или обогреватели могут быть подключены помимо ПУ).'
    : ' Так же выглядит котёл или обогреватели, подключённые помимо ПУ, — до выезда сверить адрес с реестром газификации.';
  return {info:m.gas!==false, pts:m.gas===false?12:0, eventStart:hot, eventEnd:to,
    // полная зима после перехода (3 известных месяца) — без неё баллы провала не снижаются
    heat:{y:hz.y, w:hz.wm, l:hz.l, excess:E, from:hz.ix[0], hot, to, wAfter, sBefore, sAfter, full:after.some(z=>z.ix.length>=3)},
    detail:`Зима ${seasonLbl(hz.y)}: ~${fmt(hz.wm)} кВт·ч/мес при летних ~${fmt(hz.l)} — электроотопление, добавка ~${fmt(E)} кВт·ч/мес. Последний месяц с отоплением — ${ymLabel(months[hot])}, с ${ymLabel(months[to])} его нет: зимы после — ~${fmt(wAfter)} кВт·ч/мес, без отопительной добавки; лето ${sAfter!=null?'~'+fmt(sAfter)+' ('+fmt(sAfter/sBefore*100)+'% прежнего ~'+fmt(sBefore)+')':'после перехода ещё не наступило (до него ~'+fmt(sBefore)+')'}. Пропала сезонная добавка, а не всё потребление: чаще всего это переход на газ или другой источник тепла.`+gasTxt};
}

// v5.5: S18 (снижение пиков) — тоже описание снижения; пока он справочный (0 баллов), семья на него не влияет
const DIP_FAMILY=new Set(['S2','S3','S3б','S4','S5','S14','S15','S16','S17','S18','D1','D2']);
const BAL_FAMILY=new Set(['S11','D3','Б1']);
function limitDependentFlags(flags){
  // Несколько описаний одного провала не являются независимыми доказательствами.
  const subset=flags.filter(f=>DIP_FAMILY.has(f.code)&&f.pts>0).sort((a,b)=>b.pts-a.pts);
  if(subset.length>=2){
    let budget=Math.min(10,Math.round(subset.slice(1).reduce((s,f)=>s+f.pts,0)*0.3));
    for(const f of subset.slice(1)){
      f.rawPts=f.rawPts??f.pts;
      const effective=Math.min(budget,Math.round(f.pts*0.3));
      f.pts=effective; budget-=effective;
      f.scoreNote=(f.scoreNote?f.scoreNote+' ':'')+'Вес ограничен: зависимые признаки провала (месячные и суточные) суммарно добавляют не более 10 баллов к самому сильному.';
    }
  }
  const bal=flags.filter(f=>BAL_FAMILY.has(f.code)&&f.pts>0).sort((a,b)=>b.pts-a.pts);
  for(const f of bal.slice(1)){
    f.rawPts=f.rawPts??f.pts; f.pts=0;
    f.scoreNote='Не суммируется: то же свидетельство баланса ТП уже учтено в '+bal[0].code+'.';
  }
}
/* v5.0: совместная оценка вкладов ПУ в небаланс ТП.
   I(t) ≈ a + b·S(t) + c·S(t)² + Σ k_j·d_j(t): техпотери моделируются через отпуск S, а k_j — доля
   предполагаемой недостачи d_j ПУ, которую подтверждает небаланс (0 — ввод изменился вместе с ПУ,
   1 — вся недостача «всплыла» в потерях). k_j ограничены отрезком [0; 1,2]; решение — МНК с
   ограничениями (активное множество); коэффициенты техпотерь неотрицательны. Погрешность k_j —
   по обычной формуле МНК. Гипотеза, почти неотличимая от техпотерь (недостача постоянна весь ряд:
   меньше 8% её «энергии» не объясняется формой a + b·S + c·S²), балансом не проверяется. */
function solveSym(A, rhs){ // A·x = rhs, A — симметричная; Гаусс с выбором ведущего
  const n=A.length, M=A.map((row,i)=>row.concat([rhs[i]]));
  for(let c=0;c<n;c++){
    let p=c; for(let r=c+1;r<n;r++) if(Math.abs(M[r][c])>Math.abs(M[p][c])) p=r;
    if(Math.abs(M[p][c])<1e-12) return null;
    [M[c],M[p]]=[M[p],M[c]];
    for(let r=0;r<n;r++){ if(r===c) continue; const f=M[r][c]/M[c][c]; if(f===0) continue; for(let k=c;k<=n;k++) M[r][k]-=f*M[c][k]; }
  }
  return M.map((row,i)=>row[n]/row[i]);
}
function balanceRegression(I, S, defs){
  const idx=[]; for(let t=0;t<I.length;t++) if(I[t]!=null && S[t]!=null && S[t]>0) idx.push(t);
  if(idx.length<12 || !defs.length) return null;
  const sMean=mean(idx.map(t=>S[t]));
  const cols=[idx.map(()=>1), idx.map(t=>S[t]/sMean), idx.map(t=>(S[t]/sMean)**2)];
  const base=cols.length;
  defs.forEach(d=>cols.push(idx.map(t=>(d&&d[t])||0)));
  const y=idx.map(t=>I[t]), p=cols.length, n=idx.length;
  // техпотери физически неотрицательны: a, b, c ≥ 0 (холостой ход, нагрузочные ∝ S и ∝ S²)
  const lo=cols.map(()=>0), hi=cols.map((_,j)=>j<base?Infinity:1.2);
  const dot=(a,b)=>{ let s=0; for(let i=0;i<n;i++) s+=a[i]*b[i]; return s; };
  const ols=(free,yy)=>{
    const A=free.map(i=>free.map(j=>dot(cols[i],cols[j]))), rhs=free.map(i=>dot(cols[i],yy));
    const tr=A.reduce((s,row,i)=>s+row[i],0)||1; A.forEach((row,i)=>{ row[i]+=1e-9*tr; });
    return {A, x:solveSym(A,rhs)};
  };
  // гипотезы, неотличимые от техпотерь (постоянная недостача весь ряд), балансом не проверяются
  const techOnly=[0,1,2];
  // u — доля «энергии» недостачи, которую нельзя объяснить формой техпотерь: у постоянной весь ряд
  // недостачи u≈0 (её уровень неотличим от потерь холостого хода), у ступени на полряда u≈0,25
  const uniq=defs.map((_,k)=>{
    const d=cols[base+k], ss=d.reduce((s,x)=>s+x*x,0);
    if(!(ss>0)) return 0;
    const sol=ols(techOnly,d); if(!sol.x) return 0;
    const ssr=d.reduce((s,x,i)=>s+(x-techOnly.reduce((a,j,q)=>a+sol.x[q]*cols[j][i],0))**2,0);
    return ssr/ss;
  });
  // погрешности — по свободной (без ограничений) модели
  const all=[...Array(p).keys()], first=ols(all,y);
  if(!first.x) return null;
  const res0=y.map((v,i)=>v-all.reduce((s,j,q)=>s+first.x[q]*cols[j][i],0));
  const s2=res0.reduce((s,x)=>s+x*x,0)/Math.max(1,n-p);
  const se=defs.map((_,k)=>{ const j=base+k, e=all.map(q=>q===j?1:0), col=solveSym(first.A,e); return col? Math.sqrt(Math.max(0,s2*col[j])) : Infinity; });
  // МНК с ограничениями: худшее нарушение фиксируется на границе, остальное пересчитывается
  const fixed=new Array(p).fill(null);
  let beta=first.x.slice();
  for(let it=0; it<=p; it++){
    const free=all.filter(j=>fixed[j]==null);
    const yy=y.map((v,i)=>v-all.reduce((s,j)=>s+(fixed[j]!=null?fixed[j]*cols[j][i]:0),0));
    const sol=ols(free,yy); if(!sol.x) return null;
    let worst=-1, wv=0;
    free.forEach((j,q)=>{ const v=sol.x[q], viol=v<lo[j]?lo[j]-v:(v>hi[j]?v-hi[j]:0); if(viol>wv){ wv=viol; worst=j; } });
    beta=all.map(j=>fixed[j]!=null?fixed[j]:sol.x[free.indexOf(j)]);
    if(worst<0) break;
    fixed[worst]=beta[worst]<lo[worst]?lo[worst]:hi[worst];
  }
  const tech=I.map(()=>null);
  idx.forEach((t,i)=>{ tech[t]=beta[0]*cols[0][i]+beta[1]*cols[1][i]+beta[2]*cols[2][i]; });
  return {items:defs.map((_,k)=>({k:beta[base+k], se: uniq[k]<0.08 ? Infinity : se[k], uniq:uniq[k]})), tech};
}
function qualityNotesFor(m, months, history, gs){
  const out=[];
  if(m.corrections&&m.corrections.length) out.push({code:'Q1',title:'Сторно / отрицательные значения',detail:m.corrections.length+' отрицательных значений: '+m.corrections.slice(0,6).map(x=>x.period+' ('+fmt(x.value)+' кВт·ч)').join('; ')+(m.corrections.length>6?'; …':'')+'. Значения сохранены в этом предупреждении; из расчёта расхода исключены. Это вопрос качества данных, не баллы за хищение.'});
  if(history.leadingZeros>=3 && history.start<months.length) out.push({code:'Q2',title:'Неизвестна дата начала учёта',detail:history.leadingZeros+' начальных нулевых месяцев до '+ymLabel(months[history.start])+'. Без даты установки/подключения нельзя отличить новый ПУ от неполного архива или прежнего неучтённого потребления. Начальные нули не дают баллов и оценки объёма.'});
  const missing=m.values.slice(history.start).filter(x=>x==null).length;
  if(missing) out.push({code:'Q3',title:'Пропуски в активной истории',detail:missing+' месячных значений отсутствуют или исключены как отрицательные. Пропуск не приравнивается к нулю. Новые признаки не считают неизвестный месяц месяцем низкого потребления.'});
  const shared=[]; history.values.forEach((x,i)=>{if(x!=null&&x<=EPS&&groupMassLow(gs,i))shared.push(i);});
  if(shared.length) out.push({code:'Q4',title:'Совпадающий провал группы',detail:shared.length+' нулевых месяцев совпали с низким расходом у ≥15% активных ПУ группы сравнения (не менее 8 сопоставимых ПУ). В S5 и S15–S17 такие периоды не считаются индивидуальным подтверждением. Проверить полноту выгрузки, общие отключения и начисления.'});
  return out;
}
function labeledMetrics(results){
  const out={positive:{n:0,red:0,amber:0,green:0,dead:0},negative:{n:0,red:0,amber:0,green:0,dead:0},unknown:0, byType:{}};
  for(const r of results){
    const label=r.meter.reviewLabel;
    if(label!=='positive'&&label!=='negative'){out.unknown++;continue;}
    out[label].n++;out[label][r.cls]++;
    const t=r.meter.ctype||'unknown'; out.byType[t]??={positive:{n:0,red:0,amber:0,green:0,dead:0},negative:{n:0,red:0,amber:0,green:0,dead:0}};
    out.byType[t][label].n++;out.byType[t][label][r.cls]++;
  }
  return out;
}


const ALG_META = {
  sleeper:{code:'S1', title:'Начальные нули → начало активности (справочно)'},
  ragged:{code:'S2', title:'Рваный профиль: нули со всплесками'},
  step:{code:'S3', title:'Ступенчатое падение'},
  valley:{code:'S3б', title:'Провал с восстановлением'},
  fade:{code:'S4', title:'Затухание расхода'},
  zeroAlive:{code:'S5', title:'Нули при живой группе'},
  frozen:{code:'S6', title:'Замороженные показания'},
  round:{code:'S7', title:'Круглые числа'},
  peers:{code:'S8', title:'Ниже соседей по группе'},
  season:{code:'S9', title:'Против сезона'},
  idle:{code:'S10', title:'Мощность простаивает'},
  imb:{code:'S11', title:'Синхронность с небалансом ТП'},
  lone:{code:'S12', title:'Разовый всплеск в мёртвом ряду'},
  stepup:{code:'S13', title:'Ступенчатый рост с низкой базы'},
  slow:{code:'S14', title:'Многолетнее угасание'},
  blackout:{code:'S15', title:'Короткое обнуление с восстановлением'},
  repeatdip:{code:'S16', title:'Повторные локальные провалы'},
  yearrel:{code:'S17', title:'Устойчивое падение год к году'},
  peaks:{code:'S18', title:'Снижение сезонных пиков (справочно)'},
  dzero:{code:'D1', title:'Нулевые сутки при живой группе'},
  ddip:{code:'D2', title:'Суточный провал'},
  dsync:{code:'D3', title:'Синхронность с суточным небалансом'},
  bal:{code:'Б1', title:'Изменение подтверждено балансом ТП'},
  gas:{code:'Г1', title:'Исчезла отопительная нагрузка (вероятен газ)'},
};

const CLS = { red:45, amber:20 };

function analyze(data, tariff){
  const {meters, months, supplyRows} = data;
  const days = data.days || null, monthDays = data.monthDays || null;
  const n = months.length;

  const histories=new Map(meters.map(m=>[m,meterHistory(m)]));
  // группы (по ТП, если колонка есть; иначе весь файл)
  const groups={};
  for(const m of meters){ const g=m.tp||'__all__'; (groups[g]=groups[g]||[]).push(m); }
  const buildStats = arr => {
    const medByMonth=months.map((_,i)=>median(arr.map(m=>histories.get(m).values[i])));
    const lowCounts=[],lowShare=[];
    months.forEach((_,i)=>{
      let count=0,low=0;
      for(const m of arr){const v=histories.get(m).values;if(v[i]==null)continue;const prev=v.slice(Math.max(0,i-12),i).filter(x=>x!=null);if(prev.length<3)continue;const base=median(prev);if(base<25)continue;count++;if(v[i]<=Math.max(EPS,0.15*base))low++;}
      lowCounts.push(count);lowShare.push(count?low/count:0);
    });
    const means=arr.map(m=>mean(histories.get(m).values)).filter(x=>x!=null).sort((a,b)=>a-b);
    const p10=means.length?means[Math.floor(means.length*0.1)]:null;
    const w=[],s=[];
    months.forEach((ym,i)=>{ const gm=medByMonth[i]; if(gm!=null){ if(isWinter(ym))w.push(gm); if(isSummer(ym))s.push(gm); }});
    const wsRatio=(w.length>=2&&s.length>=2&&median(s)>0)?median(w)/median(s):null;
    const medByDay = days ? days.map((_,i)=>median(arr.map(m=>m.daily?m.daily[i]:null))) : null;
    // «живая группа» для D1 — медиана по дню только среди не мёртвых ПУ: иначе на дачных ТП
    // (половина ПУ нулевые) медиана всей группы ≤ EPS_D каждый день и D1 не срабатывает никогда
    const aliveArr = arr.filter(m=>{ const k=m.values.filter(x=>x!=null); return k.length>0 && !k.every(x=>x<=EPS); });
    const medByDayAlive = days ? days.map((_,i)=>median(aliveArr.map(m=>m.daily?m.daily[i]:null))) : null;
    return {uniqueCount:new Set(arr.map(m=>m.id)).size,types:[...new Set(arr.map(m=>m.ctype||'unknown'))],tpKeys:[...new Set(arr.map(m=>m.tp||'__all__'))],medByMonth, medByDay, medByDayAlive, lowCounts, lowShare, groupMedian:median(means), p10, wsRatio, cnt:arr.length};
  };
  const groupStats={};
  for(const [g,arr] of Object.entries(groups)) groupStats[g]=buildStats(arr);
  // подгруппы по типу потребителя (юр/физ): внутри ТП и по всему файлу.
  // Групповые признаки (S5, S8, S9, поправки S3/S14) сравнивают ПУ со «своими»:
  // юр — с юр, физ — с физ, если таких набирается от 6; иначе прежняя логика.
  const typeStats={};
  for(const [g,arr] of Object.entries(groups)){
    for(const t of ['ul','fl']){
      const sub=arr.filter(m=>m.ctype===t);
      if(sub.length>=6) typeStats[g+'|'+t]=buildStats(sub);
    }
  }
  const globalTypeStats={};
  for(const t of ['ul','fl']){
    const sub=meters.filter(m=>m.ctype===t);
    if(sub.length>=6) globalTypeStats[t]=buildStats(sub);
  }
  // маленькие группы по ТП (< 6 ПУ) сравниваем со всем файлом
  const globalStats = buildStats(meters);
  // v5.1: подпись группы сравнения — для графика и карточки ПУ
  const TYPE_GRP={ul:'юр. лица', fl:'физ. лица'};
  for(const [g,s] of Object.entries(groupStats)) s.label = g==='__all__' ? 'все ПУ выборки' : 'все ПУ '+g;
  for(const [k,s] of Object.entries(typeStats)){ const [g,t]=[k.slice(0,k.lastIndexOf('|')),k.slice(k.lastIndexOf('|')+1)]; s.label=TYPE_GRP[t]+(g==='__all__'?'':' '+g); }
  for(const [t,s] of Object.entries(globalTypeStats)) s.label=TYPE_GRP[t]+' по всему реестру';
  globalStats.label='все ПУ реестра';
  // v5.2: режим «медиана по всему реестру» (выбирается в рейтинге): уровень и сезонный профиль — по всему
  // реестру, юр/физ отдельно (если своего типа в реестре от 6 ПУ); события ТП — массовые нули, отключения,
  // «живая группа» по суткам — из своей ТП, если в ней от 6 ПУ (в меньшей их всё равно не различить).
  const scopedStats={};
  const fileScopeOf=(g,t)=>{
    const k=g+'|'+(t||'*'); if(scopedStats[k]) return scopedStats[k];
    const base=t ? globalTypeStats[t] : globalStats, gs=groupStats[g], ev=gs.cnt>=6 ? gs : base;
    return scopedStats[k]={...base, lowCounts:ev.lowCounts, lowShare:ev.lowShare, medByDay:ev.medByDay, medByDayAlive:ev.medByDayAlive, fileWide:true, fileScope:true};
  };
  // v5.1: своего типа на ТП меньше 6 — сравнение с тем же типом по всему файлу, а не со смешанной группой
  // ТП (иначе 4 юр. лица сравниваются со 137 домами). Только если такого типа в файле от FILE_TYPE_MIN ПУ:
  // медиана десятка разнородных юр. лиц сама «гуляет» от их собственных провалов. Общие события ТП —
  // массовые нули, отключения, «живая группа» по суткам — по-прежнему берутся из своей ТП: её отключение
  // не должно выглядеть как «нули при живой группе» на фоне всего файла.
  const FILE_TYPE_MIN=20;
  const fileTypeStats={};
  const fileTypeOf=(g,t)=>{
    const k=g+'|'+t; if(fileTypeStats[k]) return fileTypeStats[k];
    const gt=globalTypeStats[t], gs=groupStats[g];
    return fileTypeStats[k]={...gt, lowCounts:gs.lowCounts, lowShare:gs.lowShare, medByDay:gs.medByDay, medByDayAlive:gs.medByDayAlive, fileWide:true};
  };
  const typeFileWide=[];
  if(GROUP_SCOPE==='tp') for(const [g,arr] of Object.entries(groups)){
    if(groupStats[g].cnt<6 && meters.length!==groupStats[g].cnt) continue;
    const row={tp:g==='__all__'?'':g, ul:0, fl:0};
    for(const t of ['ul','fl']){ if(typeStats[g+'|'+t] || !globalTypeStats[t] || globalTypeStats[t].cnt<FILE_TYPE_MIN || groupStats[g].types.length<2) continue; row[t]=arr.filter(m=>m.ctype===t).length; }
    if(row.ul||row.fl) typeFileWide.push(row);
  }
  let fallbackUsed=false, typeSplitUsed=false;
  const effStats = m => {
    const g=m.tp||'__all__';
    if(GROUP_SCOPE==='file'){
      const t=m.ctype && globalTypeStats[m.ctype] ? m.ctype : null;
      if(t) typeSplitUsed=true;
      return fileScopeOf(g,t);
    }
    const ts=m.ctype ? typeStats[g+'|'+m.ctype] : null;
    if(ts){ typeSplitUsed=true; return ts; }
    const gs=groupStats[g];
    const gt=m.ctype ? globalTypeStats[m.ctype] : null;
    const small = gs.cnt<6 && meters.length!==gs.cnt;
    if(small){
      fallbackUsed=true;
      if(gt){ typeSplitUsed=true; return gt; }
      return globalStats;
    }
    if(gt && gt.cnt>=FILE_TYPE_MIN && gs.types.length>1){ typeSplitUsed=true; return fileTypeOf(g,m.ctype); }
    return gs;
  };

  // v5.0: для баланса показания ПУ с профилем «нули + всплески» (S2) раскладываются обратно по
  // месяцам, за которые они накоплены: всплеск за полгода иначе даёт в балансе «минус» в месяц съёма
  // и ложные «потери» в пустые месяцы — и забивает шумом все проверки балансом. Сумма не меняется.
  const balanceSeriesOf=new Map();
  for(const m of meters){
    const h=histories.get(m), v=h.values;
    if(!v.some(x=>x!=null&&x>EPS)) continue;
    const hit=algRagged(v,months,true,effStats(m));
    if(!hit) continue;
    // раскладка по сырому ряду: первый всплеск — назад не дальше типичной длины цикла этого ПУ
    const raw=m.values, out=raw.slice(), cyc=[];
    { let g=0, seen=false; for(const x of raw){ if(x==null) continue; if(x<=EPS){ g++; continue; } if(seen) cyc.push(g+1); seen=true; g=0; } }
    const typLen=cyc.length ? Math.max(1,Math.round(median(cyc))) : 1;
    let runStart=-1, first=true;
    for(let i=0;i<raw.length;i++){
      const x=raw[i];
      if(x==null) continue;
      if(x<=EPS){ if(runStart<0) runStart=i; continue; }
      let from = runStart<0 ? i : runStart;
      if(first) from=Math.max(from, i-typLen+1);
      const span=[]; for(let k=from;k<=i;k++) if(raw[k]!=null) span.push(k);
      span.forEach(k=>{ out[k]=x/span.length; });
      runStart=-1; first=false;
    }
    const avgAll=mean(v.filter(x=>x!=null));
    if(runStart>=0 && !first) for(let k=runStart;k<raw.length;k++) if(raw[k]!=null) out[k]=avgAll; // ещё не снятый хвост — средним
    balanceSeriesOf.set(m,out);
  }
  fallbackUsed=false; typeSplitUsed=false; // предварительный проход не должен влиять на пометки

  // небаланс, если есть строки отпуска. НЕСКОЛЬКО строк отпуска одной группы
  // (два и более тех. учёта: Т1 + Т2 …) суммируются в ОДИН ввод помесячно;
  // месяц анализируется, только если данные есть по КАЖДОМУ вводу группы.
  const imbalanceByGroup={};
  const imbDailyByGroup={};
  const tpBalance=[];
  const supplyByGroup={};
  for(const s of supplyRows){
    // сопоставляем строку отпуска с группой ПУ: точный ключ → без регистра →
    // имя группы внутри label (берём длиннейшее, чтобы «ТП-1» не съел «ТП-10») →
    // вся выборка (с предупреждением, если групп несколько)
    let g=s.tp||'__all__', balNote=null;
    if(!groups[g]){
      const lk=String(s.idsText||s.label||'').toLowerCase(), gl=String(g).toLowerCase();
      const keys=Object.keys(groups);
      const hit=keys.find(k=>k.toLowerCase()===gl)
        || keys.filter(k=>k!=='__all__' && lk.includes(k.toLowerCase()))
             .sort((a,b)=>b.length-a.length)[0];
      if(hit) g=hit;
      else{
        g='__all__';
        if(keys.length>1 && !groups['__all__']) balNote='ТП строки отпуска не сопоставлен с ТП приборов — баланс этой строки считается по ВСЕЙ выборке ('+keys.length+' групп). Проверьте ячейку «ТП» в строке отпуска.';
      }
    }
    // номера ПУ тех. учёта: любые 6–18-значные числа в тексте строки отпуска
    // номера ПУ тех. учёта — 6–18-значные числа из служебных ячеек строки; номера,
    // совпадающие с потребителями, отбрасываем (это не ввод)
    const meterIdSet=new Set(meters.map(m=>m.id));
    const ids=(String(s.idsText||s.label||'').match(/\d{6,18}/g)||[]).filter(x=>!meterIdSet.has(x));
    (supplyByGroup[g]=supplyByGroup[g]||{rows:[], note:null}).rows.push({label:s.label.trim(), ids, values:s.values, daily:s.daily||null});
    if(balNote) supplyByGroup[g].note=balNote;
  }
  const supplyByGroupSeries={}, supDailyByGroup={}, techFloorByGroup={};
  for(const g of Object.keys(supplyByGroup)){
    const rows=supplyByGroup[g].rows;
    // сумма вводов: месяц известен, только если известен у каждого ввода
    const supVals=months.map((_,i)=>{
      let sum=0;
      for(const r of rows){ if(r.values[i]==null) return null; sum+=r.values[i]; }
      return sum;
    });
    const arr=groups[g]||meters;
    // v5.0: пропуск показаний — не ноль (см. usefulWithGaps)
    const uM=usefulWithGaps(arr, m=>balanceSeriesOf.get(m)||m.values, months);
    const sumBy=uM.values;
    const imb=months.map((_,i)=>(supVals[i]!=null&&sumBy[i]!=null)?supVals[i]-sumBy[i]:null);
    imbalanceByGroup[g]=imb;
    supplyByGroupSeries[g]=supVals;
    // v5.0: фоновые потери ТП — 25-й перцентиль доли небаланса по месяцам. «Сверхфоновый» небаланс
    // считается от меньшего из норматива и фона (если фактические потери этой ТП ниже норматива).
    const shares=months.map((_,i)=>(imb[i]!=null&&supVals[i]>0)?imb[i]/supVals[i]:null).filter(x=>x!=null).sort((a,b)=>a-b);
    const background=shares.length>=6 ? shares[Math.floor(shares.length*0.25)] : null;
    const techFloor=background!=null ? Math.max(0, Math.min(MODE.norm, background)) : MODE.norm;
    techFloorByGroup[g]=techFloor;
    // агрегаты плашки — только по месяцам, где известны ОБЕ стороны (отпуск и ПУ),
    // чтобы всегда выполнялось: отпуск − по ПУ = разница
    let sup=0, useSum=0;
    months.forEach((_,i)=>{ if(imb[i]!=null){ sup+=supVals[i]; useSum+=sumBy[i]; } });
    const it=sup-useSum;
    const allIds=[]; rows.forEach(r=>r.ids.forEach(id=>{ if(!allIds.includes(id)) allIds.push(id); }));
    const label = rows.length===1
      ? (g!=='__all__' && !rows[0].label.toLowerCase().includes(g.toLowerCase()) ? rows[0].label+' '+g : rows[0].label)
      : 'Отпуск в сеть '+(g==='__all__'?'':g+' ')+'— сумма '+rows.length+' вводов (тех. учёт)';
    // суточный баланс (если выгрузка суточная): та же логика, но по дням
    let daily=null, uD=null;
    if(days){
      const dSup=days.map((_,i)=>{ let sum=0; for(const r of rows){ if(!r.daily||r.daily[i]==null) return null; sum+=r.daily[i]; } return sum; });
      uD=usefulWithGaps(arr, m=>m.daily||null, days);
      const dUse=uD.values;
      const dImb=days.map((_,i)=>(dSup[i]!=null&&dUse[i]!=null)?dSup[i]-dUse[i]:null);
      daily={supplySeries:dSup, usefulSeries:dUse, series:dImb, imputed:uD.imputed, excluded:uD.excluded};
      imbDailyByGroup[g]=dImb;
      supDailyByGroup[g]=dSup;
    }
    tpBalance.push({group:g==='__all__'?'вся выборка':g, key:g, note:supplyByGroup[g].note, label,
      inputs:rows.map(r=>({label:r.label, ids:r.ids})), meterIds:allIds, inputCount:rows.length,
      supply:sup, sumMeters:useSum, imbalance:it, pct:sup>0?it/sup*100:null,
      series:imb, supplySeries:supVals, usefulSeries:sumBy, daily,
      gaps:{imputed:uM.imputed, excluded:uM.excluded, dayImputed:uD?uD.imputed:0, dayExcluded:uD?uD.excluded:0},
      techFloor, background});
  }

  const manualTune=TUNE,manualOff=ALG_OFF;
  const manualLevels=Object.fromEntries(Object.entries(manualTune).map(([k,v])=>[k,v.level]));
  const results = meters.map(m=>{
    const g=m.tp||'__all__', gs=effStats(m), history=histories.get(m), v=history.values;
    const policy=meterPolicy(m,history,months,days,gs,manualLevels,manualOff);
    TUNE=policy.active?buildTune(policy.levels):manualTune;ALG_OFF=policy.active?policy.off:manualOff;
    // контекст, включённый только метаданными АСКУЭ, не меняет выбор алгоритмов (S9, зимние надбавки)
    const ctxOn=policy.active && !policy.autoMetadata;
    try {
    const quality=qualityNotesFor(m,months,history,gs).concat(contextQualityNotes(policy,m));
    const known=v.filter(x=>x!=null);
    const total=m.values.reduce((a,b)=>a+(b||0),0);
    // «нулевой ряд»: в суточном режиме — по суткам полных месяцев (месяц с дырами АСКУЭ даёт null
    // в месячной сумме, но живой ПУ не должен из-за этого терять признаки, в т.ч. суточные D1–D3)
    const isDead = (days && m.daily)
      ? m.daily.reduce((acc,x)=>acc+(x||0),0)<=EPS   // по всем известным суткам, включая неполные месяцы
      : (known.length===0 || known.every(x=>x<=EPS));

    const flags=[];
    let shiftIdx=null, baseline=null, loss=0, lossSrc=null;
    const add=(key,hit)=>{
      if(!hit)return null;
      const pf=TUNE[key]?TUNE[key].ptsF:1,reason=contextFlagInfo(policy,key,hit);
      const info=!!(hit.info||reason),pts=info?0:Math.max(1,Math.round(hit.pts*pf));
      const flag={...ALG_META[key],...hit,algoKey:key,info,pts,contextReason:reason||null};
      if(reason){
        flag.detail=String(hit.detail||'').split(/Оценка недоучёта|Недоучёт|Только за последний год недоучёт/)[0].trim();
        flag.detail+=' Контекст: '+reason+' Баллы и оценка недоучёта по этому сигналу не начисляются.';
        delete flag.loss;
      }
      flags.push(flag);
      if(!info&&hit.shiftIdx!=null&&shiftIdx==null){shiftIdx=hit.shiftIdx;baseline=hit.base;}
      if(!info&&hit.loss&&hit.loss>loss){loss=hit.loss;lossSrc={key,base:hit.base,shiftIdx:hit.shiftIdx,endIdx:hit.endIdx,dBase:hit.dBase,expected:hit.expected||null};}
      // Справочный флаг не блокирует другие независимые алгоритмы.
      return info?null:hit;
    };
    const dayHits=[]; // «подозрительные» сутки от D1/D2/D3 — для суточной раскладки недоучёта
    let irregular=false, dormantIdx=0, peaks=null;

    if(!isDead && known.length){
      const s1=ALG_OFF.sleeper?null:algSleeper(m.values,months);
      add('sleeper',s1);
      const winterFlag=!ctxOn||policy.seasonMode==='winter';
      const s2hit=ALG_OFF.ragged?null:algRagged(v,months,winterFlag,gs);
      irregular=!!(s2hit&&s2hit.irregular);
      const s2=add('ragged',s2hit);
      if(irregular){
        // v5.0: нерегулярный съём — помесячные уровни недостоверны, ступени/провалы/нули не оцениваются
        if(!ALG_OFF.frozen) add('frozen',algFrozen(v));
        if(!ALG_OFF.round) add('round',algRound(v));
        if(!ALG_OFF.peers) add('peers',algBelowPeers(v,gs));
        if(!ALG_OFF.idle) add('idle',algIdlePower(v,m.power));
        quality.push({code:'Q8',title:'Нерегулярный съём показаний',detail:'Нули чередуются со всплесками, но годовой объём сохраняется. Ступени, провалы, нули и синхронность с небалансом по такому ряду не оцениваются: помесячные уровни отражают график съёма, а не нагрузку. Нужны контрольные показания и график передачи.'});
      } else {
        // v5.3: «спящее» начало ряда (дом ещё не жилой) не входит в базу признаков-уровней
        const dorm=dormantPrefix(v), vL=dorm>0 ? v.map((x,i)=>i<dorm?null:x) : v;
        if(dorm>0) dormantIdx=dorm;
        const s3=add('step',ALG_OFF.step?null:algStepDrop(vL,months,gs.medByMonth,gs.cnt));
        if(!s2&&(!s3||s3.pts<=22)&&!ALG_OFF.valley) add('valley',algValley(vL,months,gs.medByMonth,gs.cnt));
        if(!s2&&!s3&&!ALG_OFF.fade) add('fade',algFade(vL,months,gs.medByMonth,gs.cnt));
        if(!s2&&!ALG_OFF.stepup){ add('stepup',algStepUp(v,months)); }
        if(!ALG_OFF.slow) add('slow',algSlowDecline(v,months,gs.medByMonth,gs.cnt,s3?s3.pts:0));
        if(!s2&&!s3&&!ALG_OFF.lone) add('lone',algLoneSpike(v));
        if(!ALG_OFF.zeroAlive) add('zeroAlive',algZeroAlive(vL,months,gs.medByMonth,gs,winterFlag));
        if(!ALG_OFF.frozen) add('frozen',algFrozen(v));
        if(!ALG_OFF.round) add('round',algRound(v));
        if(!ALG_OFF.peers) add('peers',algBelowPeers(vL,gs));
        if(!ALG_OFF.season) add('season',ctxOn?contextSeason(vL,months,gs,policy.seasonMode):algSeason(vL,months,gs.wsRatio));
        if(!ALG_OFF.idle) add('idle',algIdlePower(v,m.power));
        if(!ALG_OFF.imb) add('imb',algImbalance(v,imbalanceByGroup[g],months,supplyByGroupSeries[g]||null,techFloorByGroup[g]??MODE.norm));
        if(!ALG_OFF.blackout) add('blackout',algShortBlackout(v,months,gs));
        if(!ALG_OFF.repeatdip) add('repeatdip',algRepeatedDips(v,months,gs));
        if(!ALG_OFF.yearrel) add('yearrel',algYearRelativeDrop(v,months,gs));
        // v5.1: Г1 — объяснение провала (или, при «Газ = нет», довод за проверку); веса меняются после баланса
        if(!ALG_OFF.gas) add('gas',algHeatLoss(v,months,m));
        // v5.5: пики зимы и лета (для графика и карточки — у каждого ПУ) и справочный S18 по их снижению.
        // У нерегулярного съёма (Q8) пики отражают график съёма, а не нагрузку, — там их нет.
        peaks=seasonPeakSeries(vL,months,gs.medByMonth,gs.cnt,(m.corrections||[]).map(c=>c.idx).filter(i=>i!=null),
          {maxRatio:TUNE.peaks.maxRatio, minPeak:TUNE.peaks.minPeak});
        if(!ALG_OFF.peaks) add('peaks',algPeakDrop(peaks,months,{gas:flags.some(f=>f.algoKey==='gas')}));
      }
    }
    // суточные признаки — только на суточной выгрузке (в т.ч. для ПУ, у которого есть сутки, но нет ни одного полного месяца)
    if(!isDead && !irregular && days && m.daily){
      const d1=add('dzero',ALG_OFF.dzero?null:algDayZero(m.daily, gs.medByDayAlive));
      // D2 не считает дни, уже засчитанные D1 (нулевые сутки), — одно событие не должно набирать баллы дважды
      const d2=add('ddip',ALG_OFF.ddip?null:algDayDip(m.daily, d1?d1.dayIdx:null));
      const d3=add('dsync',ALG_OFF.dsync?null:algDaySync(m.daily, imbDailyByGroup[g]||null, supDailyByGroup[g]||null, days, techFloorByGroup[g]??MODE.norm));
      [d1,d2,d3].forEach(dd=>{ if(dd&&dd.dayIdx) dd.dayIdx.forEach(i=>{ if(!dayHits.includes(i)) dayHits.push(i); }); });
    }

    // v5.0: настройки проверки балансом для этого ПУ (с учётом его контекста) — сама проверка
    // делается после всех ПУ, совместно по ТП (см. «баланс как арбитр» ниже).
    const balCfg={off:!!ALG_OFF.bal || irregular, min:TUNE.bal?TUNE.bal.minSupport:0.6, pf:TUNE.bal?TUNE.bal.ptsF:1,
      infoReason:contextFlagInfo(policy,'bal',{}), lossKey:lossSrc?lossSrc.key:null};
    if(baseline==null) baseline=median(known.filter(x=>x>EPS));

    let winterZeros=0;
    v.forEach((x,i)=>{ if(x!=null&&x<=EPS&&isWinter(months[i])) winterZeros++; });
    let lossR=Math.round(loss);

    // помесячная оценка недоучёта (вкладка «Баланс»): строится в окне ТОГО
    // алгоритма, который дал итоговую оценку lossKwh (S13/S1 — до точки перелома,
    // S3 — после, S3б — внутри провала), и нормируется к lossKwh
    let deficitSeries=null, balanceDeficit=null;
    if(lossR>0){
      let raw=null;
      if(lossSrc && lossSrc.base>0 && lossSrc.shiftIdx!=null){
        const lk=lossSrc.key, lb=lossSrc.base, lt=lossSrc.shiftIdx, le=lossSrc.endIdx, ex=lossSrc.expected;
        const inWin=i=> lk==='valley' ? (i>=lt && (le==null||i<le))
                     : lk==='step' ? i>=lt
                     : (lk==='stepup'||lk==='sleeper') ? i<lt : true;
        // v5.0: ожидаемый уровень учитывает сезон месяца (если признак его посчитал)
        raw=v.map((x,i)=>(x!=null&&inWin(i))?Math.max(0,(ex?ex[i]:lb)-x):0);
      }
      if(!raw && baseline!=null && baseline>0){
        raw=v.map(x=>x!=null?Math.max(0,baseline-x):0);
      }
      if(raw){
        const rs=raw.reduce((a,b)=>a+b,0);
        if(rs>0){ const k=lossR/rs; deficitSeries=raw.map(x=>x*k); }
      }
      // для проверки балансом у ПУ с накопленными съёмами недостача считается по разложенному ряду,
      // тому же, что входит в баланс ТП
      const sm=balanceSeriesOf.get(m);
      if(sm && deficitSeries){
        const lb=(lossSrc&&lossSrc.base>0)?lossSrc.base:baseline;
        if(lb>0){ const rb=sm.map((x,i)=>(x!=null&&i>=history.start)?Math.max(0,lb-x):0), sb=rb.reduce((a,c)=>a+c,0); if(sb>0) balanceDeficit=rb.map(x=>x*lossR/sb); }
      }
    }

    const band = powerBand(m.power, m.voltage);
    let capClippedKwh = 0;
    // суточная НАТИВНАЯ оценка: источник итоговой оценки — суточный признак (D1–D3)
    // либо месячной раскладки нет вовсе (короткая выгрузка). Недостача до суточной
    // базы в подозрительные дни, нормирована к lossKwh, срезана суточным потолком мощности,
    // месячный ряд — суммы по дням.
    let dailyDeficit=null, dailyNative=false, deficitPartial=0;
    // суточная база ПУ — та же формула, что в D1–D3 и тепловой карте (медиана активных суток)
    const dBase = (days && m.daily) ? ((lossSrc&&lossSrc.dBase>0)?lossSrc.dBase:(median(m.daily.filter(x=>x!=null&&x>EPS_D))||null)) : null;
    if(days && m.daily && lossR>0 && ((lossSrc && /^d/.test(lossSrc.key)) || (!deficitSeries && dayHits.length))){
      const dv=m.daily;
      const hit=new Set(dayHits);
      let raw=dv.map((x,i)=>(x!=null && (hit.size?hit.has(i):true))?Math.max(0,(dBase||0)-x):0);
      let rs=raw.reduce((a,b)=>a+b,0);
      if(rs>0){
        const k=lossR/rs;
        dailyDeficit=raw.map(x=>x*k);
        if(band&&band.capKw>0){
          let clipped=0;
          dailyDeficit=dailyDeficit.map((x,i)=>{ const c=Math.min(x, Math.max(0, band.capKw*24-(dv[i]!=null?dv[i]:0))); clipped+=x-c; return c; });
          if(clipped>0.5) capClippedKwh=Math.round(clipped);
        }
        deficitSeries=months.map((_,mi)=>monthDays[mi].reduce((s,i)=>s+dailyDeficit[i],0));
        lossR=Math.round(dailyDeficit.reduce((a,b)=>a+b,0));
        // lossR — по всем дням выгрузки, deficitSeries — только по дням полных месяцев (Σ ≤ lossR)
        deficitPartial=Math.round(lossR-deficitSeries.reduce((a,b)=>a+b,0));
        dailyNative=true;
      }
    }

    // потолок по разрешённой мощности (реестр диапазонов техприсоединения):
    // максимально возможный объём месяца = верхняя граница диапазона × 730 ч;
    // недоучёт месяца не может превышать этот объём минус оплаченное (факт по ПУ)
    if(!dailyNative && band && band.capKw>0 && lossR>0){
      const capMonth = i => Math.max(0, band.capKw*HOURS_MONTH - (v[i]!=null?v[i]:0));
      if(deficitSeries){
        let clipped=0;
        deficitSeries = deficitSeries.map((x,i)=>{
          const c=Math.min(x, capMonth(i));
          clipped += x-c;
          return c;
        });
        if(clipped>0.5){
          capClippedKwh = Math.round(clipped);
          lossR = Math.round(deficitSeries.reduce((a,b)=>a+b,0));
        }
      } else {
        // ряда нет — ограничиваем итог суммой потолков по известным месяцам
        const capSum = v.reduce((a,x,i)=>a+(x!=null?capMonth(i):0),0);
        if(lossR>capSum){ capClippedKwh = Math.round(lossR-capSum); lossR = Math.round(capSum); }
      }
    }

    // суточная раскладка недоучёта (для суточного баланса): месячный объём
    // распределяется по дням месяца пропорционально суточной «недостаче»
    // max(0, база/сут − факт), при её отсутствии — поровну; сверху — суточный потолок мощности
    if(!dailyNative && days && deficitSeries && m.daily){
      dailyDeficit=days.map(()=>0);
      const dv=m.daily;
      const baseM=(lossSrc&&lossSrc.base>0)?lossSrc.base:baseline;
      months.forEach((mm,mi)=>{
        const D=deficitSeries[mi]; if(!(D>0)) return;
        const idxs=monthDays[mi]; const dim=daysInMonth(mm.y,mm.m);
        const bd=(baseM!=null&&baseM>0)?baseM/dim:null;
        let w=idxs.map(i=>{ const x=dv[i]; if(x==null) return 0; return bd!=null?Math.max(0,bd-x):1; });
        let ws=w.reduce((a,b)=>a+b,0);
        if(ws<=0){ w=idxs.map(i=>dv[i]!=null?1:0); ws=w.reduce((a,b)=>a+b,0); }
        if(ws<=0) return;
        idxs.forEach((i,k)=>{ dailyDeficit[i]=D*w[k]/ws; });
      });
      if(band&&band.capKw>0) dailyDeficit=dailyDeficit.map((x,i)=>Math.min(x, Math.max(0, band.capKw*24-(dv[i]!=null?dv[i]:0))));
    }

    const needsDataCond = policy.active&&(flags.some(f=>f.contextReason)||policy.coverage!=null&&policy.coverage<0.8||['lt30','lt50'].includes(policy.c.poll)||policy.c.source==='billing');
    return {meter:m, isDead, winterZeros, needsDataCond, policy:policySnapshot(policy), flags, quality, score:0, shiftIdx, baseline, total:Math.round(total),
      dormantIdx, peaks, deficitSeries, balanceDeficit, dailyDeficit, deficitPartial, dBase, band, capClippedKwh, balCfg, balanceTest:null, irregular,
      lossKwh:lossR, lossProfileKwh:lossR, balanceChecked:false, balanceFactor:1,
      groupMedByMonth:gs.medByMonth, groupMedByDay:(gs.medByDayAlive||gs.medByDay)||null, groupLabel:gs.label||null};
    } finally { TUNE=manualTune;ALG_OFF=manualOff; }
  });

  const dayMonth = monthDays ? (()=>{ const a=new Array(days.length).fill(-1); monthDays.forEach((ix,mi)=>ix.forEach(i=>{a[i]=mi;})); return a; })() : null;
  const scaleLoss=(r,k)=>{ // умножить оценку и её раскладку по месяцам/суткам на k
    if(r.deficitSeries) r.deficitSeries=r.deficitSeries.map(x=>x*k);
    if(r.dailyDeficit) r.dailyDeficit=r.dailyDeficit.map(x=>x*k);
    r.deficitPartial=Math.round((r.deficitPartial||0)*k);
    r.lossKwh=Math.round(r.lossKwh*k);
  };

  // v5.0: «БАЛАНС КАК АРБИТР». Небаланс ТП по месяцам раскладывается на технические потери
  // (a + b·отпуск + c·отпуск²) и вклады гипотез недоучёта отдельных ПУ: I(t) ≈ потери(t) + Σ k_j·d_j(t),
  // где d_j — помесячная недостача ПУ по его гипотезе, а k_j ∈ [0;1] — доля, которую подтверждает
  // баланс. Все гипотезы ТП оцениваются совместно, поэтому одновременные события не путаются.
  // k ≥ порога → признак Б1 (+12); k ≤ 0,15 → баллы описаний этого изменения снижаются
  // (ввод ТП изменился вместе с ПУ — похоже на реальное изменение потребления); оценка объёма × k.
  for(const b of tpBalance){
    const set=new Set(groups[b.key]||meters);
    const inTp=results.filter(r=>set.has(r.meter));
    inTp.forEach(r=>{ r.balanceChecked=true; });
    const cands=inTp.filter(r=>r.lossKwh>0 && r.deficitSeries && !r.balCfg.off)
      .sort((a,c)=>c.lossKwh-a.lossKwh);
    const known=b.series.filter(x=>x!=null).length;
    const maxC=Math.max(0, Math.min(25, Math.floor((known-4)/2)));
    const fit=balanceRegression(b.series, b.supplySeries, cands.slice(0,maxC).map(r=>r.balanceDeficit||r.deficitSeries));
    if(!fit) continue;
    b.techFit=fit.tech;
    cands.slice(0,maxC).forEach((r,j)=>{
      const est=fit.items[j]; r.balanceTest=est;
      const lossFlag=r.flags.find(f=>f.algoKey===r.balCfg.lossKey);
      if(!lossFlag) return;
      // решение — по интервалу k ± 1,5·погрешность: подтверждено, если k не ниже порога и заметно больше 0;
      // не подтверждено, если k ≤ 0,2 и верхняя граница ниже 0,75
      const k=Math.max(0, Math.min(1, est.k)), kPct=fmt(k*100), seTxt=' ±'+fmt(est.se*100);
      const confirmed = est.k>=r.balCfg.min && est.k-1.5*est.se>=0.25;
      const refuted = est.k<=0.2 && est.k+1.5*est.se<=0.75;
      if(!confirmed && !refuted && est.se>0.35){
        lossFlag.detail+=' Баланс ТП: вклад этого ПУ в небаланс выделить нельзя (мало данных, постоянная с начала ряда недостача или совпадение по времени с другими изменениями).';
        return;
      }
      const fam = DIP_FAMILY.has(lossFlag.code) ? r.flags.filter(f=>!f.info && f.pts>0 && DIP_FAMILY.has(f.code)) : [lossFlag];
      if(confirmed){
        const info=!!r.balCfg.infoReason;
        r.flags.push({...ALG_META.bal, algoKey:'bal', info, contextReason:r.balCfg.infoReason||null,
          pts: info?0:Math.max(1,Math.round(12*r.balCfg.pf)),
          detail:`Баланс ТП подтверждает ${lossFlag.code}: в небалансе ввода видно ≈${kPct}% предполагаемой недостачи этого ПУ (оценено совместно с другими ПУ и техпотерями ТП). Энергия шла через ввод ТП, но не через этот ПУ.`+(info?' Контекст: '+r.balCfg.infoReason+' Баллы не начисляются.':'')});
        lossFlag.detail+=` Баланс ТП: подтверждено (≈${kPct}${seTxt}%).`;
      } else if(refuted){
        const f0=0.3+k;
        for(const f of fam){ f.rawPts=f.rawPts??f.pts; f.pts=Math.max(1,Math.round(f.pts*f0)); }
        lossFlag.detail+=` Баланс ТП не подтверждает: в небалансе ввода видно лишь ≈${kPct}${seTxt}% предполагаемой недостачи — ввод ТП изменился вместе с ПУ, это похоже на реальное изменение потребления. Баллы описаний этого изменения снижены ×${fmt(f0,2)}.`;
      } else {
        lossFlag.detail+=` Баланс ТП подтверждает частично: в небалансе видно ≈${kPct}${seTxt}% предполагаемой недостачи.`;
      }
      if(est.se<=0.35) scaleLoss(r,k);
    });
  }

  // v5.1: Г1 «исчезла отопительная нагрузка». Провалы S3/S17, начавшиеся с последней зимы с отоплением
  // (S4 и S14 — всегда: они сравнивают с базой, в которой было отопление), объясняются сменой источника
  // тепла: их баллы и оценка недоучёта ×0,5 (×0,25, если по файлу газ подключён примерно тогда же).
  // Не снижаются, если баланс ТП подтвердил недостачу (Б1: энергия по-прежнему идёт через ввод ТП)
  // и если по файлу газа нет — тогда Г1 сам даёт баллы.
  const heatStats={n:0, reduced:0, gasYes:0, gasNo:0, byBalance:0};
  for(const r of results){
    const g1=r.flags.find(f=>f.algoKey==='gas'); if(!g1 || !g1.heat) continue;
    const m=r.meter, H=g1.heat, lo=H.from-3, hi=H.to+14;
    heatStats.n++;
    const explained=r.flags.filter(f=>!f.info && f.pts>0 && HEAT_EXPLAINS.has(f.code) && (f.code==='S4' || f.code==='S14' ||
      (s=>s!=null && s>=lo && s<=hi)(f.code==='S17'?f.eventStart:f.shiftIdx)));
    if(!explained.length) continue;
    const codes=explained.map(f=>f.code).join(', ');
    if(m.gas===false){ heatStats.gasNo++; g1.detail+=` Баллы ${codes} не снижаются.`; continue; }
    if(!H.full){ g1.detail+=` После перехода видна только неполная зима — баллы ${codes} пока не снижены.`; continue; }
    if(r.flags.some(f=>f.algoKey==='bal')){ heatStats.byBalance++; g1.detail+=` Но баланс ТП подтверждает недостачу (Б1): энергия по-прежнему проходит через ввод ТП — версия со сменой отопления маловероятна, баллы ${codes} не снижены.`; continue; }
    let k=GAS_FACTOR, why='вероятна смена источника тепла';
    if(m.gas===true){
      const gd=m.gasDate, gi=gd?gd.y*12+gd.m:null, a0=months[H.hot].y*12+months[H.hot].m, b0=months[H.to].y*12+months[H.to].m;
      if(gi==null || (gi>=a0-12 && gi<=b0+12)){ k=GAS_FACTOR/2; why='по файлу газ подключён'+(gd?' ('+gasDateLabel(gd)+')':''); heatStats.gasYes++; }
      else why='по файлу газ подключён, но дата ('+gasDateLabel(gd)+') далека от исчезновения отопления';
    }
    for(const f of explained){
      f.rawPts=f.rawPts??f.pts; f.pts=Math.max(1,Math.round(f.pts*k));
      f.scoreNote=(f.scoreNote?f.scoreNote+' ':'')+'Вес ×'+fmt(k,2)+': провал совпадает с исчезновением отопительной нагрузки (Г1) — '+why+'.';
    }
    const lossFlag=r.flags.find(f=>f.algoKey===r.balCfg.lossKey), lossToo=!!(lossFlag && explained.includes(lossFlag) && r.lossKwh>0);
    if(lossToo) scaleLoss(r,k);
    g1.detail+=` Баллы ${codes} снижены ×${fmt(k,2)}${lossToo?', оценка недоучёта — тоже':''} (${why}).`;
    g1.heatFactor=k; heatStats.reduced++;
  }

  // v5.0: предохранитель. Сумма оценок по ТП за месяц не может превышать СВЕРХФОНОВЫЙ небаланс
  // этого месяца (небаланс − min(норматив, фоновые потери ТП) × отпуск): похищенная энергия проходит
  // через учёт ввода. Превышение делится пропорционально оценкам; месяцы без данных ввода — по
  // среднему коэффициенту ТП. Для ТП без строки «Отпуск в сеть» оценки остаются «по профилю».
  for(const b of tpBalance){
    const set=new Set(groups[b.key]||meters);
    const inTp=results.filter(r=>set.has(r.meter));
    const rs=inTp.filter(r=>r.lossKwh>0);
    const floor=b.techFloor!=null ? b.techFloor : MODE.norm;
    // если баланс разложен моделью — сверх её технических потерь, иначе — сверх min(норматив, фон)
    const E=months.map((_,i)=>(b.series[i]!=null && b.supplySeries[i]!=null)
      ? Math.max(0, b.series[i]-(b.techFit && b.techFit[i]!=null ? b.techFit[i] : floor*b.supplySeries[i])) : null);
    const D=months.map((_,i)=>rs.reduce((s,r)=>s+((r.deficitSeries&&r.deficitSeries[i])||0),0));
    let sumE=0, sumD=0;
    months.forEach((_,i)=>{ if(E[i]!=null){ sumE+=E[i]; sumD+=D[i]; } });
    const F = sumD>0 ? Math.min(1, sumE/sumD) : 1;
    const f = months.map((_,i)=>E[i]==null ? F : (D[i]>0 ? Math.min(1, E[i]/D[i]) : 1));
    let before=0, after=0;
    for(const r of rs){
      before+=r.lossKwh;
      if(r.deficitSeries){
        if(r.dailyDeficit && dayMonth){
          r.dailyDeficit=r.dailyDeficit.map((x,i)=>x*(dayMonth[i]>=0 ? f[dayMonth[i]] : F));
          r.deficitSeries=months.map((_,mi)=>monthDays[mi].reduce((s,i)=>s+r.dailyDeficit[i],0));
          const inMonths=r.deficitSeries.reduce((a,c)=>a+c,0), all=r.dailyDeficit.reduce((a,c)=>a+c,0);
          r.deficitPartial=Math.round(all-inMonths);
          r.lossKwh=Math.round(all);
        } else {
          r.deficitSeries=r.deficitSeries.map((x,i)=>x*f[i]);
          r.lossKwh=Math.round(r.deficitSeries.reduce((a,c)=>a+c,0)+(r.deficitPartial||0)*F);
        }
      } else r.lossKwh=Math.round(r.lossKwh*F);
      r.balanceFactor = r.lossProfileKwh>0 ? r.lossKwh/r.lossProfileKwh : 1;
      after+=r.lossKwh;
    }
    b.reconcile={excess:Math.round(sumE), estimatedBefore:before, estimatedAfter:after, factor:F, floor,
      profile:inTp.reduce((x,r)=>x+(r.lossProfileKwh||0),0)};
  }

  // Финальная классификация. v5.0: зона — по баллам доказательств (или по объёму в режиме «по объёму»);
  // бусты меняют только порядок внутри зоны.
  for(const r of results){
    const m=r.meter;
    limitDependentFlags(r.flags);
    let score=Math.min(100,Math.round(r.flags.reduce((s,f)=>s+f.pts,0)));
    if(r.flags.some(f=>!f.info) && r.flags.filter(f=>!f.info).every(f=>f.weak)) score=Math.min(score,15);
    r.score=score;
    r.lossRub = tariff ? Math.round(r.lossKwh*tariff) : null;
    const boosts=[];
    if(!r.isDead){
      const ctx={ctype:m.ctype, power:m.power, dup:m.dup, lossKwh:r.lossKwh, winterZeros:r.winterZeros, shiftIdx:r.shiftIdx};
      for(const b of BOOST_DEFS) if(BOOSTS_ON[b.id] && b.test(ctx)) boosts.push({id:b.id, label:b.label, pts:b.pts});
    }
    r.boosts=boosts;
    r.boostPts=boosts.reduce((s,b)=>s+b.pts,0);
    r.priority=r.score+r.boostPts;
    r.cls = r.isDead?'dead'
      : MODE.zone==='loss' ? (r.lossKwh>=MODE.lossRed?'red' : r.lossKwh>=MODE.lossAmber?'amber' : 'green')
      : r.score>=CLS.red?'red' : r.score>=CLS.amber?'amber' : 'green';
    r.needsData = r.cls==='green' && r.needsDataCond;
  }

  results.sort((a,b)=>{
    const o={red:0,amber:1,green:2,dead:3};
    if(MODE.zone==='loss') return o[a.cls]-o[b.cls] || b.lossKwh-a.lossKwh || b.priority-a.priority;
    return o[a.cls]-o[b.cls] || b.priority-a.priority || b.lossKwh-a.lossKwh;
  });
  const hot=results.filter(r=>r.cls==='red'||r.cls==='amber');
  const totals={
    meters:meters.length,
    red:results.filter(r=>r.cls==='red').length,
    amber:results.filter(r=>r.cls==='amber').length,
    dead:results.filter(r=>r.cls==='dead').length,
    dataReview:results.filter(r=>r.needsData).length,
    // v5.0: в итог — только красная и жёлтая зоны; оценки по «зелёным» не суммируются
    lossKwh:hot.reduce((s,r)=>s+r.lossKwh,0),
    lossKwhUnchecked:hot.filter(r=>!r.balanceChecked).reduce((s,r)=>s+r.lossKwh,0),
    lossKwhProfile:hot.reduce((s,r)=>s+r.lossProfileKwh,0),
  };
  totals.lossRub = tariff?Math.round(totals.lossKwh*tariff):null;
  totals.boosted = results.filter(r=>r.boostPts>0).length;
  heatStats.hot=results.filter(r=>(r.cls==='red'||r.cls==='amber') && r.flags.some(f=>f.algoKey==='gas')).length;
  return {results, tpOverview:buildTpOverview(data,tpBalance), review:labeledMetrics(results), months, days, monthDays, gran:data.gran||'month', groupStats, tpBalance, totals, groupFallback:fallbackUsed, typeSplit:typeSplitUsed, typeFileWide, heatStats, groupScope:GROUP_SCOPE};
}

/* v5.0: полезный отпуск группы за период с учётом пропусков. Пропуск — не ноль: ПУ, у которого
   значение внутри его активного диапазона (от первого до последнего известного) не пришло,
   досчитывается типичным значением — медианой того же календарного месяца (для суток — суток этого
   месяца). Если досчитанная доля больше 10% полезного отпуска периода, период исключается из
   баланса как недостоверный (иначе пропуск выглядел бы как всплеск потерь). */
function usefulWithGaps(arr, seriesOf, periods){
  const P=periods.length, out=new Array(P).fill(null);
  const info=[];
  for(const m of arr){
    const s=seriesOf(m); if(!s) continue;
    let first=-1, last=-1;
    for(let i=0;i<P;i++) if(s[i]!=null){ if(first<0) first=i; last=i; }
    if(first<0) continue;
    const byM=new Map();
    for(let i=first;i<=last;i++){ if(s[i]==null) continue; const k=periods[i].m; if(!byM.has(k)) byM.set(k,[]); byM.get(k).push(s[i]); }
    const med=new Map([...byM].map(([k,a])=>[k,median(a)]));
    info.push({s,first,last,med,all:median(s.slice(first,last+1))});
  }
  let excluded=0, imputed=0;
  for(let i=0;i<P;i++){
    let known=0, gap=0, any=false;
    for(const x of info){
      if(i<x.first || i>x.last) continue;
      const val=x.s[i];
      if(val!=null){ known+=val; any=true; }
      else { const t=x.med.has(periods[i].m) ? x.med.get(periods[i].m) : x.all; gap+=(t||0); }
    }
    if(!any) continue;
    const tot=known+gap;
    if(gap>0 && tot>0 && gap/tot>0.10){ excluded++; continue; }
    if(gap>0) imputed++;
    out[i]=tot;
  }
  return {values:out, excluded, imputed};
}

if(typeof module!=='undefined'&&module.exports){
  module.exports={setGroupScope,algHeatLoss,parseGas,HEAT_EXPLAINS,defaultContext,normalizeContext,setAnalysisContext,compileContext,contextForMeter,parseAskue,pollCellValue,parsePollPct,pollBand,automationStats,tpEnergySummary,buildTpOverview,tpRecommendations,contextSeason,detectReadCatchups,meterPolicy,PRESET_TERRITORIES,PRESET_POLLS,PRESET_SOURCES,parseAOA, analyze, median, mean, parseMonthHeader, ymLabel, fmt, MONTHS_RU, CLS, EPS, setTune, buildTune, TUNE_DEFS, setZoneMode, MODE, setBoosts, BOOST_DEFS, setAlgOff, powerBand, POWER_BANDS, reviewLabelOf, labeledMetrics, meterHistory, shortDips, algShortBlackout, algRepeatedDips, algYearRelativeDrop, limitDependentFlags, setBalanceNorm, usefulWithGaps, balanceRegression, runningMedians, groupSeasonalFactors, seasonPeakSeries, algPeakDrop, PEAK_KINDS, peakPct, peakCmpNote, peakMonthsLabel, ALG_META, DIP_FAMILY};
}
