const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { filterProfanity } = require('../services/profanity');

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_LOGIN,
    pass: process.env.BREVO_SMTP_KEY,
  },
});

const CODE_TTL_MINUTES = 10;

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendVerificationEmail(toEmail, code) {
  await transporter.sendMail({
    from: `"PC Forge" <${process.env.BREVO_SENDER_EMAIL || process.env.BREVO_SMTP_LOGIN}>`,
    to: toEmail,
    subject: 'Код подтверждения регистрации',
    html: `
      <div style="font-family:sans-serif;max-width:400px;margin:0 auto">
        <h2 style="color:#1a73e8">Подтверждение email</h2>
        <p>Ваш код для завершения регистрации в <b>PC Forge</b>:</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#1a73e8;padding:16px 0">${code}</div>
        <p style="color:#666">Код действителен ${CODE_TTL_MINUTES} минут.</p>
        <p style="color:#999;font-size:12px">Если вы не регистрировались — просто проигнорируйте это письмо.</p>
      </div>
    `,
  });
}

async function sendPasswordResetEmail(toEmail, code) {
  await transporter.sendMail({
    from: `"PC Forge" <${process.env.BREVO_SENDER_EMAIL || process.env.BREVO_SMTP_LOGIN}>`,
    to: toEmail,
    subject: 'Сброс пароля',
    html: `
      <div style="font-family:sans-serif;max-width:400px;margin:0 auto">
        <h2 style="color:#1a73e8">Сброс пароля</h2>
        <p>Код для сброса пароля в <b>PC Forge</b>:</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#1a73e8;padding:16px 0">${code}</div>
        <p style="color:#666">Код действителен ${CODE_TTL_MINUTES} минут.</p>
        <p style="color:#999;font-size:12px">Если это были не вы — просто проигнорируйте письмо.</p>
      </div>
    `,
  });
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

      const cleanName = filterProfanity(String(name).trim());
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
        [emailTrim, cleanName, passwordHash, code, expiresAt]
      );

      await sendVerificationEmail(emailTrim, code);

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

  router.post('/forgot-password', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Укажите корректный email' });
      }

      const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (userRes.rows.length > 0) {
        const code = generateCode();
        const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
        await pool.query(
          `INSERT INTO password_reset_codes (email, code, expires_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (email) DO UPDATE
             SET code = EXCLUDED.code,
                 expires_at = EXCLUDED.expires_at,
                 created_at = CURRENT_TIMESTAMP`,
          [email, code, expiresAt]
        );
        try {
          await sendPasswordResetEmail(email, code);
        } catch (mailErr) {
          console.error('Forgot password: ошибка отправки письма:', mailErr && mailErr.message);
          return res.status(500).json({
            error: 'Не удалось отправить письмо. Попробуйте позже.',
            detail: mailErr && mailErr.message,
          });
        }
      }

      // Не раскрываем, существует email или нет
      res.status(200).json({ message: 'Если аккаунт существует, код отправлен на почту' });
    } catch (err) {
      console.error('Forgot password error:', err && err.message, err && err.code);
      res.status(500).json({
        error: 'Ошибка отправки кода. Попробуйте позже.',
        detail: err && err.message,
        code: err && err.code,
      });
    }
  });

  router.post('/reset-password', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const code = String(req.body?.code || '').trim();
      const newPassword = String(req.body?.new_password || '');
      if (!email || !email.includes('@') || !code) {
        return res.status(400).json({ error: 'Укажите email и код' });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Пароль не менее 6 символов' });
      }

      const resetRes = await pool.query(
        'SELECT code, expires_at FROM password_reset_codes WHERE email = $1',
        [email]
      );
      if (resetRes.rows.length === 0) {
        return res.status(400).json({ error: 'Запрос на сброс не найден. Запросите код снова.' });
      }
      const row = resetRes.rows[0];
      if (new Date() > new Date(row.expires_at)) {
        await pool.query('DELETE FROM password_reset_codes WHERE email = $1', [email]);
        return res.status(400).json({ error: 'Код истёк. Запросите новый.' });
      }
      if (row.code !== code) {
        return res.status(400).json({ error: 'Неверный код' });
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);
      const updateRes = await pool.query(
        'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE email = $2 RETURNING id',
        [passwordHash, email]
      );
      await pool.query('DELETE FROM password_reset_codes WHERE email = $1', [email]);
      if (updateRes.rows.length === 0) {
        return res.status(400).json({ error: 'Пользователь не найден' });
      }
      res.status(200).json({ message: 'Пароль обновлён. Теперь можно войти.' });
    } catch (err) {
      console.error('Reset password error:', err);
      res.status(500).json({ error: 'Ошибка сброса пароля. Попробуйте позже.' });
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
      const rawId = req.user && req.user.userId;
      const userId = rawId != null && rawId !== '' ? Number(rawId) : NaN;
      if (!Number.isFinite(userId)) {
        console.error('PATCH /me: в токене нет userId', req.user);
        return res.status(401).json({ error: 'Некорректный токен. Выйдите и войдите снова.' });
      }
      const updates = [];
      const values = [];
      let i = 1;
      if (name !== undefined) {
        const n = filterProfanity(String(name).trim());
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

      // Пробуем с updated_at (стандартная схема). Если колонки нет — повторяем без неё.
      let result;
      try {
        result = await pool.query(
          `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${i} RETURNING id, email, name, avatar_url`,
          values
        );
      } catch (colErr) {
        if (colErr.code === '42703') {
          // column "updated_at" does not exist — старая БД без этой колонки
          result = await pool.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, email, name, avatar_url`,
            values
          );
        } else {
          throw colErr;
        }
      }

      const user = result.rows[0];
      if (!user) {
        console.error('PATCH /me: пользователь не найден, id=', userId);
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
      res.json({ user: mapUserResponse(user) });
    } catch (err) {
      console.error('Patch me error:', err.message, err.code);
      // Возвращаем detail всегда — без него невозможно диагностировать проблему на Vercel
      res.status(500).json({ error: 'Ошибка обновления профиля', detail: err.message });
    }
  });

  return router;
}

module.exports = { createAuthRouter };
