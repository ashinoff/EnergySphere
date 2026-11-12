-- Модуль 03 «Инструкция начальника РИРУ».
-- content  — общие планы и технологические карты (правит тот, у кого riru.edit);
-- progress — личные отметки «выполнено» за период (день/месяц/год — по типу плана):
--            новый период = чистый лист, ничего сбрасывать не нужно;
-- docs     — нормативные документы и законы, файлы: seed:<имя> (поставляются с
--            приложением) или store:<uuid>.pdf (загружены, лежат в STORAGE_PATH/riru).
CREATE TABLE riru.content (
  kind       text PRIMARY KEY CHECK (kind IN ('strategic', 'tactical', 'operational', 'techcards')),
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer REFERENCES core.users(id) ON DELETE SET NULL
);

CREATE TABLE riru.progress (
  user_id integer NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  kind    text NOT NULL,
  item_id text NOT NULL,
  period  text NOT NULL,
  done_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, period, item_id)
);

CREATE TABLE riru.docs (
  id         serial PRIMARY KEY,
  category   text NOT NULL CHECK (category IN ('normative', 'laws')),
  num        text NOT NULL,
  doc_date   text,
  name       text NOT NULL,
  full_name  text,
  code       text,
  sort       integer NOT NULL DEFAULT 0,
  files      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES core.users(id) ON DELETE SET NULL
);
