/**
 * 서비스 워커 — 켜고 끄기, 사이트별 예외, 개수 세기
 *
 * 세는 값에 대해: 크롬 MV3 에서는 '네트워크에서 몇 개를 막았는지' 를 배포판에서 알 수 없다.
 * 그 정보를 주는 API(declarativeNetRequestFeedback)는 개발자 모드 전용이다.
 * 그래서 여기서는 **실제로 확인한 것만** 센다 — 화면에서 치운 광고 자리와 건너뛴 영상 광고.
 * 부풀린 숫자를 보여주지 않는다.
 */

const KEY = 'adfree';
const RULESET_ID = 'ads';
const ALLOW_RULE_ID = 9001;

const DEFAULTS = { enabled: true, allowHosts: [], totals: { slot: 0, video: 0, overlay: 0 } };

const ALLOW_RESOURCES = [
  'script', 'xmlhttprequest', 'sub_frame', 'image',
  'media', 'ping', 'object', 'websocket',
];

/* ---------------------------------------------------------------- 설정 */

async function load() {
  const stored = await chrome.storage.local.get(KEY);
  const data = stored[KEY] || {};
  return {
    enabled: data.enabled !== false,
    allowHosts: data.allowHosts || [],
    totals: { ...DEFAULTS.totals, ...(data.totals || {}) },
  };
}

async function save(data) {
  await chrome.storage.local.set({ [KEY]: data });
}

/* ---------------------------------------------------------------- 규칙 반영 */

/** 전체 끄기는 규칙셋 자체를 내린다. */
async function applyEnabled(enabled) {
  await chrome.declarativeNetRequest.updateEnabledRulesets(
    enabled ? { enableRulesetIds: [RULESET_ID] } : { disableRulesetIds: [RULESET_ID] }
  );
}

/** 사이트별 예외는 우선순위가 높은 allow 규칙 하나로 모아 처리한다. */
async function applyAllowHosts(hosts) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);

  const addRules = hosts.length
    ? [{
        id: ALLOW_RULE_ID,
        priority: 1000,
        action: { type: 'allow' },
        condition: { initiatorDomains: hosts, resourceTypes: ALLOW_RESOURCES },
      }]
    : [];

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

async function applyAll() {
  const data = await load();
  await applyEnabled(data.enabled);
  await applyAllowHosts(data.allowHosts);
  chrome.action.setBadgeBackgroundColor({ color: '#0F172A' });
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(KEY);
  if (!stored[KEY]) await save(DEFAULTS);
  await applyAll();
});

chrome.runtime.onStartup.addListener(applyAll);

/* ---------------------------------------------------------------- 개수 */

const perTab = new Map();   // tabId -> 이 페이지에서 확인한 개수

function paintBadge(tabId) {
  const n = perTab.get(tabId) || 0;
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : '' });
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    perTab.set(tabId, 0);
    chrome.action.setBadgeText({ tabId, text: '' });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => perTab.delete(tabId));

/* ---------------------------------------------------------------- 메시지 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;

  if (msg.type === 'adfree:count' && sender.tab) {
    const n = msg.n || 1;
    perTab.set(sender.tab.id, (perTab.get(sender.tab.id) || 0) + n);
    paintBadge(sender.tab.id);

    load().then((data) => {
      data.totals[msg.kind] = (data.totals[msg.kind] || 0) + n;
      save(data);
    });
    return false;
  }

  if (msg.type === 'adfree:detected' && sender.tab) {
    // 유튜브가 광고 차단을 알아챈 경우. 숨기지 말고 사실대로 알린다.
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: '!' });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#DC2626' });
    load().then((data) => save({ ...data, detectedAt: Date.now() }));
    return false;
  }

  if (msg.type === 'adfree:state') {
    load().then(async (data) => {
      sendResponse({ ...data, tabCount: perTab.get(msg.tabId) || 0 });
    });
    return true;
  }

  if (msg.type === 'adfree:set') {
    load().then(async (data) => {
      const next = { ...data, ...msg.patch };
      await save(next);
      await applyEnabled(next.enabled);
      await applyAllowHosts(next.allowHosts);
      sendResponse({ ok: true, ...next });
    });
    return true;
  }

  return false;
});
