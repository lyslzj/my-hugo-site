// POST /api/auth/logout  退出登录：删除会话并清 Cookie
import { clearSessionCookie, json } from './_lib/http.js';
import { destroySession } from './_lib/store.js';

export async function onRequestPost({ request, env }) {
  try {
    if (env.DB) await destroySession(request, env);
  } catch (err) {
    console.error('logout failed:', err && err.message);
  }
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(env, request) });
}
