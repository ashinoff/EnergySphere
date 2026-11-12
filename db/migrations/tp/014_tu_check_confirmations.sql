-- Импортировано из TP_Approval (scripts/import-tp.mjs): схема app → tp. Не править вручную.
-- Manual confirmation of TU check findings by the RIRU engineer (user decision Р4, 03.11.2026).
-- Only MANUAL_REVIEW / UNKNOWN findings of a specific immutable report can be confirmed, with a comment.
-- A DIFFERENCE can never be confirmed. A new act version, other TU or new rules produce a new report,
-- so earlier confirmations do not carry over.
CREATE TABLE tp.tu_check_confirmations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 check_id uuid NOT NULL REFERENCES tp.tu_checks,
 act_id uuid NOT NULL REFERENCES tp.acts,
 field text NOT NULL CHECK(length(field) BETWEEN 1 AND 50),
 comment text NOT NULL CHECK(length(btrim(comment)) BETWEEN 10 AND 2000),
 actor_id uuid NOT NULL DEFAULT tp.uid() REFERENCES tp.users,
 actor_name text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(check_id,field)
);
ALTER TABLE tp.tu_check_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tp.tu_check_confirmations ENABLE ROW LEVEL SECURITY;
CREATE POLICY scope ON tp.tu_check_confirmations FOR SELECT USING(tp.act_visible(act_id));
CREATE POLICY confirmation_insert ON tp.tu_check_confirmations FOR INSERT
 WITH CHECK(actor_id=tp.uid() AND tp.has_role('RIRU_ENGINEER',(SELECT res_id FROM tp.acts WHERE id=act_id)));
GRANT SELECT,INSERT ON tp.tu_check_confirmations TO tp_runtime;
CREATE INDEX tu_check_confirmations_check ON tp.tu_check_confirmations(check_id);

CREATE FUNCTION tp.validate_tu_confirmation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,tp AS $$
DECLARE
 report tp.tu_checks;
 finding_status text;
BEGIN
 SELECT * INTO report FROM tp.tu_checks WHERE id=NEW.check_id;
 IF report.id IS NULL OR report.act_id<>NEW.act_id THEN RAISE EXCEPTION 'TU check does not belong to the act' USING ERRCODE='23514'; END IF;
 SELECT f->>'status' INTO finding_status FROM jsonb_array_elements(report.findings) f WHERE f->>'field'=NEW.field LIMIT 1;
 IF finding_status IS NULL OR finding_status NOT IN ('MANUAL_REVIEW','UNKNOWN') THEN
  RAISE EXCEPTION 'Only MANUAL_REVIEW or UNKNOWN findings can be confirmed' USING ERRCODE='23514';
 END IF;
 NEW.actor_id:=tp.uid();
 NEW.actor_name:=coalesce(tp.my_profile()->>'name','');
 NEW.created_at:=now();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION tp.validate_tu_confirmation() FROM PUBLIC;
CREATE TRIGGER validate_tu_confirmation BEFORE INSERT ON tp.tu_check_confirmations FOR EACH ROW EXECUTE FUNCTION tp.validate_tu_confirmation();
CREATE TRIGGER immutable_tu_confirmation BEFORE UPDATE OR DELETE ON tp.tu_check_confirmations FOR EACH ROW EXECUTE FUNCTION tp.document_history_immutable();
