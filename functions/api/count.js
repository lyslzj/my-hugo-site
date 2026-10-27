// GET /api/count  本站点击数 +1，并返回当前总数（自托管计数器）
import { json } from './auth/_lib/http.js';

export async function onRequestGet({ env }) {
  try {
    await env.DB.prepare(
      `INSERT INTO site_counter(key, n) VALUES('site_pv', 1)
       ON CONFLICT(key) DO UPDATE SET n = n + 1`
    ).run();
    const row = await env.DB.prepare(
      `SELECT n FROM site_counter WHERE key = 'site_pv'`
    ).first();
    return json({ pv: row ? row.n : 1 });
  } catch (err) {
    return json({ pv: 0, error: String((err && err.message) || err) });
  }
}
