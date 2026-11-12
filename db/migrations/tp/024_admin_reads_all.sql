-- Импортировано из TP_Approval (scripts/import-tp.mjs): схема app → tp. Не править вручную.
-- Решение владельца 05.11.2026: администратор системы (TECH_ADMIN) видит все документы всех РЭС — только чтение
-- (документ, ТУ, матрица, история, замечания, скачивание). Согласовывать, загружать и исправлять он не может:
-- права на изменение по-прежнему проверяются по рабочим ролям. Заменяет прежнее правило «TECH_ADMIN без доступа к актам».
CREATE OR REPLACE FUNCTION tp.can_read(area uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT tp.has_role('RIRU_ENGINEER',area) OR tp.has_role('RIRU_HEAD',area) OR tp.has_role('RES_HEAD',area) OR tp.has_role('SUE') OR tp.has_role('STP') OR tp.has_role('GI')
  OR tp.has_role('PROCESS_ADMIN',area) OR tp.has_role('TECH_ADMIN') $$;
