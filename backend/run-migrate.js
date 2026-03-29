/**
 * Применить миграции (в т.ч. уникальное имя сборки на пользователя).
 * Запуск: node run-migrate.js
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dipproj',
});

const MIGRATIONS = [
  { file: '001_add_max_per_build.sql', name: 'max_per_build' },
  { file: '002_add_avatar_url.sql', name: 'avatar_url' },
  { file: '003_builds_unique_name.sql', name: 'builds_unique_name' },
];

async function run() {
  for (const m of MIGRATIONS) {
    const migrationPath = path.join(__dirname, 'migrations', m.file);
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await pool.query(sql);
    console.log('Миграция применена:', m.name);
  }
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
