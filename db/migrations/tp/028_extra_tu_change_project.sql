-- Импортировано из TP_Approval (scripts/import-tp.mjs): схема app → tp. Не править вручную.
-- Доп. документы договора (решение владельца 08.11.2026): к ПСУ, предыдущему акту и поопорной схеме добавлены
-- «Изменения к ТУ» и «Проект». Как и прежние виды — только PDF, без маршрута согласования, версий не создают.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='tp.extra_documents'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%POLE_SCHEME%' LOOP
  EXECUTE format('ALTER TABLE tp.extra_documents DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE tp.extra_documents ADD CONSTRAINT extra_documents_kind_check CHECK(kind IN ('PSU','PREV_ACT','POLE_SCHEME','TU_CHANGE','PROJECT'));
