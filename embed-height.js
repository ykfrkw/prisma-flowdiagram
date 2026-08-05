/* embed-height.js — 埋め込み親ページへコンテンツの高さを通知する。
 *
 * iframe で埋め込まれているときだけ、{ type: 'embed:height', height: <px> } を
 * 親へ postMessage する。送るのは高さの数値だけなので targetOrigin は '*'。
 * 受け取る側で origin と event.source を検証すること。
 * 直接開いているとき（window.parent === window）は何もしない。
 */
(function () {
  'use strict';
  if (window.parent === window) return;

  var last = 0;

  // documentElement.scrollHeight は iframe のビューポート高より小さくならず、
  // body に min-height が付いていると縮まなくなる。body の子要素の実測を使う。
  function measure() {
    var body = document.body;
    if (!body) return 0;
    var kids = body.children;
    var bottom = 0;
    for (var i = 0; i < kids.length; i++) {
      bottom = Math.max(bottom, kids[i].offsetTop + kids[i].offsetHeight);
    }
    if (!bottom) return Math.ceil(document.documentElement.scrollHeight);
    var pad = parseFloat(getComputedStyle(body).paddingBottom) || 0;
    return Math.ceil(bottom + pad);
  }

  function notify() {
    var height = measure();
    if (!height || Math.abs(height - last) < 2) return;
    last = height;
    window.parent.postMessage({ type: 'embed:height', height: height }, '*');
  }

  function start() {
    notify();
    if (typeof ResizeObserver === 'function') {
      var ro = new ResizeObserver(notify);
      ro.observe(document.body);
      var kids = document.body.children;
      for (var i = 0; i < kids.length; i++) ro.observe(kids[i]);
      // 子要素の増減も拾う
      if (typeof MutationObserver === 'function') {
        new MutationObserver(function () {
          var k = document.body.children;
          for (var j = 0; j < k.length; j++) ro.observe(k[j]);
          notify();
        }).observe(document.body, { childList: true, subtree: true });
      }
    } else if (typeof MutationObserver === 'function') {
      new MutationObserver(notify).observe(document.body, { childList: true, subtree: true, attributes: true });
    }
    window.addEventListener('resize', notify);
    window.addEventListener('load', notify);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
