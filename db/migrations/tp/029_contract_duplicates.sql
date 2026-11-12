-- Импортировано из TP_Approval (scripts/import-tp.mjs): схема app → tp. Не править вручную.
-- Номер договора ТП (ххххх-хх-хххххххх-х) уникален (решение владельца 09.11.2026): второй документ того же вида
-- (Акт ТП или АВТУ) по тому же номеру не создаётся — ни в другом РЭС, ни с другой или пустой датой договора.
-- Поиск идёт мимо RLS: инженер должен узнать о дубле даже в чужом РЭС, но получает только номер, вид, статус и РЭС.
CREATE FUNCTION tp.contract_act(number text, kind text) RETURNS TABLE(id uuid, act_type text, state text, res_name text, readable boolean, own_draft boolean, versions integer, has_tu boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
 SELECT a.id,a.act_type,a.state,r.name,tp.can_read(a.res_id) OR tp.has_role('RIRU_ENGINEER',a.res_id),
  a.state='DRAFT' AND a.author_id=tp.uid(),(SELECT count(*)::integer FROM tp.versions v WHERE v.act_id=a.id),a.technical_conditions_id IS NOT NULL
 FROM tp.acts a JOIN tp.res_units r ON r.id=a.res_id
 WHERE tp.contract_key(a.contract_number)=tp.contract_key(number) AND (kind IS NULL OR a.act_type=kind)
 ORDER BY a.created_at,a.id
$$;
REVOKE ALL ON FUNCTION tp.contract_act(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tp.contract_act(text,text) TO tp_runtime;
