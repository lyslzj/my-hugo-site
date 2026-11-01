-- 文章评论（本站 D1 账号体系）
-- 执行：npx wrangler d1 execute myblog-auth --remote --file=./migrations/0003_comments.sql

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  path       TEXT NOT NULL,   -- 评论所属文章路径，如 /posts/xxx/
  user_id    TEXT NOT NULL,
  author     TEXT NOT NULL,   -- 发表时的昵称快照
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_path ON comments(path, created_at);
