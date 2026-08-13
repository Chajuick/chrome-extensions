/**
 * 조용한 웹 — 본체
 *
 * 안전 원칙 (고치기 전에 반드시 읽을 것)
 *  1. '동의 / 허용 / 결제 / 설치' 계열 버튼은 절대 누르지 않는다.
 *     누를 안전한 버튼이 없으면 클릭 대신 '숨기기'만 한다. 숨기기는 서버 상태를 바꾸지 않는다.
 *  2. 결제 · 로그인 · 인증 · 금융 페이지에서는 아무것도 하지 않는다.
 *  3. 사용자가 방금(1.2초 이내) 클릭해서 열린 창은 건드리지 않는다.
 *     자기가 눌러서 연 팝업이 사라지면 그게 제일 짜증나기 때문이다.
 *  4. 숨긴 것은 전부 되돌릴 수 있게 기록해둔다.
 */

(() => {
  'use strict';

  if (window.__quietWebLoaded) return;
  window.__quietWebLoaded = true;

  const HIDDEN_ATTR = 'data-quietweb-hidden';
  const HOST = location.hostname.replace(/^www\./, '');
  const GESTURE_GRACE_MS = 1200;
  const SWEEP_DELAYS = [0, 300, 800, 1500, 2500, 4000, 7000];

  const DEFAULTS = { enabled: true, disabledHosts: [], siteRules: {} };

  let settings = { ...DEFAULTS };
  let ready = false;
  let hidden = [];          // { el, style } — 되돌리기용
  let clickedCount = 0;
  let lastGestureAt = 0;
  let observer = null;
  let sweepTimer = null;

  /* ---------------------------------------------------------------- 안전 판정 */

  function isSensitivePage() {
    return QW.SENSITIVE_URL.some((r) => r.test(location.href)) ||
           QW.SENSITIVE_HOST.some((r) => r.test(location.hostname));
  }

  function isOff() {
    return !settings.enabled || settings.disabledHosts.includes(HOST);
  }

  /* ---------------------------------------------------------------- 유틸 */

  function matchAny(patterns, text) {
    if (!text) return false;
    return patterns.some((r) => r.test(text));
  }

  function isVisible(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // 버튼의 '이름'을 최대한 긁어모은다 (텍스트 없는 아이콘 버튼 대응)
  function labelOf(el) {
    return [
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('alt'),
      el.tagName === 'INPUT' ? el.value : '',
      el.innerText || el.textContent,
    ].join(' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function classNameOf(el) {
    // SVG 요소의 className 은 문자열이 아니다
    return typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '');
  }

  function matchesCloseSelector(el) {
    return QW.CLOSE_SELECTORS.some((sel) => {
      try { return el.matches(sel); } catch { return false; }
    });
  }

  /* ---------------------------------------------------------------- 버튼 고르기 */

  /**
   * 레이어 안에서 '눌러도 안전한' 버튼을 하나 고른다.
   * 없으면 null — 이 경우 호출한 쪽은 클릭 대신 숨기기를 검토한다.
   */
  function findSafeButton(root) {
    const nodes = new Set();
    root.querySelectorAll(
      'button, a, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]'
    ).forEach((n) => nodes.add(n));
    for (const sel of QW.CLOSE_SELECTORS) {
      try { root.querySelectorAll(sel).forEach((n) => nodes.add(n)); } catch { /* 잘못된 선택자 무시 */ }
    }

    let best = null;
    for (const node of nodes) {
      if (!isVisible(node)) continue;

      const text = labelOf(node);

      // 위험 단어가 하나라도 있으면 후보에서 제외한다
      if (matchAny(QW.NEVER_CLICK, text)) continue;

      let score = 0;
      if (matchAny(QW.PERSISTENT_CLOSE, text)) score = 3;        // '오늘 하루 보지 않기'
      else if (matchAny(QW.SAFE_CLOSE, text)) score = 2;         // '닫기', '나중에'
      else if (matchesCloseSelector(node) && text.length <= 3) score = 1;  // 텍스트 없는 X 아이콘
      if (!score) continue;

      if (!best || score > best.score) best = { node, score, text };
    }
    return best;
  }

  /* ---------------------------------------------------------------- 레이어 판정 */

  /**
   * 이 요소가 '화면을 가리는 방해물'인지 판단한다.
   * 아니라고 판단되면 null 을 돌려주고, 그러면 아무 일도 일어나지 않는다.
   */
  function evaluate(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el === document.body || el === document.documentElement) return null;
    if (el.hasAttribute(HIDDEN_ATTR)) return null;

    try {
      if (el.matches(QW.SKIP_SELECTORS)) return null;
      if (el.closest('.quietweb-ui')) return null;
    } catch { return null; }

    if (!isVisible(el)) return null;

    const cs = getComputedStyle(el);
    const pos = cs.position;
    const z = parseInt(cs.zIndex, 10) || 0;
    const isDialog = el.matches('dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]');

    // 화면에 떠 있는 요소만 대상으로 한다
    const floating =
      isDialog ||
      pos === 'fixed' ||
      ((pos === 'absolute' || pos === 'sticky') && z >= 100);
    if (!floating) return null;

    const r = el.getBoundingClientRect();
    if (r.width < 120 || r.height < 40) return null;
    if (r.bottom <= 0 || r.top >= innerHeight) return null;   // 화면 밖

    const text = (el.innerText || '').trim();

    // --- 본문·기능 영역 오인 방지 ---
    if (text.length > 1200) return null;                       // 글이 길면 본문일 가능성
    if (el.querySelector('main, article')) return null;
    if (el.querySelector('input[type="password"]')) return null;
    if (!isDialog && el.querySelectorAll('a').length > 12) return null;  // 링크 뭉치 = 메뉴

    const coverage = (r.width * r.height) / (innerWidth * innerHeight);
    const edgeBanner = r.width >= innerWidth * 0.6 &&
                       (r.top <= 8 || innerHeight - r.bottom <= 8);
    const isBackdrop = coverage >= 0.7 && el.children.length <= 2 && text.length === 0;

    if (coverage < 0.05 && !edgeBanner && !isDialog && !isBackdrop) return null;

    return { el, coverage, edgeBanner, isDialog, isBackdrop, text };
  }

  /* ---------------------------------------------------------------- 처리 */

  function hide(el) {
    if (!el || el.hasAttribute(HIDDEN_ATTR)) return false;
    hidden.push({ el, style: el.getAttribute('style') });
    el.setAttribute(HIDDEN_ATTR, '1');
    el.style.setProperty('display', 'none', 'important');
    return true;
  }

  function act(c) {
    // 1순위: 안전한 닫기 버튼을 실제로 누른다 (사이트가 상태를 기억해줌)
    const btn = findSafeButton(c.el);
    if (btn) {
      try {
        btn.node.click();
        clickedCount += 1;
        return true;
      } catch { /* 클릭 실패하면 아래 숨기기로 넘어간다 */ }
    }

    // 2순위: 누를 만한 버튼이 없으면 숨기기만 한다.
    //        단, 광고·안내 레이어라는 근거가 있을 때만.
    const promo =
      matchAny(QW.PROMO_HINTS, c.text) ||
      matchAny(QW.PROMO_HINTS, classNameOf(c.el)) ||
      matchAny(QW.PROMO_HINTS, c.el.id || '');

    if (c.isBackdrop || promo || (c.isDialog && c.coverage >= 0.15)) {
      return hide(c.el);
    }
    return false;
  }

  /**
   * 모달이 뜨면 사이트가 body 스크롤을 잠그는 경우가 많다.
   * 모달을 치웠는데 스크롤이 잠긴 채로 남으면 페이지가 먹통처럼 보이므로 풀어준다.
   */
  function unlockScroll() {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
        el.style.setProperty('overflow-y', 'auto', 'important');
      }
      if (cs.position === 'fixed') {
        const top = parseInt(cs.top, 10) || 0;
        el.style.setProperty('position', 'static', 'important');
        if (top < 0) scrollTo(0, -top);
      }
    }
  }

  function applySiteRules() {
    const rules = settings.siteRules[HOST];
    if (!rules || !rules.length) return;
    for (const sel of rules) {
      try {
        document.querySelectorAll(sel).forEach((el) => { if (isVisible(el)) hide(el); });
      } catch { /* 저장된 선택자가 깨졌으면 무시 */ }
    }
  }

  /* ---------------------------------------------------------------- 훑기 */

  function sweep(fromMutation) {
    if (!ready || !document.body) return;
    if (isOff() || isSensitivePage()) return;

    // 사용자가 방금 눌러서 연 창은 건드리지 않는다
    if (fromMutation && Date.now() - lastGestureAt < GESTURE_GRACE_MS) return;

    const before = hidden.length + clickedCount;

    applySiteRules();

    // body 의 직계 자식만 본다. 팝업은 거의 전부 body 에 붙기 때문에
    // 전체 DOM 을 훑지 않아도 되고, 그만큼 페이지가 느려지지 않는다.
    const pool = new Set(document.body.children);
    document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')
      .forEach((n) => pool.add(n));

    for (const el of pool) {
      const c = evaluate(el);
      if (c) act(c);
    }

    const delta = hidden.length + clickedCount - before;
    if (delta > 0) {
      unlockScroll();
      report(delta);
    }
  }

  function report(delta) {
    try {
      chrome.runtime.sendMessage(
        { type: 'qw:acted', n: hidden.length + clickedCount, delta },
        () => void chrome.runtime.lastError
      );
    } catch { /* 확장이 리로드된 경우 */ }
  }

  function restoreAll() {
    const n = hidden.length;
    for (const rec of hidden) {
      rec.el.removeAttribute(HIDDEN_ATTR);
      if (rec.style === null) rec.el.removeAttribute('style');
      else rec.el.setAttribute('style', rec.style);
    }
    hidden = [];
    report(0);
    return n;
  }

  /* ---------------------------------------------------------------- 메시지 */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg && msg.type) {
      case 'qw:status':
        sendResponse({
          host: HOST,
          hidden: hidden.length,
          clicked: clickedCount,
          sensitive: isSensitivePage(),
          off: isOff(),
        });
        break;
      case 'qw:restore':
        sendResponse({ restored: restoreAll() });
        break;
      case 'qw:pick':
        QW.startPicker();
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false });
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.quietWeb) return;
    settings = { ...DEFAULTS, ...(changes.quietWeb.newValue || {}) };
    sweep(false);
  });

  /* ---------------------------------------------------------------- 시작 */

  function startWatching() {
    if (!document.body || observer) return;

    SWEEP_DELAYS.forEach((t) => setTimeout(() => sweep(false), t));

    // body 에 자식이 붙거나(팝업 삽입), body 의 class/style 이 바뀌면(스크롤 잠금) 다시 훑는다.
    observer = new MutationObserver(() => {
      if (sweepTimer) return;
      sweepTimer = setTimeout(() => { sweepTimer = null; sweep(true); }, 300);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: false,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
  }

  async function init() {
    try {
      const stored = await chrome.storage.local.get('quietWeb');
      settings = { ...DEFAULTS, ...(stored.quietWeb || {}) };
    } catch { /* 기본값으로 진행 */ }
    ready = true;

    addEventListener('pointerdown', () => { lastGestureAt = Date.now(); }, true);
    addEventListener('keydown', () => { lastGestureAt = Date.now(); }, true);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startWatching, { once: true });
    } else {
      startWatching();
    }
    addEventListener('load', () => sweep(false));
  }

  // picker.js 에서 쓰는 최소한의 통로
  window.__quietWeb = {
    hide,
    sweep,
    host: HOST,
    isVisible,
  };

  init();
})();
