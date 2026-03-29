require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { createRouter: createCategoriesRouter } = require('./routes/categories');
const { createRouter: createComponentsRouter } = require('./routes/components');
const { createRouter: createBuildsRouter } = require('./routes/builds');
const { createRouter: createCartRouter } = require('./routes/cart');
const { createRouter: createAiRouter } = require('./routes/ai');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dipprog-secret-key-change-in-production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dipproj',
});

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

// Регистрация
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Укажите email, пароль и имя' });
    }
    const emailTrim = String(email).trim().toLowerCase();
    if (emailTrim.length < 3) {
      return res.status(400).json({ error: 'Некорректный email' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Пароль не менее 6 символов' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, avatar_url, created_at`,
      [emailTrim, passwordHash, String(name).trim()]
    );
    const user = result.rows[0];
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url || null },
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Пользователь с таким email уже зарегистрирован' });
    }
    if (err.code === '28P01') {
      console.error('PostgreSQL: неверный логин или пароль. Проверьте DATABASE_URL в .env');
      return res.status(500).json({ error: 'Ошибка подключения к БД. Проверьте логин и пароль в .env' });
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      return res.status(500).json({ error: 'Не удаётся подключиться к БД. Запущен ли PostgreSQL?' });
    }
    if (err.code === '42P01') {
      console.error('Таблица users не найдена. Выполните schema.sql в базе dipproj (DBeaver или: npm run init-db)');
      return res.status(500).json({ error: 'Таблица users не создана. Выполните backend/schema.sql в базе dipproj.' });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Ошибка регистрации' });
  }
});

// Вход
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Укажите email и пароль' });
    }
    const emailTrim = String(email).trim().toLowerCase();
    const result = await pool.query(
      'SELECT id, email, name, avatar_url, password_hash FROM users WHERE email = $1',
      [emailTrim]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url || null },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

// Получить текущего пользователя по токену
app.get('/api/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      'SELECT id, email, name, avatar_url, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }
    const user = result.rows[0];
    res.json({ user: { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url || null } });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }
    console.error('Me error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обновить профиль (имя, аватар)
app.patch('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const { name, avatar_url } = req.body || {};
    const userId = req.user.userId;
    const updates = [];
    const values = [];
    let i = 1;
    if (name !== undefined) {
      const n = String(name).trim();
      if (n.length === 0) return res.status(400).json({ error: 'Имя не может быть пустым' });
      updates.push(`name = $${i++}`);
      values.push(n);
    }
    if (avatar_url !== undefined) {
      const url = avatar_url === null || avatar_url === '' ? null : String(avatar_url).trim();
      updates.push(`avatar_url = $${i++}`);
      values.push(url);
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Укажите name и/или avatar_url' });
    }
    values.push(userId);
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${i} RETURNING id, email, name, avatar_url`,
      values
    );
    const user = result.rows[0];
    res.json({ user: { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url || null } });
  } catch (err) {
    console.error('Patch me error:', err);
    res.status(500).json({ error: 'Ошибка обновления профиля' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API запущен на http://localhost:${PORT} (доступ с сети: http://<IP-ПК>:${PORT})`);
});
