const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db      = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function row2item(r) {
  return {
    id:        r.id,
    title:     r.title,
    subject:   r.subject,
    dueDate:   r.due_date,
    dueTime:   r.due_time   || null,
    priority:  r.priority,
    status:    r.status,
    notes:     r.notes      || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// GET /homework
router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM homework WHERE user_id = ? ORDER BY due_date ASC, created_at ASC'
  ).all(req.userId);
  return res.json(rows.map(row2item));
});

// POST /homework
router.post('/', (req, res) => {
  const { title, subject, dueDate, dueTime, priority, status, notes } = req.body;
  if (!title || !subject || !dueDate) {
    return res.status(400).json({ message: 'title, subject and dueDate are required.' });
  }
  const id  = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO homework (id, user_id, title, subject, due_date, due_time, priority, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.userId, title, subject, dueDate,
    dueTime || null, priority || 'medium', status || 'pending',
    notes || null, now, now
  );
  const row = db.prepare('SELECT * FROM homework WHERE id = ?').get(id);
  return res.status(201).json(row2item(row));
});

// PATCH /homework/:id
router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM homework WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ message: 'Not found.' });

  const { title, subject, dueDate, dueTime, priority, status, notes } = req.body;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE homework SET
      title    = COALESCE(?, title),
      subject  = COALESCE(?, subject),
      due_date = COALESCE(?, due_date),
      due_time = COALESCE(?, due_time),
      priority = COALESCE(?, priority),
      status   = COALESCE(?, status),
      notes    = COALESCE(?, notes),
      updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    title || null, subject || null, dueDate || null, dueTime || null,
    priority || null, status || null, notes || null,
    now, req.params.id, req.userId
  );
  const row = db.prepare('SELECT * FROM homework WHERE id = ?').get(req.params.id);
  return res.json(row2item(row));
});

// DELETE /homework/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM homework WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ message: 'Not found.' });
  return res.json({ ok: true });
});

// POST /homework/sync  — bulk upsert for offline-first sync
router.post('/sync', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ message: 'items must be an array.' });

  const upsert = db.prepare(`
    INSERT INTO homework (id, user_id, title, subject, due_date, due_time, priority, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title      = excluded.title,
      subject    = excluded.subject,
      due_date   = excluded.due_date,
      due_time   = excluded.due_time,
      priority   = excluded.priority,
      status     = excluded.status,
      notes      = excluded.notes,
      updated_at = excluded.updated_at
  `);

  const syncAll = db.transaction((items) => {
    for (const item of items) {
      upsert.run(
        item.id, req.userId, item.title, item.subject, item.dueDate,
        item.dueTime || null, item.priority || 'medium', item.status || 'pending',
        item.notes || null, item.createdAt || new Date().toISOString(),
        item.updatedAt || new Date().toISOString()
      );
    }
  });
  syncAll(items);

  const rows = db.prepare('SELECT * FROM homework WHERE user_id = ? ORDER BY due_date ASC').all(req.userId);
  return res.json(rows.map(row2item));
});

module.exports = router;