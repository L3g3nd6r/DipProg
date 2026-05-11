const nodemailer = require('nodemailer');

/**
 * Отправка писем: предпочтительно Brevo Transactional API (HTTPS), затем Resend, затем SMTP.
 * Только SMTP иногда даёт «успех» в логах, а до ящика письмо не доходит — API надёжнее.
 *
 * BREVO_API_KEY — ключ API v3 из панели Brevo (xkeysib-...), раздел SMTP & API → API keys
 * BREVO_SENDER_EMAIL — подтверждённый отправитель (тот же, что для SMTP)
 *
 * RESEND_API_KEY + RESEND_FROM — опционально, если используете Resend
 */

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
    port: Number(process.env.BREVO_SMTP_PORT || 587),
    secure: String(process.env.BREVO_SMTP_SECURE || '') === '1',
    auth: {
      user: process.env.BREVO_SMTP_LOGIN,
      pass: process.env.BREVO_SMTP_KEY,
    },
  });
}

function isMailConfigured() {
  const api = Boolean(process.env.BREVO_API_KEY);
  const smtp = Boolean(process.env.BREVO_SMTP_LOGIN && process.env.BREVO_SMTP_KEY);
  const resend = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
  return api || smtp || resend;
}

function htmlToPlainFallback(html) {
  return String(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveSenderEmail() {
  return String(process.env.BREVO_SENDER_EMAIL || process.env.BREVO_SMTP_LOGIN || process.env.RESEND_FROM || '').trim();
}

/** Brevo REST v3 — лучшая доставляемость, чем чистый SMTP */
async function sendViaBrevoRest(to, subject, html, textBody) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY не задан');

  const senderEmail = resolveSenderEmail();
  if (!senderEmail.includes('@')) {
    throw new Error('Задайте BREVO_SENDER_EMAIL или BREVO_SMTP_LOGIN (отправитель в Brevo)');
  }

  const payload = {
    sender: { name: 'PC Forge', email: senderEmail },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: textBody,
  };

  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  const raw = await r.text();
  let j = {};
  try {
    j = JSON.parse(raw);
  } catch (_) {}

  if (!r.ok) {
    const msg = j.message || j.error || j.code || raw || `HTTP ${r.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  console.info(`sendHtmlEmail: Brevo REST OK to=${to} messageId=${j.messageId || '—'}`);
  return j;
}

async function sendViaResend(to, subject, html, textBody) {
  const key = process.env.RESEND_API_KEY;
  const fromAddr = String(process.env.RESEND_FROM || '').trim();
  if (!key || !fromAddr.includes('@')) throw new Error('RESEND не настроен');

  const { Resend } = require('resend');
  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({
    from: `PC Forge <${fromAddr}>`,
    to: [to],
    subject,
    html,
    text: textBody,
  });
  if (error) throw new Error(error.message || 'Resend error');
  console.info(`sendHtmlEmail: Resend OK to=${to} id=${data?.id || '—'}`);
  return data;
}

async function sendViaSmtp(to, subject, html, textBody) {
  const login = process.env.BREVO_SMTP_LOGIN;
  const key = process.env.BREVO_SMTP_KEY;
  if (!login || !key) {
    throw new Error('SMTP не настроен (BREVO_SMTP_LOGIN / BREVO_SMTP_KEY)');
  }

  const transporter = createTransport();
  const fromAddr = resolveSenderEmail() || login;
  const from = `"PC Forge" <${fromAddr}>`;

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text: textBody,
    html,
  });
  console.info(`sendHtmlEmail: SMTP OK to=${to} from=${fromAddr} messageId=${info.messageId || '—'}`);
  return info;
}

/**
 * @param {string} to
 * @param {string} subject
 * @param {string} html
 * @param {string|null} [plainText]
 */
async function sendHtmlEmail(to, subject, html, plainText = null) {
  const textBody =
    plainText != null && String(plainText).trim() !== '' ? plainText : htmlToPlainFallback(html);

  const forceSmtp = String(process.env.MAIL_DRIVER || '').toLowerCase() === 'smtp';
  const attempts = [];

  async function tryChain() {
    if (!forceSmtp && process.env.BREVO_API_KEY) {
      try {
        return await sendViaBrevoRest(to, subject, html, textBody);
      } catch (e) {
        attempts.push(`Brevo REST: ${e.message}`);
        console.warn('sendHtmlEmail: Brevo REST не удалась, пробуем дальше:', e.message);
      }
    }

    if (!forceSmtp && process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
      try {
        return await sendViaResend(to, subject, html, textBody);
      } catch (e) {
        attempts.push(`Resend: ${e.message}`);
        console.warn('sendHtmlEmail: Resend не удалась, пробуем SMTP:', e.message);
      }
    }

    try {
      return await sendViaSmtp(to, subject, html, textBody);
    } catch (e) {
      attempts.push(`SMTP: ${e.message}`);
      throw new Error(attempts.join(' → ') || e.message);
    }
  }

  try {
    return await tryChain();
  } catch (err) {
    console.error('sendHtmlEmail: все способы не сработали:', err.message);
    throw err;
  }
}

module.exports = { sendHtmlEmail, isMailConfigured };
