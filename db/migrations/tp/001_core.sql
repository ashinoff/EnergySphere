-- Импортировано из TP_Approval (scripts/import-tp.mjs): схема app → tp. Не править вручную.
CREATE SCHEMA IF NOT EXISTS tp;
REVOKE ALL ON SCHEMA tp FROM PUBLIC;
CREATE TABLE tp.res_units(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL, name text NOT NULL);
INSERT INTO tp.res_units(code,name) VALUES ('KRASNAYA_POLYANA','Краснополянский РЭС'),('ADLER','Адлерский РЭС'),('HOSTA','Хостинский РЭС'),('SOCHI','Сочинский РЭС'),('DAGOMYS','Дагомысский РЭС'),('LAZAREVSKOE','Лазаревский РЭС'),('TUAPSE','Туапсинский РЭС');
CREATE TABLE tp.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issuer text NOT NULL, subject text NOT NULL, name text NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE(issuer,subject));
CREATE TABLE tp.roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES tp.users, role text NOT NULL CHECK(role IN ('RIRU_HEAD','RES_HEAD','SUE','STP','GI','TECH_ADMIN','PROCESS_ADMIN')), res_id uuid REFERENCES tp.res_units,
 CHECK((role IN ('RIRU_HEAD','RES_HEAD') AND res_id IS NOT NULL) OR role IN ('PROCESS_ADMIN','TECH_ADMIN') OR (role IN ('SUE','STP','GI') AND res_id IS NULL)),
 UNIQUE NULLS NOT DISTINCT(user_id,role,res_id));
CREATE TABLE tp.substitutions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role_id uuid NOT NULL REFERENCES tp.roles, substitute_id uuid NOT NULL REFERENCES tp.users, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, created_by uuid NOT NULL REFERENCES tp.users, CHECK(ends_at>starts_at));
CREATE FUNCTION tp.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('tp.user_id',true),'')::uuid $$;
CREATE FUNCTION tp.has_role(wanted text, area uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
 SELECT EXISTS(SELECT 1 FROM tp.roles r JOIN tp.users u ON u.id=r.user_id WHERE r.user_id=tp.uid() AND u.active AND r.role=wanted AND (r.res_id IS NULL OR r.res_id=area))
 OR EXISTS(SELECT 1 FROM tp.substitutions s JOIN tp.roles r ON r.id=s.role_id JOIN tp.users u ON u.id=s.substitute_id WHERE s.substitute_id=tp.uid() AND u.active AND now()>=s.starts_at AND now()<s.ends_at AND r.role=wanted AND (r.res_id IS NULL OR r.res_id=area)) $$;
CREATE FUNCTION tp.can_read(area uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT tp.has_role('RIRU_HEAD',area) OR tp.has_role('RES_HEAD',area) OR tp.has_role('SUE') OR tp.has_role('STP') OR tp.has_role('GI') OR tp.has_role('PROCESS_ADMIN',area) $$;
CREATE FUNCTION tp.resolve_identity(iss text, sub text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$ SELECT id FROM tp.users WHERE issuer=iss AND subject=sub AND active $$;
CREATE FUNCTION tp.candidates(wanted text, area uuid) RETURNS TABLE(id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
 SELECT DISTINCT coalesce(s.substitute_id,r.user_id) FROM tp.roles r JOIN tp.users u ON u.id=r.user_id AND u.active
 LEFT JOIN tp.substitutions s ON s.role_id=r.id AND now()>=s.starts_at AND now()<s.ends_at
 JOIN tp.users effective ON effective.id=coalesce(s.substitute_id,r.user_id) AND effective.active
 WHERE r.role=wanted AND (r.res_id IS NULL OR r.res_id=area) $$;
CREATE TABLE tp.calendar_days(day date PRIMARY KEY, working boolean NOT NULL, source text NOT NULL, revision integer NOT NULL CHECK(revision>0));
CREATE TABLE tp.deadline_policies(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role text NOT NULL, working_days integer NOT NULL CHECK(working_days BETWEEN 1 AND 90), preliminary boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO tp.deadline_policies(role,working_days) VALUES ('RES_HEAD',1),('SUE',2),('STP',2),('GI',2),('RIRU_HEAD',2);
CREATE TABLE tp.acts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), res_id uuid NOT NULL REFERENCES tp.res_units, author_id uuid NOT NULL REFERENCES tp.users, contract_number text NOT NULL, contract_date date NOT NULL, act_number text NOT NULL, applicant text NOT NULL, address text NOT NULL,
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','RES_REVIEW','CENTRAL_REVIEW','CENTRAL_COLLECTING','RETURNED','APPROVED','REVISING')), revision integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tp.files(id uuid PRIMARY KEY, act_id uuid NOT NULL REFERENCES tp.acts, sha256 text NOT NULL, size integer NOT NULL CHECK(size>0), kind text NOT NULL CHECK(kind IN ('ACT_DOCX','TU_DOCX','TU_PDF')), scan_status text NOT NULL CHECK(scan_status IN ('QUARANTINED','READY')), created_by uuid NOT NULL REFERENCES tp.users, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,act_id));
CREATE TABLE tp.versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), act_id uuid NOT NULL REFERENCES tp.acts, number integer NOT NULL CHECK(number>0), file_id uuid NOT NULL, snapshot jsonb NOT NULL, created_by uuid NOT NULL REFERENCES tp.users, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(act_id,number), UNIQUE(id,act_id), FOREIGN KEY(file_id,act_id) REFERENCES tp.files(id,act_id));
CREATE TABLE tp.cycles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), act_id uuid NOT NULL REFERENCES tp.acts, version_id uuid UNIQUE NOT NULL, number integer NOT NULL, state text NOT NULL CHECK(state IN ('RES_REVIEW','CENTRAL_REVIEW','CENTRAL_COLLECTING','RETURNED','APPROVED')), started_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, UNIQUE(act_id,number), UNIQUE(id,act_id), FOREIGN KEY(version_id,act_id) REFERENCES tp.versions(id,act_id));
CREATE UNIQUE INDEX one_active_cycle ON tp.cycles(act_id) WHERE closed_at IS NULL;
CREATE TABLE tp.tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), act_id uuid NOT NULL REFERENCES tp.acts, cycle_id uuid NOT NULL, role text NOT NULL CHECK(role IN ('RES_HEAD','SUE','STP','GI','RIRU_HEAD')), assignee_id uuid NOT NULL REFERENCES tp.users, status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','DONE','CANCELLED')), policy_id uuid NOT NULL REFERENCES tp.deadline_policies, calendar_snapshot jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), due_at timestamptz NOT NULL, completed_at timestamptz, UNIQUE(cycle_id,role), FOREIGN KEY(cycle_id,act_id) REFERENCES tp.cycles(id,act_id));
CREATE TABLE tp.decisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid UNIQUE NOT NULL REFERENCES tp.tasks, actor_id uuid NOT NULL REFERENCES tp.users, actor_name text NOT NULL, decision text NOT NULL CHECK(decision IN ('APPROVE','RETURN')), reason text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tp.comments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), act_id uuid NOT NULL REFERENCES tp.acts, version_id uuid NOT NULL, task_id uuid NOT NULL REFERENCES tp.tasks, author_id uuid NOT NULL REFERENCES tp.users, text text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(version_id,act_id) REFERENCES tp.versions(id,act_id));
CREATE TABLE tp.comment_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), comment_id uuid NOT NULL REFERENCES tp.comments, act_id uuid NOT NULL REFERENCES tp.acts, actor_id uuid NOT NULL REFERENCES tp.users, version_id uuid NOT NULL, type text NOT NULL CHECK(type IN ('REPORTED_FIXED','VERIFIED','REOPENED')), explanation text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(version_id,act_id) REFERENCES tp.versions(id,act_id));
CREATE TABLE tp.releases(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), act_id uuid NOT NULL REFERENCES tp.acts, version_id uuid NOT NULL, cycle_id uuid UNIQUE NOT NULL REFERENCES tp.cycles, status text NOT NULL CHECK(status IN ('CURRENT','UNDER_REVISION','SUPERSEDED','REVOKED')), published_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(version_id,act_id) REFERENCES tp.versions(id,act_id));
CREATE UNIQUE INDEX one_publication ON tp.releases(act_id) WHERE status IN ('CURRENT','UNDER_REVISION');
CREATE TABLE tp.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), act_id uuid NOT NULL REFERENCES tp.acts, recipient_id uuid NOT NULL REFERENCES tp.users, type text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tp.audit_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES tp.users, act_id uuid REFERENCES tp.acts, action text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tp.outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), act_id uuid NOT NULL REFERENCES tp.acts, type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tp.idempotency(user_id uuid NOT NULL REFERENCES tp.users, key text NOT NULL, path text NOT NULL, hash text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(user_id,path,key));

CREATE FUNCTION tp.act_visible(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM tp.acts WHERE id=target) $$;
ALTER TABLE tp.acts ENABLE ROW LEVEL SECURITY; ALTER TABLE tp.acts FORCE ROW LEVEL SECURITY;
CREATE POLICY acts_read ON tp.acts FOR SELECT USING(tp.can_read(res_id));
CREATE POLICY acts_insert ON tp.acts FOR INSERT WITH CHECK(tp.has_role('RIRU_HEAD',res_id) AND author_id=tp.uid());
CREATE POLICY acts_update ON tp.acts FOR UPDATE USING(tp.can_read(res_id)) WITH CHECK(tp.can_read(res_id));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['files','versions','cycles','tasks','comments','comment_events','releases','audit_events','outbox'] LOOP
 EXECUTE format('ALTER TABLE tp.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE tp.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY scope ON tp.%I USING(tp.act_visible(act_id)) WITH CHECK(tp.act_visible(act_id))',t);
 END LOOP;
END $$;
ALTER TABLE tp.decisions ENABLE ROW LEVEL SECURITY; ALTER TABLE tp.decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY scope ON tp.decisions USING(EXISTS(SELECT 1 FROM tp.tasks WHERE id=task_id)) WITH CHECK(actor_id=tp.uid() AND EXISTS(SELECT 1 FROM tp.tasks WHERE id=task_id AND assignee_id=tp.uid() AND status='OPEN'));
ALTER TABLE tp.notifications ENABLE ROW LEVEL SECURITY; ALTER TABLE tp.notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_read ON tp.notifications FOR SELECT USING(recipient_id=tp.uid() AND tp.act_visible(act_id));
CREATE POLICY notification_insert ON tp.notifications FOR INSERT WITH CHECK(tp.act_visible(act_id));
CREATE POLICY notification_update ON tp.notifications FOR UPDATE USING(recipient_id=tp.uid() AND tp.act_visible(act_id)) WITH CHECK(recipient_id=tp.uid());
ALTER TABLE tp.idempotency ENABLE ROW LEVEL SECURITY; ALTER TABLE tp.idempotency FORCE ROW LEVEL SECURITY;
CREATE POLICY own ON tp.idempotency USING(user_id=tp.uid()) WITH CHECK(user_id=tp.uid());
CREATE INDEX tasks_user_open ON tp.tasks(assignee_id,status,due_at);
CREATE INDEX acts_area ON tp.acts(res_id,created_at);
CREATE INDEX notifications_user ON tp.notifications(recipient_id,created_at);
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA tp FROM PUBLIC;

CREATE FUNCTION tp.my_profile() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
 SELECT jsonb_build_object('id',u.id,'name',u.name,'roles',coalesce((SELECT jsonb_agg(jsonb_build_object('role',role,'resId',res_id)) FROM tp.roles WHERE user_id=u.id),'[]'::jsonb)) FROM tp.users u WHERE u.id=tp.uid() AND active $$;
