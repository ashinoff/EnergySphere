-- Совместимость с TP_Approval (пишется вручную, импорт её не трогает).
-- Сервисные функции TP (admin_health, резервная копия/восстановление) читают список
-- применённых миграций из public.schema_migrations. В Сфере учёт ведётся в
-- es_schema_migrations с префиксом модуля («tp/001_core.sql») — отдаём TP его же
-- формат («001_core.sql»).
CREATE VIEW public.schema_migrations AS
  SELECT substr(name, 4) AS name, hash, applied_at
  FROM public.es_schema_migrations
  WHERE name LIKE 'tp/%';
