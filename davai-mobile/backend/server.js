require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();

// ── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Routes ────────────────────────────────────────────────────
app.use('/auth',     require('./routes/auth'));
app.use('/homework', require('./routes/homework'));
app.use('/chat',     require('./routes/chat'));
app.use('/payment',  require('./routes/payment'));

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), version: '1.0.0' });
});
app.get('/', (req, res) => {
  res.json({ ok: true, name: 'DAVAI Mobile API', version: '1.0.0', health: '/health' });
});

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ message: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`DAVAI backend running on http://localhost:${PORT}`);
  console.log(`  DB: ${path.join(__dirname, 'data/davai.db')}`);
  console.log(`  AI: ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'NOT SET — chat will return 503'}`);
});

module.exports = app;