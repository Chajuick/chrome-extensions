/**
 * 격리된(ISOLATED) 세계에서 도는 다리 역할.
 * 팝업 화면 ↔ page.js 사이에서 메시지만 옮긴다.
 */

(() => {
  'use strict';

  const REQ = 'ytgrab:req';
  const RES = 'ytgrab:res';
  const TIMEOUT_MS = 3000;

  function askPage() {
    return new Promise((resolve) => {
      let done = false;

      const onMessage = (event) => {
        if (event.source !== window) return;
        if (!event.data || event.data.source !== RES) return;
        finish(event.data.payload);
      };

      const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), TIMEOUT_MS);

      function finish(payload) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(payload);
      }

      window.addEventListener('message', onMessage);
      window.postMessage({ source: REQ }, '*');
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'ytgrab:formats') return false;
    askPage().then(sendResponse);
    return true;   // 비동기 응답
  });
})();
