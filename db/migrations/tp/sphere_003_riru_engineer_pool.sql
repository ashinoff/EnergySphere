-- Инженеров развития в РЭС может быть несколько (решение владельца 26.11.2026): акт на
-- доработку уходит в РЭС, исправить его может любой инженер РЭС (загрузка версии, формирование
-- акта, отправка — проверяются по роли RIRU_ENGINEER, а не по задаче). Строго один человек
-- нужен только согласующим (RIRU_HEAD, RES_HEAD, СТП, СУЭ, ТЕХБЛОК).
--
-- Маршрут TP при возврате выбирает исполнителя через tp.candidates('RIRU_ENGINEER', РЭС) и
-- требует ровно одного. Здесь для RIRU_ENGINEER кандидат всегда один: автор акта, если он
-- ещё инженер этого РЭС, иначе любой инженер РЭС. Автор возвращаемого акта передаётся
-- переменной транзакции tp.returned_author (триггер на смену состояния на RETURNED).
-- Код маршрута (modules/tp/core) не трогаем — импорт TP его перезапишет.
-- ⚠️ Если новая миграция TP переопределит tp.candidates — вернуть ветку RIRU_ENGINEER.

CREATE OR REPLACE FUNCTION tp.remember_returned_author() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'RETURNED' AND OLD.state IS DISTINCT FROM 'RETURNED' THEN
    PERFORM set_config('tp.returned_author', NEW.author_id::text, true);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS remember_returned_author ON tp.acts;
CREATE TRIGGER remember_returned_author AFTER UPDATE OF state ON tp.acts FOR EACH ROW EXECUTE FUNCTION tp.remember_returned_author();

CREATE OR REPLACE FUNCTION tp.candidates(wanted text, area uuid) RETURNS TABLE(id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,tp AS $$
 WITH pool AS (
  SELECT DISTINCT coalesce(s.substitute_id,r.user_id) AS id FROM tp.roles r JOIN tp.users u ON u.id=r.user_id AND u.active
  LEFT JOIN tp.substitutions s ON s.role_id=r.id AND now()>=s.starts_at AND now()<s.ends_at
  JOIN tp.users effective ON effective.id=coalesce(s.substitute_id,r.user_id) AND effective.active
  WHERE r.revoked_at IS NULL AND r.role=wanted AND (r.res_id IS NULL OR r.res_id=area)
 )
 SELECT id FROM pool WHERE wanted <> 'RIRU_ENGINEER'
 UNION ALL
 (SELECT id FROM pool WHERE wanted = 'RIRU_ENGINEER'
  ORDER BY (id::text = coalesce(current_setting('tp.returned_author', true), '')) DESC, id LIMIT 1)
$$;
