/**
 * 오디오 워크릿 — 탭에서 나오는 소리를 조각 단위로 넘겨준다.
 *
 * 여기서 받는 건 이미 디코딩이 끝난 PCM 이다.
 * 그래서 이걸 그대로 WAV 로 쓰면 재인코딩이 한 번도 일어나지 않는다.
 */

class TabCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length && input[0] && input[0].length) {
      // 워크릿이 넘겨주는 버퍼는 매번 재사용되므로 복사해서 보낸다
      const copies = input.map((channel) => new Float32Array(channel));
      this.port.postMessage(copies, copies.map((c) => c.buffer));
    }
    return true;   // 계속 살아있게 한다
  }
}

registerProcessor('tab-capture', TabCaptureProcessor);
