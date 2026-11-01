// /api/comments  文章评论（基于本站登录会话）
//   GET  /api/comments?path=/posts/xxx/   列出某篇文章的评论
//   POST /api/comments                    发表评论（需登录），body: { path, body }
import { json, clientIp, originAllowed } from './auth/_lib/http.js';
import { getSessionUser, rateLimit } from './auth/_lib/store.js';
import { b64url, randomBytes } from './auth/_lib/crypto.js';

function sanitize(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) return json({ error: '未绑定数据库' }, 500);
    const url = new URL(request.url);
    const path = String(url.searchParams.get('path') || '');
    if (!path || path.charAt(0) !== '/') return json({ comments: [] });

    const rows = await env.DB.prepare(
      'SELECT author, body, created_at FROM comments WHERE path = ? ORDER BY created_at ASC'
    ).bind(path).all();

    return json({
      comments: (rows.results || []).map(function (r) {
        return { author: r.author, body: r.body, created_at: r.created_at };
      })
    });
  } catch (err) {
    console.error('comments list failed:', err && err.stack ? err.stack : err);
    return json({ error: '服务器错误' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ error: '未绑定数据库' }, 500);
    if (!originAllowed(request, env)) return json({ error: '请求来源不被允许' }, 403);

    const user = await getSessionUser(request, env);
    if (!user) return json({ error: '请先登录后再评论', code: 'UNAUTHENTICATED' }, 401);

    let body;
    try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, 400); }

    const path = String(body.path || '');
    const text = String(body.body || '').trim();
    if (!path || path.charAt(0) !== '/') return json({ error: '缺少文章路径' }, 400);
    if (!text) return json({ error: '评论内容不能为空' }, 400);
    if (text.length > 2000) return json({ error: '评论不能超过 2000 字' }, 400);

    // 限流：每用户每分钟最多 5 条
    const ip = clientIp(request);
    const ok = await rateLimit(env, 'comment:user:' + user.id, 10, 60 * 1000);
    if (!ok) return json({ error: '发言过于频繁，请稍后再试' }, 429);

    const id = b64url(randomBytes(12));
    const now = Date.now();
    await env.DB.prepare(
      'INSERT INTO comments (id, path, user_id, author, body, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, path, user.id, user.name || user.email.split('@')[0], text, now).run();

    return json({ ok: true, comment: { author: user.name || user.email.split('@')[0], body: text, created_at: now } });
  } catch (err) {
    console.error('comment post failed:', err && err.stack ? err.stack : err);
    return json({ error: '服务器错误' }, 500);
  }
}
