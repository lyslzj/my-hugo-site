-- GitHub OAuth 登录（Cloudflare D1 / SQLite）
-- 执行：npx wrangler d1 execute myblog-auth --remote --file=./migrations/0002_github_oauth.sql
--
-- 把 GitHub 账号与本站 users 表关联起来。单独建一张身份表而不是给 users 加列，
-- 是因为 SQLite 的 ALTER TABLE ADD COLUMN 不允许 UNIQUE 约束，
-- 以后若再接入微信 / Google 等其它 OAuth，继续往这张表里加 provider 行即可。

CREATE TABLE IF NOT EXISTS oauth_identities (
  provider    TEXT NOT NULL,            -- 'github'
  external_id TEXT NOT NULL,            -- GitHub 数字 ID（字符串形式）
  user_id     TEXT NOT NULL,
  login       TEXT NOT NULL DEFAULT '',  -- GitHub 用户名，便于排查
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_identities(user_id);
