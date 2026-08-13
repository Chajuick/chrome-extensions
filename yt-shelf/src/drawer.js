/**
 * 서랍(drawer) — 유튜브 화면 오른쪽의 내 선반.
 *
 * 화면 오른쪽에 색인 탭이 세로로 붙는다. 첫 탭은 언제나 '전체' 이고,
 * 그 아래로 태그마다 탭이 하나씩 색을 달고 붙는다. 탭을 누르면 그 태그의 영상만 보인다.
 *
 * 깨지지 않게 지킨 것
 *  - 유튜브 DOM 안쪽에는 아무것도 끼워넣지 않는다. 화면 위에 독립적으로 떠 있을 뿐이다.
 *  - 스타일은 Shadow DOM 으로 격리한다.
 *  - 제목·채널명은 CSS 선택자로 긁지 않고 플레이어 객체에 직접 물어본다.
 *  - 탭 글자는 가로로 배치한 뒤 박스째 90도 돌린다. 세로쓰기를 쓰면 한글이 한 글자씩 쌓인다.
 */

(() => {
  'use strict';

  if (window.__ytShelfLoaded) return;
  window.__ytShelfLoaded = true;

  const WATCH_THRESHOLD_SEC = 30;   // 이만큼 봐야 '봤다'로 센다
  const TAB_LABEL_MAX = 8;          // 탭에 보일 글자 수 상한

  /* ---------------------------------------------------------------- 아이콘 */

  const P = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
  const ICON = {
    shelf: P('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
    pin: P('<path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.7l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>'),
    up: P('<path d="M7 10v12"/><path d="M15 5.9 14 10h5.8a2 2 0 0 1 2 2.6l-2.4 8a2 2 0 0 1-1.9 1.4H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z"/>'),
    down: P('<path d="M17 14V2"/><path d="M9 18.1 10 14H4.2a2 2 0 0 1-2-2.6l2.4-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.8a2 2 0 0 0-1.8 1.1L12 22a3.1 3.1 0 0 1-3-3.9Z"/>'),
    trash: P('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
    close: P('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    share: P('<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v14"/>'),
    search: P('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
    link: P('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7L12 5.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
    code: P('<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'),
    empty: P('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
  };

  function icon(name, cls) {
    const span = document.createElement('span');
    span.className = cls || 'ico';
    span.innerHTML = ICON[name];   // 코드 안에 고정된 문자열이라 외부 입력이 아니다
    return span;
  }

  /* ---------------------------------------------------------------- 상태 */

  let data = null;
  let current = null;
  let host = null;
  let shadow = null;
  let el = {};
  let keyword = '';
  let watched = 0;
  let lastHref = '';
  let toastTimer = null;

  /* ---------------------------------------------------------------- 페이지 질의 */

  function askPage() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(payload);
      };
      const onMessage = (event) => {
        if (event.source !== window) return;
        if (!event.data || event.data.source !== 'ytshelf:res') return;
        finish(event.data.payload);
      };
      const timer = setTimeout(() => finish(null), 2000);
      window.addEventListener('message', onMessage);
      window.postMessage({ source: 'ytshelf:req' }, '*');
    });
  }

  /* ---------------------------------------------------------------- 뼈대 */

  const TEMPLATE = `
    <div class="wrap">
      <span class="ruler" id="ruler"></span>
      <nav class="tabs" id="tabs"></nav>

      <aside class="panel" id="panel">
        <header class="head">
          <h1 id="heading">내 선반</h1>
          <span class="total" id="total"></span>
          <button class="dot-btn" id="color" title="탭 색 바꾸기" hidden><i></i></button>
          <button class="icon-btn" id="pin" title="열어둔 채로 고정"></button>
          <button class="icon-btn" id="close" title="닫기"></button>
        </header>

        <section class="saver" id="saver">
          <div class="now" id="now"></div>
          <div class="field">
            <input type="text" id="tagInput" placeholder="태그 (쉼표로 구분)" />
            <button class="primary" id="save">저장</button>
          </div>
          <div class="suggest" id="suggest"></div>
          <button class="rule" id="channelRule"></button>
        </section>

        <div class="tools">
          <select id="group">
            <option value="recent">최근 저장순</option>
            <option value="channel">채널별</option>
            <option value="tag">태그별</option>
            <option value="most">많이 본 순</option>
            <option value="unwatched">아직 안 본 것</option>
          </select>
          <label class="search-box">
            <span class="ico" id="searchIcon"></span>
            <input type="text" id="search" placeholder="검색" />
          </label>
        </div>

        <div class="list" id="list"></div>

        <div class="scrim" id="scrim" data-hide="1"></div>
        <div class="sheet" id="sheet" data-hide="1"></div>
        <div class="toast" id="toast"></div>
      </aside>
    </div>
  `;

  async function build() {
    host = document.createElement('div');
    host.id = 'yt-shelf-host';
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';

    shadow = host.attachShadow({ mode: 'open' });

    const css = await fetch(chrome.runtime.getURL('src/drawer.css')).then((r) => r.text());
    const style = document.createElement('style');
    style.textContent = css;

    const holder = document.createElement('div');
    holder.innerHTML = TEMPLATE;

    shadow.append(style, holder.firstElementChild);
    document.documentElement.appendChild(host);

    const id = (name) => shadow.getElementById(name);
    el = {
      ruler: id('ruler'), tabs: id('tabs'), panel: id('panel'),
      heading: id('heading'), total: id('total'), color: id('color'),
      pin: id('pin'), close: id('close'),
      saver: id('saver'), now: id('now'), tagInput: id('tagInput'),
      save: id('save'), suggest: id('suggest'), channelRule: id('channelRule'),
      group: id('group'), search: id('search'), searchIcon: id('searchIcon'),
      list: id('list'), scrim: id('scrim'), sheet: id('sheet'), toast: id('toast'),
    };

    el.pin.appendChild(icon('pin'));
    el.close.appendChild(icon('close'));
    el.searchIcon.innerHTML = ICON.search;

    watchTheme();
    watchFullscreen();
    wire();
  }

  /* ---------------------------------------------------------------- 유튜브 테마 따라가기 */

  /** 유튜브는 어두운 테마일 때 <html> 에 dark 속성을 붙인다. 그걸 그대로 따라간다. */
  function applyTheme() {
    host.dataset.theme = document.documentElement.hasAttribute('dark') ? 'dark' : 'light';
  }

  function watchTheme() {
    applyTheme();
    new MutationObserver(applyTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['dark'],
    });
  }

  /** 전체 화면에서는 서랍이 방해가 되므로 숨긴다 */
  function watchFullscreen() {
    const update = () => { host.style.display = document.fullscreenElement ? 'none' : ''; };
    document.addEventListener('fullscreenchange', update);
    update();
  }

  /* ---------------------------------------------------------------- 알림 */

  function toast(message) {
    el.toast.textContent = message;
    el.toast.dataset.show = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.dataset.show = '0'; }, 2800);
  }

  async function copy(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      toast(message);
    } catch {
      const box = document.createElement('textarea');
      box.value = text;
      box.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand('copy');
      box.remove();
      toast(ok ? message : '복사하지 못했습니다.');
    }
  }

  /* ---------------------------------------------------------------- 시트 */

  function openSheet(build) {
    el.sheet.textContent = '';
    build(el.sheet);

    const cancel = document.createElement('button');
    cancel.className = 'cancel';
    cancel.textContent = '닫기';
    cancel.addEventListener('click', closeSheet);
    el.sheet.appendChild(cancel);

    el.scrim.dataset.hide = '0';
    el.sheet.dataset.hide = '0';
    requestAnimationFrame(() => {
      el.scrim.dataset.show = '1';
      el.sheet.dataset.show = '1';
    });
  }

  function closeSheet() {
    el.scrim.dataset.show = '0';
    el.sheet.dataset.show = '0';
    setTimeout(() => {
      el.scrim.dataset.hide = '1';
      el.sheet.dataset.hide = '1';
    }, 200);
  }

  function sheetTitle(parent, title, lead) {
    const h = document.createElement('h2');
    h.textContent = title;
    parent.appendChild(h);
    if (lead) {
      const p = document.createElement('p');
      p.className = 'lead';
      p.textContent = lead;
      parent.appendChild(p);
    }
  }

  function sheetOption(parent, iconName, title, desc, onClick) {
    const button = document.createElement('button');
    button.className = 'opt';

    const body = document.createElement('span');
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = title;
    const d = document.createElement('span');
    d.className = 'd';
    d.textContent = desc;
    body.append(t, d);

    button.append(icon(iconName), body);
    button.addEventListener('click', onClick);
    parent.appendChild(button);
  }

  /* ---------------------------------------------------------------- 색인 탭 */

  function tagCounts() {
    const counts = new Map();
    for (const item of Object.values(data.items)) {
      for (const tag of item.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return counts;
  }

  /** 회전한 글자가 들어갈 만큼 탭 높이를 정한다. 실제로 글자 폭을 재서 쓴다. */
  function measure(text) {
    el.ruler.textContent = text;
    return Math.min(190, Math.max(52, Math.ceil(el.ruler.getBoundingClientRect().width) + 26));
  }

  function shorten(text) {
    return text.length > TAB_LABEL_MAX ? `${text.slice(0, TAB_LABEL_MAX)}…` : text;
  }

  function makeTab(tag, label, count, color) {
    const active = data.ui.activeTag === tag;
    const text = `${shorten(label)}${count != null ? ` ${count}` : ''}`;

    const button = document.createElement('button');
    button.className = 'tab';
    button.dataset.active = active ? '1' : '0';
    button.style.setProperty('--tab', color);
    button.style.height = `${measure(text)}px`;
    button.title = count != null ? `${label} (${count}개)` : label;

    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = text;
    button.appendChild(lbl);

    button.addEventListener('click', async () => {
      if (data.ui.open && active) { setOpen(false); return; }
      data.ui.activeTag = tag;
      await Shelf.setUi({ activeTag: tag, open: true });
      data.ui.open = true;
      await reload();
    });

    return button;
  }

  function renderTabs() {
    el.tabs.textContent = '';
    el.tabs.dataset.open = data.ui.open ? '1' : '0';

    const total = Object.keys(data.items).length;
    el.tabs.appendChild(makeTab('', '전체', total, 'var(--accent)'));

    const hidden = new Set(data.hiddenTabs);
    const counts = [...tagCounts().entries()]
      .filter(([tag]) => !hidden.has(tag))
      .sort((a, b) => b[1] - a[1]);

    for (const [tag, count] of counts) {
      el.tabs.appendChild(makeTab(tag, tag, count, Shelf.colorFor(tag, data.tagColors)));
    }
  }

  /* ---------------------------------------------------------------- 탭 색 */

  function openColorSheet() {
    const tag = data.ui.activeTag;
    if (!tag) return;

    openSheet((sheet) => {
      sheetTitle(sheet, `${tag} 탭`, '색을 고르면 바로 바뀝니다.');

      const palette = document.createElement('div');
      palette.className = 'palette';
      const now = Shelf.colorFor(tag, data.tagColors);

      for (const color of Shelf.PALETTE) {
        const swatch = document.createElement('button');
        swatch.className = 'swatch';
        swatch.style.background = color;
        swatch.dataset.on = color === now ? '1' : '0';
        swatch.title = color;
        swatch.addEventListener('click', async () => {
          await Shelf.setTagColor(tag, color);
          await reload();
          closeSheet();
        });
        palette.appendChild(swatch);
      }
      sheet.appendChild(palette);

      sheetOption(sheet, 'close', '이 탭 숨기기',
        '선반에서 지우지는 않습니다. 태그별 보기에서 계속 보입니다.', async () => {
          await Shelf.toggleTab(tag);
          data.ui.activeTag = '';
          await Shelf.setUi({ activeTag: '' });
          await reload();
          closeSheet();
          toast(`${tag} 탭을 숨겼습니다.`);
        });
    });
  }

  /* ---------------------------------------------------------------- 열고 닫기 */

  function paintOpen() {
    const open = !!data.ui.open;
    el.panel.dataset.open = open ? '1' : '0';
    el.tabs.dataset.open = open ? '1' : '0';
    el.pin.dataset.on = data.ui.pinned ? '1' : '0';
  }

  async function setOpen(open) {
    data.ui.open = open;
    paintOpen();
    await Shelf.setUi({ open });
  }

  /* ---------------------------------------------------------------- 현재 영상 */

  const isWatchPage = () => location.pathname === '/watch';

  function renderSuggest() {
    el.suggest.textContent = '';
    if (!current) return;

    const counts = [...tagCounts().entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    for (const [tag] of counts) {
      const chip = document.createElement('button');
      chip.className = 'sugg';
      chip.textContent = tag;
      chip.addEventListener('click', () => {
        const now = el.tagInput.value.split(',').map((t) => t.trim()).filter(Boolean);
        if (!now.includes(tag)) now.push(tag);
        el.tagInput.value = now.join(', ');
        el.tagInput.focus();
      });
      el.suggest.appendChild(chip);
    }
  }

  async function refreshCurrent() {
    if (!isWatchPage()) {
      current = null;
      el.saver.hidden = true;
      return;
    }
    el.saver.hidden = false;
    current = await askPage();

    if (!current) {
      el.now.textContent = '영상 정보를 읽는 중…';
      el.save.disabled = true;
      el.channelRule.textContent = '';
      el.suggest.textContent = '';
      return;
    }

    const saved = data.items[current.id];
    el.now.textContent = '';
    const title = document.createElement('b');
    title.textContent = current.title;
    el.now.append(title);
    if (current.channel) el.now.append(document.createTextNode(` · ${current.channel}`));

    el.save.disabled = false;
    el.save.textContent = saved ? '태그 추가' : '저장';

    const auto = data.channelTags[current.channel] || [];
    el.channelRule.textContent = auto.length
      ? `이 채널 자동 태그: ${auto.join(', ')} — 바꾸려면 누르세요`
      : '이 채널 영상에 태그가 자동으로 붙게 하기';

    renderSuggest();
  }

  /* ---------------------------------------------------------------- 시청 세기 */

  function trackWatching() {
    setInterval(async () => {
      if (!isWatchPage() || !current) return;
      if (!data.items[current.id]) return;
      if (document.hidden) return;

      const video = document.querySelector('video');
      if (!video || video.paused || video.ended) return;

      watched += 1;
      if (watched === WATCH_THRESHOLD_SEC) {
        const counted = await Shelf.countWatch(current.id);
        if (counted) {
          data = await Shelf.load();
          renderList();
          renderTabs();
        }
      }
    }, 1000);
  }

  /* ---------------------------------------------------------------- 목록 */

  function visibleItems() {
    const word = keyword.trim().toLowerCase();
    let list = Object.values(data.items);

    if (data.ui.activeTag) list = list.filter((i) => i.tags.includes(data.ui.activeTag));

    if (word) {
      list = list.filter((i) =>
        i.title.toLowerCase().includes(word) ||
        i.channel.toLowerCase().includes(word) ||
        i.tags.some((t) => t.toLowerCase().includes(word))
      );
    }
    return list;
  }

  function sortItems(list) {
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.addedAt - a.addedAt;
    });
  }

  function groupItems(list) {
    const byKey = (keyOf) => {
      const map = new Map();
      for (const item of list) {
        for (const key of keyOf(item)) {
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(item);
        }
      }
      return [...map.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([name, items]) => [name, sortItems(items)]);
    };

    switch (data.ui.group) {
      case 'channel': return byKey((i) => [i.channel || '채널 없음']);
      case 'tag': return byKey((i) => (i.tags.length ? i.tags : ['태그 없음']));
      case 'most': return [['많이 본 순', [...list].sort((a, b) => b.watchCount - a.watchCount)]];
      case 'unwatched': return [['아직 안 본 것', sortItems(list.filter((i) => !i.watchCount))]];
      default: return [['최근 저장순', sortItems(list)]];
    }
  }

  function timeText(seconds) {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  }

  function makeAct(iconName, on, title, onClick) {
    const button = document.createElement('button');
    button.className = 'act';
    button.title = title;
    button.dataset.on = on;
    button.appendChild(icon(iconName));
    button.addEventListener('click', onClick);
    return button;
  }

  function makeCard(item) {
    const card = document.createElement('div');
    card.className = 'card';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.addEventListener('click', () => open(item.id));

    const img = document.createElement('img');
    img.src = Shelf.thumbnail(item.id);
    img.alt = '';
    img.loading = 'lazy';
    thumb.appendChild(img);

    if (item.seconds) {
      const len = document.createElement('span');
      len.className = 'len';
      len.textContent = timeText(item.seconds);
      thumb.appendChild(len);
    }

    const body = document.createElement('div');
    body.className = 'body';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = item.title || item.id;
    title.title = item.title || '';
    title.addEventListener('click', () => open(item.id));

    const meta = document.createElement('div');
    meta.className = 'meta';
    if (item.channel) {
      const ch = document.createElement('span');
      ch.className = 'ch';
      ch.textContent = item.channel;
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.textContent = '·';
      meta.append(ch, dot);
    }
    const seen = document.createElement('span');
    seen.className = 'seen';
    seen.textContent = item.watchCount ? `${item.watchCount}번 봄` : '아직 안 봄';
    if (!item.watchCount) seen.dataset.new = '1';
    meta.appendChild(seen);

    body.append(title, meta);

    if (item.tags.length) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const tag of item.tags) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = tag;
        chips.appendChild(chip);
      }
      body.appendChild(chips);
    }

    const acts = document.createElement('div');
    acts.className = 'acts';
    acts.append(
      makeAct('pin', item.pinned ? '1' : '0', '맨 위 고정', async () => {
        await Shelf.update(item.id, { pinned: !item.pinned });
        await reload();
      }),
      makeAct(item.rating === -1 ? 'down' : 'up', String(item.rating || 0), '내 평가', async () => {
        const next = item.rating === 1 ? -1 : item.rating === -1 ? 0 : 1;
        await Shelf.update(item.id, { rating: next });
        await reload();
      }),
      makeAct('trash', '0', '선반에서 빼기', async () => {
        await Shelf.remove(item.id);
        await reload();
      })
    );

    card.append(thumb, body, acts);
    return card;
  }

  function open(id) {
    location.href = `https://www.youtube.com/watch?v=${id}`;
  }

  function showEmpty(message) {
    const box = document.createElement('div');
    box.className = 'empty';
    box.appendChild(icon('empty'));
    const p = document.createElement('p');
    p.textContent = message;
    p.style.whiteSpace = 'pre-line';
    box.appendChild(p);
    el.list.appendChild(box);
  }

  function renderList() {
    const tag = data.ui.activeTag;
    el.heading.textContent = tag || '내 선반';

    const items = visibleItems();
    el.total.textContent = `${items.length}개`;

    el.color.hidden = !tag;
    if (tag) el.color.style.setProperty('--tab', Shelf.colorFor(tag, data.tagColors));

    el.list.textContent = '';

    if (!items.length) {
      showEmpty(
        Object.keys(data.items).length
          ? '여기에는 아직 없습니다.\n다른 탭을 눌러보세요.'
          : '아직 저장한 영상이 없습니다.\n영상을 보다가 위에서 저장을 눌러보세요.'
      );
      return;
    }

    for (const [name, group] of groupItems(items)) {
      if (!group.length) continue;

      const head = document.createElement('div');
      head.className = 'group';

      const label = document.createElement('span');
      label.className = 'name';
      label.textContent = name;
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = ` ${group.length}`;
      label.appendChild(n);

      const share = document.createElement('button');
      share.className = 'ghost-btn';
      share.append(icon('share'), document.createTextNode('공유'));
      share.addEventListener('click', () => openShareSheet(name, group));

      head.append(label, share);
      el.list.appendChild(head);

      for (const item of group) el.list.appendChild(makeCard(item));
    }
  }

  /* ---------------------------------------------------------------- 공유 */

  function openShareSheet(label, items) {
    const ids = items.map((i) => i.id);
    const capped = Math.min(ids.length, Shelf.YT_LIMIT);

    openSheet((sheet) => {
      sheetTitle(sheet, `${label} 공유`, `${items.length}개`);

      sheetOption(sheet, 'link', `유튜브 링크 (${capped}개)`,
        '상대는 확장을 깔지 않아도 재생목록으로 봅니다. 태그는 넘어가지 않습니다.',
        async () => {
          await copy(Shelf.youtubeLink(ids), '링크를 복사했습니다.');
          closeSheet();
        });

      sheetOption(sheet, 'code', '공유 코드', '태그까지 그대로 넘어갑니다. 상대도 이 확장이 있어야 합니다.',
        async () => {
          const code = await Shelf.encodeShare(items, label);
          await copy(code, '공유 코드를 복사했습니다.');
          closeSheet();
        });
    });
  }

  /* ---------------------------------------------------------------- 연결 */

  async function reload() {
    data = await Shelf.load();
    el.group.value = data.ui.group;
    paintOpen();
    renderTabs();
    renderList();
    await refreshCurrent();
  }

  function wire() {
    el.close.addEventListener('click', () => setOpen(false));
    el.scrim.addEventListener('click', closeSheet);
    el.color.addEventListener('click', openColorSheet);

    el.pin.addEventListener('click', async () => {
      data.ui.pinned = !data.ui.pinned;
      paintOpen();
      await Shelf.setUi({ pinned: data.ui.pinned });
      toast(data.ui.pinned ? '열어둔 채로 고정했습니다.' : '고정을 풀었습니다.');
    });

    el.save.addEventListener('click', async () => {
      if (!current) return;
      const tags = el.tagInput.value.split(',').map((t) => t.trim()).filter(Boolean);
      await Shelf.add(current, tags);
      el.tagInput.value = '';
      await reload();
      toast(tags.length ? `${tags.join(', ')} 탭에 넣었습니다.` : '선반에 넣었습니다.');
    });

    el.tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.save.click();
    });

    el.channelRule.addEventListener('click', async () => {
      if (!current || !current.channel) return;
      const tags = el.tagInput.value.split(',').map((t) => t.trim()).filter(Boolean);
      await Shelf.setChannelTags(current.channel, tags);
      await reload();
      toast(tags.length
        ? `${current.channel} 영상에는 앞으로 ${tags.join(', ')} 가 자동으로 붙습니다.`
        : '이 채널의 자동 태그를 지웠습니다.');
    });

    el.group.addEventListener('change', async () => {
      data.ui.group = el.group.value;
      await Shelf.setUi({ group: data.ui.group });
      renderList();
    });

    el.search.addEventListener('input', () => {
      keyword = el.search.value;
      renderList();
    });

    shadow.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (el.sheet.dataset.hide === '0') closeSheet();
        else if (data.ui.open) setOpen(false);
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[Shelf.KEY]) reload();
    });

    // 유튜브는 페이지를 새로 읽지 않으므로 주소가 바뀌는지 직접 지켜본다
    setInterval(() => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      watched = 0;
      refreshCurrent();
      if (!data.ui.pinned && data.ui.open) setOpen(false);
    }, 700);
  }

  /* ---------------------------------------------------------------- 시작 */

  (async () => {
    data = await Shelf.load();
    await build();
    lastHref = location.href;
    await reload();
    trackWatching();
  })();
})();
