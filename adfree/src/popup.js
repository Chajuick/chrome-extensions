const $ = (id) => document.getElementById(id);

let tab = null;
let host = '';
let state = null;

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function render() {
  const off = !state.enabled;
  const siteOff = state.allowHosts.includes(host);

  $('power').textContent = off ? '꺼짐' : '켜짐';
  $('power').dataset.off = off ? '1' : '0';

  $('host').textContent = host || '이 페이지';
  $('siteToggle').textContent = siteOff ? '이 사이트에서 다시 켜기' : '이 사이트에서 끄기';
  $('siteToggle').disabled = !host;

  $('tabCount').textContent = String(state.tabCount || 0);
  $('tSlot').textContent = String(state.totals.slot || 0);
  $('tVideo').textContent = String(state.totals.video || 0);
  $('tOverlay').textContent = String(state.totals.overlay || 0);

  // 유튜브가 광고 차단을 알아챈 지 얼마 안 됐으면 사실대로 알린다
  const recent = state.detectedAt && Date.now() - state.detectedAt < 1000 * 60 * 30;
  $('warn').hidden = !recent;
  if (recent) {
    $('warn').textContent =
      '유튜브가 광고 차단을 감지했습니다. 재생이 막히면 이 사이트에서 잠시 꺼두세요.';
  }
}

async function refresh() {
  state = await send({ type: 'adfree:state', tabId: tab ? tab.id : -1 });
  render();
}

$('power').addEventListener('click', async () => {
  state = await send({ type: 'adfree:set', patch: { enabled: !state.enabled } });
  await refresh();
});

$('siteToggle').addEventListener('click', async () => {
  if (!host) return;
  const list = new Set(state.allowHosts);
  if (list.has(host)) list.delete(host);
  else list.add(host);
  await send({ type: 'adfree:set', patch: { allowHosts: [...list] } });
  await refresh();
});

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    host = new URL(tab.url).hostname.replace(/^www\./, '');
  } catch {
    host = '';
  }
  await refresh();
})();
