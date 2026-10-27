-- 本站点击数计数器（自托管，不依赖不蒜子）
CREATE TABLE IF NOT EXISTS site_counter (
  key TEXT PRIMARY KEY,
  n   INTEGER NOT NULL DEFAULT 0
);
