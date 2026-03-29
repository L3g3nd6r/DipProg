-- Уникальное имя сборки в рамках пользователя (без учёта регистра и крайних пробелов)
CREATE UNIQUE INDEX IF NOT EXISTS idx_builds_user_lower_trim_name
  ON builds (user_id, lower(trim(name)));
