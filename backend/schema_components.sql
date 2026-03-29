-- Категории комплектующих (для фильтров и будущей нейросети)
CREATE TABLE IF NOT EXISTS component_categories (
    id             SERIAL PRIMARY KEY,
    name           VARCHAR(100) NOT NULL UNIQUE,
    slug           VARCHAR(100) NOT NULL UNIQUE,
    sort_order     INT NOT NULL DEFAULT 0,
    max_per_build  INT NOT NULL DEFAULT 1
);
COMMENT ON COLUMN component_categories.max_per_build IS 'Макс. кол-во позиций этой категории в одной сборке';

-- Комплектующие ПК (совместимо с парсингом и ML: specs — произвольный JSON)
CREATE TABLE IF NOT EXISTS components (
    id          SERIAL PRIMARY KEY,
    category_id INT NOT NULL REFERENCES component_categories(id) ON DELETE CASCADE,
    name        VARCHAR(500) NOT NULL,
    description TEXT,
    price       DECIMAL(12, 2) NOT NULL DEFAULT 0,
    image_url   VARCHAR(1000),
    external_url VARCHAR(1000),
    specs       JSONB,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category_id, name)
);

CREATE INDEX IF NOT EXISTS idx_components_category ON components(category_id);
CREATE INDEX IF NOT EXISTS idx_components_price ON components(price);
CREATE INDEX IF NOT EXISTS idx_components_specs ON components USING GIN(specs);

-- Сборки пользователя
CREATE TABLE IF NOT EXISTS builds (
    id          SERIAL PRIMARY KEY,
    user_id     INT REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_builds_user ON builds(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_builds_user_lower_trim_name
  ON builds (user_id, lower(trim(name)));

-- Компоненты в сборке (одна позиция = один тип: 1 процессор, 1 видеокарта и т.д.)
CREATE TABLE IF NOT EXISTS build_components (
    id           SERIAL PRIMARY KEY,
    build_id     INT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
    component_id INT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    quantity     INT NOT NULL DEFAULT 1,
    UNIQUE(build_id, component_id)
);

CREATE INDEX IF NOT EXISTS idx_build_components_build ON build_components(build_id);

-- Корзина (для незалогиненных можно добавить session_id позже)
CREATE TABLE IF NOT EXISTS cart_items (
    id           SERIAL PRIMARY KEY,
    user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    component_id INT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    quantity     INT NOT NULL DEFAULT 1,
    UNIQUE(user_id, component_id)
);

CREATE INDEX IF NOT EXISTS idx_cart_items_user ON cart_items(user_id);

COMMENT ON TABLE component_categories IS 'Категории комплектующих (процессор, видеокарта и т.д.)';
COMMENT ON TABLE components IS 'Справочник комплектующих, цены; specs для ML/фильтров';
COMMENT ON TABLE builds IS 'Сборки ПК пользователя';
COMMENT ON TABLE cart_items IS 'Корзина пользователя';
