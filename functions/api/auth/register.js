// POST /api/auth/register  公开注册
import { json, clientIp, originAllowed, publicOrigin } from './_lib/http.js';
import { b64, hashPassword, randomBytes } from './_lib/crypto.js';
import { createToken, rateLimit } from './_lib/store.js';
import { actionMail, mailerConfigured, sendMail } from './_lib/mail.js';
import { verifyTurnstile } from './_lib/turnstile.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const name = String(body.name || '').trim().slice(0, 40);

    if (!EMAIL_RE.test(email)) return json({ error: '邮箱格式不正确', code: 'BAD_EMAIL' }, 400);
    if (password.length < 8) return json({ error: '密码至少 8 位', code: 'WEAK_PASSWORD' }, 400);
    if (password.length > 200) return json({ error: '密码过长', code: 'LONG_PASSWORD' }, 400);

    const ip = clientIp(request);
    const okIp = await rateLimit(env, 'reg:ip:' + ip, 5, 3600 * 1000);
    const okMail = await rateLimit(env, 'reg:email:' + email, 3, 3600 * 1000);
    if (!okIp || !okMail) {
      return json({ error: '注册过于频繁，请稍后再试', code: 'RATE_LIMITED' }, 429);
    }

    if (!(await verifyTurnstile(env, body.turnstileToken, ip))) {
      return json({ error: '人机验证未通过，请重试', code: 'TURNSTILE_FAILED' }, 400);
    }

    const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (exists) {
      return json({ error: '该邮箱已注册，请直接登录', code: 'EMAIL_TAKEN' }, 409);
    }

    const canMail = mailerConfigured(env);
    const needVerify = canMail && env.REQUIRE_EMAIL_VERIFICATION !== '0';
    const iterations = Number(env.PBKDF2_ITERATIONS || 100000) || 100000;

    const id = crypto.randomUUID();
    const salt = randomBytes(16);
    const hash = await hashPassword(password, salt, iterations);
    const now = Date.now();

    try {
      await env.DB.prepare(
        'INSERT INTO users (id, email, name, pw_hash, pw_salt, pw_iter, email_verified, created_at, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
        .bind(id, email, name, hash, b64(salt), iterations, needVerify ? 0 : 1, now, now)
        .run();
    } catch (err) {
      if (String(err && err.message).includes('UNIQUE')) {
        return json({ error: '该邮箱已注册，请直接登录', code: 'EMAIL_TAKEN' }, 409);
      }
      throw err;
    }

    let mailSent = false;
    if (needVerify) {
      try {
        const token = await createToken(env, id, 'verify', 24 * 3600 * 1000);
        const siteName = env.SITE_NAME || '我的个人博客';
        const link = publicOrigin(request, env) + '/verify.html?token=' + encodeURIComponent(token);
        const mail = actionMail({
          siteName,
          title: '验证你的邮箱',
          intro: '你好' + (name ? '，' + name : '') + '：感谢注册。请点击下面的按钮完成邮箱验证。',
          actionText: '立即验证',
          link,
          footer: '链接 24 小时内有效。如果这不是你本人的操作，请忽略这封邮件。'
        });
        await sendMail(env, {
          to: email,
          subject: '验证你的邮箱 · ' + siteName,
          text: mail.text,
          html: mail.html
        });
        mailSent = true;
      } catch (err) {
        console.error('send verify mail failed:', err && err.message);
      }
    }

    return json({ ok: true, verifyRequired: needVerify, mailSent });
  } catch (err) {
    console.error('register failed:', err && err.stack ? err.stack : err);
    return json({ error: '服务器错误，请稍后重试' }, 500);
  }
}
