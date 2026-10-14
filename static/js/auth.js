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
            var body = 'grant_type=password&username=' + encodeURIComponent(email) +
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

        /* 忘记密码：向邮箱发送重置密码邮件 */
        recover: function (email) {
            return req('/recover', 'POST', { email: email });
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

    /* ================= 邮件链接回调处理（邮箱确认 / 密码恢复） =================
       当用户点击 Netlify 发的"确认邮箱 / 重置密码"邮件里的链接，会被带回本站，
       token 会出现在 URL（query 或 hash）。这里读取并处理：
         - 密码恢复(recovery)：弹出"设置新密码"表单 → 用 token 更新密码
         - 其他(邮箱确认等)：提示操作成功，引导去登录                            */

    function parseCallbackParams() {
        var q = location.search.replace(/^\?/, '');
        var h = location.hash.replace(/^#/, '');
        var merged = (q ? q + '&' : '') + h;
        if (!merged) { return null; }
        var params = {};
        merged.split('&').forEach(function (kv) {
            var i = kv.indexOf('=');
            if (i > 0) { params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); }
        });
        return params;
    }

    /* 用恢复 token 兑换会话（gotrue：POST /verify type=recovery → 返回 access_token 等 session） */
    function redeemRecovery(token) {
        return fetch(API + '/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token, type: 'recovery' })
        }).then(function (r) {
            if (!r.ok) {
                return r.json().then(function (j) {
                    throw new Error((j && (j.msg || j.error_description || j.error)) || ('恢复失败（' + r.status + '）'));
                }).catch(function (e) {
                    if (e instanceof Error) { throw e; }
                    throw new Error('恢复失败（' + r.status + '）');
                });
            }
            return r.json();
        });
    }

    /* 用会话令牌更新密码（gotrue：PUT /user + Bearer access_token） */
    function setPassword(token, password) {
        return fetch(API + '/user', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ password: password })
        }).then(function (r) {
            if (!r.ok) {
                return r.json().then(function (j) {
                    throw new Error((j && (j.msg || j.error_description || j.error)) || ('重置失败（' + r.status + '）'));
                }).catch(function (e) {
                    if (e instanceof Error) { throw e; }
                    throw new Error('重置失败（' + r.status + '）');
                });
            }
            return r.json();
        });
    }

    function overlayStyle() {
        return 'position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
    }

    /* 密码恢复：弹出"设置新密码"表单 */
    function showRecoverForm(token) {
        var div = document.createElement('div');
        div.style.cssText = overlayStyle();
        div.innerHTML =
            '<div class="form-box" style="margin:0 auto;">' +
            '<div class="welcome">设 置 新 密 码</div>' +
            '<form id="recover-cb-form">' +
            '<table class="form-table">' +
            '<tr><td class="form-label">新密码:</td><td><input type="password" id="recover-cb-pass" size="24" placeholder="至少 6 位"></td></tr>' +
            '<tr><td class="form-label">确认密码:</td><td><input type="password" id="recover-cb-pass2" size="24"></td></tr>' +
            '<tr><td class="form-label">&nbsp;</td><td><input type="submit" value="确认重置"></td></tr>' +
            '</table></form>' +
            '<p class="form-note" id="recover-cb-msg"></p>' +
            '</div>';
        document.body.appendChild(div);
        document.getElementById('recover-cb-form').addEventListener('submit', function (e) {
            e.preventDefault();
            var p1 = document.getElementById('recover-cb-pass').value;
            var p2 = document.getElementById('recover-cb-pass2').value;
            var m = document.getElementById('recover-cb-msg');
            if (p1.length < 6) { m.textContent = '密码至少 6 位。'; return; }
            if (p1 !== p2) { m.textContent = '两次输入的密码不一致。'; return; }
            m.textContent = '提交中…';
            redeemRecovery(token).then(function (session) {
                var accessToken = session && (session.access_token || session.token);
                if (!accessToken) { throw new Error('未能获取会话令牌，请重新发起重置。'); }
                return setPassword(accessToken, p1);
            }).then(function () {
                m.textContent = '密码已更新，即将前往登录…';
                setTimeout(function () { location.href = '/login.html'; }, 900);
            }).catch(function (err) {
                m.textContent = Auth.errorText(err.message);
            });
        });
    }

    /* 邮箱确认：用 confirmation_token 调用 verify 端点真正完成确认 */
    function confirmEmail(token) {
        return fetch(API + '/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token, type: 'signup' })
        }).then(function (r) {
            if (!r.ok) {
                return r.json().then(function (j) {
                    throw new Error((j && (j.msg || j.error_description || j.error)) || ('验证失败（' + r.status + '）'));
                }).catch(function (e) {
                    if (e instanceof Error) { throw e; }
                    throw new Error('验证失败（' + r.status + '）');
                });
            }
            return r.json();
        });
    }

    /* 邮箱确认等其他回调：提示成功并引导登录 */
    function showCallbackSuccess(message) {
        var div = document.createElement('div');
        div.style.cssText = overlayStyle();
        div.innerHTML =
            '<div class="form-box" style="margin:0 auto;">' +
            '<div class="welcome">操 作 结 果</div>' +
            '<p style="text-align:center;">' + (message || '操作已完成，请前往登录。') + '</p>' +
            '<p style="text-align:center;"><a href="/login.html">去登录</a></p>' +
            '</div>';
        document.body.appendChild(div);
    }

    function handleAuthCallback() {
        var p = parseCallbackParams();
        if (!p) { return; }
        var recoveryToken = p.recovery_token;
        var confirmationToken = p.confirmation_token;
        var otherToken = p.invite_token || p.email_change_token || p.token || p.access_token;

        if (!recoveryToken && !confirmationToken && !otherToken) { return; }

        // 立即从地址栏清掉 token，避免刷新时重复触发
        history.replaceState(null, '', location.pathname);

        if (recoveryToken) {
            showRecoverForm(recoveryToken);
            return;
        }
        if (confirmationToken) {
            confirmEmail(confirmationToken).then(function () {
                showCallbackSuccess('邮箱验证成功，账号已激活，现在可以登录了。');
            }).catch(function (err) {
                showCallbackSuccess('邮箱验证未完成：' + Auth.errorText(err.message));
            });
            return;
        }
        showCallbackSuccess('操作已完成，请前往登录。');
    }

    function init() {
        window.Auth = Auth;
        bindLogout();
        patchLoginRedirect();
        applyLoginState();
        handleAuthCallback();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
