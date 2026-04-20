-- Добавить колонку avatar_url в users (URL аватарки)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT NULL;

COMMENT ON COLUMN users.avatar_url IS 'URL изображения аватара пользователя';
