-- «Акты ТП» (решение владельца 26.11.2026): документы создаёт и ведёт инженер развития,
-- инженер реализации только смотрит. В TP: инженер развития → RIRU_ENGINEER, инженер
-- реализации → RES_VIEWER (modules/tp/bridge.ts). Права Сферы приводим к этому явно —
-- стартовые права ролей уже выданы раньше.
DELETE FROM core.role_permissions WHERE role = 'eng_realization' AND permission = 'tp.create';
INSERT INTO core.role_permissions(role, permission) VALUES
  ('eng_realization', 'tp.view'),
  ('eng_development', 'tp.view'),
  ('eng_development', 'tp.create')
ON CONFLICT DO NOTHING;
