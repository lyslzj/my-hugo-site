// D1 数据访问：会话、一次性 token、限流
import { b64url, randomBytes, sha256Hex } from './crypto.js';
import { getCookie } from './http.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// 固定窗口限流，返回 true 表示放行
export async function rateLimit(env, key, limit, windowMs) {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;

  const row = await env.DB.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?')
    .bind(key)
    .first();

  if (!row) {
    try {
      await env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)')
        .bind(key, windowStart)
        .run();
    } catch (err) {
      if (!String(err && err.message).includes('UNIQUE')) throw err;
    }
    return true;
  }

  if (row.window_start !== windowStart) {
    await env.DB.prepare('UPDATE rate_limits SET window_start = ?, count = 1 WHERE key = ?')
      .bind(windowStart, key)
      .run();
    return true;
  }

  if (row.count >= limit) return false;

  await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
  return true;
}

export async function getSessionUser(request, env) {
  const token = getCookie(request, 'blog_session');
  if (!token) return null;

  const id = await sha256Hex(token);
  const row = await env.DB.prepare(
    'SELECT u.id, u.email, u.name, u.email_verified, u.created_at ' +
      'FROM sessions s JOIN users u ON u.id = s.user_id ' +
      'WHERE s.id = ? AND s.expires_at > ?'
  )
    .bind(id, Date.now())
    .first();

  return row || null;
}

export async function createSession(env, userId) {
  const token = b64url(randomBytes(32));
  const id = await sha256Hex(token);
  const now = Date.now();

  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  )
    .bind(id, userId, now + SESSION_TTL_MS, now)
    .run();

  return token;
}

export async function destroySession(request, env) {
  const token = getCookie(request, 'blog_session');
  if (!token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?')
    .bind(await sha256Hex(token))
    .run();
}

export async function createToken(env, userId, type, ttlMs) {
  const token = b64url(randomBytes(32));
  const id = await sha256Hex(token);
  const now = Date.now();

  await env.DB.prepare(
    'INSERT INTO tokens (id, user_id, type, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(id, userId, type, now + ttlMs, now)
    .run();

  return token;
}

export async function consumeToken(env, token, type) {
  if (!token) return null;

  const id = await sha256Hex(token);
  const row = await env.DB.prepare(
    'SELECT user_id, expires_at, used_at FROM tokens WHERE id = ? AND type = ?'
  )
    .bind(id, type)
    .first();

  if (!row || row.used_at || row.expires_at <= Date.now()) return null;

  await env.DB.prepare('UPDATE tokens SET used_at = ? WHERE id = ?')
    .bind(Date.now(), id)
    .run();

  return row;
}

export async function verifyUser(env, userId) {
  await env.DB.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?')
    .bind(Date.now(), userId)
    .run();
  await env.DB.prepare('DELETE FROM tokens WHERE user_id = ? AND type = ?')
    .bind(userId, 'verify')
    .run();
}

export async function deleteUserSessions(env, userId) {
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name || '',
    email_verified: !!row.email_verified,
    user_metadata: { full_name: row.name || '' }
  };
}
