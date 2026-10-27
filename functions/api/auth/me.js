// GET /api/auth/me  返回当前登录用户
import { json } from './_lib/http.js';
import { getSessionUser, publicUser } from './_lib/store.js';

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) return json({ error: '服务端未绑定 D1 数据库' }, 500);
    const user = await getSessionUser(request, env);
    if (!user) return json({ error: '未登录', code: 'UNAUTHENTICATED' }, 401);
    return json({ user: publicUser(user) });
  } catch (err) {
    console.error('me failed:', err && err.stack ? err.stack : err);
    return json({ error: '服务器错误，请稍后重试' }, 500);
  }
}
