// POST /api/auth/reset  用一次性 token 设置新密码，并踢掉所有旧会话
import { json, originAllowed } from './_lib/http.js';
import { b64, hashPassword, randomBytes } from './_lib/crypto.js';
import { consumeToken, deleteUserSessions } from './_lib/store.js';

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ error: '服务端未绑定 D1 数据库' }, 500);
    if (!originAllowed(request, env)) return json({ error: '请求来源不被允许' }, 403);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: '请求格式错误' }, 400);
    }

    const token = String(body.token || '');
    const password = String(body.password || '');
    if (!token) return json({ error: '链接缺少参数', code: 'BAD_TOKEN' }, 400);
    if (password.length < 8) return json({ error: '密码至少 8 位', code: 'WEAK_PASSWORD' }, 400);

    const row = await consumeToken(env, token, 'reset');
    if (!row) return json({ error: '重置链接无效或已过期', code: 'BAD_TOKEN' }, 400);

    const iterations = Number(env.PBKDF2_ITERATIONS || 100000) || 100000;
    const salt = randomBytes(16);
    const hash = await hashPassword(password, salt, iterations);

    await env.DB.prepare(
      'UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, updated_at = ? WHERE id = ?'
    )
      .bind(hash, b64(salt), iterations, Date.now(), row.user_id)
      .run();

    await deleteUserSessions(env, row.user_id);
    return json({ ok: true });
  } catch (err) {
    console.error('reset failed:', err && err.stack ? err.stack : err);
    return json({ error: '服务器错误，请稍后重试' }, 500);
  }
}
