require("dotenv").config();
const express = require("express");
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const session = require("express-session");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const priceSources = require('./price-sources.js');
const { exec } = require('child_process');

const app = express();
const PORT = Number(process.env.PORT || 5000);

const DB_FILE = process.env.DB_FILE || path.join(__dirname, "buildmatrix.sqlite");
let SQL = null;
let sqliteDb = null;

let otpStore = {};

async function sendOTP(email, otp) {
    console.log(`OTP for ${email}: ${otp}`);
    // Replace with your actual email/SMS logic
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

const otpRoutes = {
    '/api/request-otp': async (req, res) => {
        const { email } = req.body;
        const otp = generateOTP();
        otpStore[email] = { otp, expiresAt: Date.now() + 300000 };
        await sendOTP(email, otp);
        res.json({ success: true });
    },
    '/api/verify-otp': async (req, res) => {
        const { email, otp } = req.body;
        const storedOTP = otpStore[email];
        if (!storedOTP || storedOTP.otp !== otp || storedOTP.expiresAt < Date.now()) {
            return res.status(400).json({ success: false, error: 'Invalid or expired OTP' });
        }
        delete otpStore[email];
        res.json({ success: true });
    },
    '/api/setup-2fa': async (req, res) => {
        const secret = speakeasy.generateSecret({ length: 20 });
        const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
        res.json({ success: true, secret: secret.base32, qrCodeUrl });
    },
    '/api/verify-2fa': async (req, res) => {
        const { token, secret } = req.body;
        const verified = speakeasy.totp.verify({
            secret: secret,
            encoding: 'base32',
            token: token,
            window: 1
        });
        res.json({ success: verified });
    }
};

// Integrate OTP and 2FA routes
Object.entries(otpRoutes).forEach(([path, handler]) => {
    app.post(path, handler);
});

// --- Your existing code from here ---
async function initDatabase() {
  if (sqliteDb) return sqliteDb;

  SQL = SQL || (await initSqlJs());
  if (fs.existsSync(DB_FILE)) {
    const filebuf = fs.readFileSync(DB_FILE);
    sqliteDb = new SQL.Database(new Uint8Array(filebuf));
  } else {
    sqliteDb = new SQL.Database();
  }

  sqliteDb.run("PRAGMA foreign_keys = ON;");

  sqliteDb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      two_factor_enabled INTEGER NOT NULL DEFAULT 0,
      two_factor_secret TEXT,
      two_factor_temp_secret TEXT,
      two_factor_verified_at TEXT,
      is_admin INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS two_factor_recovery_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      recovery_code TEXT NOT NULL,
      is_used INTEGER NOT NULL DEFAULT 0,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS two_factor_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS builds (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      items_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price INTEGER NOT NULL,
      tier TEXT,
      specs TEXT,
      img TEXT,
      rating REAL,
      ratingCount INTEGER,
      meta TEXT
    );

    CREATE TABLE IF NOT EXISTS email_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'signup',
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  try { sqliteDb.run("ALTER TABLE password_resets ADD COLUMN code TEXT"); } catch (_) {}

  try { sqliteDb.run("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0"); } catch (_) {}
  try { sqliteDb.run("ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0"); } catch (_) {}

  saveDatabase();
  return sqliteDb;
}

function saveDatabase() {
  if (!sqliteDb || !SQL) return;
  const data = sqliteDb.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

function rowsFromStatement(stmt) {
  const cols = stmt.getColumnNames();
  const rows = [];
  while (stmt.step()) {
    const vals = stmt.get();
    const row = {};
    for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
    rows.push(row);
  }
  return rows;
}

async function dbQuery(sql, params = []) {
  await initDatabase();
  const isSelect = /^\s*select/i.test(sql);
  const stmt = sqliteDb.prepare(sql);
  stmt.bind(params);

  let rows = [];
  if (isSelect) rows = rowsFromStatement(stmt);
  else {
    while (stmt.step()) {}
  }

  stmt.free();

  if (!isSelect) {
    const affectedRows = sqliteDb.getRowsModified ? sqliteDb.getRowsModified() : 0;
    let insertId = null;
    try {
      const r = sqliteDb.exec("SELECT last_insert_rowid() AS id;");
      insertId = r?.[0]?.values?.[0]?.[0] ?? null;
    } catch (_) {}
    saveDatabase();
    return [{ affectedRows, insertId }];
  }

  return [rows];
}

const db = { query: dbQuery };

async function pingDB() {
  await db.query("SELECT 1 AS ok");
}

async function ensureSchema() {
  await initDatabase();
}

app.set("trust proxy", 1);

const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

const isProduction = process.env.NODE_ENV === 'production';

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        return callback(null, true);
      }
      if (origin.includes('.onrender.com')) {
        return callback(null, true);
      }
      if (origin.includes('ngrok')) {
        return callback(null, true);
      }
      callback(null, true);
    },
    credentials: true,
    optionsSuccessStatus: 200
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "buildmatrix.sid",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: true,
    saveUninitialized: true,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      domain: isProduction ? '.onrender.com' : undefined,
      path: '/'
    },
    proxy: true
  })
);

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  req.user = { id: req.session.userId };
  next();
}

async function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  try {
    const [rows] = await db.query("SELECT is_admin FROM users WHERE id = ?", [req.session.userId]);
    if (!rows[0]?.is_admin) {
      return res.status(403).json({ success: false, error: "Admin access required" });
    }
    next();
  } catch (err) {
    console.error("Admin check error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
}

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    twoFactorEnabled: !!row.two_factor_enabled,
    is_admin: row.is_admin ? true : false,
    createdAt: row.created_at,
  };
}

function randomTokenHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function hashRecoveryCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function generateRecoveryCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(4).toString("hex").toUpperCase());
  }
  return codes;
}

function createTransporter() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const host = process.env.EMAIL_HOST || 'smtp-relay.brevo.com';
  const port = parseInt(process.env.EMAIL_PORT || '587');
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  });
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOtpEmail({ to, code, subject, purpose }) {
  const transporter = createTransporter();
  if (!transporter) return { sent: false };

  const purposeText = purpose === 'signup'
    ? 'Complete your BuildMatrix account registration'
    : 'Reset your BuildMatrix password';

  await transporter.sendMail({
    from: `"BuildMatrix" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
    to,
    subject: subject || 'BuildMatrix Verification Code',
    html: `
      <!DOCTYPE html>
      <html>
      <body style="margin:0;padding:0;background:#080C14;font-family:Inter,Arial,sans-serif;">
        <div style="max-width:480px;margin:40px auto;background:#0e1520;border:1px solid rgba(0,212,255,0.15);border-radius:16px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,rgba(0,212,255,0.1),rgba(123,63,228,0.1));padding:28px 32px;border-bottom:1px solid rgba(0,212,255,0.1);">
            <div style="font-size:22px;font-weight:900;letter-spacing:0.05em;color:#00D4FF;">? BUILDMATRIX</div>
            <div style="font-size:12px;color:#5a8aaa;margin-top:4px;letter-spacing:0.08em;text-transform:uppercase;">Ultimate PC Builder ? Philippines</div>
          </div>
          <div style="padding:32px;">
            <div style="font-size:16px;font-weight:700;color:#D8EEFF;margin-bottom:8px;">${purposeText}</div>
            <div style="font-size:13px;color:#5a8aaa;margin-bottom:28px;line-height:1.6;">Your one-time verification code is:</div>
            <div style="background:rgba(0,212,255,0.07);border:1px solid rgba(0,212,255,0.2);border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
              <div style="font-size:40px;font-weight:900;letter-spacing:0.3em;color:#00D4FF;">${code}</div>
            </div>
            <div style="font-size:12px;color:#2a4560;line-height:1.6;">
              This code expires in <strong style="color:#5a8aaa;">10 minutes</strong>.<br>
              If you did not request this, ignore this email.
            </div>
          </div>
          <div style="padding:16px 32px;border-top:1px solid rgba(0,212,255,0.08);font-size:11px;color:#2a4560;text-align:center;">
            &copy; 2025 BuildMatrix ? Philippines PC Builder
          </div>
        </div>
      </body>
      </html>
    `
  });

  return { sent: true };
}

async function sendResetEmailIfConfigured({ to, token }) {
  return sendOtpEmail({ to, code: token, subject: 'BuildMatrix Password Reset', purpose: 'reset' });
}

app.get("/api/auth/test", (req, res) => {
  res.json({ success: true, message: "Backend is running!", time: new Date().toISOString() });
});

app.post("/api/auth/send-verification", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: "Valid email is required" });
    }

    const [exists] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
    if (exists.length) {
      return res.status(400).json({ success: false, error: "Email already registered" });
    }

    const code = generateOtp();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await db.query("DELETE FROM email_verifications WHERE email = ? AND type = 'signup'", [email]);
    await db.query(
      "INSERT INTO email_verifications (email, code, type, expires_at) VALUES (?, ?, 'signup', ?)",
      [email, code, expires]
    );

    let mailStatus = { sent: false };
    try {
      mailStatus = await sendOtpEmail({
        to: email,
        code,
        subject: "BuildMatrix - Verify Your Email",
        purpose: "signup"
      });
    } catch (e) {
      console.warn("Verification email failed:", e.message);
    }

    res.json({
      success: true,
      message: mailStatus.sent ? "Verification code sent!" : "Code generated (email not configured).",
      devToken: mailStatus.sent ? undefined : code
    });
  } catch (err) {
    console.error("send-verification error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const verificationCode = String(req.body.verificationCode || "").trim();

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: "All fields are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: "Password must be at least 6 characters" });
    }

    const [exists] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
    if (exists.length) {
      return res.status(400).json({ success: false, error: "Email already registered" });
    }

    if (verificationCode) {
      const [vcRows] = await db.query(
        "SELECT id FROM email_verifications WHERE email = ? AND code = ? AND type = 'signup' AND used = 0 AND expires_at > ?",
        [email, verificationCode, new Date().toISOString()]
      );
      if (!vcRows.length) {
        return res.status(400).json({ success: false, error: "Invalid or expired verification code" });
      }
      await db.query("UPDATE email_verifications SET used = 1 WHERE id = ?", [vcRows[0].id]);
    }

    const hashed = await bcrypt.hash(password, 10);
    await db.query("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", [name, email, hashed]);

    res.json({ success: true, message: "Registration successful" });
  } catch (err) {
    console.error("register error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const twoFactorCode = String(req.body.twoFactorCode || "").trim();

    const [rows] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
    const user = rows[0];
    if (!user) return res.status(401).json({ success: false, error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ success: false, error: "Invalid credentials" });

    if (user.two_factor_enabled) {
      if (!twoFactorCode) {
        return res.json({ requires2FA: true, userId: user.id });
      }

      const verified = speakeasy.totp.verify({
        secret: user.two_factor_secret,
        encoding: "base32",
        token: twoFactorCode,
        window: 1,
      });

      if (!verified) {
        const hashed = hashRecoveryCode(twoFactorCode);
        const [rcRows] = await db.query(
          "SELECT id FROM two_factor_recovery_codes WHERE user_id = ? AND recovery_code = ? AND is_used = 0",
          [user.id, hashed]
        );
        if (!rcRows.length) {
          await db.query(
            "INSERT INTO two_factor_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)",
            [user.id, "failed", req.ip, req.headers["user-agent"] || ""]
          );
          return res.status(401).json({ success: false, error: "Invalid 2FA code" });
        }

        await db.query(
          "UPDATE two_factor_recovery_codes SET is_used = 1, used_at = datetime('now') WHERE id = ?",
          [rcRows[0].id]
        );
        await db.query(
          "INSERT INTO two_factor_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)",
          [user.id, "recovered", req.ip, req.headers["user-agent"] || ""]
        );
      } else {
        await db.query(
          "INSERT INTO two_factor_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)",
          [user.id, "verified", req.ip, req.headers["user-agent"] || ""]
        );
      }
    }

    req.session.userId = user.id;
    req.session.save();
    res.json({ success: true, user: sanitizeUser(user) });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  if (!req.session) return res.json({ success: true });
  req.session.destroy(() => res.json({ success: true, message: "Logged out" }));
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [req.user.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const [rcCountRows] = await db.query(
      "SELECT COUNT(*) AS count FROM two_factor_recovery_codes WHERE user_id = ? AND is_used = 0",
      [req.user.id]
    );

    res.json({
      ...sanitizeUser(user),
      recoveryCodesLeft: rcCountRows[0]?.count ?? 0
    });
  } catch (err) {
    console.error("me error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: "All fields are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: "New password must be at least 6 characters" });
    }

    const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [req.user.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(401).json({ success: false, error: "Current password is incorrect" });

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE users SET password = ? WHERE id = ?", [hashed, req.user.id]);

    res.json({ success: true, message: "Password changed successfully" });
  } catch (err) {
    console.error("change password error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, error: "Email is required" });

    const [rows] = await db.query("SELECT id, email FROM users WHERE email = ?", [email]);
    const user = rows[0];
    if (!user) return res.status(404).json({ success: false, error: "Email not found in our system" });

    const code = generateOtp();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await db.query("DELETE FROM password_resets WHERE user_id = ?", [user.id]);
    await db.query(
      "INSERT INTO password_resets (user_id, token, expires_at, code) VALUES (?, ?, ?, ?)",
      [user.id, randomTokenHex(32), expires, code]
    );

    let mailStatus = { sent: false };
    try {
      mailStatus = await sendOtpEmail({ to: email, code, subject: "BuildMatrix - Password Reset Code", purpose: "reset" });
    } catch (e) {
      console.warn("Reset email failed:", e.message);
    }

    res.json({
      success: true,
      message: mailStatus.sent ? "Reset code sent to your email!" : "Code generated (email not configured).",
      devToken: mailStatus.sent ? undefined : code
    });
  } catch (err) {
    console.error("forgot password error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const newPassword = String(req.body.newPassword || "");

    if (!token || !newPassword) {
      return res.status(400).json({ success: false, error: "Code and new password are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: "Password must be at least 6 characters" });
    }

    const now = new Date().toISOString();
    const [rows] = await db.query(
      "SELECT * FROM password_resets WHERE (code = ? OR token = ?) AND used = 0 AND expires_at > ?",
      [token, token, now]
    );
    const reset = rows[0];
    if (!reset) return res.status(400).json({ success: false, error: "Invalid or expired code" });

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query("UPDATE users SET password = ? WHERE id = ?", [hashed, reset.user_id]);
    await db.query("UPDATE password_resets SET used = 1 WHERE id = ?", [reset.id]);

    res.json({ success: true, message: "Password reset successfully" });
  } catch (err) {
    console.error("reset password error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.get("/api/2fa/status", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT two_factor_enabled FROM users WHERE id = ?", [req.user.id]);
    const enabled = !!rows[0]?.two_factor_enabled;

    const [rcCountRows] = await db.query(
      "SELECT COUNT(*) AS count FROM two_factor_recovery_codes WHERE user_id = ? AND is_used = 0",
      [req.user.id]
    );

    res.json({ success: true, enabled, recoveryCodesLeft: rcCountRows[0]?.count ?? 0 });
  } catch (err) {
    console.error("2fa status error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/2fa/setup", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT email FROM users WHERE id = ?", [req.user.id]);
    const email = rows[0]?.email;
    const secret = speakeasy.generateSecret({ name: `BuildMatrix:${email}`, issuer: "BuildMatrix" });

    await db.query("UPDATE users SET two_factor_temp_secret = ? WHERE id = ?", [secret.base32, req.user.id]);

    const qrCode = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ success: true, qrCode, secret: secret.base32 });
  } catch (err) {
    console.error("2fa setup error:", err);
    res.status(500).json({ success: false, error: "Failed to setup 2FA" });
  }
});

app.post("/api/2fa/verify", requireAuth, async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    if (!token) return res.status(400).json({ success: false, error: "Token is required" });

    const [rows] = await db.query("SELECT two_factor_temp_secret FROM users WHERE id = ?", [req.user.id]);
    const temp = rows[0]?.two_factor_temp_secret;
    if (!temp) return res.status(400).json({ success: false, error: "2FA setup not initiated" });

    const ok = speakeasy.totp.verify({ secret: temp, encoding: "base32", token, window: 1 });
    if (!ok) {
      await db.query(
        "INSERT INTO two_factor_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)",
        [req.user.id, "failed", req.ip, req.headers["user-agent"] || ""]
      );
      return res.status(400).json({ success: false, error: "Invalid verification code" });
    }

    await db.query(
      "UPDATE users SET two_factor_enabled = 1, two_factor_secret = ?, two_factor_temp_secret = NULL, two_factor_verified_at = ? WHERE id = ?",
      [temp, new Date().toISOString(), req.user.id]
    );

    const recoveryCodes = generateRecoveryCodes(8);
    for (const code of recoveryCodes) {
      await db.query(
        "INSERT INTO two_factor_recovery_codes (user_id, recovery_code) VALUES (?, ?)",
        [req.user.id, hashRecoveryCode(code)]
      );
    }

    await db.query(
      "INSERT INTO two_factor_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)",
      [req.user.id, "enabled", req.ip, req.headers["user-agent"] || ""]
    );

    res.json({ success: true, message: "2FA enabled successfully", recoveryCodes });
  } catch (err) {
    console.error("2fa verify error:", err);
    res.status(500).json({ success: false, error: "Failed to verify 2FA" });
  }
});

app.post("/api/2fa/disable", requireAuth, async (req, res) => {
  try {
    await db.query(
      "UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL, two_factor_temp_secret = NULL WHERE id = ?",
      [req.user.id]
    );

    await db.query("DELETE FROM two_factor_recovery_codes WHERE user_id = ?", [req.user.id]);
    await db.query(
      "INSERT INTO two_factor_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)",
      [req.user.id, "disabled", req.ip, req.headers["user-agent"] || ""]
    );

    res.json({ success: true, message: "2FA disabled successfully" });
  } catch (err) {
    console.error("2fa disable error:", err);
    res.status(500).json({ success: false, error: "Failed to disable 2FA" });
  }
});

app.get("/api/builds", requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name, total, items_json, created_at FROM builds WHERE user_id = ? ORDER BY created_at DESC",
      [req.user.id]
    );

    const builds = rows.map((r) => ({
      id: r.id,
      name: r.name,
      total: r.total,
      createdAt: r.created_at,
      items: (() => {
        try {
          return JSON.parse(r.items_json || "[]");
        } catch {
          return [];
        }
      })(),
    }));

    res.json({ success: true, builds });
  } catch (err) {
    console.error("list builds error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.get("/api/builds/:id", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const [rows] = await db.query(
      "SELECT id, name, total, items_json, created_at FROM builds WHERE id = ? AND user_id = ? LIMIT 1",
      [id, req.user.id]
    );
    const r = rows[0];
    if (!r) return res.status(404).json({ success: false, error: "Build not found" });

    res.json({
      success: true,
      build: {
        id: r.id,
        name: r.name,
        total: r.total,
        createdAt: r.created_at,
        items: (() => {
          try {
            return JSON.parse(r.items_json || "[]");
          } catch {
            return [];
          }
        })(),
      },
    });
  } catch (err) {
    console.error("get build error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/builds", requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const total = Number(req.body.total || 0) || 0;
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!name) return res.status(400).json({ success: false, error: "Build name is required" });
    if (!items.length) return res.status(400).json({ success: false, error: "Build must contain at least 1 item" });

    const id = crypto.randomUUID();
    await db.query(
      "INSERT INTO builds (id, user_id, name, total, items_json) VALUES (?, ?, ?, ?, ?)",
      [id, req.user.id, name, Math.round(total), JSON.stringify(items)]
    );

    res.json({ success: true, message: "Build saved", id });
  } catch (err) {
    console.error("create build error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.put("/api/builds/:id", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const name = String(req.body.name || "").trim();
    const total = req.body.total != null ? Number(req.body.total) : null;
    const items = req.body.items != null ? (Array.isArray(req.body.items) ? req.body.items : null) : null;

    const [exists] = await db.query("SELECT id FROM builds WHERE id = ? AND user_id = ? LIMIT 1", [id, req.user.id]);
    if (!exists.length) return res.status(404).json({ success: false, error: "Build not found" });

    const fields = [];
    const values = [];

    if (name) {
      fields.push("name = ?");
      values.push(name);
    }
    if (total != null && !Number.isNaN(total)) {
      fields.push("total = ?");
      values.push(Math.round(total));
    }
    if (items != null) {
      fields.push("items_json = ?");
      values.push(JSON.stringify(items));
    }

    if (!fields.length) return res.json({ success: true, message: "Nothing to update" });

    fields.push("updated_at = ?");
    values.push(new Date().toISOString(), id, req.user.id);

    const sql = `UPDATE builds SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`;
    await db.query(sql, values);

    res.json({ success: true, message: "Build updated" });
  } catch (err) {
    console.error("update build error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.delete("/api/builds/:id", requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    await db.query("DELETE FROM builds WHERE id = ? AND user_id = ?", [id, req.user.id]);
    res.json({ success: true, message: "Build deleted" });
  } catch (err) {
    console.error("delete build error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  try {
    const [userCount] = await db.query("SELECT COUNT(*) as count FROM users");
    const [buildCount] = await db.query("SELECT COUNT(*) as count FROM builds");
    const [productCount] = await db.query("SELECT COUNT(*) as count FROM products");
    const [recentUsers] = await db.query("SELECT COUNT(*) as count FROM users WHERE created_at > datetime('now', '-7 days')");

    res.json({
      success: true,
      stats: {
        totalUsers: userCount[0]?.count || 0,
        totalBuilds: buildCount[0]?.count || 0,
        totalProducts: productCount[0]?.count || 0,
        newUsersThisWeek: recentUsers[0]?.count || 0
      }
    });
  } catch (err) {
    console.error("Admin stats error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.get("/api/admin/products", requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM products ORDER BY category, name");
    res.json({ success: true, products: rows });
  } catch (err) {
    console.error("Admin products error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/admin/products", requireAdmin, async (req, res) => {
  try {
    const { id, name, category, price, tier, specs, img, rating, ratingCount, meta } = req.body;

    if (!id || !name || !category || !price) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    await db.query(
      "INSERT INTO products (id, name, category, price, tier, specs, img, rating, ratingCount, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, name, category, price, tier || 'budget', specs || '', img || '', rating || 0, ratingCount || 0, JSON.stringify(meta || {})]
    );

    res.json({ success: true, message: "Product added successfully" });
  } catch (err) {
    console.error("Add product error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.put("/api/admin/products/:id", requireAdmin, async (req, res) => {
  try {
    const productId = req.params.id;
    const { name, category, price, tier, specs, img, rating, ratingCount, meta } = req.body;

    await db.query(
      "UPDATE products SET name = ?, category = ?, price = ?, tier = ?, specs = ?, img = ?, rating = ?, ratingCount = ?, meta = ? WHERE id = ?",
      [name, category, price, tier, specs, img, rating, ratingCount, JSON.stringify(meta || {}), productId]
    );

    res.json({ success: true, message: "Product updated successfully" });
  } catch (err) {
    console.error("Update product error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  try {
    const productId = req.params.id;
    await db.query("DELETE FROM products WHERE id = ?", [productId]);
    res.json({ success: true, message: "Product deleted successfully" });
  } catch (err) {
    console.error("Delete product error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT u.id, u.name, u.email, u.is_admin, u.banned, u.created_at,
             COUNT(b.id) AS build_count
      FROM users u
      LEFT JOIN builds b ON b.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    const users = rows.map(r => ({
      _id: String(r.id),
      id: String(r.id),
      name: r.name,
      email: r.email,
      is_admin: !!r.is_admin,
      banned: !!r.banned,
      buildCount: r.build_count || 0,
      createdAt: r.created_at
    }));
    res.json({ success: true, users });
  } catch (err) {
    console.error("Admin users error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.put("/api/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const { name, email, is_admin } = req.body;
    const fields = [];
    const values = [];
    if (name !== undefined)     { fields.push("name = ?");     values.push(name); }
    if (email !== undefined)    { fields.push("email = ?");    values.push(email); }
    if (is_admin !== undefined) { fields.push("is_admin = ?"); values.push(is_admin ? 1 : 0); }
    if (!fields.length) return res.json({ success: true, message: "Nothing to update" });
    values.push(Number(userId));
    await db.query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    console.error("PUT /admin/users/:id error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    if (String(req.session.userId) === String(userId)) {
      return res.status(400).json({ success: false, error: "Cannot delete your own account" });
    }
    await db.query("DELETE FROM builds WHERE user_id = ?", [Number(userId)]);
    await db.query("DELETE FROM users WHERE id = ?", [Number(userId)]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /admin/users/:id error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/admin/users/:id/ban", requireAdmin, async (req, res) => {
  try {
    await db.query("UPDATE users SET banned = 1 WHERE id = ?", [Number(req.params.id)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/admin/users/:id/unban", requireAdmin, async (req, res) => {
  try {
    await db.query("UPDATE users SET banned = 0 WHERE id = ?", [Number(req.params.id)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const { name, email, password, is_admin } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: "name, email, password required" });
    }
    const [exists] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
    if (exists.length) return res.status(409).json({ success: false, error: "Email already in use" });
    const hashed = await bcrypt.hash(password, 10);
    await db.query(
      "INSERT INTO users (name, email, password, is_admin) VALUES (?, ?, ?, ?)",
      [name, email, hashed, is_admin ? 1 : 0]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("POST /admin/users error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.delete("/api/admin/builds/:id", requireAdmin, async (req, res) => {
  try {
    await db.query("DELETE FROM builds WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /admin/builds/:id error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.put("/api/auth/theme", requireAuth, async (req, res) => {
  try {
    const { theme } = req.body;
    if (!['dark','light'].includes(theme)) return res.status(400).json({ error: 'Invalid theme' });
    try { sqliteDb.run("ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'dark'"); } catch(_) {}
    await db.query("UPDATE users SET theme = ? WHERE id = ?", [theme, req.user.id]);
    res.json({ success: true, theme });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/builds/compare", requireAuth, async (req, res) => {
  try {
    const { a, b } = req.query;
    if (!a || !b) return res.status(400).json({ error: 'Need two build IDs' });
    const [buildA] = await db.query("SELECT * FROM builds WHERE id = ? AND user_id = ?", [a, req.user.id]);
    const [buildB] = await db.query("SELECT * FROM builds WHERE id = ? AND user_id = ?", [b, req.user.id]);
    if (!buildA || !buildB) return res.status(404).json({ error: 'Build not found' });
    buildA.items = JSON.parse(buildA.items_json || '[]');
    buildB.items = JSON.parse(buildB.items_json || '[]');
    res.json({ success: true, buildA, buildB });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1 AS ok");
    res.json({ status: "ok", db: "sqlite", timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: "error", db: "unreachable" });
  }
});

app.put("/api/admin/users/:id/toggle-admin", requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    if (userId == req.session.userId) {
      return res.status(400).json({ success: false, error: "Cannot modify your own admin status" });
    }

    const [rows] = await db.query("SELECT is_admin FROM users WHERE id = ?", [userId]);
    if (!rows[0]) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const newStatus = rows[0].is_admin ? 0 : 1;
    await db.query("UPDATE users SET is_admin = ? WHERE id = ?", [newStatus, userId]);

    res.json({ success: true, message: `Admin status ${newStatus ? 'granted' : 'removed'}` });
  } catch (err) {
    console.error("Toggle admin error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.get("/api/admin/builds", requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT b.*, u.name as user_name, u.email
      FROM builds b
      JOIN users u ON b.user_id = u.id
      ORDER BY b.created_at DESC
      LIMIT 100
    `);

    const builds = rows.map(r => ({
      _id: r.id,
      id: r.id,
      name: r.name,
      total: r.total,
      createdAt: r.created_at,
      userName: r.user_name || r.email || "Unknown",
      userId: String(r.user_id),
      items: (() => {
        try { return JSON.parse(r.items_json || '[]'); }
        catch { return []; }
      })()
    }));

    res.json({ success: true, builds });
  } catch (err) {
    console.error("Admin builds error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.get('/api/stores', (req, res) => {
  res.json({
    success: true,
    stores: Object.values(priceSources.STORES).map(store => ({
      name: store.name,
      url: store.homepage,
      logo: store.logo,
      color: store.color
    }))
  });
});

app.get('/api/prices/:category/:productId', async (req, res) => {
  try {
    const { category, productId } = req.params;

    const [rows] = await db.query(
      "SELECT name FROM products WHERE id = ? AND category = ?",
      [productId, category]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }

    const productName = rows[0].name;

    const timeoutPromise = new Promise(resolve => {
      setTimeout(() => resolve({ timeout: true }), 3000);
    });

    const pricePromise = priceSources.getPricesForProduct(productName, category);
    const result = await Promise.race([pricePromise, timeoutPromise]);

    if (result.timeout) {
      return res.json({
        success: true,
        product: productName,
        category,
        prices: [],
        bestPrice: null,
        stores: priceSources.STORES,
        note: "Price check timed out - showing store references only",
        lastUpdated: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error("Price fetch error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch prices",
      stores: priceSources.STORES
    });
  }
});

app.get('/api/store-credits', (req, res) => {
  res.json({
    success: true,
    message: "Price references from Philippine PC stores",
    stores: Object.values(priceSources.STORES).map(store => ({
      name: store.name,
      url: store.homepage,
      logo: store.logo,
      color: store.color
    }))
  });
});

function runJava(className, args = []) {
  return new Promise((resolve, reject) => {
    const javaPath = path.join(__dirname, 'backend-java');
    const classPath = javaPath;
    const command = `java -cp "${classPath}" ${className} ${args.join(' ')}`;

    exec(command, { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        reject({ error: stderr || error.message });
      } else {
        resolve({ output: stdout.trim() });
      }
    });
  });
}

app.get('/api/java/compatibility', async (req, res) => {
  try {
    const { cpuSocket, mbSocket, cpuTdp, gpuTdp, psuWattage, ramType, mbRamType } = req.query;

    const results = [];

    if (cpuSocket && mbSocket) {
      try {
        const result = await runJava('CompatibilityChecker', ['socket', cpuSocket, mbSocket]);
        results.push(result.output);
      } catch (err) {
        results.push('Socket check: ' + (err.error || 'error'));
      }
    }

    if (cpuTdp && gpuTdp && psuWattage) {
      try {
        const result = await runJava('CompatibilityChecker', ['power', cpuTdp, gpuTdp, psuWattage]);
        results.push(result.output);
      } catch (err) {
        results.push('Power check: ' + (err.error || 'error'));
      }
    }

    if (ramType && mbRamType) {
      try {
        const result = await runJava('CompatibilityChecker', ['ram', ramType, mbRamType]);
        results.push(result.output);
      } catch (err) {
        results.push('RAM check: ' + (err.error || 'error'));
      }
    }

    res.json({
      success: true,
      results: results,
      javaAvailable: results.some(r => !r.includes('error') && !r.includes('Error'))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/java/price-calc', async (req, res) => {
  try {
    const { prices } = req.query;
    const priceArray = prices ? prices.split(',') : [];

    if (priceArray.length === 0) {
      return res.json({ success: true, result: 'Total: ₱0' });
    }

    try {
      const result = await runJava('PriceCalculator', priceArray);
      res.json({ success: true, result: result.output });
    } catch (err) {
      let total = 0;
      priceArray.forEach(p => { total += parseFloat(p) || 0; });
      res.json({
        success: true,
        result: `Total: ₱${total.toLocaleString()}`,
        javaAvailable: false
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/java/build-score', async (req, res) => {
  try {
    const { socketMatch, ramMatch, powerOk, gpuFits } = req.query;

    const socket = socketMatch === 'true' ? 1 : 0;
    const ram = ramMatch === 'true' ? 1 : 0;
    const power = powerOk === 'true' ? 1 : 0;
    const gpu = gpuFits === 'true' ? 1 : 0;

    try {
      const result = await runJava('BuildScoreCalculator', [socket, ram, power, gpu]);
      res.json({ success: true, result: result.output });
    } catch (err) {
      let score = 100;
      if (!socketMatch) score -= 30;
      if (!ramMatch) score -= 20;
      if (!powerOk) score -= 25;
      if (!gpuFits) score -= 15;
      let grade = score >= 90 ? 'A+ (Excellent)' : score >= 80 ? 'A (Great)' : score >= 70 ? 'B (Good)' : score >= 60 ? 'C (Fair)' : 'D (Needs Improvement)';
      res.json({
        success: true,
        result: `Score: ${score}/100, Grade: ${grade}`,
        javaAvailable: false
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/java/budget', async (req, res) => {
  try {
    const { budget } = req.query;
    const budgetValue = budget || '50000';

    try {
      const result = await runJava('BudgetAllocator', [budgetValue]);
      res.json({ success: true, result: result.output });
    } catch (err) {
      const total = parseFloat(budgetValue) || 50000;
      res.json({
        success: true,
        result: `CPU: ₱${(total * 0.25).toLocaleString()}\nGPU: ₱${(total * 0.35).toLocaleString()}\nMotherboard: ₱${(total * 0.12).toLocaleString()}\nRAM: ₱${(total * 0.08).toLocaleString()}\nStorage: ₱${(total * 0.08).toLocaleString()}\nPSU: ₱${(total * 0.07).toLocaleString()}\nCase: ₱${(total * 0.05).toLocaleString()}`,
        javaAvailable: false
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/newsletter/subscribe', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return res.status(400).json({ success: false, error: 'Invalid email' });
    await db.query("CREATE TABLE IF NOT EXISTS newsletter (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
    const [existing] = await db.query('SELECT id FROM newsletter WHERE email = ?', [email]);
    if (existing.length) return res.json({ success: false, error: 'Email already subscribed' });
    await db.query('INSERT INTO newsletter (email) VALUES (?)', [email]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.get('/api/newsletter/list', requireAdmin, async (req, res) => {
  try {
    await db.query("CREATE TABLE IF NOT EXISTS newsletter (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
    const [rows] = await db.query('SELECT email, created_at FROM newsletter ORDER BY created_at DESC');
    res.json({ success: true, subscribers: rows, count: rows.length });
  } catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.get('/api/health', async (req, res) => {
  try { await db.query('SELECT 1'); res.json({ status: 'ok', db: 'sqlite' }); }
  catch (err) { res.status(500).json({ status: 'error' }); }
});

app.delete('/api/admin/builds/:id', requireAdmin, async (req, res) => {
  try { await db.query('DELETE FROM builds WHERE id = ?', [req.params.id]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, error: 'Server error' }); }
});

app.use("/api", (req, res) => res.status(404).json({ error: "API route not found" }));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log("=================================");
  console.log("?? BuildMatrix Server Running!");
  console.log(`?? Port: ${PORT}`);
  console.log(`?? URL:  http://localhost:${PORT}/`);
  console.log("=================================");
});