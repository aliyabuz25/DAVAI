"""
DAVAI Admin Backend
SQLite-based admin API — mounted into proxy.py under /admin/api/*
"""
import sqlite3
import json
import os
import hashlib
import hmac
import secrets
import time
import re
import threading
from datetime import datetime, timezone

ADMIN_DB_PATH  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "admin.db")
MOBILE_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "davai-mobile", "backend", "data", "davai.db")

_LOCAL = threading.local()

ADMIN_SCHEMA = """
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
    CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        email       TEXT UNIQUE NOT NULL,
        pw_hash     TEXT NOT NULL,
        plan        TEXT NOT NULL DEFAULT 'free',
        program     TEXT NOT NULL DEFAULT 'IB',
        school      TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
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
"""

MOBILE_SCHEMA = """
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
"""

def _open_con(path: str, schema: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    con = sqlite3.connect(path, timeout=15.0, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("PRAGMA busy_timeout=5000")
    if schema:
        con.executescript(schema)
        con.commit()
    return con

def db():
    if not hasattr(_LOCAL, "admin_db") or _LOCAL.admin_db is None:
        _LOCAL.admin_db = _open_con(ADMIN_DB_PATH, ADMIN_SCHEMA)
    return _LOCAL.admin_db

def mdb():
    if not hasattr(_LOCAL, "mobile_db") or _LOCAL.mobile_db is None:
        try:
            _LOCAL.mobile_db = _open_con(MOBILE_DB_PATH, MOBILE_SCHEMA)
        except Exception as e:
            print(f"[admin_backend] Warning: could not connect to mobile db: {e}")
            return None
    return _LOCAL.mobile_db

def _has_mobile_db():
    return mdb() is not None

# ── Password helpers ──────────────────────────────────────────────────────────

def _hash_pw(password: str) -> str:
    salt = secrets.token_hex(16)
    h    = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return salt + ":" + h.hex()

def _verify_pw(password: str, stored: str) -> bool:
    try:
        salt, h = stored.split(":", 1)
        check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
        return hmac.compare_digest(check.hex(), h)
    except Exception:
        return False

# ── Session helpers ───────────────────────────────────────────────────────────

def _create_session(admin_id: str) -> str:
    token = secrets.token_urlsafe(40)
    expires = datetime.now(timezone.utc).replace(tzinfo=None)
    expires_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    # 7-day expiry
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
    db().execute("DELETE FROM admin_sessions WHERE expires_at <= datetime('now')")
    db().commit()

# ── Setup check ───────────────────────────────────────────────────────────────

def is_setup_done() -> bool:
    row = db().execute("SELECT COUNT(*) as c FROM admin_accounts").fetchone()
    return row["c"] > 0

# ── Route dispatch ────────────────────────────────────────────────────────────

def handle(method: str, path: str, body: dict, token: str) -> tuple:
    """Returns (status_code, response_dict)"""

    # ── Public ──────────────────────────────────────────────
    if path == "/admin/api/setup-status" and method == "GET":
        return 200, {"done": is_setup_done()}

    if path == "/admin/api/setup" and method == "POST":
        return _setup(body)

    if path == "/admin/api/login" and method == "POST":
        return _login(body)

    # ── Auth required ────────────────────────────────────────
    admin = verify_session(token)
    if not admin:
        return 401, {"message": "Unauthorized"}

    if path == "/admin/api/me" and method == "GET":
        return 200, {"id": admin["id"], "username": admin["username"]}

    if path == "/admin/api/stats" and method == "GET":
        return _stats()

    # Users
    if path == "/admin/api/users" and method == "GET":
        return _users_list()
    if path == "/admin/api/users" and method == "POST":
        return _user_create(body)
    if re.match(r"^/admin/api/users/[\w-]+$", path):
        uid = path.split("/")[-1]
        if method == "PATCH":  return _user_update(uid, body)
        if method == "DELETE": return _user_delete(uid)

    # Payments
    if path == "/admin/api/payments" and method == "GET":
        return _payments_list(body)
    if re.match(r"^/admin/api/payments/[\w-]+/approve$", path):
        pid = path.split("/")[-2]
        if method == "POST": return _payment_approve(pid)
    if re.match(r"^/admin/api/payments/[\w-]+/reject$", path):
        pid = path.split("/")[-2]
        if method == "POST": return _payment_reject(pid)

    # Codes
    if path == "/admin/api/codes" and method == "GET":
        return _codes_list()
    if path == "/admin/api/codes/generate" and method == "POST":
        return _code_generate(body)
    if re.match(r"^/admin/api/codes/[\w-]+$", path):
        cid = path.split("/")[-1]
        if method == "DELETE": return _code_delete(cid)

    # Logs
    if path == "/admin/api/logs" and method == "GET":
        return _logs()

    # Change password
    if path == "/admin/api/change-password" and method == "POST":
        return _change_password(admin["id"], body)

    # AI Config
    if path == "/admin/api/ai-config" and method == "GET":
        return _ai_config_get()
    if path == "/admin/api/ai-config" and method == "POST":
        return _ai_config_set(body)
    if path == "/admin/api/ai-config/test" and method == "POST":
        return _ai_config_test(body)

    # Site Config
    if path == "/admin/api/site-config" and method == "GET":
        return _site_config_get()
    if path == "/admin/api/site-config" and method == "POST":
        return _site_config_set(body)

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
    m     = mdb()
    today = datetime.utcnow().strftime("%Y-%m-%d")

    users_status, all_users = _users_list()
    if users_status != 200: all_users = []

    total_users   = len(all_users)
    pro_users     = len([u for u in all_users if u.get("plan") in ("pro", "pro_max")])
    today_signups = len([u for u in all_users if str(u.get("created_at","")).startswith(today)])

    pay_status, all_pay = _payments_list({})
    if pay_status != 200: all_pay = []
    pending_pay   = [p for p in all_pay if p.get("status") == "pending"]
    approved_pay  = [p for p in all_pay if p.get("status") == "approved"]

    code_status, all_codes = _codes_list()
    if code_status != 200: all_codes = []
    active_codes  = [cd for cd in all_codes if not cd.get("used_at")]

    recent_users  = all_users[:8]

    return 200, {
        "total_users":       total_users,
        "pro_users":         pro_users,
        "pending_payments":  len(pending_pay),
        "approved_payments": len(approved_pay),
        "today_signups":     today_signups,
        "active_codes":      len(active_codes),
        "recent_users":      recent_users,
        "pending_pay":       pending_pay[:8],
        "has_mobile_db":     bool(m),
    }

def _users_list():
    seen_ids = set()
    seen_emails = set()
    combined = []

    m = mdb()
    if m:
        try:
            mrows = [dict(r) for r in m.execute(
                "SELECT id,name,email,plan,program,school,created_at FROM users ORDER BY created_at DESC"
            ).fetchall()]
            for r in mrows:
                r["source"] = "app"
                seen_ids.add(r["id"])
                seen_emails.add(r["email"].lower())
                combined.append(r)
        except Exception as e:
            print(f"[admin] Error reading mobile users: {e}")

    try:
        rows = [dict(r) for r in db().execute(
            "SELECT id,name,email,plan,program,school,created_at FROM users ORDER BY created_at DESC"
        ).fetchall()]
        for r in rows:
            if r["id"] not in seen_ids and r["email"].lower() not in seen_emails:
                r["source"] = "web"
                combined.append(r)
    except Exception as e:
        print(f"[admin] Error reading web users: {e}")

    return 200, sorted(combined, key=lambda x: x.get("created_at",""), reverse=True)

def _user_create(body):
    name     = (body.get("name") or "").strip()
    email    = (body.get("email") or "").strip().lower()
    password = body.get("password") or secrets.token_urlsafe(10)
    plan     = body.get("plan") or "free"
    program  = body.get("program") or "IB"
    school   = (body.get("school") or "").strip() or None
    if not name or not email:
        return 400, {"message": "name and email required"}

    m = mdb()
    if m:
        ex = m.execute("SELECT id FROM users WHERE lower(email)=?", (email,)).fetchone()
        if ex:
            return 409, {"message": "Email already exists"}
    ex_a = db().execute("SELECT id FROM users WHERE lower(email)=?", (email,)).fetchone()
    if ex_a:
        return 409, {"message": "Email already exists"}

    uid = secrets.token_urlsafe(16)
    pw_hashed = _hash_pw(password)
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

    # Insert into mobile DB so mobile app user can log in immediately
    if m:
        m.execute(
            "INSERT INTO users (id,name,email,password,plan,program,school,created_at) VALUES (?,?,?,?,?,?,?,?)",
            (uid, name, email, pw_hashed, plan, program, school, now)
        )
        m.commit()

    # Also mirror into admin DB for full compatibility
    db().execute(
        "INSERT INTO users (id,name,email,pw_hash,plan,program,school,created_at) VALUES (?,?,?,?,?,?,?,?)",
        (uid, name, email, pw_hashed, plan, program, school, now)
    )
    db().commit()

    row = {
        "id": uid, "name": name, "email": email, "plan": plan, "program": program,
        "school": school, "created_at": now, "source": "app" if m else "web"
    }
    return 201, row

def _user_update(uid, body):
    m = mdb()
    m_row = m.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone() if m else None
    a_row = db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()

    if not m_row and not a_row:
        return 404, {"message": "User not found"}

    row = m_row or a_row
    name     = (body.get("name")    or row["name"]).strip()
    email    = (body.get("email")   or row["email"]).strip().lower()
    plan     = body.get("plan")     or row["plan"]
    program  = body.get("program")  or row["program"]
    school   = (body.get("school")  if "school" in body else row["school"])
    password = body.get("password")
    pw_hashed = _hash_pw(password) if password else None

    # Update in mobile DB
    if m and m_row:
        if pw_hashed:
            m.execute(
                "UPDATE users SET name=?,email=?,plan=?,program=?,school=?,password=? WHERE id=?",
                (name, email, plan, program, school, pw_hashed, uid)
            )
        else:
            m.execute(
                "UPDATE users SET name=?,email=?,plan=?,program=?,school=? WHERE id=?",
                (name, email, plan, program, school, uid)
            )
        m.commit()

    # Update in admin DB
    if a_row:
        if pw_hashed:
            db().execute(
                "UPDATE users SET name=?,email=?,plan=?,program=?,school=?,pw_hash=? WHERE id=?",
                (name, email, plan, program, school, pw_hashed, uid)
            )
        else:
            db().execute(
                "UPDATE users SET name=?,email=?,plan=?,program=?,school=? WHERE id=?",
                (name, email, plan, program, school, uid)
            )
        db().commit()

    updated = {
        "id": uid, "name": name, "email": email, "plan": plan, "program": program,
        "school": school, "source": "app" if m_row else "web"
    }
    return 200, updated

def _user_delete(uid):
    deleted = False
    m = mdb()
    if m:
        try:
            m.execute("DELETE FROM homework WHERE user_id=?", (uid,))
            m.execute("DELETE FROM payments WHERE user_id=?", (uid,))
        except Exception:
            pass
        rm = m.execute("DELETE FROM users WHERE id=?", (uid,))
        m.commit()
        if rm.rowcount > 0:
            deleted = True

    ra = db().execute("DELETE FROM users WHERE id=?", (uid,))
    db().commit()
    if ra.rowcount > 0:
        deleted = True

    if not deleted:
        return 404, {"message": "Not found"}
    return 200, {"ok": True}

def _payments_list(body):
    status = body.get("status","") if isinstance(body, dict) else ""
    q      = "SELECT * FROM payments" + (" WHERE status=?" if status else "") + " ORDER BY created_at DESC"
    args   = (status,) if status else ()

    seen_ids = set()
    combined = []

    m = mdb()
    if m:
        try:
            tbl = m.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='payments'").fetchone()
            if tbl:
                mrows = [dict(r) for r in m.execute(q, args).fetchall()]
                for r in mrows:
                    r["source"] = "app"
                    seen_ids.add(r["id"])
                    combined.append(r)
        except Exception as e:
            print(f"[admin] Error reading mobile payments: {e}")

    try:
        rows = [dict(r) for r in db().execute(q, args).fetchall()]
        for r in rows:
            if r["id"] not in seen_ids:
                r["source"] = "web"
                combined.append(r)
    except Exception as e:
        print(f"[admin] Error reading web payments: {e}")

    return 200, sorted(combined, key=lambda x: x.get("created_at",""), reverse=True)

def _payment_approve(pid):
    approved = False
    m = mdb()
    if m:
        try:
            mp = m.execute("SELECT * FROM payments WHERE id=?", (pid,)).fetchone()
            if mp:
                m.execute("UPDATE payments SET status='approved' WHERE id=?", (pid,))
                if mp["user_id"]:
                    m.execute("UPDATE users SET plan=? WHERE id=?", (mp["plan_id"], mp["user_id"]))
                m.commit()
                approved = True
        except Exception as e:
            print(f"[admin] approve mobile payment error: {e}")

    p = db().execute("SELECT * FROM payments WHERE id=?", (pid,)).fetchone()
    if p:
        db().execute("UPDATE payments SET status='approved' WHERE id=?", (pid,))
        if p["user_id"]:
            db().execute("UPDATE users SET plan=? WHERE id=?", (p["plan_id"], p["user_id"]))
        db().commit()
        approved = True

    if approved:
        return 200, {"ok": True}
    return 404, {"message": "Payment not found"}

def _payment_reject(pid):
    rejected = False
    m = mdb()
    if m:
        try:
            rm = m.execute("UPDATE payments SET status='rejected' WHERE id=?", (pid,))
            m.commit()
            if rm.rowcount > 0:
                rejected = True
        except Exception as e:
            print(f"[admin] reject mobile payment error: {e}")

    ra = db().execute("UPDATE payments SET status='rejected' WHERE id=?", (pid,))
    db().commit()
    if ra.rowcount > 0:
        rejected = True

    if rejected:
        return 200, {"ok": True}
    return 404, {"message": "Payment not found"}

def _codes_list():
    seen = set()
    combined = []
    m = mdb()
    if m:
        try:
            for r in m.execute("SELECT * FROM pro_codes ORDER BY created_at DESC").fetchall():
                d = dict(r)
                seen.add(d["code"])
                combined.append(d)
        except Exception:
            pass
    for r in db().execute("SELECT * FROM pro_codes ORDER BY created_at DESC").fetchall():
        d = dict(r)
        if d["code"] not in seen:
            combined.append(d)
    return 200, sorted(combined, key=lambda x: x.get("created_at",""), reverse=True)

def _code_generate(body):
    plan = body.get("plan") or "pro"
    code = "DAVAI-" + secrets.token_urlsafe(12).upper()[:16]
    cid  = secrets.token_urlsafe(12)
    m = mdb()
    if m:
        try:
            m.execute(
                "INSERT INTO pro_codes (id,code,plan) VALUES (?,?,?)",
                (cid, code, plan)
            )
            m.commit()
        except Exception as e:
            print(f"[admin] mobile db pro_code insert error: {e}")
    db().execute(
        "INSERT INTO pro_codes (id,code,plan) VALUES (?,?,?)",
        (cid, code, plan)
    )
    db().commit()
    return 201, {"code": code, "plan": plan}

def _code_delete(cid):
    deleted = False
    m = mdb()
    if m:
        try:
            rm = m.execute("DELETE FROM pro_codes WHERE id=?", (cid,))
            m.commit()
            if rm.rowcount > 0: deleted = True
        except Exception:
            pass
    ra = db().execute("DELETE FROM pro_codes WHERE id=?", (cid,))
    db().commit()
    if ra.rowcount > 0: deleted = True
    if not deleted:
        return 404, {"message": "Not found"}
    return 200, {"ok": True}

def _logs():
    # Return dummy rate-limit snapshot (real data lives in proxy.py memory)
    # proxy.py will inject real data via RATE_LOG global
    try:
        rows = RATE_LOG  # injected by proxy.py
    except NameError:
        rows = []
    return 200, rows

# ── AI Config ─────────────────────────────────────────────────────────────────

def _ensure_ai_config_table():
    db().execute("""
        CREATE TABLE IF NOT EXISTS ai_config (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)
    db().commit()

DEFAULTS = {
    "base_url":      "https://app.claude.gg/v1",
    "active_model":  "claude-sonnet-4-5",
    "max_tokens":    "800",
    "free_limit":    "15",
    "pro_limit":     "60",
    "promax_limit":  "150",
    "hourly_limit":  "20",
}

def _ai_config_get():
    _ensure_ai_config_table()
    rows = db().execute("SELECT key, value FROM ai_config").fetchall()
    cfg  = {r["key"]: r["value"] for r in rows}
    key  = cfg.get("api_key", "")
    return 200, {
        "base_url":      cfg.get("base_url",     DEFAULTS["base_url"]),
        "active_model":  cfg.get("active_model", DEFAULTS["active_model"]),
        "api_key_set":   bool(key),
        "api_key_hint":  (key[:6] + "..." + key[-4:]) if len(key) > 12 else ("*" * len(key) if key else ""),
        "max_tokens":    int(cfg.get("max_tokens",   DEFAULTS["max_tokens"])),
        "free_limit":    int(cfg.get("free_limit",   DEFAULTS["free_limit"])),
        "pro_limit":     int(cfg.get("pro_limit",    DEFAULTS["pro_limit"])),
        "promax_limit":  int(cfg.get("promax_limit", DEFAULTS["promax_limit"])),
        "hourly_limit":  int(cfg.get("hourly_limit", DEFAULTS["hourly_limit"])),
        "models": [
            {"id": "claude-haiku-5-5",    "label": "Claude Haiku 5.5 — fast, cheap"},
            {"id": "claude-sonnet-4-5",   "label": "Claude Sonnet 4.5 — balanced"},
            {"id": "claude-sonnet-4-6",   "label": "Claude Sonnet 4.6 — latest"},
            {"id": "claude-sonnet-5-5",   "label": "Claude Sonnet 5.5 — powerful"},
            {"id": "claude-opus-5-5",     "label": "Claude Opus 5.5 — best"},
            {"id": "claude-fable-5-1",    "label": "Claude Fable 5.1 — creative"},
        ],
    }

def _ai_config_set(body):
    _ensure_ai_config_table()
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

def _ai_config_test(body):
    import urllib.request
    cfg = ai_config_read()
    base_url = (body.get("base_url") or cfg.get("base_url") or DEFAULTS["base_url"]).rstrip("/")
    api_key = (body.get("api_key") or cfg.get("api_key") or "").strip()
    active_model = body.get("active_model") or cfg.get("active_model") or DEFAULTS["active_model"]

    if not api_key:
        return 200, {"ok": False, "message": "No API key configured. Enter your API key."}

    req_data = json.dumps({
        "model": active_model,
        "max_tokens": 10,
        "messages": [{"role": "user", "content": "ping"}]
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{base_url}/messages",
        data=req_data,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "Authorization": f"Bearer {api_key}",
            "anthropic-version": "2023-06-01"
        },
        method="POST"
    )

    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=10.0) as resp:
            latency = int((time.time() - t0) * 1000)
            return 200, {"ok": True, "status": resp.status, "latency_ms": latency, "model": active_model}
    except urllib.error.HTTPError as e:
        latency = int((time.time() - t0) * 1000)
        try:
            err_json = json.loads(e.read().decode())
            err_msg = err_json.get("error", {}).get("message", f"HTTP {e.code}")
        except Exception:
            err_msg = f"HTTP {e.code}"
        return 200, {"ok": False, "status": e.code, "latency_ms": latency, "message": err_msg}
    except Exception as e:
        return 200, {"ok": False, "message": f"Connection error: {str(e)}"}

def _sync_env_file(updates: dict):
    """Write updated keys back to davai-mobile/backend/.env"""
    import os
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "davai-mobile", "backend", ".env")
    if not os.path.exists(env_path):
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
        # Add any keys not already present
        for env_key, val in env_keys.items():
            if env_key not in written:
                new_lines.append(f"{env_key}={val}\n")
        with open(env_path, "w") as f:
            f.writelines(new_lines)
    except Exception as e:
        print(f"[admin] .env sync failed: {e}")

def ai_config_read():
    """Called by Node backend via HTTP to get current config."""
    _ensure_ai_config_table()
    rows = db().execute("SELECT key, value FROM ai_config").fetchall()
    cfg  = {r["key"]: r["value"] for r in rows}
    return {
        "api_key":      cfg.get("api_key",      ""),
        "base_url":     cfg.get("base_url",      ""),
        "active_model": cfg.get("active_model",  DEFAULTS["active_model"]),
        "max_tokens":   int(cfg.get("max_tokens",  DEFAULTS["max_tokens"])),
        "free_limit":   int(cfg.get("free_limit",  DEFAULTS["free_limit"])),
        "pro_limit":    int(cfg.get("pro_limit",   DEFAULTS["pro_limit"])),
        "promax_limit": int(cfg.get("promax_limit",DEFAULTS["promax_limit"])),
        "hourly_limit": int(cfg.get("hourly_limit",DEFAULTS["hourly_limit"])),
    }

# ── Site Config ────────────────────────────────────────────────────────────────

def _ensure_site_config_table():
    db().execute("""
        CREATE TABLE IF NOT EXISTS site_config (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)
    db().commit()

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
    _ensure_site_config_table()
    rows = db().execute("SELECT key, value FROM site_config").fetchall()
    cfg  = {r["key"]: r["value"] for r in rows}
    result = {}
    for k, default in SITE_DEFAULTS.items():
        result[k] = cfg.get(k, default)
    return 200, result

def _site_config_set(body):
    _ensure_site_config_table()
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
    _ensure_site_config_table()
    rows = db().execute("SELECT key, value FROM site_config").fetchall()
    cfg  = {r["key"]: r["value"] for r in rows}
    result = {}
    for k, default in SITE_DEFAULTS.items():
        result[k] = cfg.get(k, default)
    return result

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

# ── Payment submit (called from mobile app) ───────────────────────────────────

def submit_payment(user_id, plan_id, sender_name, sender_ref):
    if not plan_id or not sender_name:
        return 400, {"message": "plan_id and sender_name required"}
    pid = secrets.token_urlsafe(16)
    m = mdb()
    if m:
        try:
            m.execute(
                "INSERT INTO payments (id,user_id,plan_id,sender_name,sender_ref) VALUES (?,?,?,?,?)",
                (pid, user_id or None, plan_id, sender_name.strip(), (sender_ref or "").strip() or None)
            )
            m.commit()
        except Exception as e:
            print(f"[admin] mobile submit payment error: {e}")
    db().execute(
        "INSERT INTO payments (id,user_id,plan_id,sender_name,sender_ref) VALUES (?,?,?,?,?)",
        (pid, user_id or None, plan_id, sender_name.strip(), (sender_ref or "").strip() or None)
    )
    db().commit()
    return 201, {"ok": True, "paymentId": pid}

def get_payment_status(pid):
    m = mdb()
    if m:
        try:
            row = m.execute("SELECT status,plan_id FROM payments WHERE id=?", (pid,)).fetchone()
            if row: return 200, dict(row)
        except Exception:
            pass
    row = db().execute("SELECT status,plan_id FROM payments WHERE id=?", (pid,)).fetchone()
    if not row:
        return 404, {"message": "Not found"}
    return 200, dict(row)

# ── Redeem code (called from mobile app) ─────────────────────────────────────

def redeem_code(user_id, code):
    code_clean = (code or "").strip().upper()
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    m = mdb()

    # Check mobile DB first
    if m:
        try:
            row = m.execute("SELECT * FROM pro_codes WHERE UPPER(code)=? AND used_at IS NULL", (code_clean,)).fetchone()
            if row:
                m.execute("UPDATE pro_codes SET used_at=?, used_by=? WHERE id=?", (now, user_id, row["id"]))
                if user_id:
                    m.execute("UPDATE users SET plan=? WHERE id=?", (row["plan"], user_id))
                m.commit()
                # Mirror in admin db
                db().execute("UPDATE pro_codes SET used_at=?, used_by=? WHERE UPPER(code)=?", (now, user_id, code_clean))
                db().commit()
                return 200, {"ok": True, "plan": row["plan"]}
        except Exception as e:
            print(f"[admin] mobile redeem error: {e}")

    # Check admin DB
    row_a = db().execute("SELECT * FROM pro_codes WHERE UPPER(code)=? AND used_at IS NULL", (code_clean,)).fetchone()
    if not row_a:
        return 400, {"message": "Invalid or already used code."}

    db().execute("UPDATE pro_codes SET used_at=?, used_by=? WHERE id=?", (now, user_id, row_a["id"]))
    if user_id:
        db().execute("UPDATE users SET plan=? WHERE id=?", (row_a["plan"], user_id))
    db().commit()

    if m and user_id:
        try:
            m.execute("UPDATE users SET plan=? WHERE id=?", (row_a["plan"], user_id))
            m.commit()
        except Exception:
            pass

    return 200, {"ok": True, "plan": row_a["plan"]}
