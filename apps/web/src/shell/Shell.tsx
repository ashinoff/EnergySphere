import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ModuleId } from '../../../api/src/core/access.js';
import { useAuth, useMe } from '../auth/AuthContext.js';
import { ADMIN_MENU, MODULES, moduleById, type MenuItem, type ModuleMeta } from '../modules/registry.js';
import { ModulePage } from '../modules/ModulePage.js';
import { AnalysisHost } from '../modules/analysis/AnalysisHost.js';
import { TP_FRAME_PAGES, TpHost, tpPageAvailable, useTpAvailable } from '../modules/tp/TpHost.js';
import { TP_ROLE_INFO } from '../modules/tp/TpRoleInfo.js';

// Страницы, которые показывает фрейм модуля (остальные — обычные страницы Сферы).
// Раздел TP, которого нет у человека (по сообщению моста), показывается страницей
// Сферы с объяснением (TpRoleInfo), а не фреймом.
const isFramePage = (module: string, page: string, tpLabels: string[] | null = null) =>
  module === 'analysis' || (module === 'tp' && TP_FRAME_PAGES.has(page) && tpPageAvailable(page, tpLabels));
import { AdminPage } from '../admin/AdminPage.js';
import { IconArrowLeft, IconArrowRight, IconLock, IconSettings } from '../ui/icons.js';
import { useToast } from '../ui/kit.js';
import { TopBar } from './TopBar.js';
import { go, useRoute, type Route } from './route.js';

function useNarrow() {
  const query = '(max-width: 900px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

const STRIP = 64;   // ширина свёрнутой полосы модуля
const SIDE = 300;   // ширина меню открытого модуля
const BAR = 132;    // высота шапки модуля на телефоне

type Mode = 'col' | 'strip' | 'side' | 'hidden';
interface Slot { mode: Mode; style: CSSProperties }

// Раскладка панелей. Анимация — CSS-переходы left/top/width/height:
// колонки дашборда сужаются в полосы слева, выбранная становится меню модуля.
function layout(route: Route, allowed: ModuleMeta[], narrow: boolean) {
  const slots = new Map<string, Slot>();
  const activeId = route.view === 'module' ? route.id : route.view === 'admin' ? 'admin' : null;
  const others = allowed.filter(m => m.id !== activeId);
  const stripsWidth = narrow ? 0 : others.length * STRIP;

  MODULES.forEach((m, i) => {
    if (!activeId) {
      slots.set(m.id, narrow
        ? { mode: 'col', style: { left: 0, width: '100%', top: `${i * 25}%`, height: '25%' } }
        : { mode: 'col', style: { left: `${i * 25}%`, width: '25%', top: 0, height: '100%' } });
      return;
    }
    if (m.id === activeId) {
      slots.set(m.id, { mode: 'side', style: narrow
        ? { left: 0, width: '100%', top: 0, height: BAR }
        : { left: stripsWidth, width: SIDE, top: 0, height: '100%' } });
      return;
    }
    const k = others.indexOf(m);
    if (k < 0 || narrow) {
      slots.set(m.id, { mode: 'hidden', style: narrow ? { left: 0, width: '100%', top: 0, height: 0 } : { left: 0, width: 0, top: 0, height: '100%' } });
      return;
    }
    slots.set(m.id, { mode: 'strip', style: { left: k * STRIP, width: STRIP, top: 0, height: '100%' } });
  });

  slots.set('admin', activeId === 'admin'
    ? { mode: 'side', style: narrow ? { left: 0, width: '100%', top: 0, height: BAR } : { left: stripsWidth, width: SIDE, top: 0, height: '100%' } }
    : { mode: 'hidden', style: narrow ? { left: 0, width: '100%', top: 0, height: 0 } : { left: stripsWidth, width: 0, top: 0, height: '100%' } });

  const content: CSSProperties = narrow ? { left: 0, top: BAR } : { left: stripsWidth + SIDE, top: 0 };
  return { slots, content, activeId };
}

export function Shell() {
  const me = useMe();
  const { can } = useAuth();
  const toast = useToast();
  const route = useRoute();
  const narrow = useNarrow();
  const [hover, setHover] = useState<ModuleId | null>(null);

  const allowed = useMemo(() => MODULES.filter(m => can(m.view)), [can]);
  const adminMenu = ADMIN_MENU.filter(i => !i.perm || can(i.perm));

  // Нет доступа к разделу по адресу — на дашборд.
  const effective: Route =
    route.view === 'module' && !can(moduleById(route.id)!.view) ? { view: 'home' }
      : route.view === 'admin' && !adminMenu.length ? { view: 'home' }
        : route.view === 'admin' && !adminMenu.some(i => i.id === route.page) ? { view: 'admin', page: adminMenu[0].id }
          : route;

  const { slots, content, activeId } = layout(effective, allowed, narrow);
  const activeModule = effective.view === 'module' ? moduleById(effective.id)! : null;
  const accent = activeModule
    ? { '--tint': activeModule.tint, '--accent': activeModule.accent, '--accent-strong': activeModule.strong } as CSSProperties
    : { '--tint': '#2b3038', '--accent': '#d9dde4', '--accent-strong': '#23272e' } as CSSProperties;

  // Возврат в модуль (с дашборда или из полосы) — на тот раздел, где был.
  const lastPages = useRef<Record<string, string>>({});
  if (effective.view === 'module') lastPages.current[effective.id] = effective.page;
  const open = (m: ModuleMeta) => {
    if (!can(m.view)) { toast('Нет доступа к разделу. Обратитесь к администратору.', 'error'); return; }
    go({ view: 'module', id: m.id, page: lastPages.current[m.id] ?? m.menu[0].id });
  };

  // Пункты «Актов ТП» — ещё и по разделам, которые есть у человека в самом TP.
  const tpAvailable = useTpAvailable();
  const visibleMenu = (items: MenuItem[], view?: string) => items.filter(i =>
    (!i.perm || i.perm === view || can(i.perm)) && (view !== 'tp.view' || tpPageAvailable(i.id, tpAvailable) || i.id in TP_ROLE_INFO));

  // Модули-фреймы (анализатор, акты ТП) создаются при первом открытии и дальше
  // не пересоздаются: загруженный файл и состояние переживают переходы по разделам.
  const framePage = effective.view === 'module' && isFramePage(effective.id, effective.page, tpAvailable) ? effective : null;
  const [framesSeen, setFramesSeen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (framePage && !framesSeen[framePage.id]) setFramesSeen(seen => ({ ...seen, [framePage.id]: true }));
  }, [framePage, framesSeen]);
  // Последний раздел фрейма — отдельно от «последней страницы модуля»: уход на
  // обычную страницу модуля (например, «Создание акта по ТУ») не двигает фрейм.
  const lastFramePages = useRef<Record<string, string>>({});
  if (framePage) lastFramePages.current[framePage.id] = framePage.page;
  const frameItem = (id: ModuleId) => {
    const m = moduleById(id)!;
    const pageId = lastFramePages.current[id];
    return m.menu.find(i => i.id === pageId && isFramePage(id, i.id, tpAvailable)) ?? m.menu.find(i => isFramePage(id, i.id, tpAvailable)) ?? m.menu[0];
  };

  return (
    <div className="app">
      <TopBar me={me} active={activeModule?.id ?? null} hover={hover} canAdmin={adminMenu.length > 0} />
      <main className={`stage ${activeId ? 'stage--open' : 'stage--home'} ${narrow ? 'stage--narrow' : ''}`} style={accent}>
        {MODULES.map(m => {
          const slot = slots.get(m.id)!;
          const locked = !can(m.view);
          const page = effective.view === 'module' && effective.id === m.id ? effective.page : '';
          return (
            <section key={m.id} className={`panel panel--${slot.mode} ${locked ? 'is-locked' : ''}`}
              style={{ ...slot.style, '--tint': m.tint, '--accent': m.accent, '--accent-strong': m.strong } as CSSProperties}
              aria-hidden={slot.mode === 'hidden'}>
              <img className="panel__img" src={m.image} alt="" draggable={false} />

              <button type="button" className="panel__col" tabIndex={slot.mode === 'col' ? 0 : -1}
                onClick={() => open(m)} onMouseEnter={() => setHover(m.id)} onMouseLeave={() => setHover(null)}>
                <span className="panel__num">{m.num}<i />{m.icon}</span>
                <span className="panel__title">{m.title}</span>
                <span className="panel__subtitle">{m.subtitle}</span>
                <span className="panel__open">
                  {locked ? <><IconLock size={18} /> Нет доступа</> : <>Открыть раздел <IconArrowRight size={26} /></>}
                </span>
              </button>

              <button type="button" className="panel__strip" tabIndex={slot.mode === 'strip' ? 0 : -1}
                onClick={() => open(m)} title={m.title}>
                <span>{m.title}</span>
              </button>

              <div className="panel__side">
                <button type="button" className="side__back" onClick={() => go({ view: 'home' })} tabIndex={slot.mode === 'side' ? 0 : -1}>
                  <IconArrowLeft size={18} /> Все разделы
                </button>
                <h2 className="side__title">{m.title}</h2>
                <nav className="side__menu" aria-label={m.title}>
                  {visibleMenu(m.menu, m.view).map(item => (
                    <button key={item.id} type="button" tabIndex={slot.mode === 'side' ? 0 : -1}
                      className={`side__item ${page === item.id ? 'is-active' : ''}`}
                      onClick={() => go({ view: 'module', id: m.id, page: item.id })}>
                      {item.icon}<span>{item.title}</span>
                    </button>
                  ))}
                </nav>
                <footer className="side__foot">Рабочее пространство{me.allRes ? ' · все РЭС' : me.res ? ` · ${me.res.name}` : ''}</footer>
              </div>
            </section>
          );
        })}

        <section className={`panel panel--admin panel--${slots.get('admin')!.mode}`} style={slots.get('admin')!.style}>
          <div className="panel__side">
            <button type="button" className="side__back" onClick={() => go({ view: 'home' })}>
              <IconArrowLeft size={18} /> Все разделы
            </button>
            <span className="side__badge"><IconSettings size={34} /></span>
            <h2 className="side__title">Администри&shy;рование</h2>
            <nav className="side__menu" aria-label="Администрирование">
              {adminMenu.map(item => (
                <button key={item.id} type="button"
                  className={`side__item ${effective.view === 'admin' && effective.page === item.id ? 'is-active' : ''}`}
                  onClick={() => go({ view: 'admin', page: item.id })}>
                  {item.icon}<span>{item.title}</span>
                </button>
              ))}
            </nav>
            <footer className="side__foot">Доступы и справочники</footer>
          </div>
        </section>

        <div className={`content ${framePage ? 'content--frame' : ''}`} style={content}>
          {framesSeen.analysis && (
            <AnalysisHost module={moduleById('analysis')!} visible={framePage?.id === 'analysis'} page={frameItem('analysis')} />
          )}
          {framesSeen.tp && <TpHost key={me.id} module={moduleById('tp')!} visible={framePage?.id === 'tp'} page={frameItem('tp')} />}
          {effective.view === 'module' && activeModule && !framePage && (
            <div className="content__inner" key={`${effective.id}/${effective.page}`}>
              <ModulePage module={activeModule} page={visibleMenu(activeModule.menu, activeModule.view).find(i => i.id === effective.page)
                ?? activeModule.menu[0]} />
            </div>
          )}
          {effective.view === 'admin' && (
            <div className="content__inner" key={`admin/${effective.page}`}>
              <AdminPage page={effective.page} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
