// POST /api/auth/resend  重新发送邮箱验证邮件
import { json, clientIp, originAllowed, publicOrigin } from './_lib/http.js';
import { createToken, rateLimit } from './_lib/store.js';
import { actionMail, mailerConfigured, sendMail } from './_lib/mail.js';

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
    if (!email) return json({ error: '请输入邮箱' }, 400);

    const ip = clientIp(request);
    const canMail = mailerConfigured(env);
    const okIp = await rateLimit(env, 'resend:ip:' + ip, 5, 3600 * 1000);
    const okMail = await rateLimit(env, 'resend:email:' + email, 3, 3600 * 1000);
    if (!okIp || !okMail) return json({ ok: true, sent: false, mailer: canMail });

    const user = await env.DB.prepare('SELECT id, email, name, email_verified FROM users WHERE email = ?')
      .bind(email)
      .first();

    let sent = false;
    if (user && !user.email_verified && canMail) {
      try {
        const token = await createToken(env, user.id, 'verify', 24 * 3600 * 1000);
        const siteName = env.SITE_NAME || '我的个人博客';
        const link = publicOrigin(request, env) + '/verify.html?token=' + encodeURIComponent(token);
        const mail = actionMail({
          siteName,
          title: '验证你的邮箱',
          intro: '你好：这是重新发送的邮箱验证链接。',
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
        sent = true;
      } catch (err) {
        console.error('resend failed:', err && err.message);
      }
    }

    return json({ ok: true, sent, mailer: canMail });
  } catch (err) {
    console.error('resend failed:', err && err.stack ? err.stack : err);
    return json({ error: '服务器错误，请稍后重试' }, 500);
  }
}
