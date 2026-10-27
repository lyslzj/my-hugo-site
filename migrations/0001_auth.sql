-- 用户体系（Cloudflare D1 / SQLite）
-- 执行：npx wrangler d1 execute myblog-auth --remote --file=./migrations/0001_auth.sql

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL DEFAULT '',
  pw_hash        TEXT NOT NULL,
  pw_salt        TEXT NOT NULL,
  pw_iter        INTEGER NOT NULL DEFAULT 100000,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,   -- sha256(随机 token)，库里不存明文
  user_id    TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS tokens (
  id         TEXT PRIMARY KEY,   -- sha256(明文 token)
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,      -- verify | reset
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_tokens_exp  ON tokens(expires_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
