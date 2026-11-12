-- Импортировано из TP_Approval (scripts/import-tp.mjs): схема app → tp. Не править вручную.
-- Preserve actors of future audit events; no duplicated process statuses.
ALTER TABLE tp.audit_events ADD COLUMN actor_snapshot jsonb;
UPDATE tp.audit_events e SET actor_snapshot=jsonb_build_object('id',u.id,'name',coalesce(
 (SELECT d.actor_name FROM tp.decisions d WHERE d.task_id::text=e.details->>'taskId'),u.name),
 'source',CASE WHEN e.action='DECISION' THEN 'DECISION' ELSE 'LEGACY_CURRENT_PROFILE' END)
FROM tp.users u WHERE u.id=e.actor_id;
CREATE FUNCTION tp.capture_audit_actor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
BEGIN
 SELECT jsonb_build_object('id',id,'name',name,'source','AUDIT_CAPTURE') INTO NEW.actor_snapshot FROM tp.users WHERE id=NEW.actor_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION tp.capture_audit_actor() FROM PUBLIC;
CREATE TRIGGER audit_actor BEFORE INSERT ON tp.audit_events FOR EACH ROW EXECUTE FUNCTION tp.capture_audit_actor();
CREATE FUNCTION tp.act_user_label(target_act uuid,target_user uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
 SELECT jsonb_build_object('id',u.id,'name',u.name,'source','CURRENT_PROFILE')
 FROM tp.users u WHERE u.id=target_user AND EXISTS(SELECT 1 FROM tp.acts a WHERE a.id=target_act AND tp.can_read(a.res_id)) $$;
REVOKE ALL ON FUNCTION tp.act_user_label(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tp.act_user_label(uuid,uuid) TO tp_runtime;
CREATE INDEX audit_act_time ON tp.audit_events(act_id,created_at);
CREATE INDEX comments_act ON tp.comments(act_id);
CREATE INDEX comment_events_act ON tp.comment_events(act_id,created_at);
