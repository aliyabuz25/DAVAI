"""
DAVAI Admin Backend
Unified SQLite-based admin API mounted into proxy.py under /admin/api/*
Fully integrated with davai-mobile app and backend.
"""
import sqlite3
import json
import os
import hashlib
import hmac
import secrets
import time
import re
import urllib.request
from datetime import datetime, timezone

# ── Dynamic DB Path Discovery ────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

CANDIDATE_PATHS = [
    os.environ.get("DAVAI_DB_PATH", ""),
    os.path.join(BASE_DIR, "davai-mobile", "backend", "data", "davai.db"),
    os.path.join(os.path.dirname(BASE_DIR), "davai-mobile", "backend", "data", "davai.db"),
    os.path.join(BASE_DIR, "data", "davai.db"),
    os.path.join(BASE_DIR, "data", "admin.db"),
]

DB_PATH = None
for p in CANDIDATE_PATHS:
    if p and (os.path.exists(p) or os.path.exists(os.path.dirname(p))):
        DB_PATH = p
        break

if not DB_PATH:
    DB_PATH = os.path.join(BASE_DIR, "davai-mobile", "backend", "data", "davai.db")

# ── DB Initialization ────────────────────────────────────────────────────────

def _init_db(path: str) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    con = sqlite3.connect(path, check_same_thread=False, timeout=10.0)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("PRAGMA busy_timeout=5000")

    con.executescript("""
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

        CREATE INDEX IF NOT EXISTS idx_hw_user      ON homework(user_id);
        CREATE INDEX IF NOT EXISTS idx_hw_due       ON homework(due_date);
        CREATE INDEX IF NOT EXISTS idx_pay_status   ON payments(status);
        CREATE INDEX IF NOT EXISTS idx_codes_code   ON pro_codes(code);
        CREATE INDEX IF NOT EXISTS idx_chat_logs_ts ON chat_logs(created_at);
    """)

    # Seed default payment settings if empty
    has_pay = con.execute("SELECT COUNT(*) as n FROM payment_settings").fetchone()["n"]
    if has_pay == 0:
        con.executemany("INSERT OR IGNORE INTO payment_settings (key, value) VALUES (?, ?)", [
            ("recipient_name", "David Salahov"),
            ("bank_name",      "Kapital Bank"),
            ("card_number",    "4169 7388 1234 5678"),
            ("iban",           "AZ21 AIIB 0000 0000 1234 5678 901"),
            ("currency",       "AZN"),
            ("note_prefix",    "DAVAI Pro — "),
        ])

    # Seed default prompts if empty
    has_p = con.execute("SELECT COUNT(*) as n FROM system_prompts").fetchone()["n"]
    if has_p == 0:
        con.executemany("INSERT OR IGNORE INTO system_prompts (mode, title, prompt) VALUES (?, ?, ?)", [
            ("ib", "IB Diploma Coach", "You are a knowledgeable IB Diploma study coach. Help students understand concepts, structure essays, prepare for exams, and navigate the IB curriculum. Focus on IA, EE, TOK, and subject-specific content. Always encourage academic integrity — guide and coach, never write for students."),
            ("ielts", "IELTS Preparation Coach", "You are an expert IELTS preparation coach. Help students improve their Writing, Speaking, Reading, and Listening skills. Provide feedback on structure, coherence, vocabulary, and grammar. Give targeted advice for achieving band 7+."),
            ("tok", "Theory of Knowledge Guide", "You are a Theory of Knowledge guide. Help students develop knowledge questions, explore ways of knowing and areas of knowledge, structure TOK essays and exhibitions. Encourage critical thinking and philosophical reflection."),
            ("ee", "Extended Essay Mentor", "You are an Extended Essay mentor. Guide students through research question formation, methodology, structure, referencing, and meeting IB criteria. Help them think independently and academically."),
            ("general", "DAVAI Academic Assistant", "You are DAVAI, a helpful academic study assistant for high school and university students. Help with any subject, explain concepts clearly, assist with study techniques, and support student learning.")
        ])

    # Seed sample students, homework, payments, announcements if empty
    has_u = con.execute("SELECT COUNT(*) as n FROM users").fetchone()["n"]
    if has_u == 0:
        _seed_demo_data(con)

    con.commit()
    return con

def _seed_demo_data(con):
    try:
        students = [
            ("s_aisha", "Aisha Mammadova", "aisha@test.davai", "pro", "IB", "Baku European Lyceum"),
            ("s_kamran", "Kamran Huseynov", "kamran@test.davai", "free", "IELTS", "TISA International School"),
            ("s_leyla", "Leyla Aliyeva", "leyla@test.davai", "pro_max", "IB", "Baku Oxford School"),
            ("s_tural", "Tural Hasanov", "tural@test.davai", "free", "SAT & YKS", "Anadolu Lisesi"),
            ("s_sara", "Sara Rzayeva", "sara@test.davai", "pro", "IELTS", "ADA School")
        ]
        for sid, name, email, plan, prog, sch in students:
            con.execute(
                "INSERT OR IGNORE INTO users (id, name, email, password, plan, program, school) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (sid, name, email, "Pass12345!", plan, prog, sch)
            )

        homeworks = [
            ("hw_1", "s_aisha", "IB TOK Essay — Final Draft Submission", "Theory of Knowledge", "2026-11-20", "pending", "high", "Draft review with IB supervisor"),
            ("hw_2", "s_aisha", "Physics HL — Electromagnetic Induction Lab", "Physics", "2026-11-18", "pending", "high", "Format data tables and error propagation"),
            ("hw_3", "s_kamran", "IELTS Academic Writing Task 2", "English", "2026-11-15", "pending", "medium", "Discuss both views & give opinion essay"),
            ("hw_4", "s_kamran", "IELTS Listening Practice Test 3", "English", "2026-11-14", "done", "medium", "Check Cambridge 18 Section 4 answers"),
            ("hw_5", "s_leyla", "Math AA HL — Calculus Paper 2", "Mathematics", "2026-11-16", "pending", "high", "Differential equations and Maclaurin series"),
            ("hw_6", "s_leyla", "Chemistry HL — Organic Mechanisms", "Chemistry", "2026-11-17", "pending", "medium", "Nucleophilic substitution & elimination"),
            ("hw_7", "s_tural", "SAT Digital Practice Exam 4 — Math Module", "Mathematics", "2026-11-19", "pending", "medium", "Bluebook app timed section"),
            ("hw_8", "s_sara", "IELTS Speaking Part 2 & 3 Cue Card", "English", "2026-11-13", "overdue", "high", "Record 2 min monologue on technology")
        ]
        for hid, uid, title, subj, due, st, pri, note in homeworks:
            con.execute(
                "INSERT OR IGNORE INTO homework (id, user_id, title, subject, due_date, status, priority, notes) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (hid, uid, title, subj, due, st, pri, note)
            )

        payments = [
            ("pay_1", "s_kamran", "pro", "Kamran Huseynov", "KB-882910", "pending"),
            ("pay_2", "s_tural", "pro_max", "Tural Hasanov", "MPAY-44102", "pending"),
            ("pay_3", "s_aisha", "pro", "Aisha Mammadova", "LEO-129481", "approved")
        ]
        for pid, uid, pl, sname, sref, st in payments:
            con.execute(
                "INSERT OR IGNORE INTO payments (id, user_id, plan_id, sender_name, sender_ref, status) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (pid, uid, pl, sname, sref, st)
            )

        announcements = [
            ("ann_welcome", "Hoş Geldiniz — DAVAI Mobil Sürüm Yayında! 🎉", "IB, SAT ve YKS sınav hazırlıklarında yapay zeka çalışma koçunuz 7/24 yanınızda.", "success", 1),
            ("ann_exam", "Kasım 2026 Deneme Sınav Takvimi 📅", "Matematik ve Fen bilimleri denemelerine katılmayı unutmayın. Sürelerinizi takip edin.", "info", 1)
        ]
        for aid, title, msg, atype, act in announcements:
            con.execute(
                "INSERT OR IGNORE INTO announcements (id, title, message, type, active) "
                "VALUES (?, ?, ?, ?, ?)",
                (aid, title, msg, atype, act)
            )

        codes = [
            ("c_1", "DAVAI-PRO-A1B2", "pro"),
            ("c_2", "DAVAI-PRO-C3D4", "pro"),
            ("c_3", "DAVAI-PROMAX-E5F6", "pro_max")
        ]
        for cid, code, pl in codes:
            con.execute(
                "INSERT OR IGNORE INTO pro_codes (id, code, plan) VALUES (?, ?, ?)",
                (cid, code, pl)
            )

        con.commit()
    except Exception as ex:
        print(f"[seed] Note: {ex}")

_CON = None
def db() -> sqlite3.Connection:
    global _CON
    if _CON is None:
        _CON = _init_db(DB_PATH)
    return _CON

# Backward compatibility alias
def mdb():
    return db()

# ── Password & Auth Helpers ──────────────────────────────────────────────────

def _hash_pw(password: str) -> str:
    salt = secrets.token_hex(16)
    h    = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return salt + ":" + h.hex()

def _verify_pw(password: str, stored: str) -> bool:
    if not stored or not password:
        return False
    try:
        if stored.startswith("$2a$") or stored.startswith("$2b$"):
            # bcrypt hash from node backend
            try:
                import bcrypt
                return bcrypt.checkpw(password.encode(), stored.encode())
            except ImportError:
                import subprocess
                res = subprocess.run(
                    ["node", "-e", f"const b=require('bcryptjs'); console.log(b.compareSync({json.dumps(password)}, {json.dumps(stored)}));"],
                    capture_output=True, text=True, timeout=5
                )
                return res.stdout.strip() == "true"
        if ":" in stored:
            salt, h = stored.split(":", 1)
            check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
            return hmac.compare_digest(check.hex(), h)
        return password == stored
    except Exception:
        return False

# ── Session Management ───────────────────────────────────────────────────────

def _create_session(admin_id: str) -> str:
    token = secrets.token_urlsafe(40)
    import datetime as dt
    exp = (datetime.utcnow() + dt.timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
    db().execute(
        "INSERT INTO admin_sessions (token, admin_id, created_at, expires_at) VALUES (?,?,datetime('now'),?)",
        (token, admin_id, exp)
    )
    db().commit()
    return token

def verify_session(token: str):
    if not token:
        return None
    row = db().execute(
        "SELECT a.id, a.username FROM admin_sessions s JOIN admin_accounts a ON a.id=s.admin_id "
        "WHERE s.token=? AND s.expires_at > datetime('now')",
        (token,)
    ).fetchone()
    return row

def _clean_sessions():
    try:
        db().execute("DELETE FROM admin_sessions WHERE expires_at <= datetime('now')")
        db().commit()
    except Exception:
        pass

def is_setup_done() -> bool:
    row = db().execute("SELECT COUNT(*) as c FROM admin_accounts").fetchone()
    return row["c"] > 0

# ── Node Backend Health Checker ──────────────────────────────────────────────

def check_backend_health():
    try:
        req = urllib.request.Request("http://127.0.0.1:3000/health", headers={"User-Agent": "DAVAI-Admin"})
        with urllib.request.urlopen(req, timeout=1.5) as r:
            if r.status == 200:
                return {"online": True, "port": 3000, "status": "running"}
    except Exception:
        pass
    return {"online": False, "port": 3000, "status": "stopped"}

# ── Main Dispatcher ──────────────────────────────────────────────────────────

def handle(method: str, path: str, body: dict, token: str) -> tuple:
    """Returns (status_code, response_dict)"""

    # ── Public Endpoints ────────────────────────────────────
    if path == "/admin/api/setup-status" and method == "GET":
        return 200, {"done": is_setup_done()}

    if path == "/admin/api/setup" and method == "POST":
        return _setup(body)

    if path == "/admin/api/login" and method == "POST":
        return _login(body)

    # ── Internal AI Config Read (Node Backend) ──────────────
    if path == "/admin/api/ai-config/internal" and method == "GET":
        return 200, ai_config_read()

    if path == "/admin/api/prompts/internal" and method == "GET":
        return 200, prompts_read()

    # ── Auth Required Endpoints ─────────────────────────────
    admin = verify_session(token)
    if not admin:
        return 401, {"message": "Unauthorized"}

    if path == "/admin/api/me" and method == "GET":
        return 200, {"id": admin["id"], "username": admin["username"]}

    if path == "/admin/api/stats" and method == "GET":
        return _stats()

    if path == "/admin/api/seed" and method == "POST":
        _seed_demo_data(db())
        return 200, {"ok": True, "message": "Demo data populated successfully."}

    # Users
    if path == "/admin/api/users" and method == "GET":
        return _users_list()
    if path == "/admin/api/users" and method == "POST":
        return _user_create(body)
    if re.match(r"^/admin/api/users/[\w-]+$", path):
        uid = path.split("/")[-1]
        if method == "PATCH":  return _user_update(uid, body)
        if method == "DELETE": return _user_delete(uid)

    # Homework (Integrated with Mobile App)
    if path == "/admin/api/homework" and method == "GET":
        return _homework_list(body)
    if path == "/admin/api/homework" and method == "POST":
        return _homework_create(body)
    if re.match(r"^/admin/api/homework/[\w-]+$", path):
        hid = path.split("/")[-1]
        if method == "PATCH":  return _homework_update(hid, body)
        if method == "DELETE": return _homework_delete(hid)

    # Payments
    if path == "/admin/api/payments" and method == "GET":
        return _payments_list(body)
    if re.match(r"^/admin/api/payments/[\w-]+/approve$", path):
        pid = path.split("/")[-2]
        if method == "POST": return _payment_approve(pid)
    if re.match(r"^/admin/api/payments/[\w-]+/reject$", path):
        pid = path.split("/")[-2]
        if method == "POST": return _payment_reject(pid)

    # Payment / Bank Settings
    if path == "/admin/api/payment-settings" and method == "GET":
        return _payment_settings_get()
    if path == "/admin/api/payment-settings" and method == "POST":
        return _payment_settings_set(body)

    # Pro Codes
    if path == "/admin/api/codes" and method == "GET":
        return _codes_list()
    if path == "/admin/api/codes/generate" and method == "POST":
        return _code_generate(body)
    if re.match(r"^/admin/api/codes/[\w-]+$", path):
        cid = path.split("/")[-1]
        if method == "DELETE": return _code_delete(cid)

    # AI Config
    if path == "/admin/api/ai-config" and method == "GET":
        return _ai_config_get()
    if path == "/admin/api/ai-config" and method == "POST":
        return _ai_config_set(body)

    # System Prompts for AI Modes
    if path == "/admin/api/prompts" and method == "GET":
        return _prompts_get()
    if path == "/admin/api/prompts" and method == "POST":
        return _prompts_set(body)

    # AI Chat Logs Monitoring
    if path == "/admin/api/chat-logs" and method == "GET":
        return _chat_logs(body)

    # Announcements (Banners for Mobile App)
    if path == "/admin/api/announcements" and method == "GET":
        return _announcements_list()
    if path == "/admin/api/announcements" and method == "POST":
        return _announcement_save(body)
    if re.match(r"^/admin/api/announcements/[\w-]+$", path):
        aid = path.split("/")[-1]
        if method == "DELETE": return _announcement_delete(aid)

    # Site Config (Landing page)
    if path == "/admin/api/site-config" and method == "GET":
        return _site_config_get()
    if path == "/admin/api/site-config" and method == "POST":
        return _site_config_set(body)

    # Logs
    if path == "/admin/api/logs" and method == "GET":
        return _logs()

    # Change password
    if path == "/admin/api/change-password" and method == "POST":
        return _change_password(admin["id"], body)

    return 404, {"message": "Not found"}

# ── Handlers ──────────────────────────────────────────────────────────────────

def _setup(body):
    if is_setup_done():
        return 409, {"message": "Admin account already exists."}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    if not username or len(password) < 8:
        return 400, {"message": "Username required and password must be 8+ chars."}
    uid = secrets.token_urlsafe(12)
    db().execute(
        "INSERT INTO admin_accounts (id, username, pw_hash) VALUES (?,?,?)",
        (uid, username, _hash_pw(password))
    )
    db().commit()
    return 201, {"ok": True}

def _login(body):
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    row = db().execute("SELECT * FROM admin_accounts WHERE username=?", (username,)).fetchone()
    if not row or not _verify_pw(password, row["pw_hash"]):
        return 401, {"message": "Invalid username or password."}
    token = _create_session(row["id"])
    _clean_sessions()
    return 200, {"token": token}

def _stats():
    c     = db()
    today = datetime.utcnow().strftime("%Y-%m-%d")

    # Users
    total_users   = c.execute("SELECT COUNT(*) as n FROM users").fetchone()["n"]
    pro_users     = c.execute("SELECT COUNT(*) as n FROM users WHERE plan='pro'").fetchone()["n"]
    promax_users  = c.execute("SELECT COUNT(*) as n FROM users WHERE plan='pro_max'").fetchone()["n"]
    today_signups = c.execute("SELECT COUNT(*) as n FROM users WHERE created_at >= ?", (today,)).fetchone()["n"]

    # Homework
    total_hw      = c.execute("SELECT COUNT(*) as n FROM homework").fetchone()["n"]
    pending_hw    = c.execute("SELECT COUNT(*) as n FROM homework WHERE status!='done'").fetchone()["n"]
    done_hw       = c.execute("SELECT COUNT(*) as n FROM homework WHERE status='done'").fetchone()["n"]
    overdue_hw    = c.execute("SELECT COUNT(*) as n FROM homework WHERE status!='done' AND due_date < ?", (today,)).fetchone()["n"]

    # Payments
    pending_pay   = c.execute("SELECT COUNT(*) as n FROM payments WHERE status='pending'").fetchone()["n"]
    approved_pay  = c.execute("SELECT COUNT(*) as n FROM payments WHERE status='approved'").fetchone()["n"]

    # Pro Codes
    active_codes  = c.execute("SELECT COUNT(*) as n FROM pro_codes WHERE used_at IS NULL").fetchone()["n"]
    used_codes    = c.execute("SELECT COUNT(*) as n FROM pro_codes WHERE used_at IS NOT NULL").fetchone()["n"]

    # AI Chat queries
    total_chats   = c.execute("SELECT COUNT(*) as n FROM chat_logs").fetchone()["n"]
    today_chats   = c.execute("SELECT COUNT(*) as n FROM chat_logs WHERE created_at >= ?", (today,)).fetchone()["n"]

    # Recent lists
    recent_users = [dict(r) for r in c.execute(
        "SELECT id, name, email, plan, program, school, created_at FROM users ORDER BY created_at DESC LIMIT 8"
    ).fetchall()]
    for r in recent_users: r["source"] = "app"

    pending_payments = [dict(r) for r in c.execute(
        "SELECT p.*, u.email as user_email, u.name as user_name FROM payments p "
        "LEFT JOIN users u ON u.id = p.user_id WHERE p.status='pending' ORDER BY p.created_at DESC LIMIT 8"
    ).fetchall()]

    # Backend status
    backend_status = check_backend_health()
    db_size_kb = 0
    try:
        db_size_kb = round(os.path.getsize(DB_PATH) / 1024, 1)
    except Exception:
        pass

    return 200, {
        "total_users":       total_users,
        "pro_users":         pro_users + promax_users,
        "promax_users":      promax_users,
        "today_signups":     today_signups,
        "total_homework":    total_hw,
        "pending_homework":  pending_hw,
        "done_homework":     done_hw,
        "overdue_homework":  overdue_hw,
        "pending_payments":  pending_pay,
        "approved_payments": approved_pay,
        "active_codes":      active_codes,
        "used_codes":        used_codes,
        "total_chats":       total_chats,
        "today_chats":       today_chats,
        "recent_users":      recent_users,
        "pending_pay":       pending_payments,
        "has_mobile_db":     True,
        "db_path":           DB_PATH,
        "db_size_kb":        db_size_kb,
        "backend":           backend_status,
    }

# ── User Handlers ─────────────────────────────────────────────────────────────

def _users_list():
    rows = [dict(r) for r in db().execute("""
        SELECT u.id, u.name, u.email, u.plan, u.program, u.school, u.created_at,
               COUNT(h.id) as hw_total,
               SUM(CASE WHEN h.status = 'done' THEN 1 ELSE 0 END) as hw_done
        FROM users u
        LEFT JOIN homework h ON h.user_id = u.id
        GROUP BY u.id
        ORDER BY u.created_at DESC
    """).fetchall()]
    for r in rows:
        r["source"] = "app"
        r["hw_done"] = r["hw_done"] or 0
    return 200, rows

def _user_create(body):
    name     = (body.get("name") or "").strip()
    email    = (body.get("email") or "").strip().lower()
    password = body.get("password") or secrets.token_urlsafe(10)
    plan     = body.get("plan") or "free"
    program  = body.get("program") or "IB"
    school   = (body.get("school") or "").strip() or None

    if not name or not email:
        return 400, {"message": "Name and email are required."}

    existing = db().execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
    if existing:
        return 409, {"message": "A user with this email already exists."}

    uid = secrets.token_urlsafe(16)
    db().execute(
        "INSERT INTO users (id, name, email, password, plan, program, school, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        (uid, name, email, _hash_pw(password), plan, program, school)
    )
    db().commit()
    row = dict(db().execute("SELECT id, name, email, plan, program, school, created_at FROM users WHERE id=?", (uid,)).fetchone())
    row["source"] = "app"
    return 201, row

def _user_update(uid, body):
    row = db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        return 404, {"message": "User not found."}

    name     = (body.get("name")    or row["name"]).strip()
    email    = (body.get("email")   or row["email"]).strip().lower()
    plan     = body.get("plan")     or row["plan"]
    program  = body.get("program")  or row["program"]
    school   = body.get("school") if "school" in body else row["school"]
    password = body.get("password")

    if password:
        db().execute(
            "UPDATE users SET name=?, email=?, plan=?, program=?, school=?, password=? WHERE id=?",
            (name, email, plan, program, school, _hash_pw(password), uid)
        )
    else:
        db().execute(
            "UPDATE users SET name=?, email=?, plan=?, program=?, school=? WHERE id=?",
            (name, email, plan, program, school, uid)
        )
    db().commit()
    updated = dict(db().execute("SELECT id, name, email, plan, program, school, created_at FROM users WHERE id=?", (uid,)).fetchone())
    updated["source"] = "app"
    return 200, updated

def _user_delete(uid):
    r = db().execute("DELETE FROM users WHERE id=?", (uid,))
    db().commit()
    if r.rowcount == 0:
        return 404, {"message": "User not found."}
    return 200, {"ok": True}

# ── Homework Handlers ─────────────────────────────────────────────────────────

def _homework_list(body):
    params = body if isinstance(body, dict) else {}
    status  = params.get("status", "")
    subject = params.get("subject", "")
    user_id = params.get("user_id", "")

    query = """
        SELECT h.*, u.name as user_name, u.email as user_email
        FROM homework h
        LEFT JOIN users u ON u.id = h.user_id
        WHERE 1=1
    """
    args = []
    if status:
        query += " AND h.status = ?"
        args.append(status)
    if subject:
        query += " AND h.subject = ?"
        args.append(subject)
    if user_id:
        query += " AND h.user_id = ?"
        args.append(user_id)

    query += " ORDER BY h.due_date ASC, h.created_at DESC"
    rows = [dict(r) for r in db().execute(query, tuple(args)).fetchall()]
    return 200, rows

def _homework_create(body):
    user_id = body.get("user_id") or ""
    title = (body.get("title") or "").strip()
    subject = (body.get("subject") or "").strip()
    due_date = body.get("due_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    status = body.get("status") or "pending"
    priority = body.get("priority") or "medium"
    notes = body.get("notes") or ""
    if not title or not subject:
        return 400, {"message": "Title and subject are required."}
    hid = secrets.token_urlsafe(16)
    now = datetime.now(timezone.utc).isoformat()
    db().execute(
        "INSERT INTO homework (id, user_id, title, subject, due_date, status, priority, notes, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (hid, user_id, title, subject, due_date, status, priority, notes, now, now)
    )
    db().commit()
    return 201, {"ok": True, "id": hid}

def _homework_update(hid, body):
    row = db().execute("SELECT * FROM homework WHERE id=?", (hid,)).fetchone()
    if not row:
        return 404, {"message": "Homework item not found."}
    status   = body.get("status", row["status"])
    priority = body.get("priority", row["priority"])
    db().execute("UPDATE homework SET status=?, priority=?, updated_at=datetime('now') WHERE id=?", (status, priority, hid))
    db().commit()
    return 200, {"ok": True}

def _homework_delete(hid):
    r = db().execute("DELETE FROM homework WHERE id=?", (hid,))
    db().commit()
    if r.rowcount == 0:
        return 404, {"message": "Homework item not found."}
    return 200, {"ok": True}

# ── Payment Handlers ──────────────────────────────────────────────────────────

def _payments_list(body):
    status = body.get("status", "") if isinstance(body, dict) else ""
    query = """
        SELECT p.*, u.name as user_name, u.email as user_email, u.plan as current_user_plan
        FROM payments p
        LEFT JOIN users u ON u.id = p.user_id
    """
    args = ()
    if status:
        query += " WHERE p.status = ?"
        args = (status,)
    query += " ORDER BY p.created_at DESC"

    rows = [dict(r) for r in db().execute(query, args).fetchall()]
    for r in rows: r["source"] = "app"
    return 200, rows

def _payment_approve(pid):
    p = db().execute("SELECT * FROM payments WHERE id=?", (pid,)).fetchone()
    if not p:
        return 404, {"message": "Payment not found."}

    db().execute("UPDATE payments SET status='approved' WHERE id=?", (pid,))
    if p["user_id"]:
        # Update user's plan immediately (e.g. 'pro' or 'pro_max')
        plan = p["plan_id"] or "pro"
        db().execute("UPDATE users SET plan=? WHERE id=?", (plan, p["user_id"]))
    db().commit()
    return 200, {"ok": True}

def _payment_reject(pid):
    r = db().execute("UPDATE payments SET status='rejected' WHERE id=?", (pid,))
    db().commit()
    if r.rowcount == 0:
        return 404, {"message": "Payment not found."}
    return 200, {"ok": True}

def _payment_settings_get():
    rows = db().execute("SELECT key, value FROM payment_settings").fetchall()
    cfg = {r["key"]: r["value"] for r in rows}
    return 200, {
        "recipient_name": cfg.get("recipient_name", "David Salahov"),
        "bank_name":      cfg.get("bank_name",      "Kapital Bank"),
        "card_number":    cfg.get("card_number",    "4169 7388 1234 5678"),
        "iban":           cfg.get("iban",           "AZ21 AIIB 0000 0000 1234 5678 901"),
        "currency":       cfg.get("currency",       "AZN"),
        "note_prefix":    cfg.get("note_prefix",    "DAVAI Pro — "),
    }

def _payment_settings_set(body):
    allowed = ["recipient_name", "bank_name", "card_number", "iban", "currency", "note_prefix"]
    for k in allowed:
        if k in body and str(body[k]).strip():
            db().execute(
                "INSERT INTO payment_settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, str(body[k]).strip())
            )
    db().commit()
    return 200, {"ok": True}

# ── Pro Codes Handlers ────────────────────────────────────────────────────────

def _codes_list():
    rows = [dict(r) for r in db().execute("""
        SELECT c.*, u.email as used_by_email, u.name as used_by_name
        FROM pro_codes c
        LEFT JOIN users u ON u.id = c.used_by
        ORDER BY c.created_at DESC
    """).fetchall()]
    return 200, rows

def _code_generate(body):
    plan  = body.get("plan") or "pro"
    count = min(int(body.get("count") or 1), 25)
    generated = []

    for _ in range(count):
        code = "DAVAI-" + secrets.token_hex(4).upper() + "-" + secrets.token_hex(4).upper()
        cid  = secrets.token_urlsafe(12)
        db().execute(
            "INSERT INTO pro_codes (id, code, plan, created_at) VALUES (?, ?, ?, datetime('now'))",
            (cid, code, plan)
        )
        generated.append({"id": cid, "code": code, "plan": plan})
    db().commit()
    return 201, {"codes": generated, "count": len(generated)}

def _code_delete(cid):
    r = db().execute("DELETE FROM pro_codes WHERE id=?", (cid,))
    db().commit()
    if r.rowcount == 0:
        return 404, {"message": "Code not found."}
    return 200, {"ok": True}

# ── AI System Prompts Handlers ────────────────────────────────────────────────

def _prompts_get():
    rows = db().execute("SELECT mode, title, prompt, updated_at FROM system_prompts").fetchall()
    return 200, [dict(r) for r in rows]

def _prompts_set(body):
    prompts = body.get("prompts") if isinstance(body, dict) and "prompts" in body else body
    if not isinstance(prompts, dict) and not isinstance(prompts, list):
        return 400, {"message": "Invalid prompts payload"}

    items = prompts.items() if isinstance(prompts, dict) else [(p.get("mode"), p.get("prompt")) for p in prompts]
    for mode, prompt in items:
        if mode and prompt and str(prompt).strip():
            db().execute(
                "UPDATE system_prompts SET prompt=?, updated_at=datetime('now') WHERE mode=?",
                (str(prompt).strip(), mode)
            )
    db().commit()
    return 200, {"ok": True}

def prompts_read():
    rows = db().execute("SELECT mode, prompt FROM system_prompts").fetchall()
    return {r["mode"]: r["prompt"] for r in rows}

# ── AI Chat Logs Handlers ─────────────────────────────────────────────────────

def _chat_logs(body):
    limit = 50
    if isinstance(body, dict) and "limit" in body:
        try:
            limit = min(int(body["limit"]), 200)
        except Exception:
            pass

    rows = [dict(r) for r in db().execute("""
        SELECT l.*, COALESCE(u.name, 'Guest') as user_display_name
        FROM chat_logs l
        LEFT JOIN users u ON u.id = l.user_id
        ORDER BY l.created_at DESC
        LIMIT ?
    """, (limit,)).fetchall()]
    return 200, rows

# ── Mobile Announcements Handlers ─────────────────────────────────────────────

def _announcements_list():
    rows = [dict(r) for r in db().execute("SELECT * FROM announcements ORDER BY created_at DESC").fetchall()]
    return 200, rows

def _announcement_save(body):
    title   = (body.get("title") or "").strip()
    message = (body.get("message") or "").strip()
    type_   = body.get("type") or "info"
    active  = 1 if body.get("active", True) else 0

    if not title or not message:
        return 400, {"message": "Title and message are required."}

    aid = body.get("id") or secrets.token_urlsafe(10)
    db().execute("""
        INSERT INTO announcements (id, title, message, type, active, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
            title   = excluded.title,
            message = excluded.message,
            type    = excluded.type,
            active  = excluded.active
    """, (aid, title, message, type_, active))
    db().commit()
    return 200, {"ok": True, "id": aid}

def _announcement_delete(aid):
    r = db().execute("DELETE FROM announcements WHERE id=?", (aid,))
    db().commit()
    if r.rowcount == 0:
        return 404, {"message": "Announcement not found."}
    return 200, {"ok": True}

# ── AI Config Handlers ────────────────────────────────────────────────────────

AI_DEFAULTS = {
    "base_url":      "https://app.claude.gg/v1",
    "active_model":  "claude-sonnet-4-5",
    "max_tokens":    "800",
    "free_limit":    "15",
    "pro_limit":     "60",
    "promax_limit":  "150",
    "hourly_limit":  "20",
}

def _ai_config_get():
    rows = db().execute("SELECT key, value FROM ai_config").fetchall()
    cfg  = {r["key"]: r["value"] for r in rows}
    key  = cfg.get("api_key", "")
    return 200, {
        "base_url":      cfg.get("base_url",     AI_DEFAULTS["base_url"]),
        "active_model":  cfg.get("active_model", AI_DEFAULTS["active_model"]),
        "api_key_set":   bool(key),
        "api_key_hint":  (key[:6] + "..." + key[-4:]) if len(key) > 12 else ("*" * len(key) if key else ""),
        "max_tokens":    int(cfg.get("max_tokens",   AI_DEFAULTS["max_tokens"])),
        "free_limit":    int(cfg.get("free_limit",   AI_DEFAULTS["free_limit"])),
        "pro_limit":     int(cfg.get("pro_limit",    AI_DEFAULTS["pro_limit"])),
        "promax_limit":  int(cfg.get("promax_limit", AI_DEFAULTS["promax_limit"])),
        "hourly_limit":  int(cfg.get("hourly_limit", AI_DEFAULTS["hourly_limit"])),
        "models": [
            {"id": "claude-haiku-5-5",    "label": "Claude Haiku 5.5 — fast, light"},
            {"id": "claude-sonnet-4-5",   "label": "Claude Sonnet 4.5 — recommended"},
            {"id": "claude-sonnet-4-6",   "label": "Claude Sonnet 4.6 — latest"},
            {"id": "claude-sonnet-5-5",   "label": "Claude Sonnet 5.5 — deep thinking"},
            {"id": "claude-opus-5-5",     "label": "Claude Opus 5.5 — most powerful"},
            {"id": "claude-fable-5-1",    "label": "Claude Fable 5.1 — creative"},
        ],
    }

def _ai_config_set(body):
    updates = {}
    str_keys = ["base_url", "api_key", "active_model"]
    int_keys = ["max_tokens", "free_limit", "pro_limit", "promax_limit", "hourly_limit"]
    for k in str_keys:
        if k in body and str(body[k]).strip():
            val = str(body[k]).strip()
            if k == "base_url": val = val.rstrip("/")
            updates[k] = val
    for k in int_keys:
        if k in body:
            try:
                v = int(body[k])
                if v > 0: updates[k] = str(v)
            except (ValueError, TypeError):
                pass
    if not updates:
        return 400, {"message": "Nothing to update."}
    for k, v in updates.items():
        db().execute("INSERT INTO ai_config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, v))
    db().commit()
    _sync_env_file(updates)
    return 200, {"ok": True}

def _sync_env_file(updates: dict):
    env_paths = [
        os.path.join(BASE_DIR, "davai-mobile", "backend", ".env"),
        os.path.join(os.path.dirname(BASE_DIR), "davai-mobile", "backend", ".env")
    ]
    env_path = next((p for p in env_paths if os.path.exists(p)), None)
    if not env_path:
        return
    try:
        with open(env_path, "r") as f:
            lines = f.readlines()
        key_map = {
            "api_key":      "ANTHROPIC_API_KEY",
            "base_url":     "ANTHROPIC_BASE_URL",
            "active_model": "ACTIVE_MODEL",
        }
        env_keys = {key_map[k]: v for k, v in updates.items() if k in key_map}
        new_lines = []
        written   = set()
        for line in lines:
            found = False
            for env_key, val in env_keys.items():
                if line.startswith(env_key + "="):
                    new_lines.append(f"{env_key}={val}\n")
                    written.add(env_key)
                    found = True
                    break
            if not found:
                new_lines.append(line)
        for env_key, val in env_keys.items():
            if env_key not in written:
                new_lines.append(f"{env_key}={val}\n")
        with open(env_path, "w") as f:
            f.writelines(new_lines)
    except Exception as e:
        print(f"[admin] .env sync failed: {e}")

def ai_config_read():
    rows = db().execute("SELECT key, value FROM ai_config").fetchall()
    cfg  = {r["key"]: r["value"] for r in rows}
    return {
        "api_key":      cfg.get("api_key",      ""),
        "base_url":     cfg.get("base_url",      ""),
        "active_model": cfg.get("active_model",  AI_DEFAULTS["active_model"]),
        "max_tokens":   int(cfg.get("max_tokens",  AI_DEFAULTS["max_tokens"])),
        "free_limit":   int(cfg.get("free_limit",  AI_DEFAULTS["free_limit"])),
        "pro_limit":    int(cfg.get("pro_limit",   AI_DEFAULTS["pro_limit"])),
        "promax_limit": int(cfg.get("promax_limit",AI_DEFAULTS["promax_limit"])),
        "hourly_limit": int(cfg.get("hourly_limit",AI_DEFAULTS["hourly_limit"])),
    }

# ── Site Config Handlers ──────────────────────────────────────────────────────

SITE_DEFAULTS = {
    "site_title":           "DAVAI",
    "site_tagline":         "Free AI study companion for IB Diploma and IELTS students.",
    "hero_subtitle":        "Structured criteria guidance, essay outlines, homework tracking, and vocabulary. Designed for independent learning without commercial subscriptions.",
    "btn_primary_bg":       "#ffffff",
    "btn_primary_color":    "#000000",
    "btn_primary_text":     "Test Study Assistant",
    "btn_secondary_bg":     "rgba(255,255,255,0.08)",
    "btn_secondary_color":  "#ffffff",
    "bg_base":              "#000000",
    "bg_surface":           "#0e0e11",
    "text_main":            "#ffffff",
    "text_muted":           "#a1a1aa",
    "accent_color":         "#ffffff",
    "navbar_brand_bg":      "#ffffff",
    "navbar_brand_color":   "#000000",
    "footer_text":          "DAVAI © 2026",
    "cta_title":            "Begin Your Study Session",
    "cta_subtitle":         "Access the homework tracker, revision tools, and vocabulary assistant.",
    "features_title":       "Everything you need to study smarter",
    "card_bg":              "#0e0e11",
    "card_border":          "rgba(255,255,255,0.06)",
}

def _site_config_get():
    rows = db().execute("SELECT key, value FROM site_config").fetchall()
    cfg  = {r["key"]: r["value"] for r in rows}
    result = {}
    for k, default in SITE_DEFAULTS.items():
        result[k] = cfg.get(k, default)
    return 200, result

def _site_config_set(body):
    if not isinstance(body, dict):
        return 400, {"message": "Invalid body"}
    if body.get("_reset"):
        db().execute("DELETE FROM site_config")
        db().commit()
        return 200, {"ok": True, "updated": 0}
    updated = 0
    for k, v in body.items():
        if k in SITE_DEFAULTS and str(v).strip():
            db().execute(
                "INSERT INTO site_config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, str(v).strip())
            )
            updated += 1
    db().commit()
    return 200, {"ok": True, "updated": updated}

def site_config_read():
    rows = db().execute("SELECT key, value FROM site_config").fetchall()
    cfg  = {r["key"]: r["value"] for r in rows}
    result = {}
    for k, default in SITE_DEFAULTS.items():
        result[k] = cfg.get(k, default)
    return result

# ── Password & Rate Log Handlers ──────────────────────────────────────────────

def _change_password(admin_id, body):
    cur  = body.get("current") or ""
    new_ = body.get("new_password") or ""
    if len(new_) < 8:
        return 400, {"message": "New password must be 8+ characters."}
    row = db().execute("SELECT * FROM admin_accounts WHERE id=?", (admin_id,)).fetchone()
    if not row or not _verify_pw(cur, row["pw_hash"]):
        return 401, {"message": "Current password is incorrect."}
    db().execute("UPDATE admin_accounts SET pw_hash=? WHERE id=?", (_hash_pw(new_), admin_id))
    db().commit()
    return 200, {"ok": True}

def _logs():
    try:
        rows = RATE_LOG
    except NameError:
        rows = []
    return 200, rows
