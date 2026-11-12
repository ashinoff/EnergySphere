-- Импортировано из TP_Approval (scripts/import-tp.mjs): схема app → tp. Не править вручную.
ALTER TABLE tp.deadline_policies ADD COLUMN warning_hours integer NOT NULL DEFAULT 4 CHECK(warning_hours BETWEEN 0 AND 168);
CREATE TABLE tp.deadline_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES tp.tasks, act_id uuid NOT NULL REFERENCES tp.acts, recipient_id uuid NOT NULL REFERENCES tp.users, type text NOT NULL CHECK(type IN ('WARNING','OVERDUE','ESCALATION')), due_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(task_id,recipient_id,type,due_at));
ALTER TABLE tp.deadline_events ENABLE ROW LEVEL SECURITY;ALTER TABLE tp.deadline_events FORCE ROW LEVEL SECURITY;
CREATE POLICY scope ON tp.deadline_events USING(tp.act_visible(act_id)) WITH CHECK(tp.act_visible(act_id));
