const express = require('express');
const { stripChatInput } = require('../services/ai-normalize');
const { getAiResponse, analyzeBuild } = require('../services/ai-suggest');
const { checkBuildInspectorEligibility } = require('../services/build-inspector-eligibility');

function createRouter(pool) {
  const router = express.Router();

  /**
   * POST /api/ai/analyze-build
   * Body: { build_summary: string }
   * Возвращает развёрнутый разбор сборки: оценка, узкое место, FPS-прогноз, апгрейд, «персона».
   */
  router.post('/analyze-build', async (req, res) => {
    try {
      const raw = (req.body && req.body.build_summary) != null ? String(req.body.build_summary) : '';
      const buildSummary = stripChatInput(raw).trim();
      if (!buildSummary || buildSummary.length < 10) {
        return res.status(400).json({ error: 'Передайте описание сборки (build_summary)' });
      }
      const categorySlugs = Array.isArray(req.body?.category_slugs) ? req.body.category_slugs : [];
      const componentCount = Number(req.body?.component_count);
      const eligibility = checkBuildInspectorEligibility(
        categorySlugs,
        Number.isFinite(componentCount) && componentCount > 0 ? componentCount : categorySlugs.length,
      );
      if (!eligibility.ok) {
        return res.status(400).json({ error: eligibility.error });
      }
      const analysis = await analyzeBuild(buildSummary);
      res.json(analysis);
    } catch (err) {
      console.error('AI analyze-build error:', err);
      res.status(500).json({ error: 'Ошибка анализа сборки' });
    }
  });

  /**
   * POST /api/ai/build-suggestions
   * Body: { message: string }
   * Returns: { text?: string } — ответ текстом (приветствие, вопрос)
   *       или { suggestions: [ { name, description, pros, cons, component_ids }, ... ] } — подбор сборок
   */
  router.post('/build-suggestions', async (req, res) => {
    try {
      const { message, build_summary, history } = req.body || {};
      const text = message != null ? stripChatInput(message) : '';
      if (!text) {
        return res.status(400).json({ error: 'Укажите сообщение (message)' });
      }
      const buildSummary = build_summary != null ? String(build_summary).trim() : null;
      // history — массив [{role:'user'|'assistant', content: string}], до 10 элементов
      const chatHistory = Array.isArray(history)
        ? history.slice(-10).filter(h => (h.role === 'user' || h.role === 'assistant') && h.content)
        : null;
      const result = await getAiResponse(pool, text, buildSummary, chatHistory);
      res.json(result);
    } catch (err) {
      console.error('AI build-suggestions error:', err);
      res.status(500).json({ error: 'Ошибка подбора сборок' });
    }
  });

  return router;
}

module.exports = { createRouter };
