/**
 * 오프스크린 문서 — 오디오 디코딩 전담.
 *
 * 서비스 워커에는 AudioContext 가 없어서 WAV 변환을 할 수 없다.
 * 여기서 스트림을 받아 디코딩한 뒤 16bit PCM WAV 로 다시 써서 blob URL 을 돌려준다.
 *
 * 참고: 원본은 이미 손실 압축(AAC/Opus)이므로, WAV 로 바꾼다고 음질이 좋아지지는 않는다.
 *       편집 프로그램에 바로 넣기 위한 형식 변환일 뿐이다.
 */

/** AudioBuffer → 16bit PCM WAV (ArrayBuffer) */
function encodeWav(audioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const frameCount = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const blockAlign = channelCount * 2;               // 채널당 2바이트(16bit)
  const dataSize = frameCount * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);                      // fmt 청크 길이
  view.setUint16(20, 1, true);                       // 1 = PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // 초당 바이트
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);                      // 비트 깊이
  writeText(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < channelCount; c += 1) channels.push(audioBuffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frameCount; i += 1) {
    for (let c = 0; c < channelCount; c += 1) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

async function decodeToWav(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`스트림을 받지 못했습니다 (HTTP ${response.status})`);

  const encoded = await response.arrayBuffer();

  const context = new AudioContext();
  try {
    const audioBuffer = await context.decodeAudioData(encoded);
    const wav = encodeWav(audioBuffer);
    return URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  } finally {
    context.close();
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;

  if (msg.type === 'decode') {
    decodeToWav(msg.url)
      .then((blobUrl) => sendResponse({ ok: true, blobUrl }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'revoke') {
    URL.revokeObjectURL(msg.url);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
