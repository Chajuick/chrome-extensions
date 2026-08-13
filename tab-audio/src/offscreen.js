/**
 * 오프스크린 문서 — 실제 녹음이 일어나는 곳.
 *
 * 서비스 워커에는 getUserMedia 도 AudioContext 도 없다.
 * 그래서 탭 캡처 스트림을 여기로 가져와 PCM 을 모으고, 멈출 때 WAV 로 써서 돌려준다.
 *
 * 중요한 점: 탭을 캡처하면 기본적으로 사용자 스피커로 소리가 안 나간다.
 *           그래서 캡처한 소리를 destination 에 다시 연결해 그대로 들리게 해둔다.
 */

let audioContext = null;
let mediaStream = null;
let chunks = [];          // 인터리브된 Int16Array 조각들
let totalFrames = 0;
let channelCount = 2;
let sampleRate = 48000;
let sourceTitle = '';
let recording = false;

/* ---------------------------------------------------------------- PCM 모으기 */

function pushChunk(channels) {
  if (!recording || !channels.length) return;

  channelCount = channels.length;
  const frames = channels[0].length;
  const interleaved = new Int16Array(frames * channelCount);

  let offset = 0;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channelCount; c += 1) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      interleaved[offset] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      offset += 1;
    }
  }

  chunks.push(interleaved);
  totalFrames += frames;
}

/* ---------------------------------------------------------------- WAV 쓰기 */

function buildWav() {
  const blockAlign = channelCount * 2;
  const dataSize = totalFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);                        // 1 = PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataSize, true);

  const samples = new Int16Array(buffer, 44);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return buffer;
}

/* ---------------------------------------------------------------- 시작 / 정지 */

async function start(streamId, title) {
  if (recording) throw new Error('이미 녹음 중입니다.');

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
  });

  audioContext = new AudioContext();
  await audioContext.audioWorklet.addModule(chrome.runtime.getURL('src/recorder-worklet.js'));

  const source = audioContext.createMediaStreamSource(mediaStream);
  const recorder = new AudioWorkletNode(audioContext, 'tab-capture');
  recorder.port.onmessage = (event) => pushChunk(event.data);

  source.connect(recorder);
  recorder.connect(audioContext.destination);   // 워크릿이 돌게 하려면 연결이 필요하다
  source.connect(audioContext.destination);     // 녹음 중에도 사용자가 소리를 들을 수 있게

  sampleRate = audioContext.sampleRate;
  sourceTitle = title || '녹음';
  chunks = [];
  totalFrames = 0;
  recording = true;

  // 탭이 닫히거나 재생이 끊기면 스트림이 끝난다
  const track = mediaStream.getAudioTracks()[0];
  if (track) track.addEventListener('ended', () => { recording = false; });
}

function stop() {
  recording = false;

  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  if (audioContext) audioContext.close();
  mediaStream = null;
  audioContext = null;

  if (totalFrames === 0) throw new Error('녹음된 소리가 없습니다. 영상이 재생 중인지 확인하세요.');

  const wav = buildWav();
  const blobUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  const seconds = Math.round(totalFrames / sampleRate);

  chunks = [];   // 참조를 끊어 메모리를 돌려준다
  totalFrames = 0;

  return { blobUrl, seconds, title: sourceTitle };
}

function currentState() {
  return {
    recording,
    seconds: Math.round(totalFrames / sampleRate),
    megabytes: Math.round((totalFrames * channelCount * 2) / (1024 * 1024)),
    title: sourceTitle,
  };
}

/* ---------------------------------------------------------------- 메시지 */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;

  if (msg.type === 'start') {
    start(msg.streamId, msg.title)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'stop') {
    try {
      sendResponse({ ok: true, ...stop() });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
    return false;
  }

  if (msg.type === 'state') {
    sendResponse({ ok: true, ...currentState() });
    return false;
  }

  return false;
});
