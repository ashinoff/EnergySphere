-- Импортировано из TP_Approval (scripts/import-tp.mjs): схема app → tp. Не править вручную.
CREATE FUNCTION tp.admin_user(iss text,sub text,display_name text,wanted text,area uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
DECLARE target uuid;
BEGIN
 IF NOT tp.has_role('TECH_ADMIN') THEN RAISE EXCEPTION 'TECH_ADMIN required' USING ERRCODE='42501'; END IF;
 INSERT INTO tp.users(issuer,subject,name) VALUES(iss,sub,display_name) ON CONFLICT(issuer,subject) DO UPDATE SET name=excluded.name RETURNING id INTO target;
 INSERT INTO tp.roles(user_id,role,res_id) VALUES(target,wanted,area) ON CONFLICT DO NOTHING;
 INSERT INTO tp.audit_events(actor_id,action,details) VALUES(tp.uid(),'USER_ROLE_ASSIGNED',jsonb_build_object('userId',target,'role',wanted,'resId',area));
 RETURN target;
END $$;
CREATE FUNCTION tp.admin_substitute(target_role uuid,replacement uuid,start_time timestamptz,end_time timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
DECLARE area uuid; result uuid; original uuid;
BEGIN
 SELECT res_id,user_id INTO area,original FROM tp.roles WHERE id=target_role AND role IN ('RIRU_HEAD','RES_HEAD','SUE','STP','GI') FOR UPDATE;
 IF NOT FOUND OR NOT tp.has_role('PROCESS_ADMIN',area) THEN RAISE EXCEPTION 'PROCESS_ADMIN required' USING ERRCODE='42501'; END IF;
 IF original=replacement OR end_time<=start_time OR EXISTS(SELECT 1 FROM tp.substitutions WHERE role_id=target_role AND starts_at<end_time AND ends_at>start_time) THEN RAISE EXCEPTION 'Invalid/overlapping substitution' USING ERRCODE='22023'; END IF;
 INSERT INTO tp.substitutions(role_id,substitute_id,starts_at,ends_at,created_by) VALUES(target_role,replacement,start_time,end_time,tp.uid()) RETURNING id INTO result;
 INSERT INTO tp.audit_events(actor_id,action,details) VALUES(tp.uid(),'SUBSTITUTION_CREATED',jsonb_build_object('substitutionId',result));
 RETURN result;
END $$;
CREATE FUNCTION tp.admin_calendar(entries jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
BEGIN
 IF NOT tp.has_role('PROCESS_ADMIN') THEN RAISE EXCEPTION 'Global PROCESS_ADMIN required' USING ERRCODE='42501'; END IF;
 INSERT INTO tp.calendar_days(day,working,source,revision) SELECT day,working,source,1 FROM jsonb_to_recordset(entries) AS e(day date,working boolean,source text)
 ON CONFLICT(day) DO UPDATE SET working=excluded.working,source=excluded.source,revision=tp.calendar_days.revision+1;
 INSERT INTO tp.audit_events(actor_id,action,details) VALUES(tp.uid(),'CALENDAR_UPDATED',jsonb_build_object('count',jsonb_array_length(entries)));
END $$;
CREATE FUNCTION tp.admin_policy(wanted text,days integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
DECLARE result uuid;
BEGIN
 IF NOT tp.has_role('PROCESS_ADMIN') THEN RAISE EXCEPTION 'Global PROCESS_ADMIN required' USING ERRCODE='42501'; END IF;
 IF wanted NOT IN ('RES_HEAD','SUE','STP','GI','RIRU_HEAD') THEN RAISE EXCEPTION 'Invalid role'; END IF;
 INSERT INTO tp.deadline_policies(role,working_days) VALUES(wanted,days) RETURNING id INTO result;
 INSERT INTO tp.audit_events(actor_id,action,details) VALUES(tp.uid(),'POLICY_CREATED',jsonb_build_object('policyId',result));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION tp.admin_user(text,text,text,text,uuid),tp.admin_substitute(uuid,uuid,timestamptz,timestamptz),tp.admin_calendar(jsonb),tp.admin_policy(text,integer) FROM PUBLIC;

-- Identities/role administration is exposed only through checked functions, not raw tables.
CREATE FUNCTION tp.admin_directory() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
 SELECT CASE WHEN tp.has_role('TECH_ADMIN') OR tp.has_role('PROCESS_ADMIN') THEN
 (SELECT jsonb_agg(jsonb_build_object('id',r.id,'userId',u.id,'name',u.name,'role',r.role,'resId',r.res_id)) FROM tp.roles r JOIN tp.users u ON u.id=r.user_id) ELSE '[]'::jsonb END $$;
