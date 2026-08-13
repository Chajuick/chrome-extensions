/**
 * 팝업 — 공유 코드 받기와 백업만 담당한다.
 * 실제 선반은 유튜브 화면의 서랍에서 쓴다.
 */

const $ = (id) => document.getElementById(id);

function setStatus(text, kind) {
  const el = $('status');
  el.hidden = !text;
  el.textContent = text || '';
  if (kind) el.dataset.kind = kind;
  else delete el.dataset.kind;
}

async function refresh() {
  const data = await Shelf.load();
  $('count').textContent = String(Object.keys(data.items).length);
  $('tags').textContent = String(Shelf.allTags(data.items).length);
}

/* ---------------------------------------------------------------- 공유 코드 */

$('import').addEventListener('click', async () => {
  const code = $('code').value.trim();
  if (!code) return;

  try {
    const { label, list } = await Shelf.decodeShare(code);
    const added = await Shelf.importList(list, label);
    $('code').value = '';
    await refresh();
    setStatus(
      added
        ? `${added}개를 선반에 넣었습니다.${label ? ` (${label})` : ''}`
        : '이미 다 가지고 있는 영상이었습니다. 태그만 합쳤습니다.',
      'done'
    );
  } catch (err) {
    setStatus(`읽지 못했습니다: ${err.message}`, 'error');
  }
});

/* ---------------------------------------------------------------- 백업 */

$('export').addEventListener('click', async () => {
  const data = await Shelf.load();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `영상선반-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 10000);
  setStatus('내보냈습니다.', 'done');
});

$('pick').addEventListener('click', () => $('file').click());

$('file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    const list = Object.values(parsed.items || {});
    if (!list.length) throw new Error('영상이 들어있지 않습니다.');

    const added = await Shelf.importList(list, '');
    await refresh();
    setStatus(`${added}개를 선반에 넣었습니다.`, 'done');
  } catch (err) {
    setStatus(`읽지 못했습니다: ${err.message}`, 'error');
  } finally {
    event.target.value = '';
  }
});

refresh();
