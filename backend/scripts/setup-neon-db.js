/**
 * Одна команда для полной инициализации облачной БД (Neon / Supabase / любой PostgreSQL).
 *
 * Запуск:
 *   DATABASE_URL="postgresql://..." npm run setup-cloud-db
 *
 * Или задайте DATABASE_URL в backend/.env и запустите:
 *   npm run setup-cloud-db
 *
 * Что делает:
 *   1. Создаёт все таблицы (schema.sql)
 *   2. Применяет миграции (001, 002, 003)
 *   3. Наполняет каталог комплектующих (~400 позиций)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool }     = require('pg');
const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('\n❌ Укажите DATABASE_URL в backend/.env или в переменной окружения.\n');
  process.exit(1);
}

const sslOption = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')
  ? {}
  : { ssl: { rejectUnauthorized: false } };

const pool = new Pool({ connectionString: dbUrl, ...sslOption });

async function step(label, fn) {
  process.stdout.write(`⏳ ${label}... `);
  await fn();
  console.log('✓');
}

async function main() {
  console.log('\n🚀 Инициализация облачной БД DipProg\n');

  // 1. Схема пользователей, заказов, уведомлений
  await step('Таблицы users / orders / notifications (schema.sql)', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await pool.query(sql);
  });

  // 2. Схема комплектующих, сборок, корзины
  await step('Таблицы categories / components / builds / cart (schema_components.sql)', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'schema_components.sql'), 'utf8');
    await pool.query(sql);
  });

  // 3. Миграции (001 уже включена в schema_components, поэтому пропускаем через IF NOT EXISTS — безопасно)
  const migrations = [
    { file: '002_add_avatar_url.sql',     name: 'avatar_url' },
    { file: '003_builds_unique_name.sql', name: 'builds_unique_name' },
  ];
  for (const m of migrations) {
    const migPath = path.join(__dirname, '..', 'migrations', m.file);
    if (!fs.existsSync(migPath)) {
      console.log(`  ⚠  Миграция ${m.file} не найдена, пропускаю`);
      continue;
    }
    await step(`Миграция: ${m.name}`, async () => {
      await pool.query(fs.readFileSync(migPath, 'utf8'));
    });
  }

  await pool.end();

  // 3. Сид — запускаем как отдельный процесс (seed-components.js сам закрывает pool)
  console.log('⏳ Наполнение каталога комплектующих (~400 позиций)...');
  execSync('node scripts/seed-components.js', {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'inherit',
  });

  console.log('\n✅ Готово! База данных настроена и наполнена.\n');
  console.log('Следующий шаг: задайте DATABASE_URL в Render Dashboard и задеплойте сервер.\n');
}

main().catch(err => {
  console.error('\n❌ Ошибка:', err.message || err);
  pool.end().catch(() => {});
  process.exit(1);
});
