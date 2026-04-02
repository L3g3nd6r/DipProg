const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

/**
 * @param {import('pg').Pool} pool
 * @param {{ jwtSecret: string, mapUserResponse: Function, authMiddleware: import('express').RequestHandler }} deps
 */
function createAuthRouter(pool, { jwtSecret, mapUserResponse, authMiddleware }) {
  const router = express.Router();

  router.post('/register', async (req, res) => {
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
        jwtSecret,
        { expiresIn: '7d' }
      );
      res.status(201).json({
        token,
        user: mapUserResponse(user),
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

  router.post('/login', async (req, res) => {
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
        jwtSecret,
        { expiresIn: '7d' }
      );
      res.json({
        token,
        user: mapUserResponse(user),
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Ошибка входа' });
    }
  });

  router.get('/me', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Требуется авторизация' });
      }
      const token = authHeader.slice(7);
      const decoded = jwt.verify(token, jwtSecret);
      const result = await pool.query(
        'SELECT id, email, name, avatar_url, created_at FROM users WHERE id = $1',
        [decoded.userId]
      );
      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Пользователь не найден' });
      }
      const user = result.rows[0];
      res.json({
        user: mapUserResponse(user, true),
      });
    } catch (err) {
      if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Требуется авторизация' });
      }
      console.error('Me error:', err);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  router.patch('/me', authMiddleware, async (req, res) => {
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
      res.json({ user: mapUserResponse(user) });
    } catch (err) {
      console.error('Patch me error:', err);
      res.status(500).json({ error: 'Ошибка обновления профиля' });
    }
  });

  return router;
}

module.exports = { createAuthRouter };
