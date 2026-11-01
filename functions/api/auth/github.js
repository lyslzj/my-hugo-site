// GET /api/auth/github  发起 GitHub OAuth 登录：跳到 GitHub 授权页
//
// 流程：
//   1) 生成随机 state，连同登录后要跳回的地址写进一个短期 HttpOnly Cookie；
//   2) 302 到 GitHub /login/oauth/authorize；
//   3) GitHub 同意后回调 /api/auth/github/callback.js 换 token、建会话。
import { redirect } from './_lib/http.js';
import { b64url, randomBytes } from './_lib/crypto.js';

export async function onRequestGet({ request, env }) {
  try {
    if (!env.GITHUB_CLIENT_ID) {
      return new Response('服务端未配置 GITHUB_CLIENT_ID', { status: 500 });
    }

    const url = new URL(request.url);
    const rawRedirect = String(url.searchParams.get('redirect') || '/');

    // 只允许跳回站内相对路径，防止开放重定向
    let safeRedirect =
      rawRedirect.charAt(0) === '/' && rawRedirect.charAt(1) !== '/' && rawRedirect.charAt(1) !== '\\'
        ? rawRedirect
        : '/';

    // 若用户是从登录页被送来的，redirect 形如 /login.html?redirect=/xxx，
    // 登录成功后应直接去真正的目标页（如受保护栏目），而不是又落回登录页。
    if (safeRedirect.indexOf('/login.html') === 0) {
      try {
        const inner = new URL(safeRedirect, url.origin).searchParams.get('redirect');
        if (inner && inner.charAt(0) === '/' && inner.charAt(1) !== '/') safeRedirect = inner;
      } catch { /* 保持原 safeRedirect */ }
    }

    const state = b64url(randomBytes(24));
    const stateCookieValue = encodeURIComponent(JSON.stringify({ s: state, r: safeRedirect }));

    // 回调地址必须与 GitHub OAuth App 里登记的完全一致
    const redirectUri = url.origin + '/api/auth/github/callback';

    const authUrl =
      'https://github.com/login/oauth/authorize' +
      '?client_id=' + encodeURIComponent(env.GITHUB_CLIENT_ID) +
      '&redirect_uri=' + encodeURIComponent(redirectUri) +
      '&scope=' + encodeURIComponent('read:user user:email') +
      '&state=' + encodeURIComponent(state);

    const cookie = [
      'github_oauth_state=' + stateCookieValue,
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
      'Max-Age=600'
    ].join('; ');

    return redirect(authUrl, 302, { 'set-cookie': cookie });
  } catch (err) {
    console.error('github oauth start failed:', err && err.stack ? err.stack : err);
    return new Response('服务器错误，请稍后重试', { status: 500 });
  }
}
