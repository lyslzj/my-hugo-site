# 注册登录（Cloudflare D1）部署说明

本博客的账号体系已从 Netlify Identity 换成 **Cloudflare Pages Functions + D1** 自建方案。

## 架构

```
www.lyslzj.eu.org (Netlify)  ──/api/* 反代──▶  whp.lyslzj.eu.org (Cloudflare Pages Functions)
                                                      │
                                                      └── D1 数据库 myblog-auth
```

- 静态页面仍然两边各自构建（Hugo → `public/`）。
- 注册、登录、找回密码、邮箱验证全部跑在 Cloudflare Functions 上，数据在 D1。
- 会话是 `HttpOnly + Secure + SameSite=Lax` 的 Cookie，`Domain=lyslzj.eu.org`，
  所以在 www 登录后，whp 也是登录态，反过来也一样。
- Netlify 没有 Functions，靠 `netlify.toml` 把 `/api/*`、`/software/*`、`/works/*`
  反代到 Cloudflare：API 是为了同源 Cookie，受保护栏目是为了让 www 也走服务端门禁。

## 一次性配置

### 1. 建 D1 数据库

```bash
npx wrangler login
npx wrangler d1 create myblog-auth
```

把输出里的 `database_id` 填到 `wrangler.toml` 的 `[[d1_databases]]` 里。

### 2. 建表

```bash
npx wrangler d1 execute myblog-auth --remote --file=./migrations/0001_auth.sql
```

### 3. Cloudflare Pages 项目设置

进入 Workers & Pages → 你的 Pages 项目：

- **自定义域**：`whp.lyslzj.eu.org`（CNAME 到 `<project>.pages.dev`，开启代理）
- **Settings → Functions → D1 database bindings**：变量名 `DB` → `myblog-auth`
  （Git 集成部署必须在控制台绑；用 `wrangler pages deploy` 直传时 `wrangler.toml` 里的绑定生效）
- **Settings → Environment variables**：
  | 变量 | 值 | 说明 |
  |---|---|---|
  | `RESEND_API_KEY` | `re_xxx` | Resend 的 API key（Secret） |
  | `MAIL_FROM` | `博客 <noreply@lyslzj.eu.org>` | 发件人，域名要在 Resend 验证 |
  | `SITE_NAME` | `我的个人博客` | 可选，邮件落款 |
  | `TURNSTILE_SECRET` | 可选 | 配了才启用注册人机验证 |
  | `PBKDF2_ITERATIONS` | `100000` | 免费版建议值，见文末 |

### 4. Resend 发信域名

在 Resend 控制台添加 `lyslzj.eu.org`，按提示加 SPF / DKIM 的 DNS 记录，
状态变成 Verified 之后验证邮件才发得出去。

### 5. 重新部署

推一次 Git 即可。Netlify 会读到新的 `netlify.toml` 并把 `/api/*` 反代过去。

## 验证是否成功

1. 打开 `https://whp.lyslzj.eu.org/api/auth/health`，应返回 `{"ok":true,"db":true,...}`。
2. 在 `https://whp.lyslzj.eu.org/register.html` 注册，应收到验证邮件。
3. 点邮件里的链接 → 自动登录并跳回首页。
4. 打开 `https://www.lyslzj.eu.org/`，应显示“欢迎回来”，说明 Cookie 在 www 也生效。
5. 退出登录后访问 `/software/`：whp 上会被 302 到登录页（服务端门禁）。

## 本地开发

```bash
# 初始化本地 D1
npx wrangler d1 execute myblog-auth --local --file=./migrations/0001_auth.sql

# 同时跑静态页 + Functions（Hugo 先构建一次 public/）
hugo --minify
npx wrangler pages dev public --d1 DB=myblog-auth --compatibility-date=2026-10-01
```

单独 `hugo server` 只能看静态页面，`/api/*` 会 404。

## 免费版注意事项

- Workers 免费版每个请求只有 **10ms CPU**。PBKDF2 10 万次迭代可能偶发 `1102`，
  流量大时更明显。升级 Workers Paid（$5/月）后把 `PBKDF2_ITERATIONS` 调到 `210000` 更稳妥。
- D1 免费版有每日行读写上限（2026-09 起强制执行），个人博客的量级一般够用。
- 注册/登录都做了 D1 固定窗口限流（注册 5 次/小时/IP，登录 20 次/15 分钟/IP）。

## 安全边界

- **whp 上**：`/software/`、`/works/` 由 `functions/*/_middleware.js` 服务端校验，未登录直接 302，
  内容不会下发。
- **www 上**：这两个栏目现在也在 `netlify.toml` 里反代到 whp，同样经过服务端门禁，
  未登录拿不到正文。代价是 www 的这两个栏目依赖 Cloudflare 可用性
  （Cloudflare 挂了会打不开，但首页/文章不受影响）。
- 密码只存 PBKDF2-SHA256 哈希 + 每用户随机 salt；会话表里只存 token 的 SHA-256。
- 前端不再把 token 放 localStorage，全部走 HttpOnly Cookie，XSS 拿不到会话。

## 文件清单

```
functions/
  api/auth/_lib/        crypto.js http.js store.js mail.js turnstile.js
  api/auth/             register login logout me verify recover reset resend
                        profile password health
  software/_middleware.js   works/_middleware.js
migrations/0001_auth.sql
wrangler.toml
netlify.toml            # /api/*、/software/*、/works/* → whp 反代
static/js/auth.js       # 前端统一认证脚本
static/login.html static/register.html static/verify.html static/reset.html
static/account.html     # 个人中心：改昵称、改密码、退出
static/_headers         # 受保护栏目 no-store，防止 CDN/反代缓存
```

## 个人中心

登录后从首页“欢迎回来”或“个人中心”进入 `/account.html`：

- 查看邮箱与验证状态
- 修改昵称（`POST /api/auth/profile`）
- 修改密码（`POST /api/auth/password`，需当前密码，成功后其他设备下线）


## 可选项

- **Turnstile**：到 Cloudflare 控制台建一个 Turnstile 站点，把 site key 填到
  `static/js/auth.js` 顶部的 `CONFIG.turnstileSiteKey`，secret 配到 Pages 环境变量
  `TURNSTILE_SECRET`，两端都配才会生效。
- **改文案/主题**：`function api/auth/_lib/mail.js` 里统一模板，改 `actionMail` 即可。
