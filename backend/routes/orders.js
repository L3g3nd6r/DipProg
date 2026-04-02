const express = require('express')

function toPriceNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
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

      res.json(row)
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

module.exports = { createRouter }
