-- Импортировано из TP_Approval (scripts/import-tp.mjs): схема app → tp. Не править вручную.
-- Profile data is preparation for an explicit Keycloak identity binding, not a login by email.
ALTER TABLE tp.users ADD COLUMN email text;
ALTER TABLE tp.users ADD COLUMN deleted_at timestamptz;
ALTER TABLE tp.users ADD COLUMN account_revision integer NOT NULL DEFAULT 0;
ALTER TABLE tp.users ADD CONSTRAINT users_email_format CHECK(email IS NULL OR
 (email=lower(btrim(email)) AND length(email)<=254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'));
ALTER TABLE tp.users ADD CONSTRAINT deleted_user_inactive CHECK(deleted_at IS NULL OR NOT active);
CREATE UNIQUE INDEX users_email_unique ON tp.users(email) WHERE email IS NOT NULL AND deleted_at IS NULL;

-- Keep assignment IDs referenced by historical tasks and substitutions.
ALTER TABLE tp.roles ADD COLUMN revoked_at timestamptz;
ALTER TABLE tp.roles DROP CONSTRAINT roles_user_id_role_res_id_key;
CREATE UNIQUE INDEX roles_current_identity ON tp.roles(user_id,role,res_id) NULLS NOT DISTINCT WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION tp.has_role(wanted text, area uuid DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
 SELECT EXISTS(SELECT 1 FROM tp.roles r JOIN tp.users u ON u.id=r.user_id
 WHERE r.user_id=tp.uid() AND u.active AND r.revoked_at IS NULL AND r.role=wanted AND (r.res_id IS NULL OR r.res_id=area))
 OR EXISTS(SELECT 1 FROM tp.substitutions s JOIN tp.roles r ON r.id=s.role_id JOIN tp.users u ON u.id=s.substitute_id
 WHERE s.substitute_id=tp.uid() AND u.active AND r.revoked_at IS NULL AND now()>=s.starts_at AND now()<s.ends_at
 AND r.role=wanted AND (r.res_id IS NULL OR r.res_id=area))
$$;
CREATE OR REPLACE FUNCTION tp.candidates(wanted text, area uuid) RETURNS TABLE(id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
 SELECT DISTINCT coalesce(s.substitute_id,r.user_id) FROM tp.roles r JOIN tp.users u ON u.id=r.user_id AND u.active
 LEFT JOIN tp.substitutions s ON s.role_id=r.id AND now()>=s.starts_at AND now()<s.ends_at
 JOIN tp.users effective ON effective.id=coalesce(s.substitute_id,r.user_id) AND effective.active
 WHERE r.revoked_at IS NULL AND r.role=wanted AND (r.res_id IS NULL OR r.res_id=area)
$$;
CREATE OR REPLACE FUNCTION tp.assignment_for(wanted text,area uuid,assignee uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
 SELECT r.id FROM tp.roles r LEFT JOIN tp.substitutions s ON s.role_id=r.id AND now()>=s.starts_at AND now()<s.ends_at
 WHERE r.revoked_at IS NULL AND r.role=wanted AND (r.res_id IS NULL OR r.res_id=area) AND coalesce(s.substitute_id,r.user_id)=assignee LIMIT 1
$$;
CREATE OR REPLACE FUNCTION tp.my_profile() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
 SELECT jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'roles',coalesce((SELECT jsonb_agg(jsonb_build_object('role',r.role,'resId',r.res_id)) FROM (
 SELECT role,res_id FROM tp.roles WHERE user_id=u.id AND revoked_at IS NULL
 UNION SELECT r.role,r.res_id FROM tp.substitutions s JOIN tp.roles r ON r.id=s.role_id
 WHERE s.substitute_id=u.id AND r.revoked_at IS NULL AND now()>=s.starts_at AND now()<s.ends_at
 )r),'[]'::jsonb)) FROM tp.users u WHERE u.id=tp.uid() AND active
$$;
CREATE OR REPLACE FUNCTION tp.admin_directory() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
 SELECT CASE WHEN tp.has_role('TECH_ADMIN') OR tp.has_role('PROCESS_ADMIN') THEN
 (SELECT jsonb_agg(jsonb_build_object('id',r.id,'userId',u.id,'name',u.name,'role',r.role,'resId',r.res_id))
 FROM tp.roles r JOIN tp.users u ON u.id=r.user_id WHERE r.revoked_at IS NULL AND u.deleted_at IS NULL) ELSE '[]'::jsonb END
$$;
CREATE OR REPLACE FUNCTION tp.admin_user(iss text,sub text,display_name text,wanted text,area uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
DECLARE target uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(817624);
 IF NOT tp.has_role('TECH_ADMIN') THEN RAISE EXCEPTION 'TECH_ADMIN required' USING ERRCODE='42501'; END IF;
 INSERT INTO tp.users(issuer,subject,name) VALUES(iss,sub,display_name)
 ON CONFLICT(issuer,subject) DO UPDATE SET name=excluded.name,account_revision=tp.users.account_revision+1
 WHERE tp.users.deleted_at IS NULL RETURNING id INTO target;
 IF target IS NULL THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND' USING ERRCODE='22023'; END IF;
 INSERT INTO tp.roles(user_id,role,res_id) VALUES(target,wanted,area) ON CONFLICT DO NOTHING;
 INSERT INTO tp.audit_events(actor_id,action,details) VALUES(tp.uid(),'USER_ROLE_ASSIGNED',jsonb_build_object('userId',target,'role',wanted,'resId',area));
 RETURN target;
END $$;
CREATE OR REPLACE FUNCTION tp.admin_substitute(target_role uuid,replacement uuid,start_time timestamptz,end_time timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
DECLARE area uuid; result uuid; original uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(817624);
 SELECT res_id,user_id INTO area,original FROM tp.roles WHERE id=target_role AND revoked_at IS NULL
 AND role IN ('RIRU_ENGINEER','RIRU_HEAD','RES_HEAD','SUE','STP','GI') FOR UPDATE;
 IF NOT FOUND OR NOT tp.has_role('PROCESS_ADMIN',area) THEN RAISE EXCEPTION 'PROCESS_ADMIN required' USING ERRCODE='42501'; END IF;
 IF original=replacement OR end_time<=start_time
 OR NOT EXISTS(SELECT 1 FROM tp.users WHERE id=original AND active)
 OR NOT EXISTS(SELECT 1 FROM tp.users WHERE id=replacement AND active)
 OR EXISTS(SELECT 1 FROM tp.substitutions WHERE role_id=target_role AND starts_at<end_time AND ends_at>start_time)
 THEN RAISE EXCEPTION 'Invalid/overlapping substitution' USING ERRCODE='22023'; END IF;
 INSERT INTO tp.substitutions(role_id,substitute_id,starts_at,ends_at,created_by) VALUES(target_role,replacement,start_time,end_time,tp.uid()) RETURNING id INTO result;
 INSERT INTO tp.audit_events(actor_id,action,details) VALUES(tp.uid(),'SUBSTITUTION_CREATED',jsonb_build_object('substitutionId',result));
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION tp.local_admin_users() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
BEGIN
 IF NOT tp.has_role('TECH_ADMIN') THEN RAISE EXCEPTION 'TECH_ADMIN required' USING ERRCODE='42501'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'login',c.login,
 'revision',u.account_revision,'active',u.active,'mustChangePassword',c.must_change,
 'roles',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',r.role,'resId',r.res_id) ORDER BY r.role,r.res_id),'[]'::jsonb)
 FROM tp.roles r WHERE r.user_id=u.id AND r.revoked_at IS NULL)) ORDER BY c.login),'[]'::jsonb)
 FROM tp.local_credentials c JOIN tp.users u ON u.id=c.user_id WHERE u.deleted_at IS NULL);
END $$;
DROP FUNCTION tp.local_admin_create(text,text,text,text,uuid);
CREATE FUNCTION tp.local_admin_create(wanted text,display_name text,mail text,new_hash text,wanted_role text,area uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
DECLARE target uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(817624);
 IF NOT tp.has_role('TECH_ADMIN') THEN RAISE EXCEPTION 'TECH_ADMIN required' USING ERRCODE='42501'; END IF;
 IF mail IS NULL OR btrim(mail)='' THEN RAISE EXCEPTION 'EMAIL_REQUIRED' USING ERRCODE='22023'; END IF;
 target=tp.admin_user('urn:tp-approval:local',gen_random_uuid()::text,display_name,wanted_role,area);
 UPDATE tp.users SET email=lower(btrim(mail)) WHERE id=target;
 INSERT INTO tp.local_credentials(user_id,login,password_hash) VALUES(target,wanted,new_hash);
 RETURN target;
END $$;
CREATE OR REPLACE FUNCTION tp.local_admin_access(target uuid,enabled boolean,new_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(817624);
 IF NOT tp.has_role('TECH_ADMIN') THEN RAISE EXCEPTION 'TECH_ADMIN required' USING ERRCODE='42501'; END IF;
 IF target=tp.uid() THEN RAISE EXCEPTION 'SELF_ACCESS_CHANGE' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM tp.local_credentials WHERE user_id=target FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM tp.users WHERE id=target AND deleted_at IS NULL)
 THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND' USING ERRCODE='22023'; END IF;
 UPDATE tp.users SET active=coalesce(enabled,active),account_revision=account_revision+1 WHERE id=target;
 IF new_hash IS NOT NULL THEN
  UPDATE tp.local_credentials SET password_hash=new_hash,must_change=true,password_version=password_version+1,failed_attempts=0,locked_until=NULL WHERE user_id=target;
 END IF;
 DELETE FROM tp.local_sessions WHERE user_id=target;
 INSERT INTO tp.audit_events(actor_id,action,details) VALUES(tp.uid(),'LOCAL_ACCOUNT_UPDATED',jsonb_build_object('userId',target,'active',enabled,'passwordReset',new_hash IS NOT NULL));
END $$;
CREATE OR REPLACE FUNCTION tp.local_admin_role(target uuid,wanted_role text,area uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
DECLARE u tp.users;
BEGIN
 PERFORM pg_advisory_xact_lock(817624);
 IF NOT tp.has_role('TECH_ADMIN') THEN RAISE EXCEPTION 'TECH_ADMIN required' USING ERRCODE='42501'; END IF;
 SELECT * INTO u FROM tp.users WHERE id=target AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM tp.local_credentials WHERE user_id=target);
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND' USING ERRCODE='22023'; END IF;
 RETURN tp.admin_user(u.issuer,u.subject,u.name,wanted_role,area);
END $$;

-- Internal guard. Called under the same lock used by assignment creation.
CREATE FUNCTION tp.assert_local_roles_removable(target uuid,removed uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM tp.tasks t JOIN tp.acts a ON a.id=t.act_id JOIN tp.roles r ON r.id=ANY(removed)
 WHERE t.status='OPEN' AND (t.assignment_id=r.id OR (t.assignment_id IS NULL AND t.assignee_id=target
 AND tp.task_role(t.role,t.cycle_id)=r.role AND (r.res_id IS NULL OR r.res_id=a.res_id))))
 OR EXISTS(SELECT 1 FROM tp.substitutions WHERE role_id=ANY(removed) AND ends_at>now())
 THEN RAISE EXCEPTION 'ROLE_IN_USE' USING ERRCODE='22023'; END IF;
END $$;
CREATE FUNCTION tp.local_admin_profile(target uuid,expected integer,wanted text,display_name text,mail text,assignments jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
DECLARE u tp.users; previous_login text; removed uuid[]; changed_roles boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(817624);
 IF NOT tp.has_role('TECH_ADMIN') THEN RAISE EXCEPTION 'TECH_ADMIN required' USING ERRCODE='42501'; END IF;
 -- Login and password rotation lock credentials first; keep that order here too.
 PERFORM 1 FROM tp.local_credentials WHERE user_id=target FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND' USING ERRCODE='22023'; END IF;
 SELECT * INTO u FROM tp.users WHERE id=target AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM tp.local_credentials WHERE user_id=target) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND' USING ERRCODE='22023'; END IF;
 IF expected IS NULL OR u.account_revision<>expected THEN RAISE EXCEPTION 'ACCOUNT_CHANGED' USING ERRCODE='22023'; END IF;
 IF mail IS NULL OR btrim(mail)='' THEN RAISE EXCEPTION 'EMAIL_REQUIRED' USING ERRCODE='22023'; END IF;
 IF assignments IS NULL OR jsonb_typeof(assignments)<>'array' OR jsonb_array_length(assignments)>32
 THEN RAISE EXCEPTION 'INVALID_ASSIGNMENTS' USING ERRCODE='22023'; END IF;
 IF target=tp.uid() AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(assignments) AS x(role text,"resId" uuid) WHERE role='TECH_ADMIN' AND "resId" IS NULL)
 THEN RAISE EXCEPTION 'KEEP_ADMIN_ROLE' USING ERRCODE='22023'; END IF;
 SELECT array_agg(r.id) INTO removed FROM tp.roles r WHERE r.user_id=target AND r.revoked_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(assignments) AS x(role text,"resId" uuid) WHERE x.role=r.role AND x."resId" IS NOT DISTINCT FROM r.res_id);
 PERFORM tp.assert_local_roles_removable(target,removed);
 SELECT login INTO previous_login FROM tp.local_credentials WHERE user_id=target FOR UPDATE;
 changed_roles=coalesce(cardinality(removed),0)>0 OR EXISTS(SELECT 1 FROM jsonb_to_recordset(assignments) AS x(role text,"resId" uuid)
 WHERE NOT EXISTS(SELECT 1 FROM tp.roles r WHERE r.user_id=target AND r.revoked_at IS NULL AND r.role=x.role AND r.res_id IS NOT DISTINCT FROM x."resId"));
 UPDATE tp.users SET name=display_name,email=lower(btrim(mail)),account_revision=account_revision+1 WHERE id=target;
 UPDATE tp.local_credentials SET login=wanted WHERE user_id=target;
 UPDATE tp.roles SET revoked_at=now() WHERE id=ANY(removed);
 INSERT INTO tp.roles(user_id,role,res_id) SELECT target,x.role,x."resId" FROM jsonb_to_recordset(assignments) AS x(role text,"resId" uuid) ON CONFLICT DO NOTHING;
 IF previous_login<>wanted OR u.email IS DISTINCT FROM lower(btrim(mail)) OR changed_roles THEN DELETE FROM tp.local_sessions WHERE user_id=target; END IF;
 INSERT INTO tp.audit_events(actor_id,action,details) VALUES(tp.uid(),'LOCAL_PROFILE_UPDATED',
 jsonb_build_object('userId',target,'previous',jsonb_build_object('name',u.name,'email',u.email,'login',previous_login),
 'current',jsonb_build_object('name',display_name,'email',lower(btrim(mail)),'login',wanted),'roles',assignments));
END $$;
CREATE FUNCTION tp.local_admin_delete(target uuid,expected integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
DECLARE u tp.users; removed uuid[];
BEGIN
 PERFORM pg_advisory_xact_lock(817624);
 IF NOT tp.has_role('TECH_ADMIN') THEN RAISE EXCEPTION 'TECH_ADMIN required' USING ERRCODE='42501'; END IF;
 IF target=tp.uid() THEN RAISE EXCEPTION 'SELF_DELETE' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM tp.local_credentials WHERE user_id=target FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND' USING ERRCODE='22023'; END IF;
 SELECT * INTO u FROM tp.users WHERE id=target AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM tp.local_credentials WHERE user_id=target) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND' USING ERRCODE='22023'; END IF;
 IF expected IS NULL OR u.account_revision<>expected THEN RAISE EXCEPTION 'ACCOUNT_CHANGED' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM tp.tasks WHERE status='OPEN' AND (assignee_id=target OR tp.task_user(assignment_id,assignee_id)=target))
 OR EXISTS(SELECT 1 FROM tp.substitutions WHERE substitute_id=target AND ends_at>now())
 THEN RAISE EXCEPTION 'ACCOUNT_IN_USE' USING ERRCODE='22023'; END IF;
 SELECT array_agg(id) INTO removed FROM tp.roles WHERE user_id=target AND revoked_at IS NULL;
 PERFORM tp.assert_local_roles_removable(target,removed);
 UPDATE tp.users SET active=false,deleted_at=now(),account_revision=account_revision+1 WHERE id=target;
 UPDATE tp.roles SET revoked_at=now() WHERE id=ANY(removed);
 DELETE FROM tp.local_sessions WHERE user_id=target;
 DELETE FROM tp.local_credentials WHERE user_id=target;
 INSERT INTO tp.audit_events(actor_id,action,details) VALUES(tp.uid(),'LOCAL_ACCOUNT_DELETED',jsonb_build_object('userId',target));
END $$;
REVOKE ALL ON FUNCTION tp.local_admin_create(text,text,text,text,text,uuid),tp.local_admin_profile(uuid,integer,text,text,text,jsonb),tp.local_admin_delete(uuid,integer) FROM PUBLIC;
