/**
 * 조용한 웹 — 판별 규칙 모음
 *
 * content.js / picker.js 보다 먼저 실행되며, 전역 QW 객체에 규칙을 담는다.
 * 이 파일만 고쳐도 대부분의 오작동은 잡을 수 있게 규칙을 한곳에 모아둔다.
 */

const QW = {};

/* ------------------------------------------------------------------
 * 1) 눌러도 안전한 버튼
 *    - PERSISTENT_CLOSE: 사이트가 기억해주는 버튼. 가장 먼저 누른다.
 *    - SAFE_CLOSE: 단순히 이번만 닫는 버튼.
 * ------------------------------------------------------------------ */

// '오늘 하루 보지 않기' 계열 — 눌러두면 다음에 안 뜨므로 최우선
QW.PERSISTENT_CLOSE = [
  /오늘\s*(하루|만)?\s*(동안)?\s*(그만|안|보지|열지|다시)/,
  /하루\s*(동안)?\s*(그만|안|보지|열지)/,
  /\d+\s*(일|시간|주)\s*(동안)?\s*(그만|안|보지|열지)/,
  /일주일\s*(동안)?\s*(그만|안|보지|열지)/,
  /(다시|그만)\s*(보지|열지|표시하지)\s*(않|말)/,
  /don'?t\s*show\s*(this)?\s*again/i,
  /do\s*not\s*show\s*again/i,
];

// 이번만 닫는 버튼 / 거부·연기 계열
QW.SAFE_CLOSE = [
  /^\s*[×✕✖✗╳xX＋+]\s*$/,
  /닫기/,
  /닫습니다/,
  /^\s*확인\s*하고\s*닫기\s*$/,
  /나중에/,
  /다음에/,
  /괜찮/,
  /^\s*아니(요|오|었)/,
  /사양/,
  /관심\s*없/,
  /필요\s*없/,
  /거부/,
  /^\s*취소\s*$/,
  /건너뛰기/,
  /^\s*그냥\s*(볼|이용|계속)/,
  /웹(으로|에서|사이트로)\s*(계속\s*)?(보기|이용|볼래)/,
  /모바일\s*웹(으로)?\s*(보기|이용)/,
  /필수만/,
  /선택\s*(항목)?\s*거부/,
  /모두\s*거부/,
  /^close$/i,
  /dismiss/i,
  /no,?\s*thanks/i,
  /not\s*now/i,
  /maybe\s*later/i,
  /reject\s*all/i,
  /decline/i,
  /^skip$/i,
  /continue\s*(to|on|in)?\s*(the\s*)?(web|browser|site)/i,
];

/* ------------------------------------------------------------------
 * 2) 절대 자동으로 누르면 안 되는 버튼
 *    이 목록이 이 확장의 안전장치 핵심이다. 함부로 줄이지 말 것.
 *    (쿠키 '동의'처럼 안전한 닫기 버튼이 없는 경우는 누르지 않고 '숨기기'만 한다)
 * ------------------------------------------------------------------ */

QW.NEVER_CLICK = [
  /동의/,
  /수락/,
  /허용/,
  /승인/,
  /^\s*확인\s*$/,
  /계속\s*하기/,
  /결제/,
  /구매/,
  /주문/,
  /장바구니/,
  /신청/,
  /가입/,
  /충전/,
  /송금/,
  /이체/,
  /출금/,
  /삭제/,
  /탈퇴/,
  /해지/,
  /로그인/,
  /로그아웃/,
  /인증/,
  /본인\s*확인/,
  /설치/,
  /다운로드/,
  /앱(으로|에서)\s*(보기|열기|이용)/,
  /^\s*열기\s*$/,
  /구독/,
  /응모/,
  /참여/,
  /accept/i,
  /agree/i,
  /allow/i,
  /confirm/i,
  /^\s*ok\s*$/i,
  /subscribe/i,
  /install/i,
  /download/i,
  /sign\s*(up|in)/i,
  /log\s*in/i,
  /^buy/i,
  /checkout/i,
  /delete/i,
];

/* ------------------------------------------------------------------
 * 3) 아무것도 하지 않을 페이지
 *    결제·인증·금융처럼 잘못 건드리면 손해가 나는 곳은 통째로 건너뛴다.
 * ------------------------------------------------------------------ */

QW.SENSITIVE_URL = [
  /\/(checkout|payment|pay|order|orders|cart|billing|invoice)(\/|$|\?|#)/i,
  /\/(login|signin|sign-in|signup|sign-up|register|auth|oauth|sso|verify)(\/|$|\?|#)/i,
  /(결제|주문서|본인확인|본인인증|계좌)/,
  /nicepay|inicis|kcp|settle|tosspayments|payco|kakaopay|naverpay|paypal|stripe|checkout\.com/i,
];

QW.SENSITIVE_HOST = [
  // 은행 · 증권 · 카드
  /(^|\.)(kbstar|shinhan|wooribank|nonghyup|nhbank|hanabank|ibk|citibank|kakaobank|kbanknow|tossbank|kfcc|epostbank)\./i,
  /(^|\.)(kbcard|samsungcard|hyundaicard|lottecard|hanacard|bccard|shinhancard)\./i,
  /(^|\.)(kiwoom|truefriend|miraeasset|samsungpop|nhqv)\./i,
  // 공공 · 인증
  /\.go\.kr$/i,
  /(^|\.)(hometax|nhis|nts|iros|gov)\./i,
  /(^|\.)(kftc|yessign|signgate|crosscert)\./i,
];

/* ------------------------------------------------------------------
 * 4) 닫기 버튼처럼 생긴 요소 (텍스트가 없는 X 아이콘 대응)
 * ------------------------------------------------------------------ */

QW.CLOSE_SELECTORS = [
  '[class*="close" i]',
  '[id*="close" i]',
  '[class*="dismiss" i]',
  '[aria-label*="close" i]',
  '[aria-label*="닫기"]',
  '[title*="닫기"]',
  '[alt*="닫기"]',
  '[class*="btn-x" i]',
  '[class*="layer-close" i]',
  '[class*="pop-close" i]',
  '[class*="popup-close" i]',
  '[class*="modal-close" i]',
  '[class*="banner-close" i]',
];

/* ------------------------------------------------------------------
 * 5) 광고·안내성 레이어라는 힌트
 *    안전한 닫기 버튼이 없어서 '숨기기'로 처리할 때, 이 힌트가 있어야만 손댄다.
 * ------------------------------------------------------------------ */

QW.PROMO_HINTS = [
  /쿠키/,
  /cookie/i,
  /개인정보.{0,10}(수집|처리|방침)/,
  /맞춤형\s*광고/,
  /앱(으로|에서)/,
  /어플/,
  /설치/,
  /알림\s*(설정|받기|허용)/,
  /푸시/,
  /구독/,
  /뉴스레터/,
  /newsletter/i,
  /이벤트/,
  /쿠폰/,
  /할인/,
  /적립/,
  /첫\s*구매/,
  /회원\s*가입/,
  /배너/,
  /광고/,
  /프로모션/,
  /promo/i,
  /advertis/i,
  /notification/i,
  /subscribe/i,
  /special\s*offer/i,
  /popup/i,
  /modal/i,
  /layer/i,
  /overlay/i,
  /dimmed/i,
  /backdrop/i,
];

/* ------------------------------------------------------------------
 * 6) 절대 건드리지 않을 요소
 *    사이트 자체 UI(헤더/내비게이션)와 이 확장이 만든 UI.
 * ------------------------------------------------------------------ */

QW.SKIP_SELECTORS = [
  'header',
  'nav',
  '[role="banner"]',
  '[role="navigation"]',
  '[role="main"]',
  '[class*="gnb" i]',
  '[class*="lnb" i]',
  '[id*="header" i]',
  '[class*="header" i]',
  '.quietweb-ui',
].join(', ');
