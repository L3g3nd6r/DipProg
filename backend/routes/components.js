const express = require('express');

/** Разбивает запрос на токены (буквы/цифры любого алфавита), игнорируя дефисы, пробелы и прочие знаки. */
function searchTokensFromQuery(raw) {
  const s = String(raw || '').normalize('NFKC');
  const spaced = s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!spaced) return [];
  return spaced.split(/\s+/).filter(Boolean);
}

/** Экранирование для ILIKE: % и _ в вводе пользователя — буквально. */
function escapeLikeToken(t) {
  return t.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * «i3 12100» или «i3-12100» → %i3%12100% — найдёт «Core i3-12100».
 * Токены идут по порядку в названии, между ними допустимы любые символы.
 */
function buildFlexibleSearchPattern(raw) {
  const tokens = searchTokensFromQuery(raw);
  if (tokens.length === 0) return null;
  const body = tokens.map(escapeLikeToken).join('%');
  return `%${body}%`;
}

function createRouter(pool) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const { category_id, search, limit = 50, offset = 0 } = req.query;
      let query = `
        SELECT c.id, c.category_id, c.name, c.description, c.price, c.image_url, c.external_url, c.specs, cat.name as category_name, cat.slug as category_slug
        FROM components c
        JOIN component_categories cat ON cat.id = c.category_id
        WHERE 1=1
      `;
      const params = [];
      let n = 1;
      if (category_id) {
        query += ` AND c.category_id = $${n}`;
        params.push(parseInt(category_id, 10));
        n++;
      }
      const searchPattern = search && String(search).trim() ? buildFlexibleSearchPattern(search) : null;
      if (searchPattern) {
        query += ` AND (c.name ILIKE $${n} ESCAPE '\\' OR c.description ILIKE $${n} ESCAPE '\\')`;
        params.push(searchPattern);
        n++;
      }
      query += ` ORDER BY c.price ASC LIMIT $${n} OFFSET $${n + 1}`;
      params.push(parseInt(limit, 10) || 50, parseInt(offset, 10) || 0);
      const result = await pool.query(query, params);
      res.json({ components: result.rows });
    } catch (err) {
      console.error('Components list error:', err);
      res.status(500).json({ error: 'Ошибка загрузки комплектующих' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        `SELECT c.id, c.category_id, c.name, c.description, c.price, c.image_url, c.external_url, c.specs, cat.name as category_name, cat.slug as category_slug
         FROM components c
         JOIN component_categories cat ON cat.id = c.category_id
         WHERE c.id = $1`,
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Комплектующее не найдено' });
      }
      res.json(result.rows[0]);
    } catch (err) {
      console.error('Component get error:', err);
      res.status(500).json({ error: 'Ошибка загрузки' });
    }
  });

  return router;
}

module.exports = { createRouter };
