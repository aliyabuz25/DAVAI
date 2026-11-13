const express = require('express');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db      = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, plan: user.plan },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function safeUser(row) {
  return {
    id:        row.id,
    name:      row.name,
    email:     row.email,
    plan:      row.plan,
    program:   row.program,
    school:    row.school  || null,
    createdAt: row.created_at,
  };
}

// POST /payment/submit — no auth required (guest can pay too)
router.post('/submit', (req, res) => {
  const { planId, senderName, senderRef, userId } = req.body;
  if (!planId || !senderName) {
    return res.status(400).json({ message: 'planId and senderName are required.' });
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO payments (id, user_id, plan_id, sender_name, sender_ref, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(id, userId || null, planId, senderName.trim(), senderRef?.trim() || null);

  return res.status(201).json({ ok: true, paymentId: id });
});

// POST /payment/redeem — redeem a pro code
router.post('/redeem', (req, res) => {
  const codeRaw = (req.body.code || '').trim().toUpperCase();
  if (!codeRaw) {
    return res.status(400).json({ message: 'Code is required.' });
  }

  let userId = req.body.userId;
  // Check auth header if present
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
      userId = decoded.id;
    } catch {}
  }

  const row = db.prepare('SELECT * FROM pro_codes WHERE UPPER(code) = ? AND used_at IS NULL').get(codeRaw);
  if (!row) {
    return res.status(400).json({ message: 'Invalid or already used code.' });
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE pro_codes SET used_at = ?, used_by = ? WHERE id = ?').run(now, userId || null, row.id);

  let updatedUser = null;
  let token = null;
  if (userId) {
    db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(row.plan || 'pro', userId);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (u) {
      updatedUser = safeUser(u);
      token = makeToken(u);
    }
  }

  return res.json({
    ok: true,
    plan: row.plan || 'pro',
    user: updatedUser,
    token: token,
    message: `${(row.plan || 'pro').toUpperCase()} activated successfully!`,
  });
});

// GET /payment/status/:id — check payment status
router.get('/status/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ message: 'Payment not found.' });
  return res.json({ status: row.status, planId: row.plan_id });
});

// GET /payment/user/:userId — list user's payments
router.get('/user/:userId', (req, res) => {
  const rows = db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC').all(req.params.userId);
  return res.json(rows);
});

// POST /payment/approve/:id — admin only (protected by secret header)
router.post('/approve/:id', (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== (process.env.ADMIN_SECRET || 'davai-admin')) {
    return res.status(403).json({ message: 'Forbidden.' });
  }

  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!payment) return res.status(404).json({ message: 'Payment not found.' });

  db.prepare("UPDATE payments SET status = 'approved' WHERE id = ?").run(req.params.id);

  // If we have a user_id, upgrade their plan
  if (payment.user_id) {
    db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(payment.plan_id, payment.user_id);
  }

  return res.json({ ok: true });
});

module.exports = router;