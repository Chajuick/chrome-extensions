/**
 * 저장소 계층 — chrome.storage.local 하나만 쓴다.
 * 서버도 계정도 없고, 데이터는 전부 이 브라우저 안에만 있다.
 */

const Shelf = (() => {
  'use strict';

  const KEY = 'ytShelf';

  const DEFAULTS = {
    items: {},              // { [videoId]: item }
    channelTags: {},        // { [channelName]: ["태그", ...] }  저장할 때 자동으로 붙는다
    ui: { open: false, pinned: false, group: 'recent', width: 360 },
  };

  /** 영상 하나의 모양 */
  function makeItem(video, tags) {
    return {
      id: video.id,
      title: video.title || '',
      channel: video.channel || '',
      channelId: video.channelId || '',
      seconds: video.seconds || 0,
      tags: tags || [],
      pinned: false,
      rating: 0,            // 1 = 좋음, -1 = 별로, 0 = 없음
      watchCount: 0,
      lastWatchedAt: 0,
      lastCountedDay: '',
      addedAt: Date.now(),
    };
  }

  async function load() {
    const stored = await chrome.storage.local.get(KEY);
    const data = stored[KEY] || {};
    return {
      items: data.items || {},
      channelTags: data.channelTags || {},
      ui: { ...DEFAULTS.ui, ...(data.ui || {}) },
    };
  }

  async function save(data) {
    await chrome.storage.local.set({ [KEY]: data });
  }

  async function mutate(fn) {
    const data = await load();
    const result = fn(data);
    await save(data);
    return result;
  }

  /* ------------------------------------------------------------ 영상 */

  function add(video, tags) {
    return mutate((data) => {
      const auto = data.channelTags[video.channel] || [];
      const merged = [...new Set([...(tags || []), ...auto])];

      if (data.items[video.id]) {
        // 이미 있으면 태그만 합친다
        const item = data.items[video.id];
        item.tags = [...new Set([...item.tags, ...merged])];
        return item;
      }
      data.items[video.id] = makeItem(video, merged);
      return data.items[video.id];
    });
  }

  function remove(id) {
    return mutate((data) => { delete data.items[id]; });
  }

  function update(id, patch) {
    return mutate((data) => {
      if (data.items[id]) Object.assign(data.items[id], patch);
    });
  }

  /** 하루에 한 번만 센다. 같은 영상을 반복 재생해도 숫자가 부풀지 않게. */
  function countWatch(id) {
    const today = new Date().toISOString().slice(0, 10);
    return mutate((data) => {
      const item = data.items[id];
      if (!item || item.lastCountedDay === today) return false;
      item.watchCount += 1;
      item.lastWatchedAt = Date.now();
      item.lastCountedDay = today;
      return true;
    });
  }

  function setChannelTags(channel, tags) {
    return mutate((data) => {
      if (tags && tags.length) data.channelTags[channel] = tags;
      else delete data.channelTags[channel];
    });
  }

  function setUi(patch) {
    return mutate((data) => { Object.assign(data.ui, patch); });
  }

  /* ------------------------------------------------------------ 공유 */

  const YT_LIMIT = 50;   // watch_videos 가 받아주는 대략적인 상한

  /**
   * 유튜브가 임시 재생목록을 만들어주는 주소.
   * 받는 사람은 확장을 깔지 않아도 링크만 열면 재생목록으로 재생된다.
   */
  function youtubeLink(ids) {
    const list = ids.slice(0, YT_LIMIT).join(',');
    return `https://www.youtube.com/watch_videos?video_ids=${list}`;
  }

  function toBase64Url(bytes) {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(text) {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /**
   * 태그까지 그대로 넘기는 공유 코드.
   * 브라우저에 내장된 압축(deflate-raw)을 써서 외부 라이브러리 없이 줄인다.
   */
  async function encodeShare(items, label) {
    const payload = {
      v: 1,
      label: label || '',
      list: items.map((i) => [i.id, i.title, i.channel, i.tags]),
    };
    const stream = new Blob([JSON.stringify(payload)]).stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    const buffer = await new Response(stream).arrayBuffer();
    return toBase64Url(new Uint8Array(buffer));
  }

  async function decodeShare(code) {
    const bytes = fromBase64Url(code.trim());
    const stream = new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    const text = await new Response(stream).text();
    const payload = JSON.parse(text);
    if (!payload || payload.v !== 1 || !Array.isArray(payload.list)) {
      throw new Error('공유 코드 형식이 아닙니다.');
    }
    return {
      label: payload.label || '',
      list: payload.list.map(([id, title, channel, tags]) => ({
        id, title, channel, channelId: '', seconds: 0, tags: tags || [],
      })),
    };
  }

  /** 공유 코드나 파일에서 받은 목록을 선반에 넣는다. 이미 있으면 태그만 합친다. */
  function importList(list, extraTag) {
    return mutate((data) => {
      let added = 0;
      for (const video of list) {
        if (!video || !video.id) continue;
        const tags = [...new Set([...(video.tags || []), ...(extraTag ? [extraTag] : [])])];
        if (data.items[video.id]) {
          const item = data.items[video.id];
          item.tags = [...new Set([...item.tags, ...tags])];
        } else {
          data.items[video.id] = makeItem(video, tags);
          added += 1;
        }
      }
      return added;
    });
  }

  /* ------------------------------------------------------------ 조회 */

  function allTags(items) {
    const counts = new Map();
    for (const item of Object.values(items)) {
      for (const tag of item.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }

  function thumbnail(id) {
    return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  }

  return {
    KEY,
    load, save,
    add, remove, update, countWatch,
    setChannelTags, setUi,
    youtubeLink, encodeShare, decodeShare, importList,
    allTags, thumbnail,
    YT_LIMIT,
  };
})();
