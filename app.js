// ============================================================
// 空き時間ビューア — app.js
// ============================================================
//
// ▼設定（編集者が直接書き換える場所）▼
// -----------------------------------------------------------
const CONFIG = {
  // 公開スプレッドシートのCSV URL（ファイル→共有→ウェブに公開→形式:CSV で発行したもの）
  // 空のままだとサンプルデータが自動表示されます。
  // ★このシートは「name,date,start,end,status,note」の1件1行リスト形式です（旧・日付×時刻の巨大グリッド形式ではありません）
  CSV_URL: 'https://script.google.com/macros/s/AKfycbx_-WATnisOs0lWx3ltkmuWEEaOww6cVkggSBIuTfV15jGpjsqGxXwjSARjZaw3Pf1Vtw/exec',

  // 日時が "8/1 9:00" のように年を省略した書式の場合に使う年
  DEFAULT_YEAR: 2026,

  // グリッドに表示する日付の範囲（この範囲の日付が縦軸に並びます）
  DATE_START: '2026-08-05',
  DATE_END: '2026-08-31',

  // グリッドに表示する時間帯（この範囲外の時刻は表示されません）
  DISPLAY_START: '10:00',
  DISPLAY_END: '22:00',

  // 列の表示順（五十音順など、ここに書いた並び順が優先されます）
  // ここに書かれていない名前は末尾に追加されます
  NAME_ORDER: ['浦上', '後藤', '篠﨑', 'のあ', '安達', '三輪'],

  // スタッフ（色を変えて右端に寄せる）
  STAFF_NAMES: ['安達', '三輪'],
};
// -----------------------------------------------------------

const state = {
  names: [],                 // 人物名の配列
  dates: [],                 // 'YYYY-MM-DD' の配列（昇順、CONFIG.DATE_START〜DATE_ENDから生成）
  // eventsByPersonDate[name][date] = [{start:'HH:MM', end:'HH:MM', status:'busy'|'other', note:''}, ...]
  eventsByPersonDate: {},
  granularity: 'day',
  customBlocks: [],          // {id, start, end, label}
  hiddenNames: new Set(),    // 非表示にしたメンバー名
  collapsedDates: new Set(), // 折りたたんだ日付（'YYYY-MM-DD'）
};

// 新形式（1件1行リスト）のサンプルデータ
const SAMPLE_CSV =
`name,date,start,end,status,note
田中,2026-08-01,10:00,11:30,busy,
田中,2026-08-01,13:00,14:00,busy,
鈴木,2026-08-01,11:00,14:00,busy,
鈴木,2026-08-02,13:00,14:00,busy,
佐藤,2026-08-01,13:00,15:15,busy,
佐藤,2026-08-02,14:00,17:00,other,未定
山本,2026-08-01,13:00,14:00,busy,
山本,2026-08-02,10:00,11:30,busy,
山本,2026-08-03,10:00,12:00,busy,`;

// ---------------- DOM refs ----------------
const el = (id) => document.getElementById(id);
const loadError = el('loadError');
const statusDot = el('statusDot');
const statusText = el('statusText');
const gridPanel = el('gridPanel');
const mainGridTable = el('mainGrid');
const tooltip = el('tooltip');
const addBlockToggle = el('addBlockToggle');
const addBlockBar = el('addBlockBar');
const customChipRow = el('customChipRow');
const customStartSel = el('customStart');
const customEndSel = el('customEnd');
const customLabelInput = el('customLabel');
const memberChipRow = el('memberChipRow');

// ---------------- Helpers ----------------
const pad2 = (n) => String(n).padStart(2, '0');

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function minutesToTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${pad2(h)}:${pad2(m)}`;
}
function endToMinutes(t) {
  return t === '24:00' ? 24 * 60 : timeToMinutes(t);
}

// "YYYY-MM-DD" 柔軟パース（年省略形式にも対応）
function parseDateFlexible(str, defaultYear) {
  str = (str || '').trim();
  let m = str.match(/^(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})日?$/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = str.match(/^(\d{1,2})[\/\-月](\d{1,2})日?$/);
  if (m) return `${defaultYear}-${pad2(m[1])}-${pad2(m[2])}`;
  return null;
}
// "HH:MM" 柔軟パース（"9:5" のような1桁分も許容）。空文字はnull。
function parseTimeFlexible(str) {
  str = (str || '').trim();
  if (str === '') return null;
  if (str === '24:00') return '24:00';
  const m = str.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  return `${pad2(m[1])}:${pad2(m[2])}`;
}

function addDaysToDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function generateDateRange(startStr, endStr) {
  const dates = [];
  let cur = startStr;
  let guard = 0;
  while (cur <= endStr && guard < 3660) {
    dates.push(cur);
    cur = addDaysToDateStr(cur, 1);
    guard++;
  }
  return dates;
}

// ---------------- CSV -> state ----------------
// 期待するヘッダー（日本語/英語どちらでも可）: name/名前, date/日付, start/開始, end/終了, status/状態, note/備考
const HEADER_ALIASES = {
  name: ['name', '名前', '氏名'],
  date: ['date', '日付'],
  start: ['start', '開始'],
  end: ['end', '終了'],
  status: ['status', '状態', 'ステータス'],
  note: ['note', '備考', 'メモ'],
};

function findColumnIndex(header, key) {
  const aliases = HEADER_ALIASES[key];
  for (let i = 0; i < header.length; i++) {
    const h = header[i].toLowerCase();
    if (aliases.some((a) => h === a.toLowerCase())) return i;
  }
  return -1;
}

function ingestCSV(csvText) {
  loadError.hidden = true;
  const defaultYear = CONFIG.DEFAULT_YEAR;
  // 先頭のBOM（見えない文字）を除去してからパースする
  csvText = csvText.replace(/^\uFEFF/, '');
  const parsed = Papa.parse(csvText.trim(), { skipEmptyLines: true });
  const rows = parsed.data;
  if (!rows || rows.length < 1) {
    showError('CSVにデータ行が見つかりませんでした。');
    return false;
  }
  const header = rows[0].map((h) => (h || '').replace(/[\uFEFF\u200B]/g, '').trim());
  const idx = {
    name: findColumnIndex(header, 'name'),
    date: findColumnIndex(header, 'date'),
    start: findColumnIndex(header, 'start'),
    end: findColumnIndex(header, 'end'),
    status: findColumnIndex(header, 'status'),
    note: findColumnIndex(header, 'note'),
  };
  if (idx.name === -1 || idx.date === -1 || idx.start === -1 || idx.end === -1 || idx.status === -1) {
    showError('CSVの列見出しを認識できませんでした。"name,date,start,end,status,note" 形式の列見出しが必要です。');
    return false;
  }

  const eventsByPersonDate = {};
  const nameSet = new Set();
  let parsedCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => (c || '').trim() === '')) continue;

    const name = (r[idx.name] || '').trim();
    const date = parseDateFlexible(r[idx.date] || '', defaultYear);
    let start = parseTimeFlexible(r[idx.start] || '');
    let end = parseTimeFlexible(r[idx.end] || '');
    const statusRaw = (r[idx.status] || '').trim().toLowerCase();
    const note = idx.note !== -1 ? (r[idx.note] || '').trim() : '';

    if (!name || !date) continue;
    if (!start) start = '00:00';
    if (!end) end = '24:00';
    if (endToMinutes(end) <= timeToMinutes(start)) continue; // 不正な範囲はスキップ

    const status = statusRaw === 'busy' || statusRaw === '1' ? 'busy' : 'other';

    nameSet.add(name);
    if (!eventsByPersonDate[name]) eventsByPersonDate[name] = {};
    if (!eventsByPersonDate[name][date]) eventsByPersonDate[name][date] = [];
    eventsByPersonDate[name][date].push({ start, end, status, note });
    parsedCount++;
  }

  if (parsedCount === 0) {
    showError('予定を1件も解析できませんでした。列見出しやデータ形式をご確認ください。');
    return false;
  }

  // 名前一覧: NAME_ORDER + CSVに登場した未知の名前
  const namesFromOrder = (CONFIG.NAME_ORDER || []).filter((n) => nameSet.has(n));
  const extraNames = [...nameSet].filter((n) => !namesFromOrder.includes(n));
  state.names = [...namesFromOrder, ...extraNames];

  state.dates = generateDateRange(CONFIG.DATE_START, CONFIG.DATE_END);
  state.eventsByPersonDate = eventsByPersonDate;
  state.collapsedDates = new Set(state.dates); // デフォルトは全日折りたたみ（一覧性重視）

  statusDot.className = 'status-dot ok';
  statusText.textContent = `読み込み完了：${state.dates.length}日分 × ${state.names.length}人（予定${parsedCount}件）`;
  gridPanel.hidden = false;
  buildCustomTimeOptions();
  renderMemberChips();
  renderMainGrid();
  return true;
}

function showError(msg) {
  loadError.textContent = msg;
  loadError.hidden = false;
  statusDot.className = 'status-dot err';
  statusText.textContent = '読み込みエラー';
}

// ---------------- Aggregation（連続時間ベース） ----------------
// 指定した人・日付・時間帯 [startTime, endTime) の中身を判定する。
// Returns 'red'(全て予定あり) | 'green'(全て空き) | 'other'(全てその他) | 'yellow'(混在)
function getEventsInRange(date, startTime, endTime, name) {
  const events = (state.eventsByPersonDate[name] && state.eventsByPersonDate[name][date]) || [];
  const bStart = timeToMinutes(startTime);
  const bEnd = endToMinutes(endTime);
  const clipped = [];
  events.forEach((ev) => {
    const evStart = Math.max(bStart, timeToMinutes(ev.start));
    const evEnd = Math.min(bEnd, endToMinutes(ev.end));
    if (evEnd > evStart) clipped.push({ startMin: evStart, endMin: evEnd, status: ev.status, note: ev.note });
  });
  clipped.sort((a, b) => a.startMin - b.startMin);
  return { clipped, bStart, bEnd };
}

function aggregate(date, startTime, endTime, name) {
  const { clipped, bStart, bEnd } = getEventsInRange(date, startTime, endTime, name);
  const blockDur = bEnd - bStart;
  if (blockDur <= 0) return { status: 'nodata' };

  let coveredDur = 0;
  const types = new Set();
  clipped.forEach((c) => {
    coveredDur += c.endMin - c.startMin;
    types.add(c.status === 'busy' ? 'busy' : 'other');
  });
  if (coveredDur < blockDur) types.add('free');

  if (types.size === 0) return { status: 'nodata' };
  if (types.size === 1) {
    const t = [...types][0];
    const status = t === 'busy' ? 'red' : t === 'free' ? 'green' : 'other';
    return { status };
  }
  return { status: 'yellow' };
}

// そのブロック内で、ある人の予定(busy)やその他(other)が入っている時間帯を返す
// 例: [{start:'13:00',end:'14:00',value:1}, {start:'14:30',end:'15:15',value:'未定'}]
function getBusyRanges(date, startTime, endTime, name) {
  const { clipped } = getEventsInRange(date, startTime, endTime, name);
  return clipped.map((c) => ({
    start: minutesToTime(c.startMin),
    end: minutesToTime(c.endMin),
    value: c.status === 'busy' ? 1 : (c.note || 'その他'),
  }));
}

// ツールチップ用のテキストを組み立てる
function formatRangeDetail(ranges, status) {
  if (ranges.length === 0) {
    return status === 'nodata' ? 'データなし' : '予定なし（全て空き）';
  }
  return ranges
    .map((r) => (r.value === 1 ? `${r.start}〜${r.end}に予定あり` : `${r.start}〜${r.end}：${r.value}`))
    .join('、');
}

// ---------------- Block definitions per granularity ----------------
// すべて CONFIG.DISPLAY_START 〜 CONFIG.DISPLAY_END の範囲にクリップされる
function blocksForGranularity(g) {
  const dispStart = timeToMinutes(CONFIG.DISPLAY_START);
  const dispEnd = timeToMinutes(CONFIG.DISPLAY_END);

  switch (g) {
    case 'day':
      return [{ label: '終日', start: CONFIG.DISPLAY_START, end: CONFIG.DISPLAY_END }];
    case 'ampm': {
      const noon = 12 * 60;
      const blocks = [];
      if (dispStart < noon) {
        blocks.push({ label: '午前', start: CONFIG.DISPLAY_START, end: minutesToTime(Math.min(noon, dispEnd)) });
      }
      if (dispEnd > noon) {
        blocks.push({ label: '午後', start: minutesToTime(Math.max(noon, dispStart)), end: CONFIG.DISPLAY_END });
      }
      return blocks;
    }
    case 'hour': {
      const arr = [];
      for (let min = dispStart; min < dispEnd; min += 60) {
        const end = Math.min(min + 60, dispEnd);
        arr.push({ label: minutesToTime(min), start: minutesToTime(min), end: minutesToTime(end) });
      }
      return arr;
    }
    case 'half': {
      const arr = [];
      for (let min = dispStart; min < dispEnd; min += 30) {
        const end = Math.min(min + 30, dispEnd);
        arr.push({ label: minutesToTime(min), start: minutesToTime(min), end: minutesToTime(end) });
      }
      return arr;
    }
    case 'quarter': {
      const arr = [];
      for (let min = dispStart; min < dispEnd; min += 15) {
        const end = Math.min(min + 15, dispEnd);
        arr.push({ label: minutesToTime(min), start: minutesToTime(min), end: minutesToTime(end) });
      }
      return arr;
    }
  }
}

// ---------------- Rendering ----------------
// 縦軸 = 選んだ粒度での「日付×時間帯」の行、横軸 = 人の名前の列
function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = ['日', '月', '火', '水', '木', '金', '土'][new Date(y, m - 1, d).getDay()];
  return `${m}/${d} (${dow})`;
}

// CONFIG.NAME_ORDER の並び順に整列。スタッフ(CONFIG.STAFF_NAMES)は常に末尾。
// リストにない名前は、非スタッフなら通常メンバーの末尾に、スタッフならスタッフの末尾に追加。
function getOrderedNames(names) {
  const order = CONFIG.NAME_ORDER || [];
  const staffSet = new Set(CONFIG.STAFF_NAMES || []);
  const known = order.filter((n) => names.includes(n));
  const unknown = names.filter((n) => !order.includes(n));
  const knownNonStaff = known.filter((n) => !staffSet.has(n));
  const knownStaff = known.filter((n) => staffSet.has(n));
  const unknownNonStaff = unknown.filter((n) => !staffSet.has(n));
  const unknownStaff = unknown.filter((n) => staffSet.has(n));
  return [...knownNonStaff, ...unknownNonStaff, ...knownStaff, ...unknownStaff];
}

function isStaff(name) {
  return (CONFIG.STAFF_NAMES || []).includes(name);
}

function renderMainGrid() {
  const presetBlocks = blocksForGranularity(state.granularity);
  const visibleNames = getOrderedNames(state.names.filter((n) => !state.hiddenNames.has(n)));
  const table = mainGridTable;

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.innerHTML = `<th class="corner">日時</th>` +
    visibleNames.map((n) => `<th class="${isStaff(n) ? 'staff-col' : ''}">${n}</th>`).join('');
  thead.appendChild(headRow);

  const tbody = document.createElement('tbody');

  state.dates.forEach((date) => {
    const isCollapsed = state.collapsedDates.has(date);
    appendDateGroupRow(tbody, date, visibleNames, isCollapsed);

    if (!isCollapsed) {
      presetBlocks.forEach((block) => appendBlockRow(tbody, date, block, visibleNames, false));
      state.customBlocks.forEach((block) => appendBlockRow(tbody, date, block, visibleNames, true));
    }
  });

  table.innerHTML = '';
  table.appendChild(thead);
  table.appendChild(tbody);
}

function appendDateGroupRow(tbody, date, visibleNames, isCollapsed) {
  const tr = document.createElement('tr');
  tr.className = 'date-group';

  const th = document.createElement('th');
  th.innerHTML = `<span class="chevron">${isCollapsed ? '▶' : '▼'}</span>${formatDateLabel(date)}`;
  th.addEventListener('click', () => {
    if (state.collapsedDates.has(date)) {
      state.collapsedDates.delete(date);
    } else {
      state.collapsedDates.add(date);
    }
    renderMainGrid();
  });
  tr.appendChild(th);

  if (isCollapsed) {
    // 折りたたみ時は、その日全体（DISPLAY_START〜DISPLAY_END）のミニ状況を人ごとに表示
    visibleNames.forEach((name) => {
      const { status } = aggregate(date, CONFIG.DISPLAY_START, CONFIG.DISPLAY_END, name);
      const td = document.createElement('td');
      td.className = 'cell' + (isStaff(name) ? ' staff-col' : '');
      const box = document.createElement('div');
      box.className = `cellbox mini ${status}`;
      td.appendChild(box);
      td.addEventListener('mousemove', (e) => {
        const ranges = getBusyRanges(date, CONFIG.DISPLAY_START, CONFIG.DISPLAY_END, name);
        showTooltip(e, `${name}：${formatRangeDetail(ranges, status)}`);
      });
      td.addEventListener('mouseleave', hideTooltip);
      tr.appendChild(td);
    });
  } else {
    const spacer = document.createElement('td');
    spacer.className = 'spacer';
    spacer.colSpan = visibleNames.length;
    tr.appendChild(spacer);
  }

  tbody.appendChild(tr);
}

function appendBlockRow(tbody, date, block, visibleNames, isCustom) {
  const tr = document.createElement('tr');
  if (isCustom) tr.className = 'custom-row';
  const th = document.createElement('th');
  th.innerHTML = `<span class="tick"></span>${block.label}`;
  tr.appendChild(th);

  visibleNames.forEach((name) => {
    const { status } = aggregate(date, block.start, block.end, name);
    const td = document.createElement('td');
    td.className = 'cell' + (isStaff(name) ? ' staff-col' : '');
    const box = document.createElement('div');
    box.className = `cellbox ${status}`;
    td.appendChild(box);
    td.addEventListener('mousemove', (e) => {
      const ranges = getBusyRanges(date, block.start, block.end, name);
      showTooltip(e, `${name}：${formatRangeDetail(ranges, status)}`);
    });
    td.addEventListener('mouseleave', hideTooltip);
    tr.appendChild(td);
  });
  tbody.appendChild(tr);
}

function renderCustomChips() {
  customChipRow.innerHTML = '';
  state.customBlocks.forEach((block) => {
    const chip = document.createElement('span');
    chip.className = 'custom-chip';
    chip.innerHTML = `${block.label}<span class="chip-remove" title="削除">×</span>`;
    chip.querySelector('.chip-remove').onclick = () => {
      state.customBlocks = state.customBlocks.filter((b) => b.id !== block.id);
      renderCustomChips();
      renderMainGrid();
    };
    customChipRow.appendChild(chip);
  });
}

function renderMemberChips() {
  memberChipRow.innerHTML = '';
  getOrderedNames(state.names).forEach((name) => {
    const chip = document.createElement('button');
    const isHidden = state.hiddenNames.has(name);
    chip.type = 'button';
    chip.className = 'member-chip' + (isHidden ? ' off' : '') + (isStaff(name) ? ' staff' : '');
    chip.textContent = name;
    chip.title = isHidden ? 'クリックで表示' : 'クリックで非表示';
    chip.addEventListener('click', () => {
      if (state.hiddenNames.has(name)) {
        state.hiddenNames.delete(name);
      } else {
        state.hiddenNames.add(name);
      }
      renderMemberChips();
      renderMainGrid();
    });
    memberChipRow.appendChild(chip);
  });
}

function showTooltip(e, text) {
  tooltip.hidden = false;
  tooltip.style.left = e.clientX + 14 + 'px';
  tooltip.style.top = e.clientY + 14 + 'px';
  tooltip.textContent = text;
}
function hideTooltip() {
  tooltip.hidden = true;
}

// ---------------- Granularity control ----------------
el('granularityControl').addEventListener('click', (e) => {
  const btn = e.target.closest('.gbtn');
  if (!btn) return;
  document.querySelectorAll('.gbtn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  state.granularity = btn.dataset.g;
  renderMainGrid();
});

// ---------------- Expand / collapse all date groups ----------------
el('expandAllBtn').addEventListener('click', () => {
  state.collapsedDates.clear();
  renderMainGrid();
});
el('collapseAllBtn').addEventListener('click', () => {
  state.collapsedDates = new Set(state.dates);
  renderMainGrid();
});

// ---------------- Custom time-block controls (＋ボタン) ----------------
function buildCustomTimeOptions() {
  customStartSel.innerHTML = '';
  customEndSel.innerHTML = '';
  const dispStart = timeToMinutes(CONFIG.DISPLAY_START);
  const dispEnd = timeToMinutes(CONFIG.DISPLAY_END);
  for (let min = dispStart; min <= dispEnd; min += 15) {
    const label = minutesToTime(min);
    const optS = document.createElement('option');
    optS.value = label; optS.textContent = label;
    customStartSel.appendChild(optS);
    const optE = document.createElement('option');
    optE.value = label; optE.textContent = label;
    customEndSel.appendChild(optE);
  }
  customStartSel.value = CONFIG.DISPLAY_START;
  customEndSel.value = CONFIG.DISPLAY_END;
}

addBlockToggle.addEventListener('click', () => {
  addBlockBar.hidden = !addBlockBar.hidden;
  addBlockToggle.classList.toggle('active', !addBlockBar.hidden);
});

el('addBlockBtn').addEventListener('click', () => {
  const start = customStartSel.value;
  const end = customEndSel.value;
  if (timeToMinutes(end) <= timeToMinutes(start)) {
    alert('終了時刻は開始時刻より後にしてください。');
    return;
  }
  const label = (customLabelInput.value || '').trim() || `${start}〜${end}`;
  state.customBlocks.push({ id: Date.now() + Math.random(), start, end, label });
  customLabelInput.value = '';
  addBlockBar.hidden = true;
  addBlockToggle.classList.remove('active');
  renderCustomChips();
  renderMainGrid();
});

// ---------------- Auto-load on startup ----------------
async function autoLoad() {
  if (!CONFIG.CSV_URL) {
    // URL未設定の場合はサンプルデータを表示
    statusText.textContent = 'サンプルデータを表示中（CONFIG.CSV_URL 未設定）';
    ingestCSV(SAMPLE_CSV);
    return;
  }
  statusText.textContent = '読み込み中…';
  try {
    const res = await fetch(CONFIG.CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    ingestCSV(text);
  } catch (err) {
    showError(
      'CSVの読み込みに失敗しました（' + err.message + '）。' +
      'CONFIG.CSV_URL がウェブに公開されたCSV形式のURLか確認してください（app.js冒頭で設定）。'
    );
  }
}

autoLoad();
