const express = require('express');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Chat is available without auth (guest mode) but rate-limited per IP
const rateMap  = new Map(); // ip -> { count, resetAt }
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Fetch live limits from admin config (cached 60s)
let _limitsCache = null;
let _limitsFetchedAt = 0;
async function getLimits() {
  const now = Date.now();
  if (_limitsCache && now - _limitsFetchedAt < 60_000) return _limitsCache;
  try {
    const res = await fetch('http://127.0.0.1:5050/admin/api/ai-config/internal');
    if (res.ok) {
      const cfg = await res.json();
      _limitsCache = {
        free:    cfg.free_limit    || 15,
        pro:     cfg.pro_limit     || 60,
        promax:  cfg.promax_limit  || 150,
        hourly:  cfg.hourly_limit  || 20,
      };
      _limitsFetchedAt = now;
      return _limitsCache;
    }
  } catch (_) {}
  return _limitsCache || { free: 15, pro: 60, promax: 150, hourly: 20 };
}

async function rateLimit(req, res, next) {
  const limits = await getLimits();
  const plan   = req.userPlan || 'free';
  const limit  = plan === 'pro_max' ? limits.promax : plan === 'pro' ? limits.pro : limits.free;
  const ip     = req.ip;
  const now    = Date.now();
  let entry    = rateMap.get(ip);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    rateMap.set(ip, entry);
  }

  entry.count++;
  if (entry.count > limit) {
    const planLabel = plan === 'free' ? 'Free' : plan === 'pro' ? 'Pro' : 'Pro Max';
    return res.status(429).json({
      message: `${planLabel} plan: ${limit} messages per hour. ${plan === 'free' ? 'Upgrade to Pro for more.' : 'Try again later.'}`,
    });
  }
  next();
}

// Optional auth (don't block guests)
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../middleware/auth');
    const db = require('../db');
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET);
      req.userId   = payload.id;
      req.userPlan = payload.plan || 'free';
      if (req.userId) {
        const u = db.prepare('SELECT plan FROM users WHERE id = ?').get(req.userId);
        if (u && u.plan) {
          req.userPlan = u.plan;
        }
      }
    } catch {}
  }
  next();
}

const SYSTEM_PROMPTS = {
  ib:      'You are a knowledgeable IB Diploma study coach. Help students understand concepts, structure essays, prepare for exams, and navigate the IB curriculum. Focus on IA, EE, TOK, and subject-specific content. Always encourage academic integrity — guide and coach, never write for students.',
  ielts:   'You are an expert IELTS preparation coach. Help students improve their Writing, Speaking, Reading, and Listening skills. Provide feedback on structure, coherence, vocabulary, and grammar. Give targeted advice for achieving band 7+.',
  tok:     'You are a Theory of Knowledge guide. Help students develop knowledge questions, explore ways of knowing and areas of knowledge, structure TOK essays and exhibitions. Encourage critical thinking and philosophical reflection.',
  ee:      'You are an Extended Essay mentor. Guide students through research question formation, methodology, structure, referencing, and meeting IB criteria. Help them think independently and academically.',
  general: 'You are DAVAI, a helpful academic study assistant for high school and university students. Help with any subject, explain concepts clearly, assist with study techniques, and support student learning.',
};

// POST /chat
router.post('/', optionalAuth, rateLimit, async (req, res) => {
  const { message, mode = 'general', history = [] } = req.body;
  if (!message) return res.status(400).json({ message: 'message is required.' });

  // Fetch live config from admin backend (falls back to .env)
  let ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
  let ANTHROPIC_BASE_URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/$/, '');
  let ACTIVE_MODEL       = process.env.ACTIVE_MODEL || 'claude-sonnet-4-5';
  let MAX_TOKENS         = 800;

  try {
    const cfgRes = await fetch('http://127.0.0.1:5050/admin/api/ai-config/internal');
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      if (cfg.api_key)      ANTHROPIC_API_KEY  = cfg.api_key;
      if (cfg.base_url)     ANTHROPIC_BASE_URL = cfg.base_url.replace(/\/$/, '');
      if (cfg.active_model) ACTIVE_MODEL       = cfg.active_model;
      if (cfg.max_tokens)   MAX_TOKENS         = cfg.max_tokens;
    }
  } catch (_) { /* fallback to .env */ }

  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({ message: 'AI service not configured. Set ANTHROPIC_API_KEY.' });
  }

  const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.general;

  // Build message array — last 10 messages for context
  const contextMessages = history.slice(-10).map(m => ({
    role:    m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));
  contextMessages.push({ role: 'user', content: message });

  try {
    const response = await fetch(`${ANTHROPIC_BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'Authorization':        `Bearer ${ANTHROPIC_API_KEY}`,
        'x-api-key':            ANTHROPIC_API_KEY,
        'anthropic-version':    '2023-06-01',
      },
      body: JSON.stringify({
        model:      ACTIVE_MODEL,
        max_tokens: MAX_TOKENS,
        system:     systemPrompt,
        messages:   contextMessages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic error:', err);
      return res.status(502).json({ message: 'AI service error. Please try again.' });
    }

    const data = await response.json();
    const content = data.content?.[0]?.text ?? 'No response from AI.';
    return res.json({ content });

  } catch (err) {
    console.error('Chat error:', err);
    return res.status(503).json({ message: 'Could not reach AI service.' });
  }
});

module.exports = router;