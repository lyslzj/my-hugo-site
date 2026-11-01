/* ============================================================================
 * 本站评论（D1 + /api/comments）
 * 登录后显示评论框可直接发表；未登录只显示 GitHub 登录按钮（由 auth.js 控制显隐）
 * ==========================================================================*/
(function () {
    'use strict';
    var app = document.getElementById('comment-app');
    if (!app) return;
    var path = app.getAttribute('data-path') || location.pathname;

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function fmt(ts) {
        var d = new Date(ts);
        function p(n) { return n < 10 ? '0' + n : '' + n; }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
            ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function loadList() {
        fetch('/api/comments?path=' + encodeURIComponent(path), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var list = document.getElementById('comment-list');
                var count = document.getElementById('comment-count');
                if (!list) return;
                var cs = (d && d.comments) || [];
                if (count) count.textContent = cs.length + ' 条评论';
                if (!cs.length) {
                    list.innerHTML = '<p class="comment-empty">还没有评论，登录后来抢沙发~</p>';
                    return;
                }
                list.innerHTML = cs.map(function (c) {
                    return '<div class="comment-item">' +
                        '<div class="comment-head"><b>' + esc(c.author) + '</b>' +
                        '<span class="comment-time">' + fmt(c.created_at) + '</span></div>' +
                        '<div class="comment-body">' + esc(c.body).replace(/\n/g, '<br>') + '</div>' +
                        '</div>';
                }).join('');
            })
            .catch(function () {});
    }

    function bindSubmit() {
        var btn = document.getElementById('comment-submit');
        if (!btn) return;
        btn.addEventListener('click', function () {
            var ta = document.getElementById('comment-text');
            var msg = document.getElementById('comment-msg');
            var text = (ta.value || '').trim();
            if (!text) { if (msg) msg.textContent = '评论内容不能为空'; return; }
            btn.disabled = true;
            if (msg) msg.textContent = '发表中…';
            fetch('/api/comments', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path, body: text })
            })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    btn.disabled = false;
                    if (d.error) { if (msg) msg.textContent = d.error; return; }
                    ta.value = '';
                    if (msg) msg.textContent = '';
                    loadList();
                })
                .catch(function (e) {
                    btn.disabled = false;
                    if (msg) msg.textContent = '发表失败，请重试';
                });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            loadList(); bindSubmit();
        });
    } else {
        loadList(); bindSubmit();
    }
})();
