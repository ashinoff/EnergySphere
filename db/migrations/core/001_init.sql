-- Ядро ЭнергоСферы: РЭС, пользователи, права ролей, журнал действий.
-- Каждый модуль живёт в своей схеме одной базы и не ссылается на чужие схемы,
-- кроме core (пользователь, РЭС).
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS analysis;
CREATE SCHEMA IF NOT EXISTS consumers;
CREATE SCHEMA IF NOT EXISTS riru;
CREATE SCHEMA IF NOT EXISTS tp;

CREATE TABLE core.res (
  id         serial PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  sort       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO core.res (name, sort) VALUES
  ('Адлерский РЭС', 10), ('Краснополянский РЭС', 20), ('Хостинский РЭС', 30),
  ('Сочинский РЭС', 40), ('Дагомысский РЭС', 50), ('Лазаревский РЭС', 60),
  ('Туапсинский РЭС', 70);

-- Учётка появляется при первом входе через Keycloak (статус «ожидает роли»),
-- роль и РЭС назначает администратор.
CREATE TABLE core.users (
  id                serial PRIMARY KEY,
  keycloak_id       text UNIQUE,
  username          text,
  email             text,
  full_name         text,
  role              text,
  res_id            integer REFERENCES core.res(id) ON DELETE SET NULL,
  extra_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_login_at     timestamptz
);
CREATE UNIQUE INDEX users_email_lower ON core.users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE core.role_permissions (
  role       text NOT NULL,
  permission text NOT NULL,
  PRIMARY KEY (role, permission)
);

CREATE TABLE core.audit (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  user_id integer REFERENCES core.users(id) ON DELETE SET NULL,
  action  text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_at ON core.audit (at DESC);
