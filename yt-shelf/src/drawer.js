/**
 * 서랍(drawer) — 유튜브 화면 오른쪽에서 밀려나오는 내 선반.
 *
 * 유튜브 DOM 안쪽에는 아무것도 끼워넣지 않는다. 화면 위에 독립적으로 떠 있을 뿐이라
 * 유튜브가 화면 구조를 바꿔도 깨지지 않는다.
 * 스타일은 Shadow DOM 으로 격리해 유튜브 CSS 와 서로 간섭하지 않게 한다.
 */

(() => {
  'use strict';

  if (window.__ytShelfLoaded) return;
  window.__ytShelfLoaded = true;

  const WATCH_THRESHOLD_SEC = 30;   // 이만큼 봐야 '봤다'로 센다

  let data = null;
  let current = null;      // 지금 보고 있는 영상
  let shadow = null;
  let el = {};             // 자주 쓰는 요소 참조
  let keyword = '';
  let watched = 0;
  let lastHref = '';
  let toastTimer = null;

  /* ---------------------------------------------------------------- 페이지에서 영상 정보 얻기 */

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
      <button class="handle" id="handle">선반 <span class="count" id="count">0</span></button>

      <aside class="panel" id="panel">
        <header class="head">
          <h1>내 선반</h1>
          <button class="icon-btn" id="pin" title="열어둔 채로 고정">📌</button>
          <button class="icon-btn" id="close" title="닫기">✕</button>
        </header>

        <section class="saver" id="saver">
          <div class="now" id="now"></div>
          <div class="line">
            <input type="text" id="tagInput" placeholder="태그 (쉼표로 구분)" />
            <button class="primary" id="save">저장</button>
          </div>
          <button class="link" id="channelRule"></button>
        </section>

        <div class="tools">
          <select id="group">
            <option value="recent">최근 저장순</option>
            <option value="channel">채널별</option>
            <option value="tag">태그별</option>
            <option value="most">많이 본 순</option>
            <option value="unwatched">아직 안 본 것</option>
          </select>
          <input type="text" id="search" placeholder="검색" />
        </div>

        <div class="list" id="list"></div>
        <div class="toast" id="toast"></div>
      </aside>
    </div>
  `;

  async function build() {
    const host = document.createElement('div');
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

    el = {
      handle: shadow.getElementById('handle'),
      count: shadow.getElementById('count'),
      panel: shadow.getElementById('panel'),
      pin: shadow.getElementById('pin'),
      close: shadow.getElementById('close'),
      saver: shadow.getElementById('saver'),
      now: shadow.getElementById('now'),
      tagInput: shadow.getElementById('tagInput'),
      save: shadow.getElementById('save'),
      channelRule: shadow.getElementById('channelRule'),
      group: shadow.getElementById('group'),
      search: shadow.getElementById('search'),
      list: shadow.getElementById('list'),
      toast: shadow.getElementById('toast'),
    };

    wire();
  }

  /* ---------------------------------------------------------------- 알림 */

  function toast(message) {
    el.toast.textContent = message;
    el.toast.dataset.show = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.dataset.show = '0'; }, 2600);
  }

  async function copy(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      toast(message);
    } catch {
      // 클립보드가 막힌 경우를 대비한 대체 경로
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

  /* ---------------------------------------------------------------- 열고 닫기 */

  function paintOpen() {
    const open = !!data.ui.open;
    el.panel.dataset.open = open ? '1' : '0';
    el.handle.dataset.open = open ? '1' : '0';
    el.pin.dataset.on = data.ui.pinned ? '1' : '0';
  }

  async function setOpen(open) {
    data.ui.open = open;
    paintOpen();
    await Shelf.setUi({ open });
  }

  /* ---------------------------------------------------------------- 현재 영상 */

  function isWatchPage() {
    return location.pathname === '/watch';
  }

  async function refreshCurrent() {
    if (!isWatchPage()) {
      current = null;
      el.saver.style.display = 'none';
      return;
    }
    el.saver.style.display = '';
    current = await askPage();

    if (!current) {
      el.now.textContent = '영상 정보를 읽는 중…';
      el.save.disabled = true;
      el.channelRule.textContent = '';
      return;
    }

    const saved = data.items[current.id];
    el.now.textContent = `${current.title}${current.channel ? ` · ${current.channel}` : ''}`;
    el.save.disabled = false;
    el.save.textContent = saved ? '태그 추가' : '저장';

    const auto = data.channelTags[current.channel] || [];
    el.channelRule.textContent = auto.length
      ? `이 채널 자동 태그: ${auto.join(', ')} (바꾸기)`
      : '이 채널 영상에 태그 자동으로 붙이기';
  }

  /* ---------------------------------------------------------------- 시청 세기 */

  function trackWatching() {
    setInterval(async () => {
      if (!isWatchPage() || !current) return;
      if (!data.items[current.id]) return;         // 선반에 없는 건 세지 않는다
      if (document.hidden) return;

      const video = document.querySelector('video');
      if (!video || video.paused || video.ended) return;

      watched += 1;
      if (watched === WATCH_THRESHOLD_SEC) {
        const counted = await Shelf.countWatch(current.id);
        if (counted) {
          data = await Shelf.load();
          renderList();
        }
      }
    }, 1000);
  }

  /* ---------------------------------------------------------------- 목록 */

  function visibleItems() {
    const word = keyword.trim().toLowerCase();
    let list = Object.values(data.items);
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
    switch (data.ui.group) {
      case 'channel': {
        const map = new Map();
        for (const item of list) {
          const key = item.channel || '채널 없음';
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(item);
        }
        return [...map.entries()]
          .sort((a, b) => b[1].length - a[1].length)
          .map(([name, items]) => [name, sortItems(items)]);
      }
      case 'tag': {
        const map = new Map();
        for (const item of list) {
          const keys = item.tags.length ? item.tags : ['태그 없음'];
          for (const key of keys) {
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(item);
          }
        }
        return [...map.entries()]
          .sort((a, b) => b[1].length - a[1].length)
          .map(([name, items]) => [name, sortItems(items)]);
      }
      case 'most':
        return [['많이 본 순', [...list].sort((a, b) => b.watchCount - a.watchCount)]];
      case 'unwatched':
        return [['아직 안 본 것', sortItems(list.filter((i) => i.watchCount === 0))]];
      default:
        return [['최근 저장순', sortItems(list)]];
    }
  }

  function makeCard(item) {
    const card = document.createElement('div');
    card.className = 'card';

    const thumb = document.createElement('img');
    thumb.src = Shelf.thumbnail(item.id);
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.addEventListener('click', () => open(item.id));

    const info = document.createElement('div');
    info.className = 'info';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = item.title || item.id;
    title.title = item.title || '';
    title.addEventListener('click', () => open(item.id));

    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = [item.channel, item.watchCount ? `${item.watchCount}번 봄` : '안 봄']
      .filter(Boolean).join(' · ');

    info.append(title, sub);

    if (item.tags.length) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const tag of item.tags) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = tag;
        chips.appendChild(chip);
      }
      info.appendChild(chips);
    }

    const acts = document.createElement('div');
    acts.className = 'acts';
    acts.append(
      makeAct('📌', item.pinned ? '1' : '0', '맨 위 고정', async () => {
        await Shelf.update(item.id, { pinned: !item.pinned });
        await reload();
      }),
      makeAct(item.rating === -1 ? '👎' : '👍', String(item.rating || 0), '내 평가', async () => {
        const next = item.rating === 1 ? -1 : item.rating === -1 ? 0 : 1;
        await Shelf.update(item.id, { rating: next });
        await reload();
      }),
      makeAct('🗑', '0', '선반에서 빼기', async () => {
        await Shelf.remove(item.id);
        await reload();
      })
    );

    card.append(thumb, info, acts);
    return card;
  }

  function makeAct(label, on, title, onClick) {
    const button = document.createElement('button');
    button.className = 'act';
    button.textContent = label;
    button.title = title;
    button.dataset.on = on;
    button.addEventListener('click', onClick);
    return button;
  }

  function open(id) {
    location.href = `https://www.youtube.com/watch?v=${id}`;
  }

  function renderList() {
    el.count.textContent = String(Object.keys(data.items).length);
    el.list.textContent = '';

    const items = visibleItems();
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = Object.keys(data.items).length
        ? '검색 결과가 없습니다.'
        : '아직 저장한 영상이 없습니다.\n영상을 보다가 위에서 저장을 눌러보세요.';
      empty.style.whiteSpace = 'pre-line';
      el.list.appendChild(empty);
      return;
    }

    for (const [name, group] of groupItems(items)) {
      if (!group.length) continue;

      const head = document.createElement('div');
      head.className = 'group-head';

      const label = document.createElement('span');
      label.className = 'name';
      label.textContent = `${name} (${group.length})`;

      const share = document.createElement('button');
      share.className = 'tiny';
      share.textContent = '공유';
      share.addEventListener('click', () => shareSheet(name, group));

      head.append(label, share);
      el.list.appendChild(head);

      for (const item of group) el.list.appendChild(makeCard(item));
    }
  }

  /* ---------------------------------------------------------------- 공유 */

  function shareSheet(label, items) {
    const ids = items.map((i) => i.id);

    const head = shadow.querySelector('.group-head');
    if (!head) return;

    const menu = document.createElement('div');
    menu.className = 'group-head';

    const link = document.createElement('button');
    link.className = 'tiny';
    link.textContent = `유튜브 링크 (${Math.min(ids.length, Shelf.YT_LIMIT)}개)`;
    link.addEventListener('click', async () => {
      await copy(Shelf.youtubeLink(ids), '링크를 복사했습니다. 상대는 확장 없이도 재생목록으로 봅니다.');
      menu.remove();
    });

    const code = document.createElement('button');
    code.className = 'tiny';
    code.textContent = '공유 코드 (태그까지)';
    code.addEventListener('click', async () => {
      const text = await Shelf.encodeShare(items, label);
      await copy(text, '공유 코드를 복사했습니다. 상대도 이 확장이 있어야 합니다.');
      menu.remove();
    });

    const cancel = document.createElement('button');
    cancel.className = 'tiny';
    cancel.textContent = '취소';
    cancel.addEventListener('click', () => menu.remove());

    menu.append(link, code, cancel);
    el.list.prepend(menu);
  }

  /* ---------------------------------------------------------------- 연결 */

  async function reload() {
    data = await Shelf.load();
    el.group.value = data.ui.group;
    paintOpen();
    renderList();
    await refreshCurrent();
  }

  function wire() {
    el.handle.addEventListener('click', () => setOpen(true));
    el.close.addEventListener('click', () => setOpen(false));

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
      toast('선반에 넣었습니다.');
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
        ? `${current.channel} 영상에는 앞으로 ${tags.join(', ')} 태그가 자동으로 붙습니다.`
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

    // 다른 탭이나 팝업에서 바꾼 내용을 따라간다
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
