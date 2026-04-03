const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const CODE_TTL_MINUTES = 10;

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Без верифицированного домена Resend разрешает слать только на тестовые адреса.
 * Решение: Domains → добавить домен, DNS-записи, затем RESEND_FROM = "DipProg <noreply@ваш-домен.ru>"
 */
async function sendVerificationEmail(toEmail, code) {
  const key = String(process.env.RESEND_API_KEY || '').trim();
  if (!key) {
    return { ok: false, message: 'На сервере не задан RESEND_API_KEY.' };
  }

  const from = String(process.env.RESEND_FROM || '').trim() || 'DipProg <onboarding@resend.dev>';

  const { error } = await resend.emails.send({
    from,
    to: toEmail,
    subject: 'Код подтверждения регистрации',
    html: `
      <div style="font-family:sans-serif;max-width:400px;margin:0 auto">
        <h2 style="color:#1a73e8">Подтверждение email</h2>
        <p>Ваш код для завершения регистрации в <b>DipProg</b>:</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#1a73e8;padding:16px 0">${code}</div>
        <p style="color:#666">Код действителен ${CODE_TTL_MINUTES} минут.</p>
        <p style="color:#999;font-size:12px">Если вы не регистрировались — просто проигнорируйте это письмо.</p>
      </div>
    `,
  });

  if (error) {
    const raw = [error.message, error.name, JSON.stringify(error)].filter(Boolean).join(' ');
    console.error('Resend emails.send error:', error);
    const lower = raw.toLowerCase();
    const sandboxHint =
      lower.includes('only send') ||
      lower.includes('testing') ||
      lower.includes('verified email') ||
      lower.includes('not allowed') ||
      lower.includes('invalid') && lower.includes('to');
    const msg = sandboxHint
      ? 'Почта: без своего домена Resend шлёт код только на тестовый адрес. В Resend → Domains подключите домен, в Vercel задайте RESEND_FROM (например noreply@ваш-домен.ru) и перезапустите деплой.'
      : 'Не удалось отправить письмо с кодом. Попробуйте позже или обратитесь к администратору.';
    return { ok: false, message: msg };
  }

  return { ok: true };
}

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
      if (emailTrim.length < 3 || !emailTrim.includes('@')) {
        return res.status(400).json({ error: 'Некорректный email' });
      }
      if (String(password).length < 6) {
        return res.status(400).json({ error: 'Пароль не менее 6 символов' });
      }

      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [emailTrim]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Пользователь с таким email уже зарегистрирован' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const code = generateCode();
      const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

      await pool.query(
        `INSERT INTO pending_registrations (email, name, password_hash, code, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE
           SET name = EXCLUDED.name,
               password_hash = EXCLUDED.password_hash,
               code = EXCLUDED.code,
               expires_at = EXCLUDED.expires_at,
               created_at = CURRENT_TIMESTAMP`,
        [emailTrim, String(name).trim(), passwordHash, code, expiresAt]
      );

      const sent = await sendVerificationEmail(emailTrim, code);
      if (!sent.ok) {
        await pool.query('DELETE FROM pending_registrations WHERE email = $1', [emailTrim]);
        return res.status(502).json({ error: sent.message });
      }

      res.status(200).json({ message: 'Код подтверждения отправлен на ваш email' });
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        return res.status(500).json({ error: 'Не удаётся подключиться к БД' });
      }
      console.error('Register error:', err);
      res.status(500).json({ error: 'Ошибка регистрации. Попробуйте позже.' });
    }
  });

  router.post('/verify-email', async (req, res) => {
    try {
      const { email, code } = req.body;
      if (!email || !code) {
        return res.status(400).json({ error: 'Укажите email и код' });
      }
      const emailTrim = String(email).trim().toLowerCase();
      const codeTrim = String(code).trim();

      const result = await pool.query(
        'SELECT * FROM pending_registrations WHERE email = $1',
        [emailTrim]
      );
      if (result.rows.length === 0) {
        return res.status(400).json({ error: 'Запрос на регистрацию не найден. Начните заново.' });
      }
      const pending = result.rows[0];

      if (new Date() > new Date(pending.expires_at)) {
        await pool.query('DELETE FROM pending_registrations WHERE email = $1', [emailTrim]);
        return res.status(400).json({ error: 'Код истёк. Зарегистрируйтесь заново.' });
      }

      if (pending.code !== codeTrim) {
        return res.status(400).json({ error: 'Неверный код подтверждения' });
      }

      await pool.query('DELETE FROM pending_registrations WHERE email = $1', [emailTrim]);

      const userResult = await pool.query(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, $2, $3)
         RETURNING id, email, name, avatar_url, created_at`,
        [emailTrim, pending.password_hash, pending.name]
      );
      const user = userResult.rows[0];
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        jwtSecret,
        { expiresIn: '7d' }
      );
      res.status(201).json({ token, user: mapUserResponse(user) });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Пользователь с таким email уже зарегистрирован' });
      }
      console.error('Verify email error:', err);
      res.status(500).json({ error: 'Ошибка подтверждения. Попробуйте позже.' });
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
      res.json({ token, user: mapUserResponse(user) });
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
      res.json({ user: mapUserResponse(user, true) });
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
