const express = require('express');
const { Pool } = require('pg');

function createRouter(pool) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, name, slug, sort_order, max_per_build FROM component_categories ORDER BY sort_order, name'
      );
      res.json({ categories: result.rows });
    } catch (err) {
      console.error('Categories list error:', err);
      res.status(500).json({ error: 'Ошибка загрузки категорий' });
    }
  });

  return router;
}

module.exports = { createRouter };
