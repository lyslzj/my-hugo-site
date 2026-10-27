// POST /api/auth/password  修改密码（校验当前密码，成功后踢掉其他设备上的会话）
import { json, getCookie, clientIp, originAllowed } from './_lib/http.js';
import { b64, hashPassword, randomBytes, safeEqual, sha256Hex, unb64 } from './_lib/crypto.js';
import { getSessionUser, rateLimit } from './_lib/store.js';

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

    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!currentPassword) return json({ error: '请输入当前密码', code: 'MISSING' }, 400);
    if (newPassword.length < 8) return json({ error: '新密码至少 8 位', code: 'WEAK_PASSWORD' }, 400);
    if (newPassword.length > 200) return json({ error: '密码过长', code: 'LONG_PASSWORD' }, 400);

    const ip = clientIp(request);
    if (!(await rateLimit(env, 'pwd:ip:' + ip, 10, 3600 * 1000))) {
      return json({ error: '操作过于频繁，请稍后再试', code: 'RATE_LIMITED' }, 429);
    }

    const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    if (!row) return json({ error: '账号不存在', code: 'NO_USER' }, 404);

    const currentHash = await hashPassword(currentPassword, unb64(row.pw_salt), row.pw_iter);
    if (!safeEqual(currentHash, row.pw_hash)) {
      return json({ error: '当前密码不正确', code: 'BAD_PASSWORD' }, 400);
    }

    const iterations = Number(env.PBKDF2_ITERATIONS || 100000) || 100000;
    const salt = randomBytes(16);
    const hash = await hashPassword(newPassword, salt, iterations);

    await env.DB.prepare(
      'UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, updated_at = ? WHERE id = ?'
    )
      .bind(hash, b64(salt), iterations, Date.now(), user.id)
      .run();

    // 保留当前会话，其他设备下线
    const currentSid = await sha256Hex(getCookie(request, 'blog_session') || '');
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?')
      .bind(user.id, currentSid)
      .run();

    return json({ ok: true });
  } catch (err) {
    console.error('password failed:', err && err.stack ? err.stack : err);
    return json({ error: '服务器错误，请稍后重试' }, 500);
  }
}
