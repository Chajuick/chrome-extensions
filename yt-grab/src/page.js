/**
 * 페이지(MAIN) 월드에서 도는 조각.
 *
 * 확장의 콘텐츠 스크립트는 격리된 세계에서 돌기 때문에 유튜브 플레이어 객체를 볼 수 없다.
 * 그래서 이 파일만 MAIN 월드에 넣고, postMessage 로만 bridge.js 와 대화한다.
 * 여기서는 재생 정보를 읽어 필요한 것만 추려서 넘긴다. 다운로드는 하지 않는다.
 */

(() => {
  'use strict';

  const REQ = 'ytgrab:req';
  const RES = 'ytgrab:res';

  /** 유튜브는 화면 전환 시 페이지를 새로 읽지 않으므로, 항상 플레이어에게 현재 영상을 물어본다. */
  function readPlayerResponse() {
    try {
      const player = document.querySelector('#movie_player');
      if (player && typeof player.getPlayerResponse === 'function') {
        const res = player.getPlayerResponse();
        if (res && res.streamingData) return res;
      }
    } catch { /* 아래 대체 경로로 */ }

    // 첫 로드 직후에는 플레이어가 아직 없을 수 있다
    return window.ytInitialPlayerResponse || null;
  }

  function extFor(mime) {
    if (mime === 'audio/mp4') return 'm4a';
    if (mime === 'audio/webm') return 'weba';
    if (mime === 'video/mp4') return 'mp4';
    if (mime === 'video/webm') return 'webm';
    return 'bin';
  }

  function pick(fmt) {
    // url 이 없는 것은 서명이 걸린 스트림이다. 여기서는 다루지 않고 개수만 센다.
    if (!fmt || !fmt.url) return null;
    const mime = String(fmt.mimeType || '').split(';')[0];
    return {
      itag: fmt.itag,
      url: fmt.url,
      mime,
      ext: extFor(mime),
      bitrate: fmt.bitrate || fmt.averageBitrate || 0,
      size: Number(fmt.contentLength || 0),
      quality: fmt.qualityLabel || '',
      hasAudio: mime.startsWith('audio/') || !!fmt.audioQuality,
      hasVideo: mime.startsWith('video/'),
    };
  }

  function build(res) {
    const streaming = res.streamingData || {};
    const details = res.videoDetails || {};

    const progressive = [];
    const audio = [];
    const videoOnly = [];
    let locked = 0;

    for (const fmt of streaming.formats || []) {
      const f = pick(fmt);
      if (!f) { locked += 1; continue; }
      if (f.hasAudio && f.hasVideo) progressive.push(f);
    }

    for (const fmt of streaming.adaptiveFormats || []) {
      const f = pick(fmt);
      if (!f) { locked += 1; continue; }
      if (f.mime.startsWith('audio/')) audio.push(f);
      else if (f.mime.startsWith('video/')) videoOnly.push(f);
    }

    audio.sort((a, b) => b.bitrate - a.bitrate);
    progressive.sort((a, b) => (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0));
    videoOnly.sort((a, b) => (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0));

    return {
      ok: true,
      // SABR: 유튜브가 파일 주소 대신 스트리밍 엔드포인트 하나만 주는 방식.
      // 이 값이 있고 url 을 가진 포맷이 하나도 없으면 이 확장으로는 받을 수 없다.
      sabr: !!streaming.serverAbrStreamingUrl,
      videoId: details.videoId || '',
      title: details.title || '영상',
      author: details.author || '',
      lengthSeconds: Number(details.lengthSeconds || 0),
      isLive: !!details.isLiveContent,
      audio,
      progressive,
      videoOnly,
      locked,
    };
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== REQ) return;

    let payload;
    try {
      const res = readPlayerResponse();
      payload = res ? build(res) : { ok: false, error: 'no-player' };
    } catch (err) {
      payload = { ok: false, error: String(err && err.message ? err.message : err) };
    }
    window.postMessage({ source: RES, payload }, '*');
  });
})();
