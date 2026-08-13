/**
 * 조용한 웹 — 직접 지우기 모드
 *
 * 자동으로 못 잡은 팝업을 사용자가 직접 클릭해서 알려주는 기능.
 * 한 번 알려주면 그 사이트에서는 다음부터 자동으로 사라진다.
 */

(() => {
  'use strict';

  let active = false;
  let overlay = null;
  let hintBar = null;
  let target = null;

  /* ---------------------------------------------------------------- UI */

  function buildUI() {
    overlay = document.createElement('div');
    overlay.className = 'quietweb-ui quietweb-highlight';

    hintBar = document.createElement('div');
    hintBar.className = 'quietweb-ui quietweb-hint';
    hintBar.textContent = '없애고 싶은 팝업을 클릭하세요  ·  ESC 를 누르면 취소';

    document.body.append(overlay, hintBar);
  }

  function teardown() {
    overlay?.remove();
    hintBar?.remove();
    overlay = hintBar = target = null;
  }

  function toast(message) {
    const el = document.createElement('div');
    el.className = 'quietweb-ui quietweb-toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  /* ---------------------------------------------------------------- 선택자 만들기 */

  // 자동 생성된 것처럼 보이는 클래스(해시, 숫자 덩어리)는 다음 방문 때 바뀌므로 거른다
  function usableClasses(el) {
    return [...el.classList].filter((c) =>
      /^[a-zA-Z][\w-]{1,30}$/.test(c) &&
      !/\d{4,}/.test(c) &&
      !/^(is-|js-|active|open|show|visible|on)$/i.test(c)
    ).slice(0, 2);
  }

  function selectorFor(el) {
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) {
      const byId = `#${CSS.escape(el.id)}`;
      try { if (document.querySelectorAll(byId).length === 1) return byId; } catch { /* 무시 */ }
    }

    const parts = [];
    let node = el;
    let depth = 0;

    while (node && node.nodeType === 1 && node !== document.body && depth < 4) {
      let part = node.tagName.toLowerCase();
      const classes = usableClasses(node);
      if (classes.length) {
        part += '.' + classes.map((c) => CSS.escape(c)).join('.');
      } else if (node.parentElement) {
        part += `:nth-child(${[...node.parentElement.children].indexOf(node) + 1})`;
      }
      parts.unshift(part);

      const selector = parts.join(' > ');
      try {
        if (document.querySelectorAll(selector).length === 1) return selector;
      } catch { /* 무시 */ }

      node = node.parentElement;
      depth += 1;
    }
    return parts.join(' > ');
  }

  /* ---------------------------------------------------------------- 저장 */

  async function saveRule(selector) {
    const host = window.__quietWeb.host;
    const stored = await chrome.storage.local.get('quietWeb');
    const settings = stored.quietWeb || {};
    const siteRules = { ...(settings.siteRules || {}) };
    const list = new Set(siteRules[host] || []);
    list.add(selector);
    siteRules[host] = [...list];
    await chrome.storage.local.set({ quietWeb: { ...settings, siteRules } });
  }

  /* ---------------------------------------------------------------- 이벤트 */

  function highlight(el) {
    target = el;
    const r = el.getBoundingClientRect();
    Object.assign(overlay.style, {
      top: `${r.top + scrollY}px`,
      left: `${r.left + scrollX}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  }

  function onMove(e) {
    if (!active) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.closest('.quietweb-ui')) return;

    // 너무 작은 조각이 잡히면 팝업 전체를 고르도록 위로 한두 단계 올라간다
    let pick = el;
    for (let i = 0; i < 3 && pick.parentElement && pick.parentElement !== document.body; i += 1) {
      const r = pick.getBoundingClientRect();
      if (r.width >= 160 && r.height >= 80) break;
      pick = pick.parentElement;
    }
    highlight(pick);
  }

  async function onClick(e) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const el = target;
    stop();
    if (!el) return;

    const selector = selectorFor(el);
    await saveRule(selector);
    window.__quietWeb.hide(el);
    toast('기억했습니다. 이 사이트에서는 다음부터 자동으로 없어집니다.');
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); stop(); }
  }

  /* ---------------------------------------------------------------- 시작 / 종료 */

  function start() {
    if (active) return;
    active = true;
    buildUI();
    addEventListener('mousemove', onMove, true);
    addEventListener('click', onClick, true);
    addEventListener('keydown', onKey, true);
  }

  function stop() {
    if (!active) return;
    active = false;
    removeEventListener('mousemove', onMove, true);
    removeEventListener('click', onClick, true);
    removeEventListener('keydown', onKey, true);
    teardown();
  }

  QW.startPicker = start;
})();
