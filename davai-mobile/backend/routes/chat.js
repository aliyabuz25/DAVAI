const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Chat rate limiter per IP / User
const rateMap   = new Map(); // ip -> { count, resetAt }
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Fetch live limits from database or internal admin API
let _limitsCache = null;
let _limitsFetchedAt = 0;

function getLimits() {
  const now = Date.now();
  if (_limitsCache && now - _limitsFetchedAt < 30_000) return _limitsCache;

  try {
    const rows = db.prepare('SELECT key, value FROM ai_config').all();
    if (rows && rows.length > 0) {
      const cfg = {};
      for (const r of rows) cfg[r.key] = r.value;
      _limitsCache = {
        free:   parseInt(cfg.free_limit   || '15', 10),
        pro:    parseInt(cfg.pro_limit    || '60', 10),
        promax: parseInt(cfg.promax_limit || '150', 10),
        hourly: parseInt(cfg.hourly_limit || '20', 10),
      };
      _limitsFetchedAt = now;
      return _limitsCache;
    }
  } catch (_) {}

  return _limitsCache || { free: 15, pro: 60, promax: 150, hourly: 20 };
}

async function rateLimit(req, res, next) {
  const limits = getLimits();
  const plan   = req.userPlan || 'free';
  const limit  = plan === 'pro_max' ? limits.promax : plan === 'pro' ? limits.pro : limits.free;
  const ip     = req.ip || req.socket.remoteAddress || 'unknown';
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
      message: `${planLabel} plan limit reached (${limit} messages/hour). ${plan === 'free' ? 'Upgrade to Pro for more.' : 'Please try again later.'}`,
    });
  }
  next();
}

// Optional auth (doesn't block guest students)
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../middleware/auth');
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET);
      req.userId   = payload.id;
      req.userPlan = payload.plan || 'free';
      if (req.userId) {
        const u = db.prepare('SELECT email, plan FROM users WHERE id = ?').get(req.userId);
        if (u) {
          req.userEmail = u.email;
          if (u.plan) req.userPlan = u.plan;
        }
      }
    } catch {}
  }
  next();
}

const DEFAULT_SYSTEM_PROMPTS = {
  ib:      'You are a knowledgeable IB Diploma study coach. Help students understand concepts, structure essays, prepare for exams, and navigate the IB curriculum. Focus on IA, EE, TOK, and subject-specific content. Always encourage academic integrity — guide and coach, never write for students.',
  ielts:   'You are an expert IELTS preparation coach. Help students improve their Writing, Speaking, Reading, and Listening skills. Provide feedback on structure, coherence, vocabulary, and grammar. Give targeted advice for achieving band 7+.',
  tok:     'You are a Theory of Knowledge guide. Help students develop knowledge questions, explore ways of knowing and areas of knowledge, structure TOK essays and exhibitions. Encourage critical thinking and philosophical reflection.',
  ee:      'You are an Extended Essay mentor. Guide students through research question formation, methodology, structure, referencing, and meeting IB criteria. Help them think independently and academically.',
  general: 'You are DAVAI, a helpful academic study assistant for high school and university students. Help with any subject, explain concepts clearly, assist with study techniques, and support student learning.',
};

function getSystemPrompt(mode) {
  try {
    const row = db.prepare('SELECT prompt FROM system_prompts WHERE mode = ?').get(mode);
    if (row && row.prompt && row.prompt.trim()) {
      return row.prompt.trim();
    }
  } catch (_) {}
  return DEFAULT_SYSTEM_PROMPTS[mode] || DEFAULT_SYSTEM_PROMPTS.general;
}

// POST /chat
router.post('/', optionalAuth, rateLimit, async (req, res) => {
  const { message, mode = 'general', history = [] } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ message: 'message is required.' });
  }

  // Load config from DB with fallback to process.env
  let apiKey  = process.env.ANTHROPIC_API_KEY;
  let baseUrl = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/$/, '');
  let model   = process.env.ACTIVE_MODEL || 'claude-sonnet-4-5';
  let maxTokens = 800;

  try {
    const cfgRows = db.prepare('SELECT key, value FROM ai_config').all();
    const cfg = {};
    for (const r of cfgRows) cfg[r.key] = r.value;
    if (cfg.api_key)      apiKey  = cfg.api_key;
    if (cfg.base_url)     baseUrl = cfg.base_url.replace(/\/$/, '');
    if (cfg.active_model) model   = cfg.active_model;
    if (cfg.max_tokens)   maxTokens = parseInt(cfg.max_tokens, 10);
  } catch (_) {}

  if (!apiKey) {
    return res.status(503).json({ message: 'AI service not configured. Please set API key in Admin Panel.' });
  }

  const systemPrompt = getSystemPrompt(mode);

  // Build context array — last 10 messages
  const contextMessages = history.slice(-10).map(m => ({
    role:    m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));
  contextMessages.push({ role: 'user', content: message.trim() });

  const logId = uuidv4();
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

  try {
    const response = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'Authorization':        `Bearer ${apiKey}`,
        'x-api-key':            apiKey,
        'anthropic-version':    '2023-06-01',
      },
      body: JSON.stringify({
        model:      model,
        max_tokens: maxTokens,
        system:     systemPrompt,
        messages:   contextMessages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', errText);

      // Log failure
      try {
        db.prepare(`
          INSERT INTO chat_logs (id, user_id, user_email, mode, prompt, response, model, tokens_est, status, ip)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'error', ?)
        `).run(logId, req.userId || null, req.userEmail || null, mode, message.trim(), errText.slice(0, 500), model, 0, clientIp);
      } catch (_) {}

      return res.status(502).json({ message: 'AI service returned an error. Please try again in a moment.' });
    }

    const data = await response.json();
    const content = data.content?.[0]?.text ?? 'No response from AI.';
    const estTokens = Math.round((message.length + content.length) / 4);

    // Log success
    try {
      db.prepare(`
        INSERT INTO chat_logs (id, user_id, user_email, mode, prompt, response, model, tokens_est, status, ip)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success', ?)
      `).run(logId, req.userId || null, req.userEmail || null, mode, message.trim(), content.slice(0, 1000), model, estTokens, clientIp);
    } catch (e) {
      console.error('Log write failed:', e.message);
    }

    return res.json({ content, mode, model });

  } catch (err) {
    console.error('Chat execution error:', err);
    try {
      db.prepare(`
        INSERT INTO chat_logs (id, user_id, user_email, mode, prompt, response, model, tokens_est, status, ip)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'network_error', ?)
      `).run(logId, req.userId || null, req.userEmail || null, mode, message.trim(), err.message, model, 0, clientIp);
    } catch (_) {}

    return res.status(503).json({ message: 'Could not connect to AI service. Please check server internet connection.' });
  }
});

module.exports = router;
