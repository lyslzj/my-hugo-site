// GET /api/auth/health  部署自检：D1 是否连通、邮件/人机验证是否配置
import { json } from './_lib/http.js';

export async function onRequestGet({ env }) {
  const out = {
    ok: true,
    db: false,
    mailer: !!(env.SMTP_USER && env.SMTP_PASS),
    turnstile: !!env.TURNSTILE_SECRET
  };

  try {
    if (env.DB) {
      await env.DB.prepare('SELECT 1 AS ok').first();
      out.db = true;
    }
  } catch (err) {
    out.ok = false;
    out.dbError = String((err && err.message) || err);
  }

  return json(out);
}
