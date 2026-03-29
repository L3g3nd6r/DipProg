require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dipproj',
});

async function init() {
  const schemaPath = path.join(__dirname, 'schema_components.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  const migrationPath = path.join(__dirname, 'migrations', '001_add_max_per_build.sql');
  if (fs.existsSync(migrationPath)) {
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    await pool.query(migrationSql);
  }
  console.log('Таблицы комплектующих созданы (component_categories, components, builds, build_components, cart_items).');
  await pool.end();
}

init().catch((err) => {
  console.error(err);
  process.exit(1);
});
