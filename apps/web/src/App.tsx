import { useState, type FormEvent } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext.js';
import { EMBEDDED, login, logout } from './auth/session.js';
import { SphereLogo } from './shell/SphereLogo.js';
import { Shell } from './shell/Shell.js';
import { Button, Field, Input, ToastProvider } from './ui/kit.js';

export function App() {
  return (
    <ToastProvider>
      <AuthProvider><Gate /></AuthProvider>
    </ToastProvider>
  );
}

function Gate() {
  const { state, reload } = useAuth();
  if (state.phase === 'loading') return <Splash text={EMBEDDED ? 'Вход через платформу…' : 'Загрузка…'} />;
  if (state.phase === 'anonymous') return EMBEDDED ? <Splash text="Вход через платформу…" /> : <Login />;
  if (state.phase === 'error') {
    return <Notice title="Не удалось открыть ЭнергоСферу" text={state.message}
      actions={<><Button onClick={reload}>Повторить</Button><Button variant="ghost" onClick={logout}>Выйти</Button></>} />;
  }
  const { me } = state;
  if (me.status === 'blocked') {
    return <Notice title="Доступ закрыт" text="Ваша учётная запись заблокирована. Обратитесь к администратору."
      actions={<Button variant="ghost" onClick={logout}>Выйти</Button>} />;
  }
  if (me.status === 'pending') {
    return <Notice title={`Здравствуйте${me.fullName ? `, ${me.fullName}` : ''}!`}
      text="Учётная запись создана. Администратор назначит вам роль и РЭС — после этого откроются нужные разделы."
      actions={<><Button variant="primary" onClick={reload}>Проверить ещё раз</Button><Button variant="ghost" onClick={logout}>Выйти</Button></>} />;
  }
  return <Shell />;
}

function Splash({ text }: { text: string }) {
  return (
    <div className="screen">
      <div className="splash"><span className="splash__sphere"><SphereLogo active={null} size={72} /></span><p>{text}</p></div>
    </div>
  );
}

function Notice({ title, text, actions }: { title: string; text: string; actions: React.ReactNode }) {
  return (
    <div className="screen">
      <div className="login">
        <SphereLogo active={null} size={64} />
        <h1 className="login__title">{title}</h1>
        <p className="login__text">{text}</p>
        <div className="login__actions">{actions}</div>
      </div>
    </div>
  );
}

function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) { setError('Введите логин и пароль.'); return; }
    setBusy(true); setError('');
    // После входа AuthProvider сам перечитает профиль (подписка на сессию).
    try { await login(username.trim(), password); } catch (err) {
      setError((err as Error).message); setPassword(''); setBusy(false);
    }
  };

  return (
    <div className="screen screen--login">
      <form className="login" onSubmit={submit} noValidate>
        <SphereLogo active={null} size={84} />
        <h1 className="login__brand">ЭнергоСфера</h1>
        <p className="login__tagline">Единая рабочая платформа</p>
        <Field label="Логин">
          <Input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus
            value={username} onChange={e => setUsername(e.target.value)} disabled={busy} />
        </Field>
        <Field label="Пароль">
          <Input type="password" name="password" autoComplete="current-password"
            value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
        </Field>
        {error && <p className="login__error" role="alert">{error}</p>}
        <Button variant="primary" type="submit" className="login__submit" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</Button>
        <p className="login__hint">Логин и пароль — те же, что на платформе.</p>
      </form>
    </div>
  );
}
