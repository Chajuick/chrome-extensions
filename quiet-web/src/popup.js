/**
 * 조용한 웹 — 팝업 화면
 */

const KEY = 'quietWeb';
const DEFAULTS = { enabled: true, disabledHosts: [], siteRules: {}, total: 0 };

const $ = (id) => document.getElementById(id);

let settings = { ...DEFAULTS };
let tab = null;
let host = '';
let status = null;

/** 콘텐츠 스크립트에 물어본다. 확장이 붙지 않은 탭(chrome:// 등)이면 null 이 온다. */
function ask(message) {
  return new Promise((resolve) => {
    if (!tab) return resolve(null);
    chrome.tabs.sendMessage(tab.id, message, (response) => {
      void chrome.runtime.lastError;
      resolve(response || null);
    });
  });
}

async function save() {
  await chrome.storage.local.set({ [KEY]: settings });
}

function render() {
  const siteOff = settings.disabledHosts.includes(host);

  $('power').textContent = settings.enabled ? '켜짐' : '꺼짐';
  $('power').dataset.off = settings.enabled ? '0' : '1';

  $('host').textContent = host || '이 페이지';
  $('siteToggle').textContent = siteOff ? '이 사이트에서 다시 켜기' : '이 사이트에서 끄기';
  $('siteToggle').disabled = !host;

  const handled = status ? status.hidden + status.clicked : 0;
  $('restore').disabled = !status || status.hidden === 0;
  $('pick').disabled = !status;

  let text;
  if (!status) {
    text = '이 화면에서는 동작하지 않아요.';
  } else if (status.sensitive) {
    text = '결제·로그인 페이지라 안전을 위해 쉬는 중이에요.';
  } else if (!settings.enabled) {
    text = '지금은 꺼져 있어요.';
  } else if (siteOff) {
    text = '이 사이트에서는 꺼둔 상태예요.';
  } else if (handled > 0) {
    text = `이 페이지에서 <strong>${handled}개</strong> 치웠어요.`;
  } else {
    text = '이 페이지는 조용하네요. 치울 게 없었어요.';
  }
  $('summary').innerHTML = text;

  $('total').textContent = settings.total
    ? `지금까지 모두 ${settings.total.toLocaleString('ko-KR')}개 치웠어요`
    : '';
}

/* ---------------------------------------------------------------- 동작 */

$('power').addEventListener('click', async () => {
  settings.enabled = !settings.enabled;
  await save();
  render();
});

$('siteToggle').addEventListener('click', async () => {
  if (!host) return;
  const list = new Set(settings.disabledHosts);
  if (list.has(host)) list.delete(host);
  else list.add(host);
  settings.disabledHosts = [...list];
  await save();
  render();
});

$('pick').addEventListener('click', async () => {
  await ask({ type: 'qw:pick' });
  window.close();
});

$('restore').addEventListener('click', async () => {
  await ask({ type: 'qw:restore' });
  status = await ask({ type: 'qw:status' });
  render();
});

/* ---------------------------------------------------------------- 시작 */

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const stored = await chrome.storage.local.get(KEY);
  settings = { ...DEFAULTS, ...(stored[KEY] || {}) };

  try {
    host = new URL(tab.url).hostname.replace(/^www\./, '');
  } catch {
    host = '';
  }

  status = await ask({ type: 'qw:status' });
  render();
})();
