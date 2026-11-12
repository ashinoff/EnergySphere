-- СУЭ участвует в согласовании актов ТП (модуль 04): начальник согласует,
-- инженер смотрит. Стартовые права этих ролей выданы раньше — добавляем явно.
INSERT INTO core.role_permissions(role, permission) VALUES
  ('nach_sue', 'tp.view'), ('nach_sue', 'tp.approve'), ('eng_sue', 'tp.view')
ON CONFLICT DO NOTHING;
