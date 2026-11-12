-- Импортировано из TP_Approval (scripts/import-tp.mjs): схема app → tp. Не править вручную.
-- Понятная причина отказа в назначении (06.11.2026): кто из сотрудников подходит на этап в РЭС документа —
-- имена кандидатов с учётом замещения и признак «роль без РЭС (на все РЭС)». Только имена, без контактов.
CREATE FUNCTION tp.candidate_labels(wanted text, area uuid) RETURNS TABLE(id uuid,name text,all_res boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
 SELECT DISTINCT effective.id,effective.name,r.res_id IS NULL FROM tp.roles r JOIN tp.users u ON u.id=r.user_id AND u.active
 LEFT JOIN tp.substitutions s ON s.role_id=r.id AND now()>=s.starts_at AND now()<s.ends_at
 JOIN tp.users effective ON effective.id=coalesce(s.substitute_id,r.user_id) AND effective.active
 WHERE r.revoked_at IS NULL AND r.role=wanted AND (r.res_id IS NULL OR r.res_id=area) AND tp.uid() IS NOT NULL
$$;
REVOKE ALL ON FUNCTION tp.candidate_labels(text,uuid) FROM PUBLIC;
