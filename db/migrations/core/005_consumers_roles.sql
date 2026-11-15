-- Модуль 02 «Поиск потребителя» (решение владельца): реестр своего РЭС обновляет
-- и отметки монтёров завершает только инженер РИРУ (= инженер реализации);
-- начальник РИРУ и СУЭ отметки только смотрят. Стартовые права ролей выданы
-- раньше — приводим их к этой схеме явно.
DELETE FROM core.role_permissions
 WHERE (role IN ('nach_res', 'nach_riru') AND permission IN ('consumers.registry', 'consumers.complete'));
INSERT INTO core.role_permissions(role, permission) VALUES
  ('nach_riru', 'consumers.inbox'),
  ('eng_realization', 'consumers.inbox'),
  ('nach_sue', 'consumers.inbox'),
  ('eng_sue', 'consumers.inbox')
ON CONFLICT DO NOTHING;
