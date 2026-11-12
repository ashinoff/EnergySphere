-- Какие роли уже получили стартовые права (чтобы выдавать их ровно один раз,
-- в том числе ролям, добавленным в каталог позже).
CREATE TABLE core.seeded_roles (
  role      text PRIMARY KEY,
  seeded_at timestamptz NOT NULL DEFAULT now()
);
-- Роли, чьи права уже есть в матрице, считаются засеянными.
INSERT INTO core.seeded_roles(role) SELECT DISTINCT role FROM core.role_permissions ON CONFLICT DO NOTHING;
