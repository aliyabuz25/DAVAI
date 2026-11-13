const express = require('express');
const db      = require('../db');

const router = express.Router();

// GET /config/announcement — active mobile notification banner
router.get('/announcement', (req, res) => {
  try {
    const row = db.prepare('SELECT id, title, message, type, created_at FROM announcements WHERE active = 1 ORDER BY created_at DESC LIMIT 1').get();
    if (!row) {
      return res.json({ active: false });
    }
    return res.json({
      active:    true,
      id:        row.id,
      title:     row.title,
      message:   row.message,
      type:      row.type || 'info',
      createdAt: row.created_at,
    });
  } catch (err) {
    return res.json({ active: false });
  }
});

// GET /config/recipient-info — recipient bank info
router.get('/recipient-info', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM payment_settings').all();
    const cfg = {};
    for (const r of rows) cfg[r.key] = r.value;
    return res.json({
      name:     cfg.recipient_name || 'David Salahov',
      bank:     cfg.bank_name      || 'Kapital Bank',
      card:     cfg.card_number    || '4169 7388 1234 5678',
      iban:     cfg.iban           || 'AZ21 AIIB 0000 0000 1234 5678 901',
      currency: cfg.currency       || 'AZN',
      note:     cfg.note_prefix    || 'DAVAI Pro — ',
    });
  } catch (err) {
    return res.status(500).json({ message: 'Error reading configuration' });
  }
});

module.exports = router;
