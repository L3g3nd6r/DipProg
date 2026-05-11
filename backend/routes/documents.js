const express = require('express')

/**
 * Документы пользователя: акт приёма заказа и любые будущие документы.
 * Контент хранится в БД (text/html, открывается как Word документ через MIME application/msword).
 */
function createRouter(pool, authMiddleware) {
  const router = express.Router()
  router.use(authMiddleware)

  // Список документов пользователя
  router.get('/', async (req, res) => {
    try {
      const userId = Number(req.user.userId)
      if (!Number.isFinite(userId)) return res.status(401).json({ error: 'Неверный токен' })
      const result = await pool.query(
        `SELECT id, order_id, kind, title, file_name, mime_type, created_at
         FROM order_documents
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      )
      res.json({ documents: result.rows })
    } catch (err) {
      console.error('GET /api/documents', err)
      res.status(500).json({ error: 'Не удалось загрузить документы' })
    }
  })

  // Скачать документ (как Word .doc)
  router.get('/:id/download', async (req, res) => {
    try {
      const userId = Number(req.user.userId)
      const docId = Number(req.params.id)
      if (!Number.isFinite(docId)) return res.status(400).json({ error: 'Некорректный ID документа' })
      const result = await pool.query(
        `SELECT id, user_id, file_name, mime_type, content
         FROM order_documents
         WHERE id = $1 AND user_id = $2
         LIMIT 1`,
        [docId, userId]
      )
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Документ не найден' })
      }
      const row = result.rows[0]
      const fileName = String(row.file_name || `document-${row.id}.doc`)
      const mime = String(row.mime_type || 'application/msword')
      // RFC 5987: имя файла с unicode (для нелатинских символов) — Android/Word корректно подхватят
      const safeAscii = fileName.replace(/[^A-Za-z0-9._-]+/g, '_')
      res.setHeader('Content-Type', mime + '; charset=utf-8')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
      )
      res.send(Buffer.from(String(row.content || ''), 'utf-8'))
    } catch (err) {
      console.error('GET /api/documents/:id/download', err)
      res.status(500).json({ error: 'Не удалось получить документ' })
    }
  })

  // Удалить документ
  router.delete('/:id', async (req, res) => {
    try {
      const userId = Number(req.user.userId)
      const docId = Number(req.params.id)
      if (!Number.isFinite(docId)) return res.status(400).json({ error: 'Некорректный ID документа' })
      const r = await pool.query(
        'DELETE FROM order_documents WHERE id = $1 AND user_id = $2 RETURNING id',
        [docId, userId]
      )
      if (r.rows.length === 0) return res.status(404).json({ error: 'Документ не найден' })
      res.json({ ok: true })
    } catch (err) {
      console.error('DELETE /api/documents/:id', err)
      res.status(500).json({ error: 'Не удалось удалить документ' })
    }
  })

  return router
}

module.exports = { createRouter }
