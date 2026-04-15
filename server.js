/**
 * BuildMatrix Backend — server.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fixes vs original:
 *  1. sql.js (in-memory, loses data on restart) → better-sqlite3 (persistent)
 *  2. Brevo SMTP properly configured via EMAIL_HOST / EMAIL_PORT / EMAIL_FROM
 *  3. Added missing email_verifications table
 *  4. Added bio / theme columns to users
 *  5. requireAuth now loads full user row (needed for ban checks etc.)
 *  6. Banned users blocked at login
 *  7. All original endpoints kept 100% intact
 *
 * Install:  npm install
 * Run:      node server.js  /  npm start
 */

'use strict';
require('dotenv').config();

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const bcrypt     = require('bcryptjs');
const cors       = require('cors');
const session    = require('express-session');
const speakeasy  = require('speakeasy');
const QRCode     = require('qrcode');
const nodemailer = require('nodemailer');
const Database   = require('better-sqlite3');
const { exec }   = require('child_process');

// optional price-sources module
let priceSources = null;
try {
  priceSources = require('./price-sources.js');
} catch (_) {
  console.warn('price-sources.js not found — price endpoints disabled.');
  priceSources = { STORES: {}, getPricesForProduct: async () => ({ prices: [], bestPrice: null }) };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const PORT         = Number(process.env.PORT || 5000);
const DB_FILE      = process.env.DB_FILE || path.join(__dirname, 'buildmatrix.sqlite');
const isProduction = process.env.NODE_ENV === 'production';

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE — better-sqlite3 (persistent file, no data loss on restart)
// ─────────────────────────────────────────────────────────────────────────────
const sqliteDb = new Database(DB_FILE);
sqliteDb.pragma('journal_mode = WAL');
sqliteDb.pragma('foreign_keys = ON');

sqliteDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    name                     TEXT    NOT NULL,
    email                    TEXT    NOT NULL UNIQUE,
    password                 TEXT    NOT NULL,
    bio                      TEXT    DEFAULT '',
    theme                    TEXT    DEFAULT 'dark',
    avatar_url               TEXT    DEFAULT NULL,
    two_factor_enabled       INTEGER NOT NULL DEFAULT 0,
    two_factor_secret        TEXT,
    two_factor_temp_secret   TEXT,
    two_factor_verified_at   TEXT,
    is_admin                 INTEGER DEFAULT 0,
    banned                   INTEGER NOT NULL DEFAULT 0,
    created_at               TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    token       TEXT    NOT NULL,
    expires_at  TEXT    NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS email_verifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    NOT NULL,
    code        TEXT    NOT NULL,
    type        TEXT    NOT NULL,
    expires_at  TEXT    NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS two_factor_recovery_codes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    recovery_code TEXT    NOT NULL,
    is_used       INTEGER NOT NULL DEFAULT 0,
    used_at       TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS two_factor_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    action      TEXT    NOT NULL,
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS builds (
    id          TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    name        TEXT    NOT NULL,
    total       INTEGER NOT NULL DEFAULT 0,
    items_json  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS shared_builds (
    id          TEXT PRIMARY KEY,
    items_json  TEXT NOT NULL,
    total       INTEGER NOT NULL DEFAULT 0,
    name        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL,
    price       INTEGER NOT NULL,
    tier        TEXT,
    specs       TEXT,
    img         TEXT,
    rating      REAL,
    ratingCount INTEGER,
    meta        TEXT
  );

  CREATE TABLE IF NOT EXISTS newsletter (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// safe column migrations
for (const m of [
  "ALTER TABLE users ADD COLUMN is_admin    INTEGER DEFAULT 0",
  "ALTER TABLE users ADD COLUMN banned      INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN avatar_url  TEXT DEFAULT NULL",
  "ALTER TABLE users ADD COLUMN bio         TEXT DEFAULT ''",
  "ALTER TABLE users ADD COLUMN theme       TEXT DEFAULT 'dark'",
]) { try { sqliteDb.exec(m); } catch (_) {} }

// thin async wrapper — keeps original  const [rows] = await db.query(...)  pattern
const db = {
  query(sql, params = []) {
    const isSelect = /^\s*select/i.test(sql.trim());
    if (isSelect) {
      const rows = sqliteDb.prepare(sql).all(...params);
      return Promise.resolve([rows]);
    }
    const info = sqliteDb.prepare(sql).run(...params);
    return Promise.resolve([{ affectedRows: info.changes, insertId: info.lastInsertRowid }]);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL — Brevo SMTP
// ─────────────────────────────────────────────────────────────────────────────
function buildTransporter() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    host:   process.env.EMAIL_HOST || 'smtp-relay.brevo.com',
    port:   Number(process.env.EMAIL_PORT || 587),
    secure: false,
    auth: { user, pass },
  });
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOtpEmail({ to, code, subject, purpose }) {
  const tr = buildTransporter();
  if (!tr) { console.warn('[EMAIL] Not configured — OTP:', code); return { sent: false }; }

  const labels = {
    signup:          'Complete your BuildMatrix registration',
    change_password: 'Confirm your password change',
  };
  const label = labels[purpose] || 'Verify your BuildMatrix action';
  const from  = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  await tr.sendMail({
    from: `"BuildMatrix" <${from}>`,
    to,
    subject: subject || 'BuildMatrix Verification Code',
    html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#080C14;font-family:Inter,Arial,sans-serif;">
<div style="max-width:480px;margin:40px auto;background:#0e1520;border:1px solid rgba(0,212,255,0.15);border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,rgba(0,212,255,0.1),rgba(123,63,228,0.1));padding:28px 32px;border-bottom:1px solid rgba(0,212,255,0.1);">
    <div style="font-size:22px;font-weight:900;letter-spacing:0.05em;color:#00D4FF;">&#9881; BUILDMATRIX</div>
    <div style="font-size:12px;color:#5a8aaa;margin-top:4px;text-transform:uppercase;letter-spacing:0.08em;">Ultimate PC Builder &middot; Philippines</div>
  </div>
  <div style="padding:32px;">
    <div style="font-size:16px;font-weight:700;color:#D8EEFF;margin-bottom:8px;">${label}</div>
    <div style="font-size:13px;color:#5a8aaa;margin-bottom:28px;line-height:1.6;">Your one-time verification code is:</div>
    <div style="background:rgba(0,212,255,0.07);border:1px solid rgba(0,212,255,0.2);border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
      <div style="font-size:40px;font-weight:900;letter-spacing:0.3em;color:#00D4FF;font-family:monospace;">${code}</div>
    </div>
    <div style="font-size:12px;color:#2a4560;line-height:1.6;">
      This code expires in <strong style="color:#5a8aaa;">10 minutes</strong>.<br>
      If you did not request this, ignore this email. Never share this code.
    </div>
  </div>
  <div style="padding:16px 32px;border-top:1px solid rgba(0,212,255,0.08);font-size:11px;color:#2a4560;text-align:center;">&copy; ${new Date().getFullYear()} BuildMatrix &mdash; Philippines</div>
</div></body></html>`,
  });
  return { sent: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPRESS APP
// ─────────────────────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);

const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) return cb(null, true);
    if (origin.includes('.onrender.com') || origin.includes('.netlify.app')) return cb(null, true);
    if (origin.includes('ngrok')) return cb(null, true);
    cb(null, true);
  },
  credentials: true,
  optionsSuccessStatus: 200,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  name: 'buildmatrix.sid',
  secret: (() => {
    const s = process.env.SESSION_SECRET;
    if (!s || s === 'dev-secret-change-me') {
      const gen = crypto.randomBytes(32).toString('hex');
      if (!s) console.warn('SESSION_SECRET not set — sessions will reset on restart!');
      return gen;
    }
    return s;
  })(),
  resave: true,
  saveUninitialized: true,
  rolling: true,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure:   isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge:   7 * 24 * 60 * 60 * 1000,
    path: '/',
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  if (!req.session?.userId)
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    const user = rows[0];
    if (!user) { req.session.destroy(() => {}); return res.status(401).json({ success: false, error: 'User not found' }); }
    if (user.banned) return res.status(403).json({ success: false, error: 'Your account has been banned.' });
    req.user = user;
    next();
  } catch (err) {
    console.error('requireAuth error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
}

async function requireAdmin(req, res, next) {
  if (!req.session?.userId)
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!rows[0]?.is_admin) return res.status(403).json({ success: false, error: 'Admin access required' });
    req.user = rows[0];
    next();
  } catch (err) {
    console.error('requireAdmin error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
}

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id:               row.id,
    name:             row.name,
    email:            row.email,
    bio:              row.bio  || '',
    theme:            row.theme || 'dark',
    avatarUrl:        row.avatar_url || null,
    twoFactorEnabled: !!row.two_factor_enabled,
    is_admin:         !!row.is_admin,
    createdAt:        row.created_at,
  };
}

function randomTokenHex(bytes = 32)  { return crypto.randomBytes(bytes).toString('hex'); }
function hashRecoveryCode(code)       { return crypto.createHash('sha256').update(code).digest('hex'); }
function generateRecoveryCodes(n = 8) { return Array.from({ length: n }, () => crypto.randomBytes(4).toString('hex').toUpperCase()); }

// ─────────────────────────────────────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/auth/test', (req, res) =>
  res.json({ success: true, message: 'Backend is running!', time: new Date().toISOString() })
);

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const name     = String(req.body.name  || '').trim();
    const email    = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const verCode  = String(req.body.verificationCode || '').trim();

    if (!name || !email || !password)
      return res.status(400).json({ success: false, error: 'All fields are required' });
    if (password.length < 6)
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });

    const [exists] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (exists.length)
      return res.status(400).json({ success: false, error: 'Email already registered' });

    // verify OTP only when email is configured AND user provided a code
    const emailConfigured = !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);
    if (emailConfigured && verCode) {
      const [vcRows] = await db.query(
        "SELECT id FROM email_verifications WHERE email=? AND code=? AND type='signup' AND used=0 AND expires_at>?",
        [email, verCode, new Date().toISOString()]
      );
      if (!vcRows.length)
        return res.status(400).json({ success: false, error: 'Invalid or expired verification code' });
      await db.query('UPDATE email_verifications SET used=1 WHERE id=?', [vcRows[0].id]);
    }

    const hashed = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name, email, hashed]);
    const [newRows] = await db.query('SELECT * FROM users WHERE email=?', [email]);
    res.json({ success: true, message: 'Registration successful', user: sanitizeUser(newRows[0]) });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const email         = String(req.body.email        || '').trim().toLowerCase();
    const password      = String(req.body.password     || '');
    const twoFactorCode = String(req.body.twoFactorCode || '').trim();

    const [rows] = await db.query('SELECT * FROM users WHERE email=?', [email]);
    const user = rows[0];
    if (!user)       return res.status(401).json({ success: false, error: 'Invalid credentials' });
    if (user.banned) return res.status(403).json({ success: false, error: 'Your account has been banned.' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ success: false, error: 'Invalid credentials' });

    if (user.two_factor_enabled) {
      if (!twoFactorCode) return res.json({ requires2FA: true, userId: user.id });

      const verified = speakeasy.totp.verify({ secret: user.two_factor_secret, encoding: 'base32', token: twoFactorCode, window: 1 });
      if (!verified) {
        const hashed = hashRecoveryCode(twoFactorCode);
        const [rcRows] = await db.query(
          'SELECT id FROM two_factor_recovery_codes WHERE user_id=? AND recovery_code=? AND is_used=0',
          [user.id, hashed]
        );
        if (!rcRows.length) {
          await db.query('INSERT INTO two_factor_logs (user_id,action,ip_address,user_agent) VALUES (?,?,?,?)',
            [user.id, 'failed', req.ip, req.headers['user-agent'] || '']);
          return res.status(401).json({ success: false, error: 'Invalid 2FA code' });
        }
        await db.query("UPDATE two_factor_recovery_codes SET is_used=1, used_at=datetime('now') WHERE id=?", [rcRows[0].id]);
        await db.query('INSERT INTO two_factor_logs (user_id,action,ip_address,user_agent) VALUES (?,?,?,?)',
          [user.id, 'recovered', req.ip, req.headers['user-agent'] || '']);
      } else {
        await db.query('INSERT INTO two_factor_logs (user_id,action,ip_address,user_agent) VALUES (?,?,?,?)',
          [user.id, 'verified', req.ip, req.headers['user-agent'] || '']);
      }
    }

    req.session.userId = user.id;
    req.session.save(() => res.json({ success: true, user: sanitizeUser(user) }));
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  if (!req.session) return res.json({ success: true });
  req.session.destroy(() => { res.clearCookie('buildmatrix.sid'); res.json({ success: true, message: 'Logged out' }); });
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const [rcRows] = await db.query(
      'SELECT COUNT(*) AS count FROM two_factor_recovery_codes WHERE user_id=? AND is_used=0', [req.user.id]);
    res.json({ ...sanitizeUser(req.user), recoveryCodesLeft: rcRows[0]?.count ?? 0 });
  } catch (err) {
    console.error('me error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/auth/theme
app.put('/api/auth/theme', requireAuth, async (req, res) => {
  try {
    const theme = req.body.theme === 'light' ? 'light' : 'dark';
    await db.query('UPDATE users SET theme=? WHERE id=?', [theme, req.user.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

// POST /api/auth/send-verification  — email OTP for registration
app.post('/api/auth/send-verification', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

    const [exists] = await db.query('SELECT id FROM users WHERE email=?', [email]);
    if (exists.length) return res.status(400).json({ success: false, error: 'Email already registered' });

    const code    = generateOtp();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await db.query("DELETE FROM email_verifications WHERE email=? AND type='signup'", [email]);
    await db.query("INSERT INTO email_verifications (email,code,type,expires_at) VALUES (?,?,'signup',?)", [email, code, expires]);

    let mailStatus = { sent: false };
    try { mailStatus = await sendOtpEmail({ to: email, code, subject: 'BuildMatrix — Verify Your Email', purpose: 'signup' }); }
    catch (e) { console.error('send-verification mail error:', e.message); }

    res.json({ success: true, message: mailStatus.sent ? 'Code sent!' : 'Code generated.', ...(mailStatus.sent ? {} : { devToken: code }) });
  } catch (err) {
    console.error('send-verification error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/auth/reset-password-captcha — no email OTP, captcha verified on frontend
app.post('/api/auth/reset-password-captcha', async (req, res) => {
  try {
    const email       = String(req.body.email       || '').trim().toLowerCase();
    const newPassword = String(req.body.newPassword || '');
    if (!email)           return res.status(400).json({ success: false, error: 'Email is required' });
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });

    const [rows] = await db.query('SELECT id FROM users WHERE email=?', [email]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'No account found with that email' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password=? WHERE email=?', [hashed, email]);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    console.error('reset-password-captcha error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/auth/change-password
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword     = String(req.body.newPassword     || '');
    if (!currentPassword || !newPassword) return res.status(400).json({ success: false, error: 'All fields are required' });
    if (newPassword.length < 6) return res.status(400).json({ success: false, error: 'New password must be at least 6 characters' });
    const ok = await bcrypt.compare(currentPassword, req.user.password);
    if (!ok) return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password=? WHERE id=?', [hashed, req.user.id]);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('change-password error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/auth/send-security-otp
app.post('/api/auth/send-security-otp', requireAuth, async (req, res) => {
  try {
    const purpose = String(req.body.purpose || 'change_password');
    if (!['change_password', 'enable_2fa', 'disable_2fa'].includes(purpose))
      return res.status(400).json({ success: false, error: 'Invalid purpose' });

    const email   = req.user.email;
    const code    = generateOtp();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await db.query('DELETE FROM email_verifications WHERE email=? AND type=?', [email, purpose]);
    await db.query('INSERT INTO email_verifications (email,code,type,expires_at) VALUES (?,?,?,?)', [email, code, purpose, expires]);

    const subjectMap = { change_password: 'BuildMatrix — Confirm Password Change', enable_2fa: 'BuildMatrix — Confirm Enable 2FA', disable_2fa: 'BuildMatrix — Confirm Disable 2FA' };
    let mailStatus = { sent: false };
    try { mailStatus = await sendOtpEmail({ to: email, code, subject: subjectMap[purpose], purpose }); }
    catch (e) { console.error('send-security-otp mail error:', e.message); }

    const masked = email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
    res.json({ success: true, email: masked, message: mailStatus.sent ? 'Code sent to your email!' : 'Code generated.', ...(mailStatus.sent ? {} : { devToken: code }) });
  } catch (err) {
    console.error('send-security-otp error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/auth/verify-security-otp
app.post('/api/auth/verify-security-otp', requireAuth, async (req, res) => {
  try {
    const code    = String(req.body.code    || '').trim();
    const purpose = String(req.body.purpose || 'change_password');
    if (!code) return res.status(400).json({ success: false, error: 'Code is required' });
    const [vcRows] = await db.query(
      'SELECT id FROM email_verifications WHERE email=? AND code=? AND type=? AND used=0 AND expires_at>?',
      [req.user.email, code, purpose, new Date().toISOString()]
    );
    if (!vcRows.length) return res.status(400).json({ success: false, error: 'Invalid or expired code. Check your email.' });
    await db.query('UPDATE email_verifications SET used=1 WHERE id=?', [vcRows[0].id]);
    res.json({ success: true });
  } catch (err) {
    console.error('verify-security-otp error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/auth/avatar
app.post('/api/auth/avatar', requireAuth, async (req, res) => {
  try {
    const avatarUrl = req.body.avatarUrl || null;
    if (avatarUrl && avatarUrl.length > 250000) return res.status(400).json({ success: false, error: 'Image too large. Max 200KB.' });
    await db.query('UPDATE users SET avatar_url=? WHERE id=?', [avatarUrl, req.user.id]);
    res.json({ success: true, avatarUrl });
  } catch (err) {
    console.error('avatar update error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PUT /api/auth/profile
app.put('/api/auth/profile', requireAuth, async (req, res) => {
  try {
    const name  = String(req.body.name  || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
    const fields = ['name=?']; const values = [name];
    if (email && email !== req.user.email) {
      const [existing] = await db.query('SELECT id FROM users WHERE email=? AND id!=?', [email, req.user.id]);
      if (existing.length) return res.status(409).json({ success: false, error: 'Email already in use' });
      fields.push('email=?'); values.push(email);
    }
    values.push(req.user.id);
    await db.query(`UPDATE users SET ${fields.join(',')} WHERE id=?`, values);
    const [rows] = await db.query('SELECT * FROM users WHERE id=?', [req.user.id]);
    res.json({ success: true, user: sanitizeUser(rows[0]) });
  } catch (err) {
    console.error('profile update error:', err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/profile/:userId', requireAuth, async (req, res) => {
  try {
    const [userRows] = await db.query('SELECT * FROM users WHERE id=?', [req.params.userId]);
    const user = userRows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const [builds] = await db.query('SELECT * FROM builds WHERE user_id=? ORDER BY created_at DESC', [user.id]);
    const totalSpent = builds.reduce((s, b) => s + (b.total || 0), 0);
    res.json({
      user: sanitizeUser(user),
      stats: { totalBuilds: builds.length, totalSpent: Math.round(totalSpent), avgBuild: builds.length ? Math.round(totalSpent / builds.length) : 0 },
      recentBuilds: builds.slice(0, 5).map(b => ({ id: b.id, name: b.name, total: b.total, created_at: b.created_at })),
    });
  } catch (err) {
    console.error('profile get error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/profile/update', requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 80);
    const bio  = String(req.body.bio  || '').trim().slice(0, 300);
    if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
    await db.query('UPDATE users SET name=?, bio=? WHERE id=?', [name, bio, req.user.id]);
    const [rows] = await db.query('SELECT * FROM users WHERE id=?', [req.user.id]);
    res.json({ success: true, user: sanitizeUser(rows[0]) });
  } catch (err) {
    console.error('profile update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2FA ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/2fa/status', requireAuth, async (req, res) => {
  try {
    const [rcRows] = await db.query('SELECT COUNT(*) AS count FROM two_factor_recovery_codes WHERE user_id=? AND is_used=0', [req.user.id]);
    res.json({ success: true, enabled: !!req.user.two_factor_enabled, recoveryCodesLeft: rcRows[0]?.count ?? 0 });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.post('/api/2fa/setup', requireAuth, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({ name: `BuildMatrix:${req.user.email}`, issuer: 'BuildMatrix' });
    await db.query('UPDATE users SET two_factor_temp_secret=? WHERE id=?', [secret.base32, req.user.id]);
    const qrCode = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ success: true, qrCode, secret: secret.base32 });
  } catch (err) { res.status(500).json({ success: false, error: 'Failed to setup 2FA' }); }
});

app.post('/api/2fa/verify', requireAuth, async (req, res) => {
  try {
    const token = String(req.body.token || '').trim();
    if (!token) return res.status(400).json({ success: false, error: 'Token is required' });
    const temp = req.user.two_factor_temp_secret;
    if (!temp) return res.status(400).json({ success: false, error: '2FA setup not initiated' });
    const ok = speakeasy.totp.verify({ secret: temp, encoding: 'base32', token, window: 1 });
    if (!ok) {
      await db.query('INSERT INTO two_factor_logs (user_id,action,ip_address,user_agent) VALUES (?,?,?,?)', [req.user.id, 'failed', req.ip, req.headers['user-agent'] || '']);
      return res.status(400).json({ success: false, error: 'Invalid verification code' });
    }
    await db.query("UPDATE users SET two_factor_enabled=1, two_factor_secret=?, two_factor_temp_secret=NULL, two_factor_verified_at=? WHERE id=?", [temp, new Date().toISOString(), req.user.id]);
    const recoveryCodes = generateRecoveryCodes(8);
    for (const code of recoveryCodes)
      await db.query('INSERT INTO two_factor_recovery_codes (user_id,recovery_code) VALUES (?,?)', [req.user.id, hashRecoveryCode(code)]);
    await db.query('INSERT INTO two_factor_logs (user_id,action,ip_address,user_agent) VALUES (?,?,?,?)', [req.user.id, 'enabled', req.ip, req.headers['user-agent'] || '']);
    res.json({ success: true, message: '2FA enabled successfully', recoveryCodes });
  } catch (err) { res.status(500).json({ success: false, error: 'Failed to verify 2FA' }); }
});

app.post('/api/2fa/disable', requireAuth, async (req, res) => {
  try {
    await db.query('UPDATE users SET two_factor_enabled=0, two_factor_secret=NULL, two_factor_temp_secret=NULL WHERE id=?', [req.user.id]);
    await db.query('DELETE FROM two_factor_recovery_codes WHERE user_id=?', [req.user.id]);
    await db.query('INSERT INTO two_factor_logs (user_id,action,ip_address,user_agent) VALUES (?,?,?,?)', [req.user.id, 'disabled', req.ip, req.headers['user-agent'] || '']);
    res.json({ success: true, message: '2FA disabled successfully' });
  } catch (err) { res.status(500).json({ success: false, error: 'Failed to disable 2FA' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// BUILDS ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/builds', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id,name,total,items_json,created_at FROM builds WHERE user_id=? ORDER BY created_at DESC', [req.user.id]);
    res.json({ success: true, builds: rows.map(r => ({ id: r.id, name: r.name, total: r.total, createdAt: r.created_at, items: (() => { try { return JSON.parse(r.items_json || '[]'); } catch { return []; } })() })) });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.get('/api/builds/:id', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM builds WHERE id=? AND user_id=? LIMIT 1', [req.params.id, req.user.id]);
    const r = rows[0];
    if (!r) return res.status(404).json({ success: false, error: 'Build not found' });
    res.json({ success: true, build: { id: r.id, name: r.name, total: r.total, createdAt: r.created_at, items: (() => { try { return JSON.parse(r.items_json || '[]'); } catch { return []; } })() } });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.post('/api/builds', requireAuth, async (req, res) => {
  try {
    const name  = String(req.body.name  || '').trim();
    const total = Number(req.body.total || 0);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!name)         return res.status(400).json({ success: false, error: 'Build name is required' });
    if (!items.length) return res.status(400).json({ success: false, error: 'Build must contain at least 1 item' });
    const id = crypto.randomUUID();
    await db.query('INSERT INTO builds (id,user_id,name,total,items_json) VALUES (?,?,?,?,?)', [id, req.user.id, name, Math.round(total), JSON.stringify(items)]);
    res.json({ success: true, message: 'Build saved', id });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.put('/api/builds/:id', requireAuth, async (req, res) => {
  try {
    const [exists] = await db.query('SELECT id FROM builds WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    if (!exists.length) return res.status(404).json({ success: false, error: 'Build not found' });
    const fields = []; const values = [];
    const name  = String(req.body.name  || '').trim();
    const total = req.body.total != null ? Number(req.body.total) : null;
    const items = req.body.items != null ? (Array.isArray(req.body.items) ? req.body.items : null) : null;
    if (name)  { fields.push('name=?');       values.push(name); }
    if (total != null && !Number.isNaN(total)) { fields.push('total=?'); values.push(Math.round(total)); }
    if (items) { fields.push('items_json=?'); values.push(JSON.stringify(items)); }
    if (!fields.length) return res.json({ success: true, message: 'Nothing to update' });
    fields.push('updated_at=?'); values.push(new Date().toISOString(), req.params.id, req.user.id);
    await db.query(`UPDATE builds SET ${fields.join(',')} WHERE id=? AND user_id=?`, values);
    res.json({ success: true, message: 'Build updated' });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.delete('/api/builds/:id', requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM builds WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    res.json({ success: true, message: 'Build deleted' });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.put('/api/builds/:id/notes', requireAuth, async (req, res) => {
  try {
    const [exists] = await db.query('SELECT id FROM builds WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    if (!exists.length) return res.status(404).json({ success: false, error: 'Build not found' });
    await db.query('UPDATE builds SET updated_at=? WHERE id=?', [new Date().toISOString(), req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// SHARE ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/share', async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ success: false, error: 'No items in build' });
    const id = crypto.randomBytes(4).toString('hex');
    await db.query('INSERT INTO shared_builds (id,items_json,total,name) VALUES (?,?,?,?)', [id, JSON.stringify(items), Math.round(Number(req.body.total) || 0), String(req.body.name || 'Shared Build').trim()]);
    res.json({ success: true, id, url: `${req.protocol}://${req.get('host')}/index.html?buildShare=${id}` });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.get('/api/share/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM shared_builds WHERE id=?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Shared build not found' });
    const r = rows[0];
    res.json({ success: true, build: { id: r.id, name: r.name, total: r.total, createdAt: r.created_at, items: (() => { try { return JSON.parse(r.items_json); } catch { return []; } })() } });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [[{ count: tu }]] = await db.query('SELECT COUNT(*) as count FROM users');
    const [[{ count: tb }]] = await db.query('SELECT COUNT(*) as count FROM builds');
    const [[{ count: tp }]] = await db.query('SELECT COUNT(*) as count FROM products');
    const [[{ count: nw }]] = await db.query("SELECT COUNT(*) as count FROM users WHERE created_at > datetime('now','-7 days')");
    res.json({ success: true, stats: { totalUsers: tu, totalBuilds: tb, totalProducts: tp, newUsersThisWeek: nw } });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT u.id,u.name,u.email,u.is_admin,u.banned,u.created_at,COUNT(b.id) AS build_count FROM users u LEFT JOIN builds b ON b.user_id=u.id GROUP BY u.id ORDER BY u.created_at DESC`);
    res.json({ success: true, users: rows.map(r => ({ _id: String(r.id), id: String(r.id), name: r.name, email: r.email, is_admin: !!r.is_admin, banned: !!r.banned, buildCount: r.build_count || 0, createdAt: r.created_at })) });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { name, email, password, is_admin } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, error: 'name, email, password required' });
    const [exists] = await db.query('SELECT id FROM users WHERE email=?', [email]);
    if (exists.length) return res.status(409).json({ success: false, error: 'Email already in use' });
    await db.query('INSERT INTO users (name,email,password,is_admin) VALUES (?,?,?,?)', [name, email, await bcrypt.hash(password, 10), is_admin ? 1 : 0]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const { name, email, is_admin } = req.body;
    const fields = []; const values = [];
    if (name     !== undefined) { fields.push('name=?');     values.push(name); }
    if (email    !== undefined) { fields.push('email=?');    values.push(email); }
    if (is_admin !== undefined) { fields.push('is_admin=?'); values.push(is_admin ? 1 : 0); }
    if (!fields.length) return res.json({ success: true, message: 'Nothing to update' });
    values.push(Number(req.params.id));
    await db.query(`UPDATE users SET ${fields.join(',')} WHERE id=?`, values);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    if (String(req.session.userId) === String(req.params.id)) return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
    await db.query('DELETE FROM builds WHERE user_id=?', [Number(req.params.id)]);
    await db.query('DELETE FROM users  WHERE id=?',      [Number(req.params.id)]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.put('/api/admin/users/:id/toggle-admin', requireAdmin, async (req, res) => {
  try {
    if (req.params.id == req.session.userId) return res.status(400).json({ success: false, error: 'Cannot modify your own admin status' });
    const [rows] = await db.query('SELECT is_admin FROM users WHERE id=?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
    const newStatus = rows[0].is_admin ? 0 : 1;
    await db.query('UPDATE users SET is_admin=? WHERE id=?', [newStatus, req.params.id]);
    res.json({ success: true, message: `Admin status ${newStatus ? 'granted' : 'removed'}` });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.post('/api/admin/users/:id/ban',   requireAdmin, async (req, res) => { try { await db.query('UPDATE users SET banned=1 WHERE id=?', [Number(req.params.id)]); res.json({ success: true }); } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); } });
app.post('/api/admin/users/:id/unban', requireAdmin, async (req, res) => { try { await db.query('UPDATE users SET banned=0 WHERE id=?', [Number(req.params.id)]); res.json({ success: true }); } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); } });

app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const newPassword = String(req.body.newPassword || '').trim();
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    await db.query('UPDATE users SET password=? WHERE id=?', [await bcrypt.hash(newPassword, 10), Number(req.params.id)]);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.get('/api/admin/builds', requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT b.*,u.name as user_name,u.email FROM builds b JOIN users u ON b.user_id=u.id ORDER BY b.created_at DESC LIMIT 100`);
    res.json({ success: true, builds: rows.map(r => ({ _id: r.id, id: r.id, name: r.name, total: r.total, createdAt: r.created_at, userName: r.user_name || r.email || 'Unknown', userId: String(r.user_id), items: (() => { try { return JSON.parse(r.items_json || '[]'); } catch { return []; } })() })) });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.delete('/api/admin/builds/:id', requireAdmin, async (req, res) => { try { await db.query('DELETE FROM builds WHERE id=?', [req.params.id]); res.json({ success: true }); } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); } });

app.get('/api/admin/products', requireAdmin, async (req, res) => { try { const [rows] = await db.query('SELECT * FROM products ORDER BY category,name'); res.json({ success: true, products: rows }); } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); } });

app.post('/api/admin/products', requireAdmin, async (req, res) => {
  try {
    const { id, name, category, price, tier, specs, img, rating, ratingCount, meta } = req.body;
    if (!id || !name || !category || !price) return res.status(400).json({ success: false, error: 'Missing required fields' });
    await db.query('INSERT INTO products (id,name,category,price,tier,specs,img,rating,ratingCount,meta) VALUES (?,?,?,?,?,?,?,?,?,?)', [id, name, category, price, tier || 'budget', specs || '', img || '', rating || 0, ratingCount || 0, JSON.stringify(meta || {})]);
    res.json({ success: true, message: 'Product added' });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
  try {
    const { name, category, price, tier, specs, img, rating, ratingCount, meta } = req.body;
    await db.query('UPDATE products SET name=?,category=?,price=?,tier=?,specs=?,img=?,rating=?,ratingCount=?,meta=? WHERE id=?', [name, category, price, tier, specs, img, rating, ratingCount, JSON.stringify(meta || {}), req.params.id]);
    res.json({ success: true, message: 'Product updated' });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => { try { await db.query('DELETE FROM products WHERE id=?', [req.params.id]); res.json({ success: true }); } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); } });

// ─────────────────────────────────────────────────────────────────────────────
// NEWSLETTER
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/newsletter/subscribe', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return res.status(400).json({ success: false, error: 'Invalid email' });
    const [existing] = await db.query('SELECT id FROM newsletter WHERE email=?', [email]);
    if (existing.length) return res.json({ success: false, error: 'Email already subscribed' });
    await db.query('INSERT INTO newsletter (email) VALUES (?)', [email]);
    const secret = process.env.SESSION_SECRET || 'buildmatrix-unsub';
    const token  = crypto.createHmac('sha256', secret).update(email).digest('hex');
    res.json({ success: true, unsubscribeUrl: `${req.protocol}://${req.get('host')}/api/newsletter/unsubscribe?email=${encodeURIComponent(email)}&token=${token}` });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.get('/api/newsletter/unsubscribe', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    const token = String(req.query.token || '').trim();
    if (!email) return res.status(400).send('<h2>Invalid link.</h2>');
    const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'buildmatrix-unsub').update(email).digest('hex');
    if (token && token !== expected) return res.status(403).send('<h2>Invalid token.</h2>');
    await db.query('DELETE FROM newsletter WHERE email=?', [email]);
    res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0a;color:#fff;"><h2 style="color:#00D4FF;">✓ Unsubscribed</h2><p style="color:#aaa;">${email} removed from BuildMatrix newsletter.</p><a href="/" style="color:#00D4FF;">← Back</a></body></html>`);
  } catch (err) { res.status(500).send('<h2>Error.</h2>'); }
});

app.get('/api/newsletter/list', requireAdmin, async (req, res) => {
  try { const [rows] = await db.query('SELECT email,created_at FROM newsletter ORDER BY created_at DESC'); res.json({ success: true, subscribers: rows, count: rows.length }); }
  catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.delete('/api/newsletter/:email', requireAdmin, async (req, res) => {
  try { await db.query('DELETE FROM newsletter WHERE email=?', [decodeURIComponent(req.params.email).trim().toLowerCase()]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PRICE SOURCES
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/stores',        (req, res) => res.json({ success: true, stores: Object.values(priceSources.STORES).map(s => ({ name: s.name, url: s.homepage, logo: s.logo, color: s.color })) }));
app.get('/api/store-credits', (req, res) => res.json({ success: true, message: 'Price references from Philippine PC stores', stores: Object.values(priceSources.STORES).map(s => ({ name: s.name, url: s.homepage, logo: s.logo, color: s.color })) }));

app.get('/api/prices/:category/:productId', async (req, res) => {
  try {
    const { category, productId } = req.params;
    const [rows] = await db.query('SELECT name FROM products WHERE id=? AND category=?', [productId, category]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Product not found' });
    const result = await Promise.race([priceSources.getPricesForProduct(rows[0].name, category), new Promise(r => setTimeout(() => r({ timeout: true }), 3000))]);
    if (result.timeout) return res.json({ success: true, product: rows[0].name, category, prices: [], bestPrice: null, note: 'Timed out', lastUpdated: new Date().toISOString() });
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ success: false, error: 'Failed to fetch prices', stores: priceSources.STORES }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// JAVA INTEGRATION
// ─────────────────────────────────────────────────────────────────────────────

function runJava(className, args = []) {
  return new Promise((resolve, reject) => {
    exec(`java -cp "${path.join(__dirname, 'backend-java')}" ${className} ${args.join(' ')}`, { timeout: 5000 }, (error, stdout, stderr) => {
      error ? reject({ error: stderr || error.message }) : resolve({ output: stdout.trim() });
    });
  });
}

app.get('/api/java/compatibility', async (req, res) => {
  try {
    const { cpuSocket, mbSocket, cpuTdp, gpuTdp, psuWattage, ramType, mbRamType } = req.query;
    const results = [];
    if (cpuSocket && mbSocket) { try { results.push((await runJava('CompatibilityChecker', ['socket', cpuSocket, mbSocket])).output); } catch (e) { results.push('Socket check: ' + (e.error || 'error')); } }
    if (cpuTdp && gpuTdp && psuWattage) { try { results.push((await runJava('CompatibilityChecker', ['power', cpuTdp, gpuTdp, psuWattage])).output); } catch (e) { results.push('Power check: ' + (e.error || 'error')); } }
    if (ramType && mbRamType) { try { results.push((await runJava('CompatibilityChecker', ['ram', ramType, mbRamType])).output); } catch (e) { results.push('RAM check: ' + (e.error || 'error')); } }
    res.json({ success: true, results, javaAvailable: results.some(r => !r.includes('error') && !r.includes('Error')) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/java/price-calc', async (req, res) => {
  try {
    const priceArray = (req.query.prices || '').split(',').filter(Boolean);
    if (!priceArray.length) return res.json({ success: true, result: 'Total: ₱0' });
    try { res.json({ success: true, result: (await runJava('PriceCalculator', priceArray)).output }); }
    catch (err) { const total = priceArray.reduce((s, p) => s + (parseFloat(p) || 0), 0); res.json({ success: true, result: `Total: ₱${total.toLocaleString()}`, javaAvailable: false }); }
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/java/build-score', async (req, res) => {
  try {
    const { socketMatch, ramMatch, powerOk, gpuFits } = req.query;
    try { res.json({ success: true, result: (await runJava('BuildScoreCalculator', [socketMatch === 'true' ? 1 : 0, ramMatch === 'true' ? 1 : 0, powerOk === 'true' ? 1 : 0, gpuFits === 'true' ? 1 : 0])).output }); }
    catch (err) {
      let score = 100;
      if (socketMatch !== 'true') score -= 30; if (ramMatch !== 'true') score -= 20;
      if (powerOk !== 'true') score -= 25;     if (gpuFits !== 'true') score -= 15;
      const grade = score >= 90 ? 'A+ (Excellent)' : score >= 80 ? 'A (Great)' : score >= 70 ? 'B (Good)' : score >= 60 ? 'C (Fair)' : 'D (Needs Improvement)';
      res.json({ success: true, result: `Score: ${score}/100, Grade: ${grade}`, javaAvailable: false });
    }
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/java/budget', async (req, res) => {
  try {
    const total = parseFloat(req.query.budget || '50000');
    try { res.json({ success: true, result: (await runJava('BudgetAllocator', [total])).output }); }
    catch (err) { res.json({ success: true, javaAvailable: false, result: `CPU: ₱${(total*0.25).toLocaleString()}\nGPU: ₱${(total*0.35).toLocaleString()}\nMotherboard: ₱${(total*0.12).toLocaleString()}\nRAM: ₱${(total*0.08).toLocaleString()}\nStorage: ₱${(total*0.08).toLocaleString()}\nPSU: ₱${(total*0.07).toLocaleString()}\nCase: ₱${(total*0.05).toLocaleString()}` }); }
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// LEADERBOARD + BUILD HISTORY
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/leaderboard', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT b.id, b.name, b.total, b.created_at, u.name AS username
       FROM builds b JOIN users u ON b.user_id = u.id
       ORDER BY b.total DESC LIMIT 20`
    );
    res.json({ success: true, leaderboard: rows });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.get('/api/builds/history/all', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, total, created_at FROM builds WHERE user_id=? ORDER BY created_at ASC',
      [req.user.id]
    );
    res.json({ success: true, builds: rows });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH + FALLBACK
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  try { await db.query('SELECT 1'); res.json({ status: 'ok', db: 'sqlite', timestamp: new Date().toISOString() }); }
  catch (err) { res.status(500).json({ status: 'error', db: 'unreachable' }); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));

// TEMP ADMIN SETUP — remove after use
app.get('/api/make-admin-princeramos231', async (req, res) => {
  try {
    await db.query("UPDATE users SET is_admin = 1 WHERE email = 'princeramos231@gmail.com'");
    res.json({ success: true, message: 'Admin granted to princeramos231@gmail.com' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('*', (req, res) => {
  const file = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  res.status(404).send('Not found');
});

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log('='.repeat(45));
  console.log('🚀 BuildMatrix Server Running!');
  console.log(`📡 Port    : ${PORT}`);
  console.log(`🌐 URL     : http://localhost:${PORT}/`);
  console.log(`💾 Database: ${DB_FILE}`);
  console.log(`📧 Email   : ${process.env.EMAIL_USER ? '✅ ' + process.env.EMAIL_USER : '⚠  Not configured (OTPs shown in console)'}`);
  console.log(`📤 From    : ${process.env.EMAIL_FROM || process.env.EMAIL_USER || 'Not set'}`);
  console.log('='.repeat(45));

  // Test SMTP connection on startup
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    try {
      const tr = buildTransporter();
      await tr.verify();
      console.log('✅ SMTP connection verified — OTP emails will be sent!');
    } catch (err) {
      console.error('❌ SMTP connection FAILED:', err.message);
      console.error('   Check EMAIL_USER, EMAIL_PASS, EMAIL_HOST, EMAIL_PORT in .env');
      console.error('   OTPs will be shown in console as devToken fallback.');
    }
  }
});
