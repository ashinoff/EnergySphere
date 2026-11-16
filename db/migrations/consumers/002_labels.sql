-- Названия столбцов реестра — один раз на загрузку, а в строке (records.cells) —
-- только значения по их порядку (null — пусто). На настоящем расширенном списке
-- (≈25 тыс. строк, 60 столбцов) это втрое меньше, чем пары [столбец, значение].
-- Строки прежнего вида (пары) читаются как раньше.
ALTER TABLE consumers.uploads ADD COLUMN labels jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE consumers.registries ADD COLUMN labels jsonb NOT NULL DEFAULT '[]'::jsonb;
