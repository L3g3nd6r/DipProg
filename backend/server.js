require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { createRouter: createCategoriesRouter } = require('./routes/categories');
const { createRouter: createComponentsRouter } = require('./routes/components');
const { createRouter: createBuildsRouter } = require('./routes/builds');
const { createRouter: createCartRouter } = require('./routes/cart');
const { createRouter: createAiRouter } = require('./routes/ai');
const { createRouter: createStatsRouter } = require('./routes/stats');
const { createRouter: createOrdersRouter } = require('./routes/orders');
const { createAuthRouter } = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

const isProd = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || (isProd ? null : 'dipprog-dev-key-change-me');
if (!JWT_SECRET) {
  console.error('JWT_SECRET обязателен при NODE_ENV=production (укажите в .env)');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dipproj',
});

const ASSEMBLER_EMAILS = String(process.env.ASSEMBLER_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function resolveUserRole(email) {
  const e = String(email || '').trim().toLowerCase();
  return ASSEMBLER_EMAILS.includes(e) ? 'assembler' : 'customer';
}

function mapUserResponse(user, withCreatedAt = false) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar_url: user.avatar_url || null,
    role: resolveUserRole(user.email),
    ...(withCreatedAt ? { created_at: user.created_at != null ? new Date(user.created_at).toISOString() : null } : {}),
  };
}

async function ensureRuntimeSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      customer_name VARCHAR(255) NOT NULL,
      customer_phone VARCHAR(64) NOT NULL,
      customer_email VARCHAR(255) NOT NULL,
      shipping_address TEXT NOT NULL,
      comment TEXT NULL,
      items_json JSONB NOT NULL,
      total_rub NUMERIC(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(32) NOT NULL DEFAULT 'new',
      completed_by INT NULL REFERENCES users(id),
      completed_at TIMESTAMP WITH TIME ZONE NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
  await pool.query(
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS received_at TIMESTAMP WITH TIME ZONE NULL`
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_notifications (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_order_notifications_user ON order_notifications(user_id)`);
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  try {
    const token = authHeader.slice(7);
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
}

app.use(cors());
app.use(express.json());

app.use('/api/categories', createCategoriesRouter(pool));
app.use('/api/components', createComponentsRouter(pool));
app.use('/api/builds', createBuildsRouter(pool, authMiddleware));
app.use('/api/cart', createCartRouter(pool, authMiddleware));
app.use('/api/ai', createAiRouter(pool));
app.use('/api/stats', createStatsRouter(pool, authMiddleware));
app.use('/api/orders', createOrdersRouter(pool, authMiddleware, resolveUserRole));
app.use(
  '/api/auth',
  createAuthRouter(pool, { jwtSecret: JWT_SECRET, mapUserResponse, authMiddleware })
);

// ─── Запуск: обычный (node server.js) или serverless-экспорт (Vercel) ───────

let schemaInitialized = false;

async function initIfNeeded() {
  if (!schemaInitialized) {
    await ensureRuntimeSchema();
    schemaInitialized = true;
  }
}

if (require.main === module) {
  // Локальная разработка / Render / любой обычный хостинг
  initIfNeeded()
    .then(() => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`API запущен на http://localhost:${PORT} (доступ с сети: http://<IP-ПК>:${PORT})`);
        if (ASSEMBLER_EMAILS.length > 0) {
          console.log(`Роль сборщика назначена email: ${ASSEMBLER_EMAILS.join(', ')}`);
        } else {
          console.log('ASSEMBLER_EMAILS не задан — все пользователи считаются обычными заказчиками');
        }
        if (!isProd) {
          console.log('Режим разработки: JWT_SECRET по умолчанию (для production задайте JWT_SECRET в .env)');
        }
      });
    })
    .catch((err) => {
      console.error('Не удалось инициализировать схему заказов:', err);
      process.exit(1);
    });
} else {
  // Serverless-хостинг (Vercel): экспортируем обработчик
  module.exports = async (req, res) => {
    try {
      await initIfNeeded();
    } catch (err) {
      console.error('initIfNeeded failed:', err);
      res.status(500).json({ error: 'Ошибка инициализации сервера: ' + (err.message || err) });
      return;
    }
    app(req, res);
  };
}
