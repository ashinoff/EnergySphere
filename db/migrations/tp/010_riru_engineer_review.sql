-- Импортировано из TP_Approval (scripts/import-tp.mjs): схема app → tp. Не править вручную.
-- Existing uploader role assignments become engineer assignments; their UUIDs and
-- substitutions remain intact. Historical tasks/decisions are never rewritten.
ALTER TABLE tp.roles DROP CONSTRAINT roles_role_check;
ALTER TABLE tp.roles DROP CONSTRAINT roles_check;
ALTER TABLE tp.roles ADD CHECK(role IN ('RIRU_ENGINEER','RIRU_HEAD','RES_HEAD','SUE','STP','GI','TECH_ADMIN','PROCESS_ADMIN'));
ALTER TABLE tp.roles ADD CHECK((role IN ('RIRU_ENGINEER','RIRU_HEAD','RES_HEAD') AND res_id IS NOT NULL) OR role IN ('PROCESS_ADMIN','TECH_ADMIN') OR (role IN ('SUE','STP','GI') AND res_id IS NULL));
UPDATE tp.roles SET role='RIRU_ENGINEER' WHERE role='RIRU_HEAD';
INSERT INTO tp.deadline_policies(role,working_days,preliminary) SELECT 'RIRU_ENGINEER',working_days,preliminary FROM tp.deadline_policies WHERE role='RIRU_HEAD' ORDER BY created_at DESC,id DESC LIMIT 1;
INSERT INTO tp.deadline_policies(role,working_days,preliminary) VALUES('RIRU_HEAD',1,true);
ALTER TABLE tp.acts ADD COLUMN workflow_version integer NOT NULL DEFAULT 1 CHECK(workflow_version IN (1,2));
ALTER TABLE tp.cycles ADD COLUMN workflow_version integer NOT NULL DEFAULT 1 CHECK(workflow_version IN (1,2));
ALTER TABLE tp.acts ALTER COLUMN workflow_version SET DEFAULT 2;
ALTER TABLE tp.cycles ALTER COLUMN workflow_version SET DEFAULT 2;
ALTER TABLE tp.acts DROP CONSTRAINT acts_state_check;
ALTER TABLE tp.acts ADD CHECK(state IN ('DRAFT','RIRU_REVIEW','RES_REVIEW','CENTRAL_REVIEW','CENTRAL_COLLECTING','RETURNED','APPROVED','REVISING'));
ALTER TABLE tp.cycles DROP CONSTRAINT cycles_state_check;
ALTER TABLE tp.cycles ADD CHECK(state IN ('RIRU_REVIEW','RES_REVIEW','CENTRAL_REVIEW','CENTRAL_COLLECTING','RETURNED','APPROVED'));
ALTER TABLE tp.tasks DROP CONSTRAINT tasks_role_check;
ALTER TABLE tp.tasks ADD CHECK(role IN ('RIRU_ENGINEER','RIRU_HEAD','RES_HEAD','SUE','STP','GI'));
CREATE FUNCTION tp.task_role(task_role text,cycle uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN task_role='RIRU_HEAD' AND EXISTS(SELECT 1 FROM tp.cycles WHERE id=cycle AND workflow_version=1) THEN 'RIRU_ENGINEER' ELSE task_role END
$$;
REVOKE ALL ON FUNCTION tp.task_role(text,uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION tp.can_read(area uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT tp.has_role('RIRU_ENGINEER',area) OR tp.has_role('RIRU_HEAD',area) OR tp.has_role('RES_HEAD',area) OR tp.has_role('SUE') OR tp.has_role('STP') OR tp.has_role('GI') OR tp.has_role('PROCESS_ADMIN',area) $$;
CREATE OR REPLACE FUNCTION tp.admin_substitute(target_role uuid,replacement uuid,start_time timestamptz,end_time timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
DECLARE area uuid; result uuid; original uuid;
BEGIN
 SELECT res_id,user_id INTO area,original FROM tp.roles WHERE id=target_role AND role IN ('RIRU_ENGINEER','RIRU_HEAD','RES_HEAD','SUE','STP','GI') FOR UPDATE;
 IF NOT FOUND OR NOT tp.has_role('PROCESS_ADMIN',area) THEN RAISE EXCEPTION 'PROCESS_ADMIN required' USING ERRCODE='42501'; END IF;
 IF original=replacement OR end_time<=start_time OR EXISTS(SELECT 1 FROM tp.substitutions WHERE role_id=target_role AND starts_at<end_time AND ends_at>start_time) THEN RAISE EXCEPTION 'Invalid/overlapping substitution' USING ERRCODE='22023'; END IF;
 INSERT INTO tp.substitutions(role_id,substitute_id,starts_at,ends_at,created_by) VALUES(target_role,replacement,start_time,end_time,tp.uid()) RETURNING id INTO result;
 INSERT INTO tp.audit_events(actor_id,action,details) VALUES(tp.uid(),'SUBSTITUTION_CREATED',jsonb_build_object('substitutionId',result));
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION tp.admin_policy(wanted text,days integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
DECLARE result uuid;
BEGIN
 IF NOT tp.has_role('PROCESS_ADMIN') THEN RAISE EXCEPTION 'Global PROCESS_ADMIN required' USING ERRCODE='42501'; END IF;
 IF wanted NOT IN ('RES_HEAD','SUE','STP','GI','RIRU_HEAD','RIRU_ENGINEER') THEN RAISE EXCEPTION 'Invalid role'; END IF;
 INSERT INTO tp.deadline_policies(role,working_days) VALUES(wanted,days) RETURNING id INTO result;
 INSERT INTO tp.audit_events(actor_id,action,details) VALUES(tp.uid(),'POLICY_CREATED',jsonb_build_object('policyId',result));
 RETURN result;
END $$;
ALTER POLICY acts_insert ON tp.acts WITH CHECK(tp.has_role('RIRU_ENGINEER',res_id) AND author_id=tp.uid());
ALTER POLICY contracts_insert ON tp.contracts WITH CHECK(tp.has_role('RIRU_ENGINEER',res_id));
ALTER POLICY tu_insert ON tp.technical_conditions WITH CHECK(
 tp.has_role('RIRU_ENGINEER',res_id) AND created_by=tp.uid() AND EXISTS(
 SELECT 1 FROM tp.acts a JOIN tp.files f ON f.act_id=a.id WHERE a.id=source_act_id AND a.contract_id=technical_conditions.contract_id AND f.id=file_id AND f.kind='TU_DOCX' AND f.scan_status='READY'));
