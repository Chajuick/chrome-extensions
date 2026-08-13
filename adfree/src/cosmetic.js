/**
 * 광고 자리 정리 — 일반 웹페이지용
 *
 * 네트워크에서 광고를 막으면 그 자리에 빈 상자가 남아 화면이 어색해진다.
 * 여기서는 '광고 자리라고 이름표가 붙은 것' 만 숨긴다.
 * 추측으로 지우지 않는다. 멀쩡한 내용을 지우는 게 광고가 남는 것보다 훨씬 나쁘기 때문이다.
 */

(() => {
  'use strict';

  if (window.__adfreeCosmetic) return;
  window.__adfreeCosmetic = true;

  const HOST = location.hostname.replace(/^www\./, '');

  // 광고 슬롯이라고 스스로 밝히고 있는 것들
  const AD_MARKERS = [
    'ins.adsbygoogle',
    'iframe[id^="google_ads_"]',
    'iframe[id^="aswift_"]',
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="googlesyndication.com"]',
    'iframe[src*="amazon-adsystem.com"]',
    'iframe[src*="criteo"]',
    'iframe[src*="taboola"]',
    'iframe[src*="outbrain"]',
    'iframe[src*="adnxs"]',
    'iframe[src*="display.ad.daum.net"]',
    'iframe[src*="widerplanet"]',
    '[id^="div-gpt-ad"]',
    '[id^="google_ads_iframe"]',
    '[class*="taboola" i]',
    '[id*="taboola" i]',
    '[id*="outbrain" i]',
    '.OUTBRAIN',
    '[id*="dable" i]',
    '[class*="adsbygoogle" i]',
    '[data-ad-slot]',
    '[data-google-query-id]',
  ].join(', ');

  let enabled = true;
  let hiddenCount = 0;
  const seen = new WeakSet();

  function report(n) {
    if (!n) return;
    try {
      chrome.runtime.sendMessage({ type: 'adfree:count', kind: 'slot', n },
        () => void chrome.runtime.lastError);
    } catch { /* 확장이 리로드된 경우 */ }
  }

  /**
   * 광고를 지우고 나면 높이만 잡아먹는 빈 껍데기가 남는 경우가 많다.
   * 눈에 보이는 내용이 아무것도 없는 부모만 골라 같이 접는다.
   */
  function collapseEmptyParent(node) {
    let parent = node.parentElement;
    for (let depth = 0; parent && depth < 2; depth += 1) {
      if (parent === document.body || parent.children.length > 1) return;
      if ((parent.innerText || '').trim().length > 0) return;
      const box = parent.getBoundingClientRect();
      if (box.height > 600) return;      // 큰 영역은 본문일 수 있다
      parent.style.setProperty('display', 'none', 'important');
      parent = parent.parentElement;
    }
  }

  function sweep() {
    if (!enabled) return;

    let count = 0;
    for (const node of document.querySelectorAll(AD_MARKERS)) {
      if (seen.has(node)) continue;
      seen.add(node);

      const box = node.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;

      node.style.setProperty('display', 'none', 'important');
      collapseEmptyParent(node);
      count += 1;
    }

    hiddenCount += count;
    report(count);
  }

  async function start() {
    try {
      const stored = await chrome.storage.local.get('adfree');
      const settings = stored.adfree || {};
      enabled = settings.enabled !== false && !(settings.allowHosts || []).includes(HOST);
    } catch { /* 기본값으로 진행 */ }

    if (!enabled) return;

    sweep();
    [400, 1200, 2500, 5000].forEach((t) => setTimeout(sweep, t));

    // 나중에 끼어드는 광고를 위해 지켜본다. 빈도가 낮게 묶어서 화면을 느리게 만들지 않는다.
    let pending = null;
    new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; sweep(); }, 500);
    }).observe(document.documentElement, { childList: true, subtree: true });

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'adfree:page-stats') {
        sendResponse({ hidden: hiddenCount, host: HOST });
      }
      return false;
    });
  }

  start();
})();
