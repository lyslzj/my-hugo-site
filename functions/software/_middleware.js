// /software/* 服务端门禁：未登录 302 到登录页（Cloudflare 侧真正生效）
import { getSessionUser } from '../api/auth/_lib/store.js';

export async function onRequest({ request, env, next }) {
  if (!env.DB) return next();

  let user = null;
  try {
    user = await getSessionUser(request, env);
  } catch (err) {
    console.error('gate failed:', err && err.message);
    return next();
  }

  if (user) return next();

  const url = new URL(request.url);
  return new Response(null, {
    status: 302,
    headers: {
      location: '/login.html?redirect=' + encodeURIComponent(url.pathname + url.search),
      'cache-control': 'no-store'
    }
  });
}
