/**
 * Обновляет цены в БД без пересоздания каталога (тот же коэффициент + оверрайды, что в seed).
 * npm run update-prices
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const { applyRetailPrice } = require('./retail-prices');

/** Разовое повышение, если в БД ещё старый коэффициент ~1.07 */
const LEGACY_BOOST = 1.14;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dipproj',
});

async function main() {
  const r = await pool.query('SELECT id, name, price FROM components ORDER BY id');
  let n = 0;
  for (const row of r.rows) {
    const oldP = Number(row.price) || 0;
    const boosted = Math.max(100, Math.round((oldP * LEGACY_BOOST) / 100) * 100);
    const next = applyRetailPrice(row.name, boosted);
    if (next !== oldP) {
      await pool.query('UPDATE components SET price = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [next, row.id]);
      n += 1;
    }
  }
  console.log(`Обновлено цен: ${n} из ${r.rows.length}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
