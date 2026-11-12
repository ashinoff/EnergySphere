-- Маршрут актов ТП (модуль 04) начинается с Инженера реализации (= Инженер РИРУ)
-- и Начальника РИРУ: им нужен доступ к разделу. Стартовые права этих ролей уже
-- были выданы раньше, поэтому добавляем недостающие явно (повторно не дублируются).
INSERT INTO core.role_permissions(role, permission) VALUES
  ('eng_realization', 'tp.view'), ('eng_realization', 'tp.create'),
  ('nach_riru', 'tp.view'), ('nach_riru', 'tp.approve')
ON CONFLICT DO NOTHING;
