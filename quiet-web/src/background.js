/**
 * 조용한 웹 — 서비스 워커
 * 하는 일은 두 가지뿐이다: 기본 설정 만들기, 아이콘에 처리 개수 표시하기.
 */

const KEY = 'quietWeb';
const DEFAULTS = { enabled: true, disabledHosts: [], siteRules: {}, total: 0 };

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(KEY);
  await chrome.storage.local.set({ [KEY]: { ...DEFAULTS, ...(stored[KEY] || {}) } });
  chrome.action.setBadgeBackgroundColor({ color: '#4F46E5' });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'qw:acted' || !sender.tab) return;

  const count = msg.n || 0;
  chrome.action.setBadgeText({ tabId: sender.tab.id, text: count ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#4F46E5' });

  const delta = msg.delta || 0;
  if (delta > 0) {
    chrome.storage.local.get(KEY).then(({ [KEY]: settings }) => {
      const next = { ...DEFAULTS, ...(settings || {}) };
      next.total = (next.total || 0) + delta;
      chrome.storage.local.set({ [KEY]: next });
    });
  }
});

// 페이지를 옮기면 배지를 초기화한다
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') chrome.action.setBadgeText({ tabId, text: '' });
});
