-- Таблица пользователей для авторизации и регистрации
CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    email       VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name        VARCHAR(255) NOT NULL,
    avatar_url  VARCHAR(512) NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Индекс для быстрого поиска по email при входе
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Комментарии для документации
COMMENT ON TABLE users IS 'Пользователи приложения сборки ПК';
COMMENT ON COLUMN users.password_hash IS 'Хеш пароля (bcrypt)';
