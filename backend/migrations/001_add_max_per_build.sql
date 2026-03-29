-- Лимит количества комплектующих одной категории в сборке
ALTER TABLE component_categories
  ADD COLUMN IF NOT EXISTS max_per_build INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN component_categories.max_per_build IS 'Макс. количество позиций этой категории в одной сборке (напр. 1 для процессора, 4 для ОЗУ)';

-- Разумные лимиты по умолчанию (обновить после seed при необходимости)
UPDATE component_categories SET max_per_build = 1  WHERE slug = 'processors';
UPDATE component_categories SET max_per_build = 2  WHERE slug = 'gpu';
UPDATE component_categories SET max_per_build = 4  WHERE slug = 'ram';
UPDATE component_categories SET max_per_build = 1  WHERE slug = 'motherboard';
UPDATE component_categories SET max_per_build = 4  WHERE slug = 'storage';
UPDATE component_categories SET max_per_build = 1  WHERE slug = 'psu';
UPDATE component_categories SET max_per_build = 1  WHERE slug = 'case';
