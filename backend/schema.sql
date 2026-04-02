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

-- Заказы пользователей (оформленные из корзины)
CREATE TABLE IF NOT EXISTS orders (
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_name   VARCHAR(255) NOT NULL,
    customer_phone  VARCHAR(64) NOT NULL,
    customer_email  VARCHAR(255) NOT NULL,
    shipping_address TEXT NOT NULL,
    comment         TEXT NULL,
    items_json      JSONB NOT NULL,
    total_rub       NUMERIC(12,2) NOT NULL DEFAULT 0,
    status          VARCHAR(32) NOT NULL DEFAULT 'new',
    completed_by    INT NULL REFERENCES users(id),
    completed_at    TIMESTAMP WITH TIME ZONE NULL,
    received_at     TIMESTAMP WITH TIME ZONE NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- Внутренние уведомления по заказам
CREATE TABLE IF NOT EXISTS order_notifications (
    id          SERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       VARCHAR(255) NOT NULL,
    body        TEXT NOT NULL,
    is_read     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_order_notifications_user ON order_notifications(user_id);
