-- Импортировано из TP_Approval (scripts/import-tp.mjs): схема app → tp. Не править вручную.
-- Technical administrators manage the dictionary without gaining act content access.
CREATE FUNCTION tp.admin_error_category(target uuid,label text,enabled boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
DECLARE result tp.error_categories;
BEGIN
 IF NOT tp.has_role('TECH_ADMIN') THEN RAISE EXCEPTION 'TECH_ADMIN required' USING ERRCODE='42501'; END IF;
 IF target IS NULL THEN INSERT INTO tp.error_categories(name,active) VALUES(label,enabled) RETURNING * INTO result;
 ELSE UPDATE tp.error_categories SET name=label,active=enabled WHERE id=target RETURNING * INTO result;
 END IF;
 IF result.id IS NULL THEN RAISE EXCEPTION 'Category not found' USING ERRCODE='22023'; END IF;
 INSERT INTO tp.audit_events(actor_id,action,details) VALUES(tp.uid(),'ERROR_CATEGORY_CHANGED',jsonb_build_object('categoryId',result.id,'name',label,'active',enabled));
 RETURN to_jsonb(result);
END $$;
REVOKE ALL ON FUNCTION tp.admin_error_category(uuid,text,boolean) FROM PUBLIC;
