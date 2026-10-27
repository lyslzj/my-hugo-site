// POST /api/auth/login  邮箱 + 密码登录，成功后下发 HttpOnly 会话 Cookie
import { json, clientIp, originAllowed, sessionCookie } from './_lib/http.js';
import { hashPassword, randomBytes, safeEqual, unb64 } from './_lib/crypto.js';
import { createSession, publicUser, rateLimit } from './_lib/store.js';

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

    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) return json({ error: '请填写邮箱和密码', code: 'MISSING' }, 400);

    const ip = clientIp(request);
    const okIp = await rateLimit(env, 'login:ip:' + ip, 20, 15 * 60 * 1000);
    const okEmail = await rateLimit(env, 'login:email:' + email, 10, 15 * 60 * 1000);
    if (!okIp || !okEmail) {
      return json({ error: '尝试过于频繁，请 15 分钟后再试', code: 'RATE_LIMITED' }, 429);
    }

    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();

    // 用户不存在时也跑一次哈希，避免通过响应耗时枚举邮箱
    const iterations = user ? user.pw_iter : 100000;
    const salt = user ? unb64(user.pw_salt) : randomBytes(16);
    const hash = await hashPassword(password, salt, iterations);

    if (!user || !safeEqual(hash, user.pw_hash)) {
      return json({ error: '邮箱或密码不正确', code: 'BAD_CREDENTIALS' }, 401);
    }

    if (!user.email_verified) {
      return json(
        { error: '邮箱尚未验证，请查收验证邮件，或点击“重新发送验证邮件”', code: 'EMAIL_UNVERIFIED' },
        403
      );
    }

    const token = await createSession(env, user.id);
    return json({ ok: true, user: publicUser(user) }, 200, {
      'set-cookie': sessionCookie(env, request, token, 30 * 24 * 3600)
    });
  } catch (err) {
    console.error('login failed:', err && err.stack ? err.stack : err);
    return json({ error: '服务器错误，请稍后重试' }, 500);
  }
}
