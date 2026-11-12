import { useRef } from 'react';
import type { ModuleId } from '../../../api/src/core/access.js';

// Логотип-сфера из четырёх лепестков: каждый лепесток — свой модуль (по
// часовой стрелке от левого верхнего: анализ, поиск, РИРУ, акты ТП).
// При выборе модуля сфера поворачивается так, чтобы его лепесток встал в
// левый верхний угол, остальные приглушаются. Поворот — всегда кратчайшим путём.
const ORDER: ModuleId[] = ['analysis', 'consumers', 'riru', 'tp'];

export function SphereLogo({ active, hover, size = 36 }: { active: ModuleId | null; hover?: ModuleId | null; size?: number }) {
  const angle = useRef(0);
  if (active) {
    const target = -90 * ORDER.indexOf(active);
    let delta = (target - angle.current) % 360;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    angle.current += delta;
  }
  const lit = active ?? hover ?? null;
  return (
    <span className="sphere" style={{ width: size, height: size }} aria-hidden="true">
      <span className="sphere__spin" style={{ transform: `rotate(${angle.current}deg)` }}>
        {ORDER.map(id => (
          <img key={id} src={`/img/petal-${id}.png`} alt="" draggable={false}
            className={`sphere__petal ${lit && lit !== id ? 'is-dim' : ''}`} />
        ))}
      </span>
    </span>
  );
}
