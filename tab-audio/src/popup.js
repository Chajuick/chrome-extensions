/**
 * 팝업 — 시작/정지 버튼과 경과 시간만 보여준다.
 *
 * 팝업은 다른 곳을 클릭하면 바로 닫히므로 상태를 여기에 두면 안 된다.
 * 열릴 때마다 서비스 워커에게 현재 상태를 물어본다.
 */

const $ = (id) => document.getElementById(id);

let tab = null;
let recording = false;
let ticking = null;

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function setStatus(text, kind) {
  const el = $('status');
  el.hidden = !text;
  el.textContent = text || '';
  if (kind) el.dataset.kind = kind;
  else delete el.dataset.kind;
}

function paint(state) {
  recording = !!state.recording;

  $('toggle').disabled = false;
  $('toggle').textContent = recording ? '정지하고 저장' : '녹음 시작';
  $('toggle').dataset.state = recording ? 'recording' : 'idle';

  $('timer').hidden = !recording;
  if (recording) {
    $('elapsed').textContent = formatTime(state.seconds || 0);
    $('size').textContent = state.megabytes ? `${state.megabytes}MB` : '';
  }
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: 'rec:state' });
  paint(state || { recording: false });
}

function startTicking() {
  if (ticking) return;
  ticking = setInterval(refresh, 500);
}

function stopTicking() {
  clearInterval(ticking);
  ticking = null;
}

/* ---------------------------------------------------------------- 동작 */

$('toggle').addEventListener('click', async () => {
  $('toggle').disabled = true;
  setStatus('');

  try {
    if (!recording) {
      const result = await chrome.runtime.sendMessage({
        type: 'rec:start',
        tabId: tab.id,
        title: tab.title,
      });
      if (!result || !result.ok) throw new Error(result && result.error ? result.error : '시작 실패');
      startTicking();
      await refresh();
    } else {
      stopTicking();
      setStatus('저장하는 중…');
      const result = await chrome.runtime.sendMessage({ type: 'rec:stop' });
      if (!result || !result.ok) throw new Error(result && result.error ? result.error : '정지 실패');
      setStatus(`${formatTime(result.seconds)} 녹음됨. 저장 위치를 선택하세요.`, 'done');
      await refresh();
    }
  } catch (err) {
    setStatus(`실패: ${err.message}`, 'error');
    $('toggle').disabled = false;
    await refresh();
  }
});

/* ---------------------------------------------------------------- 시작 */

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !/^https?:/.test(tab.url || '')) {
    $('tabTitle').textContent = '일반 웹페이지에서만 녹음할 수 있습니다.';
    return;
  }

  $('tabTitle').textContent = tab.title || '이 탭';

  await refresh();
  if (recording) startTicking();
})();
