const express = require('express')

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatRub(n) {
  const x = Number(n)
  return Number.isFinite(x)
    ? x.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'
}

/**
 * Формирует HTML акта приёма-передачи.
 * Сохраняется в БД и отдаётся Android-приложению как «.doc» с MIME application/msword —
 * Word, Pages, LibreOffice, Google Docs и WPS открывают такие файлы как Word-документ.
 */
function renderOrderActHtml(order) {
  let items = order.items_json
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items || '[]')
    } catch (_) {
      items = []
    }
  }
  if (!Array.isArray(items)) items = []

  let rows = ''
  let i = 1
  for (const it of items) {
    const qty = Number(it.quantity) || 1
    const price = Number(it.price) || 0
    const sum = price * qty
    const name = escapeHtml(it.name != null ? String(it.name) : 'Позиция')
    rows += `<tr>
      <td style="padding:6px 10px;border:1px solid #111;">${i}. ${name}</td>
      <td style="padding:6px 10px;border:1px solid #111;text-align:center;">${qty}</td>
      <td style="padding:6px 10px;border:1px solid #111;text-align:right;">${formatRub(price)}</td>
      <td style="padding:6px 10px;border:1px solid #111;text-align:right;">${formatRub(sum)}</td>
    </tr>`
    i += 1
  }

  const total = formatRub(order.total_rub)
  const recv = order.received_at
    ? new Date(order.received_at).toLocaleString('ru-RU')
    : new Date().toLocaleString('ru-RU')
  const custName = escapeHtml(String(order.customer_name || '—'))
  const custEmail = escapeHtml(String(order.customer_email || '—'))
  const custPhone = escapeHtml(String(order.customer_phone || '—'))
  const ship = escapeHtml(String(order.shipping_address || '—'))
  const ordId = escapeHtml(String(order.id))

  // Корневой документ с XML namespace под MS Office — Word подхватывает форматирование,
  // печать корректно идёт на A4. Файл сохраняется с расширением .doc.
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40" lang="ru">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="ProgId" content="Word.Document">
<meta name="Generator" content="Microsoft Word 15">
<title>Акт заказа ${ordId}</title>
<!--[if gte mso 9]><xml>
<w:WordDocument>
  <w:View>Print</w:View>
  <w:Zoom>100</w:Zoom>
  <w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml><![endif]-->
<style>
@page Section1 { size: 21cm 29.7cm; margin: 2cm 1.8cm 2cm 2.5cm; mso-page-orientation: portrait; }
div.Section1 { page: Section1; }
body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #000; }
h1.doc-title { font-size: 14pt; text-align: center; font-weight: bold; margin: 0 0 6pt; }
.doc-sub { text-align: center; font-size: 11pt; margin-bottom: 18pt; color: #333; }
.meta { margin: 0 0 12pt; line-height: 1.55; }
.preamble { text-align: justify; line-height: 1.55; margin: 0 0 14pt; }
table.act { border-collapse: collapse; width: 100%; margin: 10pt 0; font-size: 11pt; table-layout: fixed; }
table.act th { background: #ececec; padding: 8px 10px; border: 1px solid #111; font-weight: bold; text-align: left; vertical-align: middle; }
table.act td { vertical-align: top; line-height: 1.35; }
.total { margin-top: 12pt; font-weight: bold; font-size: 12pt; }
.signatures { width: 100%; margin-top: 32pt; border-collapse: collapse; }
.sign-cell { width: 50%; vertical-align: bottom; padding-right: 10pt; }
.sign-cell:last-child { padding-right: 0; padding-left: 10pt; }
.sign-line { border-top: 1px solid #111; padding-top: 4pt; margin-top: 48pt; line-height: 1.45; }
.fine { font-size: 9pt; color: #444; margin-top: 24pt; line-height: 1.4; }
</style>
</head>
<body>
<div class="Section1">
  <h1 class="doc-title">Акт приёма-передачи товара</h1>
  <div class="doc-sub">по заказу № ${ordId} от сервиса PC Forge</div>
  <p class="meta">
    <b>Заказчик:</b> ${custName}<br/>
    <b>Контактный телефон:</b> ${custPhone}<br/>
    <b>Электронная почта:</b> ${custEmail}<br/>
    <b>Адрес доставки:</b> ${ship}<br/>
    <b>Дата подтверждения получения:</b> ${escapeHtml(recv)}
  </p>
  <p class="preamble">
    Заказчик подтверждает получение перечисленного ниже товара в полном объёме. Внешний вид и комплектность удовлетворяют,
    претензий к поставщику/исполнителю на момент приёмки заказчик не имеет.
  </p>
  <table class="act">
    <thead>
      <tr>
        <th style="text-align:left;">Наименование</th>
        <th style="width:18%;text-align:center;">Кол-во</th>
        <th style="width:20%;text-align:right;">Цена, ₽</th>
        <th style="width:22%;text-align:right;">Сумма, ₽</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="total">Итого к оплате по документу: ${total} ₽</p>
  <table class="signatures">
    <tr>
      <td class="sign-cell">
        <div class="sign-line">
          Заказчик: ФИО, подпись, дата
        </div>
      </td>
      <td class="sign-cell">
        <div class="sign-line">
          Представитель исполнителя: ФИО, подпись, дата
        </div>
      </td>
    </tr>
  </table>
  <p class="fine">
    Документ сформирован автоматически приложением PC Forge.
    Может использоваться для личного учёта и предъявления. Юридическую значимость при необходимости оформляют на бумажном носителе по шаблону организации.
  </p>
</div>
</body>
</html>`
}

function toPriceNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Создаёт документ-акт и сохраняет в order_documents. Возвращает строку из БД. */
async function createReceivedActDocument(pool, order) {
  const html = renderOrderActHtml(order)
  const fileName = `act-order-${order.id}.doc`
  const title = `Акт приёма заказа №${order.id}`
  const r = await pool.query(
    `INSERT INTO order_documents (user_id, order_id, kind, title, file_name, mime_type, content)
     VALUES ($1, $2, 'receipt_act', $3, $4, 'application/msword', $5)
     ON CONFLICT (order_id, kind) DO UPDATE
       SET title = EXCLUDED.title,
           file_name = EXCLUDED.file_name,
           mime_type = EXCLUDED.mime_type,
           content = EXCLUDED.content,
           created_at = CURRENT_TIMESTAMP
     RETURNING id, user_id, order_id, kind, title, file_name, mime_type, created_at`,
    [order.user_id, order.id, title, fileName, html]
  )
  return r.rows[0]
}

function createRouter(pool, authMiddleware, resolveUserRole) {
  const router = express.Router()
  router.use(authMiddleware)

  function isAssembler(req) {
    return resolveUserRole(req.user.email) === 'assembler'
  }

  async function createNotification(userId, title, body) {
    await pool.query(
      `INSERT INTO order_notifications (user_id, title, body)
       VALUES ($1, $2, $3)`,
      [userId, title, body]
    )
  }

  router.post('/', async (req, res) => {
    try {
      const userId = Number(req.user.userId)
      if (!Number.isFinite(userId)) return res.status(401).json({ error: 'Неверный токен' })
      const customerName = String(req.body?.customer_name || '').trim()
      const customerPhone = String(req.body?.customer_phone || '').trim()
      const customerEmail = String(req.body?.customer_email || '').trim()
      const shippingAddress = String(req.body?.shipping_address || '').trim()
      const comment = String(req.body?.comment || '').trim()
      if (!customerName || !customerPhone || !customerEmail || !shippingAddress) {
        return res.status(400).json({ error: 'Заполните имя, телефон, email и адрес доставки' })
      }

      const cartResult = await pool.query(
        `SELECT ci.component_id, ci.quantity, c.name, c.price
         FROM cart_items ci
         JOIN components c ON c.id = ci.component_id
         WHERE ci.user_id = $1
         ORDER BY c.name`,
        [userId]
      )
      if (cartResult.rows.length === 0) {
        return res.status(400).json({ error: 'Корзина пуста' })
      }

      const items = cartResult.rows.map((r) => ({
        component_id: Number(r.component_id),
        name: r.name,
        quantity: Number(r.quantity) || 1,
        price: String(r.price ?? '0'),
      }))
      const total = items.reduce((s, it) => s + toPriceNumber(it.price) * it.quantity, 0)

      const insertOrder = await pool.query(
        `INSERT INTO orders (
           user_id, customer_name, customer_phone, customer_email, shipping_address,
           comment, items_json, total_rub, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
         RETURNING id, user_id, customer_name, customer_phone, customer_email, shipping_address,
                   comment, items_json, total_rub, status, created_at, updated_at, completed_at, received_at`,
        [
          userId,
          customerName,
          customerPhone,
          customerEmail,
          shippingAddress,
          comment || null,
          JSON.stringify(items),
          total,
          'new',
        ]
      )
      await pool.query('DELETE FROM cart_items WHERE user_id = $1', [userId])

      await createNotification(userId, 'Заказ принят', `Заказ #${insertOrder.rows[0].id} создан и передан сборщику.`)

      const usersResult = await pool.query('SELECT id, email FROM users')
      const assemblerIds = usersResult.rows
        .filter((u) => resolveUserRole(u.email) === 'assembler')
        .map((u) => Number(u.id))
        .filter(Number.isFinite)
      for (const assemblerId of assemblerIds) {
        await createNotification(
          assemblerId,
          'Новый заказ',
          `Получен заказ #${insertOrder.rows[0].id} от ${customerName}.`
        )
      }

      res.status(201).json(insertOrder.rows[0])
    } catch (err) {
      console.error('POST /api/orders', err)
      res.status(500).json({ error: 'Ошибка оформления заказа' })
    }
  })

  router.get('/my', async (req, res) => {
    try {
      const userId = Number(req.user.userId)
      const result = await pool.query(
        `SELECT id, user_id, customer_name, customer_phone, customer_email, shipping_address,
                comment, items_json, total_rub, status, created_at, updated_at, completed_at, received_at
         FROM orders
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      )
      res.json({ orders: result.rows })
    } catch (err) {
      console.error('GET /api/orders/my', err)
      res.status(500).json({ error: 'Ошибка загрузки заказов' })
    }
  })

  router.get('/assigned', async (req, res) => {
    try {
      if (!isAssembler(req)) return res.status(403).json({ error: 'Доступ только для сборщика' })
      const result = await pool.query(
        `SELECT id, user_id, customer_name, customer_phone, customer_email, shipping_address,
                comment, items_json, total_rub, status, created_at, updated_at, completed_at, received_at
         FROM orders
         ORDER BY CASE status
           WHEN 'new' THEN 0
           WHEN 'sent' THEN 1
           WHEN 'received' THEN 2
           ELSE 3
         END, created_at DESC`
      )
      res.json({ orders: result.rows })
    } catch (err) {
      console.error('GET /api/orders/assigned', err)
      res.status(500).json({ error: 'Ошибка загрузки заказов' })
    }
  })

  router.post('/:id/complete', async (req, res) => {
    try {
      if (!isAssembler(req)) return res.status(403).json({ error: 'Доступ только для сборщика' })
      const orderId = Number(req.params.id)
      if (!Number.isFinite(orderId)) return res.status(400).json({ error: 'Некорректный ID заказа' })
      const assemblerId = Number(req.user.userId)
      const result = await pool.query(
        `UPDATE orders
         SET status = 'sent', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, completed_by = $2
         WHERE id = $1 AND status = 'new'
         RETURNING id, user_id, customer_name, customer_phone, customer_email, shipping_address,
                   comment, items_json, total_rub, status, created_at, updated_at, completed_at, received_at`,
        [orderId, assemblerId]
      )
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Заказ не найден, уже отправлен или закрыт' })
      }
      const row = result.rows[0]
      await createNotification(row.user_id, 'Заказ отправлен', `Заказ #${row.id} отправлен. Ожидайте доставку.`)
      res.json(row)
    } catch (err) {
      console.error('POST /api/orders/:id/complete', err)
      res.status(500).json({ error: 'Ошибка завершения заказа' })
    }
  })

  router.post('/:id/confirm-receipt', async (req, res) => {
    try {
      if (isAssembler(req)) return res.status(403).json({ error: 'Подтверждает только покупатель' })
      const userId = Number(req.user.userId)
      const orderId = Number(req.params.id)
      if (!Number.isFinite(orderId)) return res.status(400).json({ error: 'Некорректный ID заказа' })
      const result = await pool.query(
        `UPDATE orders
         SET status = 'received', received_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND user_id = $2 AND status = 'sent'
         RETURNING id, user_id, customer_name, customer_phone, customer_email, shipping_address,
                   comment, items_json, total_rub, status, created_at, updated_at, completed_at, received_at`,
        [orderId, userId]
      )
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Заказ не найден или нельзя подтвердить на этом этапе' })
      }
      const row = result.rows[0]
      await createNotification(userId, 'Спасибо!', `Заказ #${row.id} отмечен как полученный.`)

      const usersResult = await pool.query('SELECT id, email FROM users')
      const assemblerIds = usersResult.rows
        .filter((u) => resolveUserRole(u.email) === 'assembler')
        .map((u) => Number(u.id))
        .filter(Number.isFinite)
      for (const assemblerId of assemblerIds) {
        await createNotification(
          assemblerId,
          'Заказ получен клиентом',
          `Клиент подтвердил получение заказа #${row.id}.`
        )
      }

      let documentSaved = false
      let documentError = null
      try {
        const doc = await createReceivedActDocument(pool, row)
        documentSaved = true
        await createNotification(
          userId,
          'Документ готов',
          `По заказу #${row.id} сформирован акт приёма. Откройте «Документы» в профиле.`
        )
        console.info(`confirm-receipt: документ-акт сохранён id=${doc.id} order=${row.id}`)
      } catch (docErr) {
        documentError = docErr && docErr.message ? docErr.message : String(docErr)
        console.error('confirm-receipt: сохранение акта в БД:', docErr)
      }

      res.json({
        ...row,
        document_saved: documentSaved,
        document_error: documentError,
      })
    } catch (err) {
      console.error('POST /api/orders/:id/confirm-receipt', err)
      res.status(500).json({ error: 'Ошибка подтверждения получения' })
    }
  })

  router.get('/notifications/my', async (req, res) => {
    try {
      const userId = Number(req.user.userId)
      const result = await pool.query(
        `SELECT id, title, body, is_read, created_at
         FROM order_notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [userId]
      )
      res.json({ notifications: result.rows })
    } catch (err) {
      console.error('GET /api/orders/notifications/my', err)
      res.status(500).json({ error: 'Ошибка загрузки уведомлений' })
    }
  })

  router.post('/notifications/read-all', async (req, res) => {
    try {
      const userId = Number(req.user.userId)
      await pool.query(
        `UPDATE order_notifications
         SET is_read = true
         WHERE user_id = $1 AND is_read = false`,
        [userId]
      )
      res.json({ ok: true })
    } catch (err) {
      console.error('POST /api/orders/notifications/read-all', err)
      res.status(500).json({ error: 'Ошибка обновления уведомлений' })
    }
  })

  return router
}

module.exports = { createRouter, renderOrderActHtml, createReceivedActDocument }
