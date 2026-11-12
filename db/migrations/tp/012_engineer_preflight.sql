-- Импортировано из TP_Approval (scripts/import-tp.mjs): схема app → tp. Не править вручную.
ALTER TABLE tp.acts ADD COLUMN tu_check_required boolean NOT NULL DEFAULT true;
CREATE TABLE tp.tu_checks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), act_id uuid NOT NULL REFERENCES tp.acts,
 version_id uuid NOT NULL, technical_conditions_id uuid NOT NULL REFERENCES tp.technical_conditions,
 act_hash text NOT NULL, tu_hash text NOT NULL, rules_version text NOT NULL,
 status text NOT NULL CHECK(status IN ('PASS','BLOCKED')), findings jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES tp.users, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(version_id,act_id) REFERENCES tp.versions(id,act_id)
);
ALTER TABLE tp.tu_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tp.tu_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY scope ON tp.tu_checks FOR SELECT USING(tp.act_visible(act_id));
CREATE POLICY check_insert ON tp.tu_checks FOR INSERT WITH CHECK(tp.has_role('RIRU_ENGINEER',(SELECT res_id FROM tp.acts WHERE id=act_id)) AND created_by=tp.uid());
CREATE INDEX tu_checks_source ON tp.tu_checks(act_id,version_id,technical_conditions_id,created_at DESC);
CREATE FUNCTION tp.guard_tu_requirement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.tu_check_required IS DISTINCT FROM OLD.tu_check_required AND coalesce(current_setting('tp.user_id',true),'')<>'' THEN RAISE EXCEPTION 'TU validation requirement cannot be changed by runtime' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION tp.guard_tu_requirement() FROM PUBLIC;
CREATE TRIGGER guard_tu_requirement BEFORE UPDATE ON tp.acts FOR EACH ROW EXECUTE FUNCTION tp.guard_tu_requirement();
-- Show already-authorized temporary roles in navigation, without granting new rights.
CREATE OR REPLACE FUNCTION tp.my_profile() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
 SELECT jsonb_build_object('id',u.id,'name',u.name,'roles',coalesce((SELECT jsonb_agg(jsonb_build_object('role',r.role,'resId',r.res_id)) FROM (
 SELECT role,res_id FROM tp.roles WHERE user_id=u.id
 UNION SELECT r.role,r.res_id FROM tp.substitutions s JOIN tp.roles r ON r.id=s.role_id WHERE s.substitute_id=u.id AND now()>=s.starts_at AND now()<s.ends_at
 )r),'[]'::jsonb)) FROM tp.users u WHERE u.id=tp.uid() AND active
$$;
