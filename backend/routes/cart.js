const express = require('express');

function createRouter(pool, authMiddleware) {
  const router = express.Router();

  router.use(authMiddleware);

  router.get('/', async (req, res) => {
    try {
      const userId = req.user.userId;
      const result = await pool.query(
        `SELECT ci.id, ci.component_id, ci.quantity, c.name, c.price, c.category_id, cat.name as category_name, cat.slug as category_slug
         FROM cart_items ci
         JOIN components c ON c.id = ci.component_id
         JOIN component_categories cat ON cat.id = c.category_id
         WHERE ci.user_id = $1
         ORDER BY cat.sort_order, c.name`,
        [userId]
      );
      const total = result.rows.reduce((s, r) => s + Number(r.price) * (r.quantity || 1), 0);
      res.json({ items: result.rows, total });
    } catch (err) {
      console.error('Cart get error:', err);
      res.status(500).json({ error: 'Ошибка загрузки корзины' });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const userId = req.user.userId;
      const { component_id, quantity = 1 } = req.body || {};
      const compId = parseInt(component_id, 10);
      const qty = Math.max(1, parseInt(quantity, 10) || 1);
      await pool.query(
        `INSERT INTO cart_items (user_id, component_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, component_id) DO UPDATE SET quantity = cart_items.quantity + $3`,
        [userId, compId, qty]
      );
      const row = await pool.query(
        `SELECT ci.id, ci.component_id, ci.quantity, c.name, c.price, cat.name as category_name
         FROM cart_items ci
         JOIN components c ON c.id = ci.component_id
         JOIN component_categories cat ON cat.id = c.category_id
         WHERE ci.user_id = $1 AND ci.component_id = $2`,
        [userId, compId]
      );
      res.status(201).json(row.rows[0] || { component_id: compId, quantity: qty });
    } catch (err) {
      if (err.code === '23503') {
        return res.status(404).json({ error: 'Комплектующее не найдено' });
      }
      console.error('Cart add error:', err);
      res.status(500).json({ error: 'Ошибка добавления в корзину' });
    }
  });

  router.put('/items/:component_id', async (req, res) => {
    try {
      const userId = req.user.userId;
      const componentId = parseInt(req.params.component_id, 10);
      const { quantity } = req.body || {};
      const qty = Math.max(0, parseInt(quantity, 10) || 0);
      if (qty === 0) {
        await pool.query(
          'DELETE FROM cart_items WHERE user_id = $1 AND component_id = $2',
          [userId, componentId]
        );
        return res.status(200).json({ removed: true });
      }
      const result = await pool.query(
        'UPDATE cart_items SET quantity = $1 WHERE user_id = $2 AND component_id = $3 RETURNING id, component_id, quantity',
        [qty, userId, componentId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Позиция не найдена в корзине' });
      }
      res.json(result.rows[0]);
    } catch (err) {
      console.error('Cart update error:', err);
      res.status(500).json({ error: 'Ошибка обновления корзины' });
    }
  });

  router.delete('/items/:component_id', async (req, res) => {
    try {
      const userId = req.user.userId;
      const componentId = parseInt(req.params.component_id, 10);
      await pool.query(
        'DELETE FROM cart_items WHERE user_id = $1 AND component_id = $2',
        [userId, componentId]
      );
      res.status(204).send();
    } catch (err) {
      console.error('Cart delete error:', err);
      res.status(500).json({ error: 'Ошибка удаления из корзины' });
    }
  });

  return router;
}

module.exports = { createRouter };
