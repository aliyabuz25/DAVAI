const express  = require('express');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db       = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, plan: user.plan },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function verifyPassword(password, stored) {
  if (!stored || !password) return false;
  if (stored.startsWith('$2a$') || stored.startsWith('$2b$')) {
    try {
      return bcrypt.compareSync(password, stored);
    } catch {
      return false;
    }
  }
  if (stored.includes(':')) {
    try {
      const [salt, hash] = stored.split(':');
      const check = crypto.pbkdf2Sync(password, salt, 260000, 32, 'sha256').toString('hex');
      return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
    } catch {
      return false;
    }
  }
  return password === stored;
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

// POST /auth/register
router.post('/register', (req, res) => {
  const { name, email, password, program } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) {
    return res.status(409).json({ message: 'An account with this email already exists.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const id   = uuidv4();
  db.prepare(`
    INSERT INTO users (id, name, email, password, plan, program)
    VALUES (?, ?, ?, ?, 'free', ?)
  `).run(id, name.trim(), email.toLowerCase().trim(), hash, program || 'IB');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return res.status(201).json({ token: makeToken(user), user: safeUser(user) });
});

// POST /auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  return res.json({ token: makeToken(user), user: safeUser(user) });
});

// GET /auth/me
router.get('/me', require('../middleware/auth').authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  return res.json(safeUser(user));
});

// PATCH /auth/me
router.patch('/me', require('../middleware/auth').authMiddleware, (req, res) => {
  const { name, program, school } = req.body;
  db.prepare(`
    UPDATE users SET name = COALESCE(?, name), program = COALESCE(?, program), school = COALESCE(?, school)
    WHERE id = ?
  `).run(name || null, program || null, school || null, req.userId);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  return res.json(safeUser(user));
});

module.exports = router;