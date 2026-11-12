// Единый набор элементов интерфейса. Все модули строятся ТОЛЬКО из него —
// так кнопки, поля и карточки везде одного размера и стиля. Цвет модуля
// приходит через CSS-переменные --accent / --accent-strong (shell.css).
import {
  createContext, useCallback, useContext, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({ variant = 'secondary', icon, children, className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: ReactNode }) {
  return (
    <button type="button" className={`btn btn--${variant} ${icon && !children ? 'btn--icon-only' : ''} ${className}`} {...rest}>
      {icon && <span className="btn__icon">{icon}</span>}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => <input className="input" {...props} />;

export const TextArea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className="input textarea" rows={2} {...props} />;

export const Select = ({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <span className="select"><select {...props}>{children}</select></span>
);

export function Card({ title, aside, children, className = '' }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || aside) && <header className="card__head">{title && <h2 className="card__title">{title}</h2>}{aside}</header>}
      {children}
    </section>
  );
}

export function PageHeader({ crumbs, title, subtitle, actions }: { crumbs: string[]; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <nav className="crumbs" aria-label="Путь">
        {crumbs.map((c, i) => <span key={i} className={i === crumbs.length - 1 ? 'crumbs__current' : ''}>{c}</span>)}
      </nav>
      <div className="page-head__row">
        <div>
          <h1 className="page-head__title">{title}</h1>
          {subtitle && <p className="page-head__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-head__actions">{actions}</div>}
      </div>
    </header>
  );
}

export function Progress({ value, total }: { value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return <span className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></span>;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'accent' | 'warn' | 'danger' | 'ok'; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Empty({ image, title, text, action }: { image?: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {image && <img className="empty__img" src={image} alt="" />}
      <h3 className="empty__title">{title}</h3>
      {text && <p className="empty__text">{text}</p>}
      {action}
    </div>
  );
}

export function Checkbox({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange?: (v: boolean) => void; label?: string }) {
  return (
    <label className={`check ${disabled ? 'is-disabled' : ''}`} title={label}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange?.(e.target.checked)} aria-label={label} />
      <span className="check__box" />
    </label>
  );
}

export function Switch({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} title={label} disabled={disabled}
      className={`switch ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="switch__knob" />
    </button>
  );
}

// ── Всплывающие сообщения (без модальных окон) ─────────────────────────
type Toast = { id: number; text: string; tone: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = ++seq.current;
    setItems(list => [...list.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems(list => list.filter(t => t.id !== id)), tone === 'error' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map(t => <div key={t.id} className={`toast toast--${t.tone}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
