// GET /api/auth/github/callback  GitHub OAuth 回调：换 token、建/关联用户、下发会话 Cookie
import { redirect } from '../_lib/http.js';
import { getCookie, sessionCookie } from '../_lib/http.js';
import { b64url, randomBytes } from '../_lib/crypto.js';
import { createSession, publicUser } from '../_lib/store.js';

const GITHUB_API = 'https://api.github.com';

// 出错时跳回首页并在 hash 里带上错误，前端 auth.js 可读取提示
function fail(url, message) {
  const base = new URL(url.origin);
  base.hash = 'github_login_error=' + encodeURIComponent(message);
  return redirect(base.pathname + base.hash, 302);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  try {
    if (!env.DB) return new Response('服务端未绑定 D1 数据库', { status: 500 });
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return new Response('服务端未配置 GitHub OAuth', { status: 500 });
    }

    const code = String(url.searchParams.get('code') || '');
    const state = String(url.searchParams.get('state') || '');
    const errQuery = String(url.searchParams.get('error') || '');
    if (errQuery) return fail(url, 'GitHub 授权被取消或拒绝。');
    if (!code || !state) return fail(url, '授权回调参数缺失，请重试。');

    // 校验 state（防 CSRF）
    const raw = getCookie(request, 'github_oauth_state');
    let saved = null;
    try {
      saved = raw ? JSON.parse(decodeURIComponent(raw)) : null;
    } catch {
      saved = null;
    }
    if (!saved || saved.s !== state) return fail(url, '登录状态已过期，请重新点击 GitHub 登录。');
    const redirectTo = typeof saved.r === 'string' && saved.r.charAt(0) === '/' ? saved.r : '/';

    // 1) 用 code 换 access_token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'myblog-oauth'
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code: code
      })
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    const accessToken = tokenData && tokenData.access_token;
    if (!accessToken) {
      console.error('github token exchange failed:', tokenData);
      return fail(url, '与 GitHub 交换登录凭证失败，请重试。');
    }

    const authHeaders = {
      'Authorization': 'Bearer ' + accessToken,
      'User-Agent': 'myblog-oauth',
      'Accept': 'application/vnd.github+json'
    };

    // 2) 取 GitHub 用户资料
    const userRes = await fetch(GITHUB_API + '/user', { headers: authHeaders });
    const ghUser = await userRes.json().catch(() => ({}));
    if (!ghUser || !ghUser.id) return fail(url, '无法获取 GitHub 用户信息。');

    // 3) 取已验证的主邮箱（用户可能隐藏公开邮箱，user:email scope 能拿到）
    let email = '';
    try {
      const emailsRes = await fetch(GITHUB_API + '/user/emails', { headers: authHeaders });
      const emails = await emailsRes.json();
      if (Array.isArray(emails)) {
        const primary = emails.find(function (e) { return e.primary && e.verified; });
        if (primary) email = String(primary.email || '').toLowerCase();
      }
    } catch (e) {
      email = '';
    }
    if (!email) email = ghUser.id + '@users.noreply.github.com';

    const ghId = String(ghUser.id);
    const ghLogin = String(ghUser.login || '');
    const ghName = String(ghUser.name || ghUser.login || 'GitHub 用户');

    // 4) 找到或创建本站用户
    let user = null;

    const identity = await env.DB.prepare(
      'SELECT user_id FROM oauth_identities WHERE provider = ? AND external_id = ?'
    ).bind('github', ghId).first();

    if (identity) {
      user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(identity.user_id).first();
    }

    if (!user) {
      // 已有同邮箱账号 → 直接绑定，不重复建号
      user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
      if (!user) {
        const now = Date.now();
        const newId = b64url(randomBytes(16));
        await env.DB.prepare(
          'INSERT INTO users (id, email, name, pw_hash, pw_salt, pw_iter, email_verified, created_at, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)'
        ).bind(newId, email, ghName, '', '', now, now).run();
        user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(newId).first();
      }
      await env.DB.prepare(
        'INSERT OR REPLACE INTO oauth_identities (provider, external_id, user_id, login, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind('github', ghId, user.id, ghLogin, Date.now()).run();
    }

    // 5) 建会话
    const token = await createSession(env, user.id);

    const clearCookie = [
      'github_oauth_state=',
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
      'Max-Age=0'
    ].join('; ');

    const h = new Headers();
    h.set('location', redirectTo);
    h.set('cache-control', 'no-store');
    h.append('set-cookie', sessionCookie(env, request, token, 30 * 24 * 3600));
    h.append('set-cookie', clearCookie);
    return new Response(null, { status: 302, headers: h });
  } catch (err) {
    console.error('github oauth callback failed:', err && err.stack ? err.stack : err);
    return fail(url, '登录过程出错，请重试。');
  }
}
