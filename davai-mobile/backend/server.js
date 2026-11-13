require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();

// ── CORS & Preflight Middleware ──────────────────────────────
app.use(cors({
  origin: (origin, callback) => callback(null, true), // Allow all origins including APK / mobile apps (undefined)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-DAVAI-Device',
    'X-DAVAI-Plan',
    'X-Admin-Token',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Cache-Control',
    'Pragma'
  ],
  exposedHeaders: ['*'],
  maxAge: 86400,
}));
app.options('*', cors());

// Explicit CORS headers fallback for mobile APKs / WebViews
app.use((req, res, next) => {
  const reqOrigin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', reqOrigin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-DAVAI-Device, X-DAVAI-Plan, X-Admin-Token, X-Requested-With, Accept, Origin, Cache-Control, Pragma');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Routes ────────────────────────────────────────────────────
app.use('/auth',     require('./routes/auth'));
app.use('/homework', require('./routes/homework'));
app.use('/chat',     require('./routes/chat'));
app.use('/payment',  require('./routes/payment'));
app.use('/config',   require('./routes/config'));

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
const PORT = process.env.NODE_PORT || 3000;
app.listen(PORT, () => {
  console.log(`DAVAI backend running on http://localhost:${PORT}`);
  console.log(`  DB: ${process.env.DAVAI_DB_PATH || path.join(__dirname, 'data/davai.db')}`);
  console.log(`  AI: ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'NOT SET — chat will return 503'}`);
});

module.exports = app;