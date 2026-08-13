/**
 * 페이지(MAIN) 월드 조각 — 현재 영상의 제목과 채널명을 읽어 넘긴다.
 *
 * 유튜브 화면에서 제목·채널명을 CSS 선택자로 긁으면 유튜브가 구조를 바꿀 때마다 깨진다.
 * 플레이어 객체에 직접 물어보는 이 방식이 훨씬 오래 간다.
 */

(() => {
  'use strict';

  const REQ = 'ytshelf:req';
  const RES = 'ytshelf:res';

  function readDetails() {
    try {
      const player = document.querySelector('#movie_player');
      if (player && typeof player.getPlayerResponse === 'function') {
        const res = player.getPlayerResponse();
        if (res && res.videoDetails) return res.videoDetails;
      }
    } catch { /* 아래 대체 경로로 */ }

    const initial = window.ytInitialPlayerResponse;
    return (initial && initial.videoDetails) || null;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== REQ) return;

    let payload = null;
    try {
      const d = readDetails();
      if (d && d.videoId) {
        payload = {
          id: d.videoId,
          title: d.title || '',
          channel: d.author || '',
          channelId: d.channelId || '',
          seconds: Number(d.lengthSeconds || 0),
        };
      }
    } catch { /* payload 는 null 로 둔다 */ }

    window.postMessage({ source: RES, payload }, '*');
  });
})();
