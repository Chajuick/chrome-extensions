/**
 * 서비스 워커 — 실제 저장을 담당한다.
 *
 * 두 갈래가 있다.
 *  1) 원본 그대로 저장: 스트림 URL 을 그대로 chrome.downloads 에 넘긴다. 재인코딩이 없어 가장 빠르고 음질 손실도 없다.
 *  2) WAV 로 저장: 서비스 워커에는 오디오 디코더가 없으므로 오프스크린 문서를 띄워 거기서 디코딩한다.
 */

const OFFSCREEN_PATH = 'src/offscreen.html';

/* ---------------------------------------------------------------- 파일명 */

function safeName(name, ext) {
  const cleaned = String(name)
    .replace(/[\\/:*?"<>|]/g, '_')     // 윈도우에서 못 쓰는 글자
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'video';
  return `${cleaned}.${ext}`;
}

/* ---------------------------------------------------------------- 오프스크린 */

let creating = null;

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (existing.length > 0) return;

  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['AUDIO_PLAYBACK', 'BLOBS'],
      justification: '오디오 스트림을 WAV 로 변환하려면 오디오 디코더가 필요합니다.',
    });
  }
  await creating;
  creating = null;
}

/* ---------------------------------------------------------------- 저장 */

function download(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs: true }, (id) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(id);
    });
  });
}

/** 다운로드가 끝나면 blob URL 을 정리한다 (안 하면 메모리에 계속 남는다). */
function revokeWhenDone(downloadId, blobUrl) {
  const onChanged = (delta) => {
    if (delta.id !== downloadId) return;
    if (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
      chrome.downloads.onChanged.removeListener(onChanged);
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'revoke', url: blobUrl })
        .catch(() => { /* 이미 닫혔으면 무시 */ });
    }
  };
  chrome.downloads.onChanged.addListener(onChanged);
}

async function saveOriginal(url, title, ext) {
  const id = await download(url, safeName(title, ext));
  return { ok: true, id };
}

async function saveAsWav(url, title) {
  await ensureOffscreen();

  const result = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'decode',
    url,
  });
  if (!result || !result.ok) {
    throw new Error(result && result.error ? result.error : '변환에 실패했습니다.');
  }

  const id = await download(result.blobUrl, safeName(title, 'wav'));
  revokeWhenDone(id, result.blobUrl);
  return { ok: true, id };
}

/* ---------------------------------------------------------------- 메시지 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return false;   // 오프스크린 앞으로 온 것은 건드리지 않는다

  if (msg.type === 'ytgrab:save') {
    saveOriginal(msg.url, msg.title, msg.ext)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'ytgrab:wav') {
    saveAsWav(msg.url, msg.title)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});
