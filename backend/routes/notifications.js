import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// GET /notifications
router.get('/notifications', authenticate, async (req, res, next) => {
  try {
    const { unreadOnly, limit = 50 } = req.query;
    let sql = 'SELECT * FROM notifications WHERE recipient_id = $1';
    const params = [req.user.id];

    if (unreadOnly === 'true') {
      sql += ' AND read_at IS NULL';
    }

    sql += ' ORDER BY created_at DESC LIMIT $2';
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
      'UPDATE notifications SET read_at = now() WHERE id = $1 AND recipient_id = $2 RETURNING *',
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notification not found.' } });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
