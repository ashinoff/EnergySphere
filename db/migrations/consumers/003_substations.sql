-- Справочник ТП по РЭС (загружает администратор по шаблону «РЭС | ТП | Координаты»).
-- name_key — ключ сравнения с ТП в реестре потребителей («Подключение · ТП»):
-- «ТП-Д165», «Д-165», «д165» → «Д165». Число потребителей на ТП не хранится —
-- считается по действующему реестру РЭС, поэтому меняется с каждой его загрузкой.
CREATE TABLE consumers.substations (
  id          serial PRIMARY KEY,
  res_id      integer NOT NULL REFERENCES core.res(id) ON DELETE CASCADE,
  name        text NOT NULL,
  name_key    text NOT NULL,
  lat         double precision,
  lon         double precision,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by integer REFERENCES core.users(id) ON DELETE SET NULL,
  UNIQUE (res_id, name_key)
);
