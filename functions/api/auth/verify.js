// 邮箱验证：GET 给邮件里的链接用（验证后自动登录并跳转），POST 给页面用（返回 JSON）
import { json, redirect, sessionCookie } from './_lib/http.js';
import { consumeToken, createSession, publicUser, verifyUser } from './_lib/store.js';

const SESSION_MAX_AGE = 30 * 24 * 3600;

async function redeem(env, token) {
  const row = await consumeToken(env, token, 'verify');
  if (!row) return null;
  await verifyUser(env, row.user_id);
  return row;
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) return redirect('/verify.html?status=error');
    const url = new URL(request.url);
    const row = await redeem(env, url.searchParams.get('token') || '');
    if (!row) return redirect('/verify.html?status=invalid');

    const session = await createSession(env, row.user_id);
    return redirect('/?verified=1', 302, {
      'set-cookie': sessionCookie(env, request, session, SESSION_MAX_AGE)
    });
  } catch (err) {
    console.error('verify(get) failed:', err && err.message);
    return redirect('/verify.html?status=error');
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ error: '服务端未绑定 D1 数据库' }, 500);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: '请求格式错误' }, 400);
    }

    const row = await redeem(env, String(body.token || ''));
    if (!row) return json({ error: '验证链接无效或已过期', code: 'BAD_TOKEN' }, 400);

    const session = await createSession(env, row.user_id);
    const user = await env.DB.prepare('SELECT id, email, name, email_verified FROM users WHERE id = ?')
      .bind(row.user_id)
      .first();

    return json({ ok: true, user: publicUser(user) }, 200, {
      'set-cookie': sessionCookie(env, request, session, SESSION_MAX_AGE)
    });
  } catch (err) {
    console.error('verify(post) failed:', err && err.message);
    return json({ error: '服务器错误，请稍后重试' }, 500);
  }
}
