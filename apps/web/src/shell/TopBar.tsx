import { useEffect, useRef, useState } from 'react';
import type { ModuleId } from '../../../api/src/core/access.js';
import type { Me } from '../auth/AuthContext.js';
import { logout } from '../auth/session.js';
import { IconBell, IconLogout, IconSettings, IconUser } from '../ui/icons.js';
import { SphereLogo } from './SphereLogo.js';
import { go } from './route.js';

export function TopBar({ me, active, hover, canAdmin }: { me: Me; active: ModuleId | null; hover: ModuleId | null; canAdmin: boolean }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [menu]);

  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={() => go({ view: 'home' })} aria-label="ЭнергоСфера — на главную">
        <SphereLogo active={active} hover={hover} />
        <span className="brand__name">ЭнергоСфера</span>
      </button>
      <div className="topbar__right">
        <span className="topbar__org">Сочинские электрические сети</span>
        <span className="topbar__sep" />
        <button type="button" className="icon-btn" aria-label="Уведомления" title="Уведомления"><IconBell size={24} /></button>
        <div className="usermenu" ref={ref}>
          <button type="button" className="icon-btn icon-btn--ring" aria-label="Профиль" aria-expanded={menu} onClick={() => setMenu(v => !v)}>
            <IconUser size={22} />
          </button>
          {menu && (
            <div className="usermenu__pop" role="menu">
              <div className="usermenu__who">
                <strong>{me.fullName || me.username}</strong>
                <span>{me.roleTitle}{me.res ? ` · ${me.res.name}` : me.allRes ? ' · все РЭС' : ''}</span>
              </div>
              {canAdmin && (
                <button type="button" role="menuitem" className="usermenu__item" onClick={() => { setMenu(false); go({ view: 'admin', page: '' }); }}>
                  <IconSettings size={18} /> Администрирование
                </button>
              )}
              <button type="button" role="menuitem" className="usermenu__item" onClick={logout}>
                <IconLogout size={18} /> Выйти
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
