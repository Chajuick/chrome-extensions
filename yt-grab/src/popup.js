/**
 * 팝업 화면 — 받을 수 있는 형식을 보여주고 고르게 한다.
 *
 * 유튜브 페이지 DOM 에는 손대지 않는다. 유튜브가 화면 구조를 자주 바꾸기 때문에
 * 버튼을 심어두면 금방 깨진다. 확장 아이콘만 누르면 되므로 이쪽이 훨씬 오래 간다.
 */

const $ = (id) => document.getElementById(id);

let info = null;

/* ---------------------------------------------------------------- 표시 도우미 */

function humanSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}GB`;
  if (mb >= 10) return `${Math.round(mb)}MB`;
  return `${mb.toFixed(1)}MB`;
}

function humanTime(seconds) {
  if (!seconds) return '';
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

function row({ label, size, accent, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = accent ? 'row accent' : 'row';

  const name = document.createElement('span');
  name.className = 'label';
  name.textContent = label;
  button.appendChild(name);

  if (size) {
    const s = document.createElement('span');
    s.className = 'size';
    s.textContent = size;
    button.appendChild(s);
  }

  button.addEventListener('click', () => onClick(button));
  return button;
}

function section(title) {
  const h = document.createElement('h2');
  h.textContent = title;
  return h;
}

/* ---------------------------------------------------------------- 저장 요청 */

async function run(button, message, doneText) {
  const buttons = [...document.querySelectorAll('.row')];
  buttons.forEach((b) => { b.disabled = true; });
  setStatus('준비하는 중… 창을 닫아도 계속 진행됩니다.');

  try {
    const result = await chrome.runtime.sendMessage(message);
    if (!result || !result.ok) throw new Error(result && result.error ? result.error : '알 수 없는 오류');
    setStatus(doneText, 'done');
  } catch (err) {
    setStatus(`실패: ${err.message}`, 'error');
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

function saveOriginal(button, fmt) {
  return run(
    button,
    { type: 'ytgrab:save', url: fmt.url, title: info.title, ext: fmt.ext },
    '저장 위치를 선택하면 내려받습니다.'
  );
}

function saveWav(button, fmt) {
  setStatus('변환하는 중… 곡 길이에 따라 시간이 걸립니다.');
  return run(
    button,
    { type: 'ytgrab:wav', url: fmt.url, title: info.title },
    'WAV 변환 완료. 저장 위치를 선택하세요.'
  );
}

/* ---------------------------------------------------------------- 그리기 */

function render() {
  const body = $('body');
  body.innerHTML = '';

  $('title').textContent = info.title;
  $('meta').textContent = [info.author, humanTime(info.lengthSeconds)].filter(Boolean).join(' · ');

  if (info.isLive) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = '실시간 방송은 받을 수 없습니다.';
    body.appendChild(note);
    return;
  }

  // --- 소리 ---
  const bestAudio = info.audio[0];
  if (bestAudio) {
    body.appendChild(section('소리만'));
    body.appendChild(row({
      label: `원본 그대로 (.${bestAudio.ext})`,
      size: humanSize(bestAudio.size),
      accent: true,
      onClick: (b) => saveOriginal(b, bestAudio),
    }));
    body.appendChild(row({
      label: 'WAV 로 변환해서 저장',
      size: '',
      onClick: (b) => saveWav(b, bestAudio),
    }));
  }

  // --- 소리 + 영상 ---
  if (info.progressive.length) {
    body.appendChild(section('영상 + 소리'));
    for (const fmt of info.progressive) {
      body.appendChild(row({
        label: `${fmt.quality || '기본'} (.${fmt.ext})`,
        size: humanSize(fmt.size),
        onClick: (b) => saveOriginal(b, fmt),
      }));
    }
  }

  // --- 고화질(소리 없음) ---
  if (info.videoOnly.length) {
    body.appendChild(section('고화질 · 소리 없음'));
    for (const fmt of info.videoOnly.slice(0, 4)) {
      body.appendChild(row({
        label: `${fmt.quality || '?'} (.${fmt.ext})`,
        size: humanSize(fmt.size),
        onClick: (b) => saveOriginal(b, fmt),
      }));
    }
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = '고화질은 소리가 따로 있어 파일에 소리가 없습니다. 소리를 붙이려면 위의 "소리만"을 같이 받아 편집 프로그램에서 합치세요.';
    body.appendChild(note);
  }

  if (!bestAudio && !info.progressive.length && !info.videoOnly.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '받을 수 있는 스트림이 없습니다.';
    body.appendChild(empty);
  }

  if (info.locked > 0) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = `이 영상은 ${info.locked}개 스트림이 잠겨 있어 목록에서 빠졌습니다.`;
    body.appendChild(note);
  }
}

function fail(message) {
  $('title').textContent = '받을 수 없음';
  $('meta').textContent = '';
  const empty = document.createElement('p');
  empty.className = 'empty';
  empty.textContent = message;
  $('body').appendChild(empty);
}

/* ---------------------------------------------------------------- 시작 */

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !/^https:\/\/www\.youtube\.com\/watch/.test(tab.url || '')) {
    fail('유튜브 영상 페이지에서 눌러주세요.');
    return;
  }

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: 'ytgrab:formats' });
  } catch {
    fail('페이지를 새로고침한 뒤 다시 눌러주세요.');
    return;
  }

  if (!response || !response.ok) {
    fail(response && response.error === 'timeout'
      ? '영상 정보를 읽지 못했습니다. 재생을 시작한 뒤 다시 눌러주세요.'
      : '영상 정보를 읽지 못했습니다.');
    return;
  }

  info = response;
  render();
})();
