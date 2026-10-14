/* ============================================================================
 * 站点登录 / 注册（基于 Netlify Identity）统一脚本
 * ----------------------------------------------------------------------------
 * 职责：
 *   1) 维护登录态（access_token 存 localStorage）
 *   2) 通过 Netlify Identity REST 接口实现 登录/注册/退出/取用户
 *   3) 控制顶部导航显隐：未登录隐藏"软件集锦/我的作品"，显示登录/注册；
 *      登录后显示用户名与"退出"
 *   4) 登录门禁：受保护栏目（/software/ /works/）未登录时隐藏正文并提示登录
 * 依赖：站点部署在 Netlify 且已启用 Identity 服务。
 * 引入：所有页面 </body> 前 <script src="/js/auth.js"></script>
 * ==========================================================================*/
(function () {
    'use strict';

    /* ---- Netlify Identity REST 端点（与站点同域） ---- */
    var API = window.location.origin + '/.netlify/identity';
    var TOKEN_KEY = 'blog_auth_token';

    /* ---------- 登录态 ---------- */
    function getToken() {
        try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
    }
    function setToken(t) {
        try {
            if (t) { localStorage.setItem(TOKEN_KEY, t); } else { localStorage.removeItem(TOKEN_KEY); }
        } catch (e) { /* localStorage 不可用时忽略 */ }
    }
    function isLoggedIn() { return !!getToken(); }

    /* ---------- 请求封装 ---------- */
    function req(path, method, body) {
        var headers = { 'Content-Type': 'application/json' };
        var t = getToken();
        if (t) { headers['Authorization'] = 'Bearer ' + t; }
        return fetch(API + path, {
            method: method,
            headers: headers,
            body: body ? JSON.stringify(body) : undefined
        }).then(function (r) {
            if (!r.ok) {
                return r.json().then(function (j) {
                    var msg = (j && (j.error_description || j.msg || j.error)) || ('请求失败（' + r.status + '）');
                    var err = new Error(msg);
                    err.status = r.status;
                    err.data = j;
                    throw err;
                }).catch(function (e) {
                    if (e instanceof Error) { throw e; }
                    throw new Error('请求失败（' + r.status + '）');
                });
            }
            return r.json().catch(function () { return {}; });
        });
    }

    /* ---------- 对外 API ---------- */
    var Auth = {
        isLoggedIn: isLoggedIn,
        getToken: getToken,

        /* 登录：email + password，成功后写入 token 并返回响应
           注意：Netlify Identity 的 token 接口要求 x-www-form-urlencoded 格式 */
        login: function (email, password) {
            var body = 'grant_type=password&email=' + encodeURIComponent(email) +
                '&password=' + encodeURIComponent(password);
            return fetch(API + '/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body
            }).then(function (r) {
                if (!r.ok) {
                    return r.json().then(function (j) {
                        var msg = (j && (j.error_description || j.msg || j.error)) || ('登录失败（' + r.status + '）');
                        var err = new Error(msg);
                        err.status = r.status;
                        err.data = j;
                        throw err;
                    }).catch(function (e) {
                        if (e instanceof Error) { throw e; }
                        throw new Error('登录失败（' + r.status + '）');
                    });
                }
                return r.json();
            }).then(function (data) {
                if (!data || !data.access_token) { throw new Error('登录响应异常，请重试。'); }
                setToken(data.access_token);
                return data;
            });
        },

        /* 注册：email + password，可选 data（如昵称）。返回新用户信息。 */
        signup: function (email, password, data) {
            return req('/signup', 'POST', {
                email: email,
                password: password,
                data: data || {}
            });
        },

        /* 退出：清 token，并通知服务端 */
        logout: function () {
            var t = getToken();
            setToken(null);
            if (t) {
                try {
                    fetch(API + '/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + t } });
                } catch (e) { /* 忽略 */ }
            }
            applyLoginState();
        },

        /* 取当前登录用户信息（需已登录） */
        getCurrentUser: function () {
            if (!isLoggedIn()) { return Promise.reject(new Error('未登录')); }
            return req('/user', 'GET');
        },

        /* 把 Netlify Identity 常见错误翻译成友好中文文案 */
        errorText: function (raw) {
            var m = (raw || '').toLowerCase();
            var map = [
                ['no user found with that email, or password invalid', '邮箱或密码不正确，请核对后重试，或重置密码。'],
                ['password invalid', '邮箱或密码不正确，请核对后重试。'],
                ['invalid login credentials', '邮箱或密码不正确。'],
                ['email not confirmed', '该邮箱尚未激活，请先完成邮箱验证或等待管理员确认。'],
                ['signup disabled', '注册功能当前已关闭。'],
                ['email already in use', '该邮箱已注册，请直接登录。'],
                ['password should be at least', '密码长度不符合要求（至少 6 位）。'],
                ['invalid email', '邮箱格式不正确。'],
                ['signup not confirmed', '注册后需经确认才可登录，请查看邮箱或等待管理员。'],
                ['user not found', '该邮箱尚未注册。'],
                ['no user found', '该邮箱尚未注册。']
            ];
            for (var i = 0; i < map.length; i++) {
                if (m.indexOf(map[i][0]) !== -1) { return map[i][1]; }
            }
            return raw || '操作失败，请重试。';
        }
    };

    /* ---------- 页面状态 ---------- */
    /* 受保护栏目：路径以这些前缀开头（software 软件集锦、works 我的作品） */
    var PROTECTED_PREFIXES = ['/software', '/works'];

    function isProtectedPage() {
        var p = location.pathname;
        for (var i = 0; i < PROTECTED_PREFIXES.length; i++) {
            var pre = PROTECTED_PREFIXES[i];
            if (p === pre || p.indexOf(pre + '/') === 0) { return true; }
        }
        return false;
    }

    function userNameOf(u) {
        if (!u) { return '用户'; }
        if (u.user_metadata && u.user_metadata.full_name) { return u.user_metadata.full_name; }
        if (u.email) { return u.email.split('@')[0]; }
        return '用户';
    }

    function applyLoginState() {
        var logged = isLoggedIn();

        /* 需要登录才可见（软件集锦 / 我的作品 导航） */
        var needAuth = document.querySelectorAll('[data-need-auth]');
        for (var i = 0; i < needAuth.length; i++) {
            needAuth[i].style.display = logged ? '' : 'none';
        }
        /* 未登录才可见（登录 / 注册） */
        var loggedOut = document.querySelectorAll('[data-logged-out]');
        for (var j = 0; j < loggedOut.length; j++) {
            loggedOut[j].style.display = logged ? 'none' : '';
        }
        /* 登录后才可见（用户名 / 退出） */
        var loggedIn = document.querySelectorAll('[data-logged-in]');
        for (var k = 0; k < loggedIn.length; k++) {
            loggedIn[k].style.display = logged ? '' : 'none';
        }

        /* 门禁：受保护栏目未登录 → 隐藏正文，显示登录提示 */
        var gateMain = document.getElementById('gate-main');
        var gateTip = document.getElementById('gate-tip');
        if (isProtectedPage() && !logged) {
            if (gateMain) { gateMain.style.display = 'none'; }
            if (gateTip) { gateTip.style.display = ''; }
        } else {
            if (gateMain) { gateMain.style.display = ''; }
            if (gateTip) { gateTip.style.display = 'none'; }
        }

        /* 登录后：填充用户名（先占位，再异步读取真实信息） */
        if (logged) {
            var nameEls = document.querySelectorAll('[data-username]');
            for (var m = 0; m < nameEls.length; m++) { nameEls[m].textContent = '用户'; }
            Auth.getCurrentUser().then(function (u) {
                var nm = userNameOf(u);
                for (var n = 0; n < nameEls.length; n++) { nameEls[n].textContent = nm; }
            }).catch(function () {});
        }
    }

    /* 绑定所有"退出"按钮 */
    function bindLogout() {
        var btns = document.querySelectorAll('[data-logout]');
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', function (e) {
                e.preventDefault();
                Auth.logout();
                if (isProtectedPage()) {
                    // 已停留在受保护页：刷新以显示登录提示
                    location.reload();
                } else {
                    applyLoginState();
                }
            });
        }
    }

    /* 登录 / 注册页返回链接携带 redirect 参数 */
    function patchLoginRedirect() {
        var link = document.getElementById('gate-login-link');
        if (link) {
            var redir = location.pathname;
            link.href = '/login.html?redirect=' + encodeURIComponent(redir);
        }
    }

    function init() {
        window.Auth = Auth;
        bindLogout();
        patchLoginRedirect();
        applyLoginState();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
