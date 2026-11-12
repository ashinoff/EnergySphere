-- Импортировано из TP_Approval (scripts/import-tp.mjs): схема app → tp. Не править вручную.
-- Keep the original role assignment, not a permanently copied substitute identity.
ALTER TABLE tp.tasks ADD COLUMN assignment_id uuid REFERENCES tp.roles;
CREATE FUNCTION tp.assignment_for(wanted text,area uuid,assignee uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
 SELECT r.id FROM tp.roles r LEFT JOIN tp.substitutions s ON s.role_id=r.id AND now()>=s.starts_at AND now()<s.ends_at
 WHERE r.role=wanted AND (r.res_id IS NULL OR r.res_id=area) AND coalesce(s.substitute_id,r.user_id)=assignee LIMIT 1 $$;
CREATE FUNCTION tp.task_user(assignment uuid,fallback uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
 SELECT coalesce((SELECT coalesce(s.substitute_id,r.user_id) FROM tp.roles r LEFT JOIN tp.substitutions s ON s.role_id=r.id AND now()>=s.starts_at AND now()<s.ends_at WHERE r.id=assignment),fallback) $$;
REVOKE ALL ON FUNCTION tp.assignment_for(text,uuid,uuid),tp.task_user(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tp.assignment_for(text,uuid,uuid),tp.task_user(uuid,uuid) TO tp_runtime;
DROP POLICY scope ON tp.decisions;
CREATE POLICY scope ON tp.decisions USING(EXISTS(SELECT 1 FROM tp.tasks WHERE id=task_id)) WITH CHECK(actor_id=tp.uid() AND EXISTS(SELECT 1 FROM tp.tasks WHERE id=task_id AND tp.task_user(assignment_id,assignee_id)=tp.uid() AND status='OPEN'));
REVOKE UPDATE ON tp.files FROM tp_runtime;
