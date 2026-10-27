// POST /api/auth/profile  修改昵称
import { json, originAllowed } from './_lib/http.js';
import { getSessionUser, publicUser } from './_lib/store.js';

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ error: '服务端未绑定 D1 数据库' }, 500);
    if (!originAllowed(request, env)) return json({ error: '请求来源不被允许' }, 403);

    const user = await getSessionUser(request, env);
    if (!user) return json({ error: '未登录', code: 'UNAUTHENTICATED' }, 401);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: '请求格式错误' }, 400);
    }

    const name = String(body.name || '').trim().slice(0, 40);
    await env.DB.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?')
      .bind(name, Date.now(), user.id)
      .run();

    const row = await env.DB.prepare(
      'SELECT id, email, name, email_verified, created_at FROM users WHERE id = ?'
    )
      .bind(user.id)
      .first();

    return json({ ok: true, user: publicUser(row) });
  } catch (err) {
    console.error('profile failed:', err && err.stack ? err.stack : err);
    return json({ error: '服务器错误，请稍后重试' }, 500);
  }
}
