const express = require('express');
const { getPresetComponentIds } = require('../services/ai-suggest');
const { filterProfanity } = require('../services/profanity');

function createRouter(pool, authMiddleware) {
  const router = express.Router();

  router.use(authMiddleware);

  async function isBuildNameTaken(userId, name, excludeBuildId) {
    const q = excludeBuildId != null
      ? `SELECT id FROM builds WHERE user_id = $1 AND lower(trim(name)) = lower(trim($2)) AND id <> $3 LIMIT 1`
      : `SELECT id FROM builds WHERE user_id = $1 AND lower(trim(name)) = lower(trim($2)) LIMIT 1`;
    const params = excludeBuildId != null ? [userId, name, excludeBuildId] : [userId, name];
    const r = await pool.query(q, params);
    return r.rows.length > 0;
  }

  // Генерирует уникальное имя: "Название", "Название (2)", "Название (3)", ...
  async function generateUniqueBuildName(userId, rawName, excludeBuildId = null) {
    const base = filterProfanity((rawName && String(rawName).trim()) || '');
    if (!base) return { ok: false, error: 'Укажите имя сборки' };
    const stripped = base.replace(/\s*\(\d+\)$/, '').trim();
    if (!(await isBuildNameTaken(userId, stripped, excludeBuildId))) {
      return { ok: true, name: stripped };
    }
    for (let i = 2; i <= 100; i++) {
      const candidate = `${stripped} (${i})`;
      if (!(await isBuildNameTaken(userId, candidate, excludeBuildId))) {
        return { ok: true, name: candidate };
      }
    }
    return { ok: false, error: 'Слишком много сборок с таким названием' };
  }

  async function insertBuildWithComponents(userId, buildName, ids) {
    const buildResult = await pool.query(
      'INSERT INTO builds (user_id, name) VALUES ($1, $2) RETURNING id, name, created_at, updated_at',
      [userId, buildName]
    );
    const build = buildResult.rows[0];
    const buildId = build.id;
    for (const compId of ids) {
      const compRow = await pool.query('SELECT category_id FROM components WHERE id = $1', [compId]);
      if (compRow.rows.length === 0) continue;
      const categoryId = compRow.rows[0].category_id;
      const catRow = await pool.query('SELECT max_per_build FROM component_categories WHERE id = $1', [categoryId]);
      const maxPerBuild = (catRow.rows[0] && catRow.rows[0].max_per_build != null) ? parseInt(catRow.rows[0].max_per_build, 10) : 1;
      const countResult = await pool.query(
        `SELECT COALESCE(SUM(bc.quantity), 0) AS total FROM build_components bc JOIN components c ON c.id = bc.component_id WHERE bc.build_id = $1 AND c.category_id = $2`,
        [buildId, categoryId]
      );
      const current = parseInt(countResult.rows[0].total, 10) || 0;
      if (current >= maxPerBuild) continue;
      await pool.query(
        `INSERT INTO build_components (build_id, component_id, quantity) VALUES ($1, $2, 1)
         ON CONFLICT (build_id, component_id) DO UPDATE SET quantity = build_components.quantity + 1`,
        [buildId, compId]
      );
    }
    return build;
  }

  router.get('/', async (req, res) => {
    try {
      const userId = req.user.userId;
      const result = await pool.query(
        'SELECT id, name, created_at, updated_at FROM builds WHERE user_id = $1 ORDER BY updated_at DESC',
        [userId]
      );
      res.json({ builds: result.rows });
    } catch (err) {
      console.error('Builds list error:', err);
      res.status(500).json({ error: 'Ошибка загрузки сборок' });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const userId = req.user.userId;
      const { name } = req.body || {};
      const buildName = (name && String(name).trim()) || 'Новая сборка';
      const check = await generateUniqueBuildName(userId, buildName);
      if (!check.ok) return res.status(400).json({ error: check.error });
      const result = await pool.query(
        'INSERT INTO builds (user_id, name) VALUES ($1, $2) RETURNING id, name, created_at, updated_at',
        [userId, check.name]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Сборка с таким названием уже существует' });
      }
      console.error('Build create error:', err);
      res.status(500).json({ error: 'Ошибка создания сборки' });
    }
  });

  /**
   * POST /api/builds/from-suggestion
   * Body: { name: string, component_ids: number[] }
   * Создаёт сборку и добавляет в неё все указанные комплектующие. Возвращает созданную сборку с id.
   */
  router.post('/from-suggestion', async (req, res) => {
    try {
      const userId = req.user.userId;
      const { name, component_ids } = req.body || {};
      const buildName = (name && String(name).trim()) || 'Сборка из ИИ';
      const check = await generateUniqueBuildName(userId, buildName);
      if (!check.ok) return res.status(400).json({ error: check.error });
      const ids = Array.isArray(component_ids) ? component_ids.map((id) => parseInt(id, 10)).filter((id) => Number.isInteger(id) && id > 0) : [];
      const build = await insertBuildWithComponents(userId, check.name, ids);
      res.status(201).json(build);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Сборка с таким названием уже существует' });
      }
      console.error('Build from-suggestion error:', err);
      res.status(500).json({ error: 'Ошибка создания сборки из подбора' });
    }
  });

  /**
   * POST /api/builds/from-preset
   * Body: { name: string, preset: "gaming" | "workstation" }
   * Создаёт сборку с подобранными из каталога комплектующими (как готовые сценарии на главной).
   */
  router.post('/from-preset', async (req, res) => {
    try {
      const userId = req.user.userId;
      const { name, preset } = req.body || {};
      const buildName = (name && String(name).trim()) || 'Новая сборка';
      const check = await generateUniqueBuildName(userId, buildName);
      if (!check.ok) return res.status(400).json({ error: check.error });
      const ids = await getPresetComponentIds(pool, preset);
      if (!ids.length) {
        return res.status(503).json({ error: 'Каталог пуст или не удалось подобрать комплектующие' });
      }
      const build = await insertBuildWithComponents(userId, check.name, ids);
      res.status(201).json(build);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Сборка с таким названием уже существует' });
      }
      console.error('Build from-preset error:', err);
      res.status(500).json({ error: 'Ошибка создания сборки по сценарию' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const userId = req.user.userId;
      const buildId = parseInt(req.params.id, 10);
      const buildResult = await pool.query(
        'SELECT id, name, created_at, updated_at FROM builds WHERE id = $1 AND user_id = $2',
        [buildId, userId]
      );
      if (buildResult.rows.length === 0) {
        return res.status(404).json({ error: 'Сборка не найдена' });
      }
      const componentsResult = await pool.query(
        `SELECT bc.id, bc.component_id, bc.quantity, c.name, c.price, c.category_id, c.specs, cat.name as category_name, cat.slug as category_slug
         FROM build_components bc
         JOIN components c ON c.id = bc.component_id
         JOIN component_categories cat ON cat.id = c.category_id
         WHERE bc.build_id = $1
         ORDER BY cat.sort_order, c.name`,
        [buildId]
      );
      const build = buildResult.rows[0];
      build.components = componentsResult.rows;
      build.total_price = componentsResult.rows.reduce((s, r) => s + Number(r.price) * (r.quantity || 1), 0);
      res.json(build);
    } catch (err) {
      console.error('Build get error:', err);
      res.status(500).json({ error: 'Ошибка загрузки сборки' });
    }
  });

  router.get('/:id/compatibility', async (req, res) => {
    try {
      const userId = req.user.userId;
      const buildId = parseInt(req.params.id, 10);
      const buildCheck = await pool.query(
        'SELECT id FROM builds WHERE id = $1 AND user_id = $2',
        [buildId, userId]
      );
      if (buildCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Сборка не найдена' });
      }
      const compResult = await pool.query(
        `SELECT c.id, c.name, c.category_id, c.specs, cat.slug as category_slug
         FROM build_components bc
         JOIN components c ON c.id = bc.component_id
         JOIN component_categories cat ON cat.id = c.category_id
         WHERE bc.build_id = $1`,
        [buildId]
      );
      const warnings = [];
      const bySlug = {};
      for (const r of compResult.rows) {
        if (!bySlug[r.category_slug]) bySlug[r.category_slug] = [];
        bySlug[r.category_slug].push({ name: r.name, specs: r.specs || {} });
      }
      const cpu = (bySlug.processors || [])[0];
      const mb = (bySlug.motherboard || [])[0];
      const rams = bySlug.ram || [];
      const psu = (bySlug.psu || [])[0];
      if (cpu && mb && cpu.specs && mb.specs) {
        const cpuSocket = cpu.specs.socket;
        const mbSocket = mb.specs.socket;
        if (cpuSocket && mbSocket && cpuSocket !== mbSocket) {
          warnings.push({ type: 'socket', message: `Сокет процессора (${cpuSocket}) не совместим с материнской платой (${mbSocket}).` });
        }
      }
      if (mb && rams.length > 0 && mb.specs) {
        const mbRamType = mb.specs.ram_type || mb.specs.memory_type;
        for (const r of rams) {
          if (r.specs && r.specs.type && mbRamType && r.specs.type !== mbRamType) {
            warnings.push({ type: 'ram', message: `Тип памяти ${r.specs.type} может не подходить к материнской плате (${mbRamType}).` });
            break;
          }
        }
      }
      if (psu && psu.specs && psu.specs.power_w) {
        const psuW = parseInt(psu.specs.power_w, 10) || 0;
        if (psuW > 0 && psuW < 450) {
          warnings.push({ type: 'psu', message: `Блок питания ${psuW} Вт может быть недостаточен для сборки.` });
        }
      }
      res.json({ warnings });
    } catch (err) {
      console.error('Compatibility error:', err);
      res.status(500).json({ error: 'Ошибка проверки совместимости' });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const userId = req.user.userId;
      const buildId = parseInt(req.params.id, 10);
      const { name } = req.body || {};
      const buildName = name != null ? String(name).trim() : null;
      if (!buildName) {
        return res.status(400).json({ error: 'Укажите имя сборки' });
      }
      const check = await generateUniqueBuildName(userId, buildName, buildId);
      if (!check.ok) return res.status(400).json({ error: check.error });
      const result = await pool.query(
        'UPDATE builds SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 RETURNING id, name, updated_at',
        [check.name, buildId, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Сборка не найдена' });
      }
      res.json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Сборка с таким названием уже существует' });
      }
      console.error('Build update error:', err);
      res.status(500).json({ error: 'Ошибка обновления' });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const userId = req.user.userId;
      const buildId = parseInt(req.params.id, 10);
      const result = await pool.query(
        'DELETE FROM builds WHERE id = $1 AND user_id = $2 RETURNING id',
        [buildId, userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Сборка не найдена' });
      }
      res.status(204).send();
    } catch (err) {
      console.error('Build delete error:', err);
      res.status(500).json({ error: 'Ошибка удаления' });
    }
  });

  router.post('/:id/components', async (req, res) => {
    try {
      const userId = req.user.userId;
      const buildId = parseInt(req.params.id, 10);
      const { component_id, quantity = 1 } = req.body || {};
      const compId = parseInt(component_id, 10);
      const qty = Math.max(1, parseInt(quantity, 10) || 1);
      const buildCheck = await pool.query(
        'SELECT id FROM builds WHERE id = $1 AND user_id = $2',
        [buildId, userId]
      );
      if (buildCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Сборка не найдена' });
      }
      const compRow = await pool.query(
        'SELECT category_id FROM components WHERE id = $1',
        [compId]
      );
      if (compRow.rows.length === 0) {
        return res.status(404).json({ error: 'Комплектующее не найдено' });
      }
      const categoryId = compRow.rows[0].category_id;
      const catRow = await pool.query(
        'SELECT max_per_build, name FROM component_categories WHERE id = $1',
        [categoryId]
      );
      const maxPerBuild = (catRow.rows[0] && catRow.rows[0].max_per_build != null) ? parseInt(catRow.rows[0].max_per_build, 10) : 1;
      const categoryName = (catRow.rows[0] && catRow.rows[0].name) ? catRow.rows[0].name : 'категория';
      const countResult = await pool.query(
        `SELECT COALESCE(SUM(bc.quantity), 0) AS total
         FROM build_components bc
         JOIN components c ON c.id = bc.component_id
         WHERE bc.build_id = $1 AND c.category_id = $2`,
        [buildId, categoryId]
      );
      const currentTotal = parseInt(countResult.rows[0].total, 10) || 0;
      if (currentTotal + qty > maxPerBuild) {
        return res.status(400).json({
          error: `Достигнут лимит: ${categoryName} (макс. ${maxPerBuild}). В сборке уже ${currentTotal}.`
        });
      }
      await pool.query(
        `INSERT INTO build_components (build_id, component_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (build_id, component_id) DO UPDATE SET quantity = build_components.quantity + $3`,
        [buildId, compId, qty]
      );
      const row = await pool.query(
        `SELECT bc.id, bc.component_id, bc.quantity, c.name, c.price, cat.name as category_name
         FROM build_components bc
         JOIN components c ON c.id = bc.component_id
         JOIN component_categories cat ON cat.id = c.category_id
         WHERE bc.build_id = $1 AND bc.component_id = $2`,
        [buildId, compId]
      );
      res.status(201).json(row.rows[0] || { component_id: compId, quantity: qty });
    } catch (err) {
      if (err.code === '23503') {
        return res.status(404).json({ error: 'Комплектующее не найдено' });
      }
      console.error('Build add component error:', err);
      res.status(500).json({ error: 'Ошибка добавления в сборку' });
    }
  });

  router.delete('/:id/components/:component_id', async (req, res) => {
    try {
      const userId = req.user.userId;
      const buildId = parseInt(req.params.id, 10);
      const componentId = parseInt(req.params.component_id, 10);
      const buildCheck = await pool.query(
        'SELECT id FROM builds WHERE id = $1 AND user_id = $2',
        [buildId, userId]
      );
      if (buildCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Сборка не найдена' });
      }
      await pool.query(
        'DELETE FROM build_components WHERE build_id = $1 AND component_id = $2',
        [buildId, componentId]
      );
      res.status(204).send();
    } catch (err) {
      console.error('Build remove component error:', err);
      res.status(500).json({ error: 'Ошибка удаления из сборки' });
    }
  });

  router.post('/:id/cart', async (req, res) => {
    try {
      const userId = req.user.userId;
      const buildId = parseInt(req.params.id, 10);
      const buildCheck = await pool.query(
        'SELECT id FROM builds WHERE id = $1 AND user_id = $2',
        [buildId, userId]
      );
      if (buildCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Сборка не найдена' });
      }
      const components = await pool.query(
        'SELECT component_id, quantity FROM build_components WHERE build_id = $1',
        [buildId]
      );
      for (const row of components.rows) {
        await pool.query(
          `INSERT INTO cart_items (user_id, component_id, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, component_id) DO UPDATE SET quantity = cart_items.quantity + $3`,
          [userId, row.component_id, row.quantity || 1]
        );
      }
      res.status(201).json({ added: components.rows.length });
    } catch (err) {
      if (err.code === '23503') {
        return res.status(404).json({ error: 'Комплектующее из сборки не найдено' });
      }
      console.error('Build add to cart error:', err);
      res.status(500).json({ error: 'Ошибка добавления сборки в корзину' });
    }
  });

  return router;
}

module.exports = { createRouter };
