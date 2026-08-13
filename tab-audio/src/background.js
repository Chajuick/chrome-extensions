/**
 * 서비스 워커 — 녹음 시작/정지 지시와 저장만 담당한다.
 *
 * 실제 녹음은 오프스크린 문서가 하고, 상태도 거기가 진짜다.
 * 서비스 워커는 놀고 있으면 크롬이 꺼버리기 때문에 여기에 상태를 두면 안 된다.
 */

const OFFSCREEN_PATH = 'src/offscreen.html';

let creating = null;

async function offscreenExists() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await offscreenExists()) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['USER_MEDIA'],
      justification: '탭에서 재생되는 소리를 녹음하려면 미디어 스트림이 필요합니다.',
    });
  }
  await creating;
  creating = null;
}

function toOffscreen(message) {
  return chrome.runtime.sendMessage({ target: 'offscreen', ...message });
}

function safeName(name) {
  const cleaned = String(name || '녹음')
    .replace(/\s*-\s*YouTube\s*$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || '녹음';
  return `${cleaned}.wav`;
}

function setBadge(on) {
  chrome.action.setBadgeText({ text: on ? 'REC' : '' });
  if (on) chrome.action.setBadgeBackgroundColor({ color: '#DC2626' });
}

/* ---------------------------------------------------------------- 동작 */

async function getState() {
  if (!(await offscreenExists())) return { ok: true, recording: false };
  try {
    return await toOffscreen({ type: 'state' });
  } catch {
    return { ok: true, recording: false };
  }
}

async function startRecording(tabId, title) {
  await ensureOffscreen();

  // 이 호출은 사용자가 확장 아이콘을 눌렀을 때만 허용된다 (activeTab)
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

  const result = await toOffscreen({ type: 'start', streamId, title });
  if (!result || !result.ok) throw new Error(result && result.error ? result.error : '녹음을 시작하지 못했습니다.');

  setBadge(true);
  return { ok: true };
}

function download(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs: true }, (id) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(id);
    });
  });
}

/** 저장이 끝나기 전에 오프스크린을 닫으면 blob 이 사라진다. 끝난 뒤에 닫는다. */
function closeOffscreenWhenDone(downloadId) {
  const onChanged = (delta) => {
    if (delta.id !== downloadId) return;
    const state = delta.state && delta.state.current;
    if (state === 'complete' || state === 'interrupted') {
      chrome.downloads.onChanged.removeListener(onChanged);
      chrome.offscreen.closeDocument().catch(() => { /* 이미 닫혔으면 무시 */ });
    }
  };
  chrome.downloads.onChanged.addListener(onChanged);
}

async function stopRecording() {
  const result = await toOffscreen({ type: 'stop' });
  setBadge(false);

  if (!result || !result.ok) {
    await chrome.offscreen.closeDocument().catch(() => {});
    throw new Error(result && result.error ? result.error : '녹음을 마치지 못했습니다.');
  }

  const id = await download(result.blobUrl, safeName(result.title));
  closeOffscreenWhenDone(id);
  return { ok: true, seconds: result.seconds };
}

/* ---------------------------------------------------------------- 메시지 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return false;

  if (msg.type === 'rec:state') {
    getState().then(sendResponse);
    return true;
  }

  if (msg.type === 'rec:start') {
    startRecording(msg.tabId, msg.title)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'rec:stop') {
    stopRecording()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});
