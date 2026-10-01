import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// GET /notifications
router.get('/notifications', authenticate, async (req, res, next) => {
  try {
    const { unreadOnly, limit = 50 } = req.query;
    let sql = `SELECT n.*,
                      COALESCE(n.payload->>'title', 'Notification') AS title,
                      COALESCE(n.payload->>'message', '') AS message,
                      (n.read_at IS NOT NULL) AS read,
                      to_char(n.created_at, 'Mon DD, HH12:MI AM') AS time
               FROM notifications n WHERE n.recipient_id = $1`;
    const params = [req.user.id];

    if (unreadOnly === 'true') {
      sql += ' AND n.read_at IS NULL';
    }

    sql += ' ORDER BY n.created_at DESC LIMIT $2';
    params.push(Math.min(100, Number(limit) || 50));

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /notifications/:id/read
router.post('/notifications/:id/read', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND recipient_id = $2 RETURNING *',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notification not found.' } });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
