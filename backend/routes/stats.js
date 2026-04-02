const express = require('express');

/**
 * Статистика пользователя (только с авторизацией).
 */
function createRouter(pool, authMiddleware) {
  const router = express.Router();
  router.use(authMiddleware);

  router.get('/me', async (req, res) => {
    try {
      const userId = Number(req.user.userId);
      if (!Number.isFinite(userId)) {
        return res.status(401).json({ error: 'Неверный токен' });
      }

      const [builds, cart, cartTotal, buildSlots, userRow] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS c FROM builds WHERE user_id = $1', [userId]),
        pool.query(
          `SELECT COALESCE(SUM(quantity), 0)::int AS qty, COUNT(*)::int AS lines
           FROM cart_items WHERE user_id = $1`,
          [userId]
        ),
        pool.query(
          `SELECT COALESCE(SUM(ci.quantity * c.price), 0) AS total
           FROM cart_items ci
           JOIN components c ON c.id = ci.component_id
           WHERE ci.user_id = $1`,
          [userId]
        ),
        pool.query(
          `SELECT COALESCE(SUM(bc.quantity), 0)::int AS c
           FROM build_components bc
           INNER JOIN builds b ON b.id = bc.build_id
           WHERE b.user_id = $1`,
          [userId]
        ),
        pool.query(
          `SELECT COALESCE(
             u.created_at,
             (SELECT MIN(b.created_at) FROM builds b WHERE b.user_id = u.id),
             NOW()
           ) AS created_at
           FROM users u WHERE u.id = $1`,
          [userId]
        ),
      ]);

      const rawTotal = cartTotal.rows[0] && cartTotal.rows[0].total;
      const totalStr = rawTotal != null ? String(rawTotal) : '0';

      const created = userRow.rows[0] && userRow.rows[0].created_at;
      let memberSince = null;
      if (created != null) {
        const d = new Date(created);
        if (!Number.isNaN(d.getTime())) memberSince = d.toISOString();
      }

      // node-pg часто отдаёт COUNT/SUM строками — в JSON должны быть числа, иначе клиент Gson падает
      res.json({
        builds_count: parseInt(builds.rows[0].c, 10) || 0,
        cart_lines: parseInt(cart.rows[0].lines, 10) || 0,
        cart_quantity: parseInt(cart.rows[0].qty, 10) || 0,
        cart_total_rub: totalStr,
        build_component_slots: parseInt(buildSlots.rows[0].c, 10) || 0,
        member_since: memberSince,
      });
    } catch (err) {
      console.error('GET /api/stats/me', err);
      res.status(500).json({ error: 'Ошибка статистики' });
    }
  });

  return router;
}

module.exports = { createRouter };
