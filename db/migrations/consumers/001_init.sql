-- Модуль 02 «Поиск потребителя».
-- registries — действующий реестр каждого РЭС (у каждого РЭС свой, «7 баз»):
--              новая загрузка целиком заменяет реестр только своего РЭС;
-- uploads    — загрузка в процессе: строки приходят частями и становятся видны
--              поиску только после завершения (до этого действует прежний реестр);
-- records    — строки реестра: ключи поиска (№ ПУ, ЛС — без пробелов, в нижнем
--              регистре), подпись и адрес для списка, все ячейки — пары [столбец, значение];
-- visits     — отметки монтёра на месте (снимок карточки, геометка), new → done;
--              завершённые удаляются через 3 дня вместе с файлами;
-- visit_files — фото объекта (JPEG/PNG) и ПСУ (всегда один PDF), лежат в
--              STORAGE_PATH/consumers/<visit>/.
CREATE TABLE consumers.uploads (
  id         uuid PRIMARY KEY,
  res_id     integer NOT NULL REFERENCES core.res(id) ON DELETE CASCADE,
  file_name  text NOT NULL,
  rows       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES core.users(id) ON DELETE SET NULL
);

CREATE TABLE consumers.registries (
  res_id      integer PRIMARY KEY REFERENCES core.res(id) ON DELETE CASCADE,
  upload_id   uuid NOT NULL,
  file_name   text NOT NULL,
  rows        integer NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by integer REFERENCES core.users(id) ON DELETE SET NULL
);

CREATE TABLE consumers.records (
  id        bigserial PRIMARY KEY,
  res_id    integer NOT NULL REFERENCES core.res(id) ON DELETE CASCADE,
  upload_id uuid NOT NULL,
  meter     text NOT NULL DEFAULT '',
  account   text NOT NULL DEFAULT '',
  title     text NOT NULL DEFAULT '',
  address   text NOT NULL DEFAULT '',
  cells     jsonb NOT NULL
);
CREATE INDEX records_upload ON consumers.records(upload_id);
CREATE INDEX records_meter ON consumers.records(res_id, meter text_pattern_ops);
CREATE INDEX records_account ON consumers.records(res_id, account text_pattern_ops);

CREATE TABLE consumers.visits (
  id         serial PRIMARY KEY,
  res_id     integer NOT NULL REFERENCES core.res(id) ON DELETE CASCADE,
  meter      text NOT NULL DEFAULT '',
  account    text NOT NULL DEFAULT '',
  title      text NOT NULL DEFAULT '',
  address    text NOT NULL DEFAULT '',
  lat        double precision,
  lon        double precision,
  accuracy   real,
  comment    text,
  status     text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done')),
  created_by integer REFERENCES core.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_by    integer REFERENCES core.users(id) ON DELETE SET NULL,
  done_at    timestamptz
);
CREATE INDEX visits_res_status ON consumers.visits(res_id, status, created_at DESC);

CREATE TABLE consumers.visit_files (
  id       serial PRIMARY KEY,
  visit_id integer NOT NULL REFERENCES consumers.visits(id) ON DELETE CASCADE,
  kind     text NOT NULL CHECK (kind IN ('photo', 'psu')),
  name     text NOT NULL,
  stored   text NOT NULL,
  mime     text NOT NULL,
  size     integer NOT NULL
);
CREATE INDEX visit_files_visit ON consumers.visit_files(visit_id);
