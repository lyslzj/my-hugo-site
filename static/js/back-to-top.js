/* 自动给文章卡片底部加"回到顶部"链接（2026-10-14）
   作用范围：layouts/_default/baseof.html 里只在 science 栏目引入本文件
   特点：不用手写 HTML，新卡片/新文章自动生效 */
(function () {
    function addBackToTop() {
        var cards = document.querySelectorAll('.article-body .card');
        if (!cards.length) { return; }
        Array.prototype.forEach.call(cards, function (card) {
            if (card.querySelector('.back-to-top')) { return; }   /* 避免重复添加 */
            var a = document.createElement('a');
            a.className = 'back-to-top';
            a.href = '#top';
            a.textContent = '\u2191 \u56de\u5230\u9876\u90e8';
            a.addEventListener('click', function (e) {
                e.preventDefault();
                try { window.scrollTo({ top: 0, behavior: 'smooth' }); }
                catch (err) { window.scrollTo(0, 0); }
            });
            card.appendChild(a);
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addBackToTop);
    } else {
        addBackToTop();
    }
})();
