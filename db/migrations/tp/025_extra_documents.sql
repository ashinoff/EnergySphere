-- Импортировано из TP_Approval (scripts/import-tp.mjs): схема app → tp. Не править вручную.
-- Дополнительные документы договора (решение владельца 06.11.2026): ПСУ, предыдущий акт ТП, поопорная схема.
-- Загружаются в PDF к выбранному документу (при создании или позже через «Доп. документы»), видны в пакете документов
-- и в режиме проверки как документ для сравнения. Маршрута согласования у них нет; удаляются вместе с документом.
ALTER TABLE tp.files DROP CONSTRAINT IF EXISTS files_kind_check;
ALTER TABLE tp.files ADD CONSTRAINT files_kind_check CHECK(kind IN ('ACT_DOCX','AVTU_DOCX','TU_DOCX','ACT_PDF','AVTU_PDF','TU_PDF','EXTRA_PDF'));

CREATE TABLE tp.extra_documents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 act_id uuid NOT NULL REFERENCES tp.acts,
 file_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('PSU','PREV_ACT','POLE_SCHEME')),
 number integer NOT NULL CHECK(number>0),
 created_by uuid NOT NULL REFERENCES tp.users,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(file_id,act_id) REFERENCES tp.files(id,act_id),
 UNIQUE(act_id,kind,number));
CREATE INDEX extra_documents_act ON tp.extra_documents(act_id);

ALTER TABLE tp.extra_documents ENABLE ROW LEVEL SECURITY; ALTER TABLE tp.extra_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY extra_documents_read ON tp.extra_documents FOR SELECT USING(tp.act_visible(act_id));
CREATE POLICY extra_documents_insert ON tp.extra_documents FOR INSERT WITH CHECK(created_by=tp.uid() AND EXISTS(
 SELECT 1 FROM tp.acts a JOIN tp.files f ON f.act_id=a.id WHERE a.id=act_id AND f.id=file_id AND f.kind='EXTRA_PDF' AND f.scan_status='READY'
  AND a.state IN ('DRAFT','RETURNED','REVISING') AND tp.has_role('RIRU_ENGINEER',a.res_id)));
