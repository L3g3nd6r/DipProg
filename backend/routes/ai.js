const express = require('express');
const { stripChatInput } = require('../services/ai-normalize');
const { getAiResponse } = require('../services/ai-suggest');

function createRouter(pool) {
  const router = express.Router();

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
