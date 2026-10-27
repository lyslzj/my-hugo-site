// 邮件发送：通过 Workers 原生 TCP 直连 SMTP（默认 163 邮箱 smtp.163.com:465）
import { WorkerMailer } from 'worker-mailer';

export function mailerConfigured(env) {
  return !!(env.SMTP_USER && env.SMTP_PASS);
}

export async function sendMail(env, { to, subject, text, html }) {
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    throw new Error('未配置 SMTP（SMTP_USER / SMTP_PASS）');
  }

  const mailer = await WorkerMailer.connect({
    host: env.SMTP_HOST || 'smtp.163.com',
    port: 465,
    secure: true,
    authType: 'plain',
    credentials: {
      username: env.SMTP_USER,
      password: env.SMTP_PASS
    }
  });

  await mailer.send({
    from: { name: env.SMTP_NAME || '博客', email: env.SMTP_USER },
    to: { email: to },
    subject,
    text,
    html
  });
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 统一的邮件正文模板（文字 + 简单 HTML）
export function actionMail({ siteName, title, intro, actionText, link, footer }) {
  const note = footer || '如果这不是你本人的操作，请忽略这封邮件。';

  const text = [
    intro,
    '',
    actionText + '：' + link,
    '',
    note,
    '',
    siteName || ''
  ].join('\n');

  const html =
    '<div style="font-family:system-ui,-apple-system,\'Segoe UI\',sans-serif;line-height:1.7;color:#222;max-width:520px;margin:0 auto;padding:24px;">' +
    '<h2 style="font-size:18px;margin:0 0 16px;">' + esc(title) + '</h2>' +
    '<p style="margin:0 0 8px;">' + esc(intro) + '</p>' +
    '<p style="margin:24px 0;">' +
    '<a href="' + esc(link) + '" style="display:inline-block;background:#1f6feb;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;">' +
    esc(actionText) +
    '</a></p>' +
    '<p style="margin:0 0 8px;color:#666;font-size:13px;word-break:break-all;">若按钮无法点击，请复制链接：<br>' +
    esc(link) +
    '</p>' +
    '<p style="margin:24px 0 0;color:#999;font-size:12px;">' + esc(note) + '</p>' +
    '<p style="margin:8px 0 0;color:#999;font-size:12px;">' + esc(siteName || '') + '</p>' +
    '</div>';

  return { text, html };
}
