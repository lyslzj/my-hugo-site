// JSON 响应 / Cookie / 来源校验 / 客户端 IP
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign(
      {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      },
      headers
    )
  });
}

export function redirect(location, status = 302, headers = {}) {
  return new Response(null, {
    status,
    headers: Object.assign({ location, 'cache-control': 'no-store' }, headers)
  });
}

export function getCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

export function clientIp(request) {
  // Netlify 反代过来时 x-forwarded-for 是真实访客 IP，优先使用；
  // 直连 Cloudflare 时两者都会给出访客 IP。
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-nf-client-connection-ip') ||
    'unknown'
  );
}

export function allowedOrigins(env) {
  return String(
    env.ALLOWED_ORIGINS ||
      'https://www.lyslzj.eu.org,https://whp.lyslzj.eu.org,https://lyslzj.eu.org'
  )
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function originAllowed(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  return allowedOrigins(env).includes(origin.replace(/\/+$/, ''));
}

export function publicOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (origin && originAllowed(request, env)) return origin.replace(/\/+$/, '');
  return String(env.SITE_URL || 'https://www.lyslzj.eu.org').replace(/\/+$/, '');
}

// 在 lyslzj.eu.org 及其子域上共享会话（www / whp 通用）；其他域名（如 pages.dev 预览）退回 host-only
export function sessionCookie(env, request, token, maxAge) {
  const host = new URL(request.url).hostname;
  const domain = String(env.COOKIE_DOMAIN || 'lyslzj.eu.org').replace(/^\./, '');
  const useDomain = host === domain || host.endsWith('.' + domain);
  const parts = [
    'blog_session=' + token,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=' + maxAge
  ];
  if (useDomain) parts.push('Domain=' + domain);
  return parts.join('; ');
}

export function clearSessionCookie(env, request) {
  return sessionCookie(env, request, '', 0);
}
