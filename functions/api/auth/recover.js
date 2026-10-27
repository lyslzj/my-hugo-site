// POST /api/auth/recover  发送重置密码邮件（无论邮箱是否存在都返回 ok）
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
    await rateLimit(env, 'recover:ip:' + ip, 5, 3600 * 1000);
    await rateLimit(env, 'recover:email:' + email, 3, 3600 * 1000);

    const canMail = mailerConfigured(env);
    const user = await env.DB.prepare('SELECT id, email, name FROM users WHERE email = ?')
      .bind(email)
      .first();

    let sent = false;
    if (user && canMail) {
      try {
        const token = await createToken(env, user.id, 'reset', 3600 * 1000);
        const siteName = env.SITE_NAME || '我的个人博客';
        const link = publicOrigin(request, env) + '/reset.html?token=' + encodeURIComponent(token);
        const mail = actionMail({
          siteName,
          title: '重置密码',
          intro: '你好：我们收到了重置密码的请求。点击下面的按钮设置新密码。',
          actionText: '设置新密码',
          link,
          footer: '链接 1 小时内有效。如果这不是你本人的操作，请忽略这封邮件，你的密码不会被修改。'
        });
        await sendMail(env, {
          to: email,
          subject: '重置密码 · ' + siteName,
          text: mail.text,
          html: mail.html
        });
        sent = true;
      } catch (err) {
        console.error('send reset mail failed:', err && err.message);
      }
    }

    return json({ ok: true, sent, mailer: canMail });
  } catch (err) {
    console.error('recover failed:', err && err.stack ? err.stack : err);
    return json({ error: '服务器错误，请稍后重试' }, 500);
  }
}
