/**
 * 유튜브 영상 광고 건너뛰기
 *
 * 설계에서 제일 중요한 결정:
 *   유튜브에서는 광고 요청을 네트워크에서 막지 않는다 (rules/network.json 의 3번 규칙).
 *   유튜브의 광고차단 감지는 '광고 리소스가 로드에 실패했는지' 를 보는 방식이 많아서,
 *   요청을 막으면 오히려 걸린다. 그래서 광고를 정상적으로 받되 플레이어 단에서 넘긴다.
 *
 * 넘기는 순서
 *   1) '건너뛰기' 버튼이 있으면 누른다 (유튜브가 정상으로 취급하는 경로)
 *   2) 못 건너뛰는 광고면 재생 위치를 끝으로 밀고, 그동안만 음소거한다
 *
 * 유튜브가 화면 구조를 바꾸면 이 파일이 가장 먼저 깨진다. 고칠 곳도 여기 하나다.
 */

(() => {
  'use strict';

  if (window.__adfreeYouTube) return;
  window.__adfreeYouTube = true;

  const TICK_MS = 300;

  const SKIP_SELECTORS = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    'button[class*="skip-button"]',
  ].join(', ');

  const OVERLAY_CLOSE_SELECTORS = [
    '.ytp-ad-overlay-close-button',
    '.ytp-ad-overlay-close-container',
    '.ytp-ad-text-overlay-close-button',
  ].join(', ');

  // 유튜브가 '광고 차단을 감지했다' 며 띄우는 안내. 우리는 이걸 없애려 들지 않고 알리기만 한다.
  const ENFORCEMENT_SELECTORS = [
    'ytd-enforcement-message-view-model',
    'tp-yt-paper-dialog ytd-enforcement-message-view-model',
  ].join(', ');

  let enabled = true;
  let mutedByUs = false;
  let skipped = 0;
  let warned = false;

  function report(kind) {
    try {
      chrome.runtime.sendMessage({ type: 'adfree:count', kind }, () => void chrome.runtime.lastError);
    } catch { /* 확장이 리로드된 경우 */ }
  }

  function findSkipButton() {
    for (const node of document.querySelectorAll(SKIP_SELECTORS)) {
      const box = node.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return node;
    }
    // 클래스가 바뀌었을 때를 대비한 보조 경로
    for (const node of document.querySelectorAll('button, .ytp-button')) {
      const label = `${node.getAttribute('aria-label') || ''} ${node.textContent || ''}`;
      if (/건너뛰|skip/i.test(label) && node.getBoundingClientRect().width > 0) return node;
    }
    return null;
  }

  function restoreSound(video) {
    if (mutedByUs && video) {
      video.muted = false;
      mutedByUs = false;
    }
  }

  function tick() {
    if (!enabled) return;

    const player = document.querySelector('#movie_player');
    const video = document.querySelector('video');
    if (!player || !video) return;

    // 겹쳐 뜨는 배너 광고는 언제든 닫는다
    for (const node of document.querySelectorAll(OVERLAY_CLOSE_SELECTORS)) {
      if (node.getBoundingClientRect().width > 0) {
        node.click();
        report('overlay');
      }
    }

    const adShowing = player.classList.contains('ad-showing') ||
                      player.classList.contains('ad-interrupting');

    if (!adShowing) {
      restoreSound(video);
      return;
    }

    const skip = findSkipButton();
    if (skip) {
      skip.click();
      skipped += 1;
      report('video');
      restoreSound(video);
      return;
    }

    // 건너뛸 수 없는 광고 — 소리를 끄고 끝으로 민다
    if (!video.muted) {
      video.muted = true;
      mutedByUs = true;
    }
    if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.15) {
      video.currentTime = video.duration;
      skipped += 1;
      report('video');
    }
  }

  function checkEnforcement() {
    if (warned) return;
    if (!document.querySelector(ENFORCEMENT_SELECTORS)) return;
    warned = true;
    try {
      chrome.runtime.sendMessage({ type: 'adfree:detected' }, () => void chrome.runtime.lastError);
    } catch { /* 무시 */ }
  }

  async function start() {
    try {
      const stored = await chrome.storage.local.get('adfree');
      const settings = stored.adfree || {};
      const host = location.hostname.replace(/^www\./, '');
      enabled = settings.enabled !== false && !(settings.allowHosts || []).includes(host);
    } catch { /* 기본값으로 진행 */ }

    setInterval(tick, TICK_MS);
    setInterval(checkEnforcement, 2000);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.adfree) return;
      const settings = changes.adfree.newValue || {};
      const host = location.hostname.replace(/^www\./, '');
      enabled = settings.enabled !== false && !(settings.allowHosts || []).includes(host);
      if (!enabled) restoreSound(document.querySelector('video'));
    });
  }

  start();
})();
