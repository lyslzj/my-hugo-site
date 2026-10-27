/* ============================================================================
 * 站点登录 / 注册（Cloudflare D1 自建用户体系）
 * ----------------------------------------------------------------------------
 * 职责：
 *   1) 维护登录态（HttpOnly Cookie 会话，前端只读 /api/auth/me 的结果）
 *   2) 注册 / 登录 / 退出 / 找回密码 / 邮箱验证 / 重发验证邮件
 *   3) 控制顶部导航显隐与受保护栏目（/software/、/works/）的客户端门禁
 * 依赖：Cloudflare Pages Functions 的 /api/auth/*，见仓库 AUTH-SETUP.md
 * ==========================================================================*/
(function () {
    'use strict';

    /* ---------- 可配置项 ----------
     * apiBase：留空 = 同源（推荐，Netlify 由 netlify.toml 反代到 Cloudflare）。
     *           如果以后把页面和 API 分到不同域名，再填 https://whp.lyslzj.eu.org
     * turnstileSiteKey：Cloudflare Turnstile 的 site key，留空则不启用。
     *           要启用必须同时配置服务端 TURNSTILE_SECRET。
     */
    var CONFIG = window.AUTH_CONFIG || {
        apiBase: '',
        turnstileSiteKey: ''
    };

    var API = String(CONFIG.apiBase || '').replace(/\/+$/, '') + '/api/auth';

    var state = { user: null, loading: null, version: 0 };

    /* ---------- 请求封装 ---------- */
    function request(path, options) {
        var opts = options || {};
        var init = {
            method: opts.method || 'GET',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }
        };
        if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

        return fetch(API + path, init).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (data) {
                if (!res.ok) {
                    var err = new Error(
                        (data && (data.error || data.message)) || ('请求失败（' + res.status + '）')
                    );
                    err.status = res.status;
                    err.code = data && data.code;
                    throw err;
                }
                return data || {};
            });
        });
    }

    /* ---------- 登录态 ---------- */
    function refresh() {
        if (!state.loading) {
            var version = state.version;
            state.loading = fetch(API + '/me', { credentials: 'same-origin' })
                .then(function (res) {
                    return res.ok ? res.json() : null;
                })
                .then(function (data) {
                    var user = (data && data.user) || null;
                    if (version === state.version) state.user = user;
                    return user;
                })
                .catch(function () {
                    if (version === state.version) state.user = null;
                    return null;
                });
        }
        return state.loading;
    }

    function applyUser(user) {
        state.version++;
        state.user = user || null;
        state.loading = Promise.resolve(state.user);
    }

    /* ---------- 对外 API ---------- */
    var Auth = {
        refresh: refresh,

        isLoggedIn: function () { return !!state.user; },
        getUser: function () { return state.user; },

        login: function (email, password, turnstileToken) {
            return request('/login', {
                method: 'POST',
                body: { email: email, password: password, turnstileToken: turnstileToken || '' }
            }).then(function (data) {
                applyUser(data.user);
                return data.user;
            });
        },

        signup: function (email, password, data, turnstileToken) {
            return request('/register', {
                method: 'POST',
                body: {
                    email: email,
                    password: password,
                    name: (data && (data.full_name || data.name)) || '',
                    turnstileToken: turnstileToken || ''
                }
            });
        },

        recover: function (email) {
            return request('/recover', { method: 'POST', body: { email: email } });
        },

        resend: function (email) {
            return request('/resend', { method: 'POST', body: { email: email } });
        },

        updateProfile: function (name) {
            return request('/profile', { method: 'POST', body: { name: name } }).then(function (data) {
                if (data.user) applyUser(data.user);
                return data.user;
            });
        },

        changePassword: function (currentPassword, newPassword) {
            return request('/password', {
                method: 'POST',
                body: { currentPassword: currentPassword, newPassword: newPassword }
            });
        },

        reset: function (token, password) {
            return request('/reset', { method: 'POST', body: { token: token, password: password } });
        },

        verify: function (token) {
            return request('/verify', { method: 'POST', body: { token: token } }).then(function (data) {
                applyUser(data.user);
                return data.user;
            });
        },

        logout: function () {
            var done = function () { applyUser(null); };
            return request('/logout', { method: 'POST' }).then(done).catch(done);
        },

        getCurrentUser: function () {
            return refresh().then(function (user) {
                if (!user) throw new Error('未登录');
                return user;
            });
        },

        errorText: function (raw) {
            return raw || '操作失败，请重试。';
        }
    };

    /* ---------- Turnstile（可选） ---------- */
    var turnstileLoading = null;

    function loadTurnstile() {
        if (!CONFIG.turnstileSiteKey) return Promise.resolve(null);
        if (window.turnstile) return Promise.resolve(window.turnstile);
        if (!turnstileLoading) {
            turnstileLoading = new Promise(function (resolve) {
                var script = document.createElement('script');
                script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
                script.async = true;
                script.onload = function () { resolve(window.turnstile || null); };
                script.onerror = function () { resolve(null); };
                document.head.appendChild(script);
            });
        }
        return turnstileLoading;
    }

    Auth.mountTurnstile = function (el) {
        if (!el) return Promise.resolve(null);
        return loadTurnstile().then(function (ts) {
            if (!ts || !CONFIG.turnstileSiteKey) return null;
            return ts.render(el, { sitekey: CONFIG.turnstileSiteKey });
        }).catch(function () {
            return null;
        });
    };

    Auth.turnstileToken = function () {
        return (window.turnstile && window.turnstile.getResponse()) || '';
    };

    /* ---------- 页面状态 ---------- */
    var PROTECTED_PREFIXES = ['/software', '/works'];

    function isProtectedPage() {
        var p = location.pathname;
        for (var i = 0; i < PROTECTED_PREFIXES.length; i++) {
            var pre = PROTECTED_PREFIXES[i];
            if (p === pre || p.indexOf(pre + '/') === 0) return true;
        }
        return false;
    }

    function userNameOf(u) {
        if (!u) return '用户';
        if (u.user_metadata && u.user_metadata.full_name) return u.user_metadata.full_name;
        if (u.name) return u.name;
        if (u.email) return u.email.split('@')[0];
        return '用户';
    }

    function applyLoginState() {
        var logged = !!state.user;

        var needAuth = document.querySelectorAll('[data-need-auth]');
        for (var i = 0; i < needAuth.length; i++) {
            needAuth[i].style.display = logged ? '' : 'none';
        }

        var loggedOut = document.querySelectorAll('[data-logged-out]');
        for (var j = 0; j < loggedOut.length; j++) {
            loggedOut[j].style.display = logged ? 'none' : '';
        }

        var loggedIn = document.querySelectorAll('[data-logged-in]');
        for (var k = 0; k < loggedIn.length; k++) {
            loggedIn[k].style.display = logged ? '' : 'none';
        }

        var gateMain = document.getElementById('gate-main');
        var gateTip = document.getElementById('gate-tip');
        if (isProtectedPage() && !logged) {
            if (gateMain) gateMain.style.display = 'none';
            if (gateTip) gateTip.style.display = '';
        } else {
            if (gateMain) gateMain.style.display = '';
            if (gateTip) gateTip.style.display = 'none';
        }

        var nameEls = document.querySelectorAll('[data-username]');
        for (var m = 0; m < nameEls.length; m++) {
            nameEls[m].textContent = userNameOf(state.user);
        }
    }

    function bindLogout() {
        var btns = document.querySelectorAll('[data-logout]');
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', function (e) {
                e.preventDefault();
                Auth.logout().then(function () {
                    if (isProtectedPage()) {
                        location.reload();
                    } else {
                        applyLoginState();
                    }
                });
            });
        }
    }

    function patchLoginRedirect() {
        var link = document.getElementById('gate-login-link');
        if (link) {
            link.href = '/login.html?redirect=' + encodeURIComponent(location.pathname);
        }
    }

    function init() {
        window.Auth = Auth;
        bindLogout();
        patchLoginRedirect();
        refresh().then(applyLoginState);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
