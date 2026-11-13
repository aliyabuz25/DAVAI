const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'davai.db');
const db = new Database(DB_PATH);

// WAL mode for high-concurrency read/write
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// ── Schema Initialization ───────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    plan        TEXT NOT NULL DEFAULT 'free',
    program     TEXT NOT NULL DEFAULT 'IB',
    school      TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS homework (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    title       TEXT NOT NULL,
    subject     TEXT NOT NULL,
    due_date    TEXT NOT NULL,
    due_time    TEXT,
    priority    TEXT NOT NULL DEFAULT 'medium',
    status      TEXT NOT NULL DEFAULT 'pending',
    notes       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS payments (
    id           TEXT PRIMARY KEY,
    user_id      TEXT,
    plan_id      TEXT NOT NULL,
    sender_name  TEXT NOT NULL,
    sender_ref   TEXT,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pro_codes (
    id          TEXT PRIMARY KEY,
    code        TEXT UNIQUE NOT NULL,
    plan        TEXT NOT NULL DEFAULT 'pro',
    used_at     TEXT,
    used_by     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admin_accounts (
    id          TEXT PRIMARY KEY,
    username    TEXT UNIQUE NOT NULL,
    pw_hash     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token       TEXT PRIMARY KEY,
    admin_id    TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_config (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS site_config (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS system_prompts (
    mode        TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    prompt      TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_logs (
    id          TEXT PRIMARY KEY,
    user_id     TEXT,
    user_email  TEXT,
    mode        TEXT NOT NULL DEFAULT 'general',
    prompt      TEXT NOT NULL,
    response    TEXT,
    model       TEXT,
    tokens_est  INTEGER DEFAULT 0,
    status      TEXT DEFAULT 'success',
    ip          TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payment_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    message     TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'info',
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_homework_user   ON homework(user_id);
  CREATE INDEX IF NOT EXISTS idx_homework_due    ON homework(due_date);
  CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
  CREATE INDEX IF NOT EXISTS idx_pro_codes_code  ON pro_codes(code);
  CREATE INDEX IF NOT EXISTS idx_chat_logs_time  ON chat_logs(created_at);
`);

// ── Default Seed Data ───────────────────────────────────────────────
const defaultPrompts = [
  ['ib', 'IB Diploma Coach', 'You are a knowledgeable IB Diploma study coach. Help students understand concepts, structure essays, prepare for exams, and navigate the IB curriculum. Focus on IA, EE, TOK, and subject-specific content. Always encourage academic integrity — guide and coach, never write for students.'],
  ['ielts', 'IELTS Preparation Coach', 'You are an expert IELTS preparation coach. Help students improve their Writing, Speaking, Reading, and Listening skills. Provide feedback on structure, coherence, vocabulary, and grammar. Give targeted advice for achieving band 7+.'],
  ['tok', 'Theory of Knowledge Guide', 'You are a Theory of Knowledge guide. Help students develop knowledge questions, explore ways of knowing and areas of knowledge, structure TOK essays and exhibitions. Encourage critical thinking and philosophical reflection.'],
  ['ee', 'Extended Essay Mentor', 'You are an Extended Essay mentor. Guide students through research question formation, methodology, structure, referencing, and meeting IB criteria. Help them think independently and academically.'],
  ['general', 'DAVAI Academic Assistant', 'You are DAVAI, a helpful academic study assistant for high school and university students. Help with any subject, explain concepts clearly, assist with study techniques, and support student learning.']
];

const insertPrompt = db.prepare(`
  INSERT OR IGNORE INTO system_prompts (mode, title, prompt, updated_at)
  VALUES (?, ?, ?, datetime('now'))
`);
for (const [mode, title, prompt] of defaultPrompts) {
  insertPrompt.run(mode, title, prompt);
}

const defaultPaymentSettings = [
  ['recipient_name', 'David Salahov'],
  ['bank_name',      'Kapital Bank'],
  ['card_number',    '4169 7388 1234 5678'],
  ['iban',           'AZ21 AIIB 0000 0000 1234 5678 901'],
  ['currency',       'AZN'],
  ['note_prefix',    'DAVAI Pro — '],
];

const insertSetting = db.prepare(`
  INSERT OR IGNORE INTO payment_settings (key, value)
  VALUES (?, ?)
`);
for (const [key, val] of defaultPaymentSettings) {
  insertSetting.run(key, val);
}

module.exports = db;
