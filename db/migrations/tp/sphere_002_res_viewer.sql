-- Роль «зритель РЭС» (решение владельца 26.11.2026): инженер реализации видит акты ТП своего
-- РЭС, но не готовит и не согласует их — документы ведёт инженер развития (RIRU_ENGINEER).
-- Пишется в Сфере (sphere_*), импорт TP её не удаляет. ⚠️ Если новая миграция TP
-- переопределит tp.can_read, RES_VIEWER нужно вернуть туда (см. AGENTS.md).
ALTER TABLE tp.roles DROP CONSTRAINT roles_role_check;
ALTER TABLE tp.roles ADD CONSTRAINT roles_role_check CHECK(role IN ('RIRU_ENGINEER','RIRU_HEAD','RES_HEAD','RES_VIEWER','SUE','STP','GI','SUE_ENGINEER','STP_ENGINEER','GI_ENGINEER','TECH_ADMIN','PROCESS_ADMIN'));
ALTER TABLE tp.roles DROP CONSTRAINT roles_scope_check;
ALTER TABLE tp.roles ADD CONSTRAINT roles_scope_check CHECK((role IN ('RIRU_ENGINEER','RIRU_HEAD','RES_HEAD','RES_VIEWER') AND res_id IS NOT NULL) OR role IN ('PROCESS_ADMIN','TECH_ADMIN')
 OR (role IN ('SUE','STP','GI','SUE_ENGINEER','STP_ENGINEER','GI_ENGINEER') AND res_id IS NULL));

CREATE OR REPLACE FUNCTION tp.can_read(area uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT tp.has_role('RIRU_ENGINEER',area) OR tp.has_role('RIRU_HEAD',area) OR tp.has_role('RES_HEAD',area) OR tp.has_role('RES_VIEWER',area)
  OR tp.has_role('SUE') OR tp.has_role('STP') OR tp.has_role('GI')
  OR tp.has_role('SUE_ENGINEER') OR tp.has_role('STP_ENGINEER') OR tp.has_role('GI_ENGINEER')
  OR tp.has_role('PROCESS_ADMIN',area) OR tp.has_role('TECH_ADMIN') $$;
