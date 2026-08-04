// ============================================================
// 空き時間ビューア — app.js
// ============================================================
//
// ▼設定（編集者が直接書き換える場所）▼
// -----------------------------------------------------------
const CONFIG = {
  // 公開スプレッドシートのCSV URL（ファイル→共有→ウェブに公開→形式:CSV で発行したもの）
  // 空のままだとサンプルデータが自動表示されます。
  CSV_URL: 'https://docs.google.com/spreadsheets/d/18HLCvVCuYxIAHsMJhSyPOqRPmp0bz8xDsdHD6WxEZ8A/export?format=csv&gid=2123979796',

  // 日時が "8/1 9:00" のように年を省略した書式の場合に使う年
  DEFAULT_YEAR: 2026,

  // グリッドに表示する時間帯（この範囲外のデータは表示されません）
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
  dates: [],                 // 'YYYY-MM-DD' の配列（昇順）
  // slotData[date][time] = { name: 0|1, ... }  time は 'HH:MM' (30分刻み)
  slotData: {},
  granularity: 'day',
  customBlocks: [],          // {id, start, end, label}
  hiddenNames: new Set(),    // 非表示にしたメンバー名
  collapsedDates: new Set(), // 折りたたんだ日付（'YYYY-MM-DD'）
};

const SAMPLE_CSV =
`datetime,田中,鈴木,佐藤,山本
2026-08-01 10:00,1,0,0,0
2026-08-01 10:30,1,0,0,0
2026-08-01 11:00,1,1,0,0
2026-08-01 11:30,0,1,0,0
2026-08-01 13:00,1,1,1,1
2026-08-01 13:30,1,1,1,1
2026-08-01 14:00,0,1,1,0
2026-08-01 14:30,0,0,1,0
2026-08-02 10:00,0,0,0,0
2026-08-02 10:30,0,0,0,0
2026-08-02 11:00,1,0,0,1
2026-08-02 11:30,1,0,0,1
2026-08-02 13:00,1,1,0,1
2026-08-02 13:30,1,1,0,1
2026-08-02 14:00,0,0,1,0
2026-08-02 14:30,0,0,1,0
2026-08-03 10:00,1,1,1,1
2026-08-03 10:30,1,1,1,1
2026-08-03 11:00,1,1,1,1
2026-08-03 11:30,1,1,1,1
2026-08-03 13:00,0,1,0,0
2026-08-03 13:30,0,0,0,0
2026-08-03 14:00,0,0,0,1
2026-08-03 14:30,0,0,0,0`;

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

// Parse a combined "datetime" style string into {date:'YYYY-MM-DD', time:'HH:MM'}
function parseCombined(str, defaultYear) {
  str = str.trim();
  let m = str.match(/^(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})日?[ T](\d{1,2}):(\d{2})/);
  if (m) return { date: `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`, time: `${pad2(m[4])}:${m[5]}` };
  m = str.match(/^(\d{1,2})[\/\-月](\d{1,2})日?[ ,　]+(\d{1,2}):(\d{2})/);
  if (m) return { date: `${defaultYear}-${pad2(m[1])}-${pad2(m[2])}`, time: `${pad2(m[3])}:${m[4]}` };
  return null;
}
// Parse a date-only string
function parseDateOnly(str, defaultYear) {
  str = str.trim();
  let m = str.match(/^(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})日?$/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = str.match(/^(\d{1,2})[\/\-月](\d{1,2})日?$/);
  if (m) return `${defaultYear}-${pad2(m[1])}-${pad2(m[2])}`;
  return null;
}
// Parse a time-only string, snapped to nearest 30 min
function parseTimeOnly(str) {
  str = str.trim();
  const m = str.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${pad2(m[1])}:${m[2]}`;
}

// ---------------- CSV -> state ----------------
function ingestCSV(csvText) {
  loadError.hidden = true;
  const defaultYear = CONFIG.DEFAULT_YEAR;
  const parsed = Papa.parse(csvText.trim(), { skipEmptyLines: true });
  const rows = parsed.data;
  if (!rows || rows.length < 2) {
    showError('CSVにデータ行が見つかりませんでした。');
    return false;
  }
  const header = rows[0].map((h) => (h || '').trim());
  if (header.length < 2) {
    showError('CSVの列数が足りません（日時列＋人物名の列が必要です）。');
    return false;
  }

  // Detect format: combined datetime column, or separate date/time columns
  const sampleRow = rows[1];
  const combinedTry = parseCombined(sampleRow[0] || '', defaultYear);
  let mode, nameStartIdx;
  if (combinedTry) {
    mode = 'combined';
    nameStartIdx = 1;
  } else {
    const dateTry = parseDateOnly(sampleRow[0] || '', defaultYear);
    const timeTry = parseTimeOnly(sampleRow[1] || '');
    if (dateTry && timeTry) {
      mode = 'split';
      nameStartIdx = 2;
    } else {
      showError('1列目（および2列目）の日付・時刻形式を認識できませんでした。例: "2026-08-01 09:00" または 日付列と時刻列を分けてください。');
      return false;
    }
  }

  const names = header.slice(nameStartIdx).filter((n) => n.length > 0);
  if (names.length === 0) {
    showError('人物名の列が見つかりませんでした。');
    return false;
  }

  const slotData = {};
  const dateSet = new Set();
  let parsedCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => (c || '').trim() === '')) continue;
    let date, time;
    if (mode === 'combined') {
      const p = parseCombined(r[0] || '', defaultYear);
      if (!p) continue;
      date = p.date; time = p.time;
    } else {
      date = parseDateOnly(r[0] || '', defaultYear);
      time = parseTimeOnly(r[1] || '');
      if (!date || !time) continue;
    }
    dateSet.add(date);
    if (!slotData[date]) slotData[date] = {};
    const values = {};
    names.forEach((name, idx) => {
      const raw = (r[nameStartIdx + idx] || '').toString().trim();
      let v = 0;
      if (raw === '1' || raw.toLowerCase() === 'true' || raw === '○') v = 1;
      else if (raw === '2') v = 2;
      else if (raw === '×') v = 0;
      values[name] = v;
    });
    slotData[date][time] = values;
    parsedCount++;
  }

  if (parsedCount === 0) {
    showError('日時を1件も解析できませんでした。フォーマットをご確認ください。');
    return false;
  }

  state.names = names;
  state.dates = Array.from(dateSet).sort();
  state.slotData = slotData;
  state.collapsedDates = new Set(state.dates); // デフォルトは全日折りたたみ（一覧性重視）

  statusDot.className = 'status-dot ok';
  statusText.textContent = `読み込み完了：${state.dates.length}日分 × ${names.length}人`;
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

// ---------------- Aggregation ----------------
// Aggregates ONE person's 30-min sub-slots within [startTime, endTime) on a given date.
// 値は 0=空き / 1=用事あり / 2=その他(未定など)
// Returns 'red'(全コマ1) | 'green'(全コマ0) | 'other'(全コマ2) | 'yellow'(混在) | 'nodata'
function aggregate(date, startTime, endTime, name) {
  const dayData = state.slotData[date];
  if (!dayData) return { status: 'nodata', total: 0 };

  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime === '24:00' ? '24:00' : endTime);
  const seen = new Set();
  let total = 0;

  for (const time in dayData) {
    const tMin = timeToMinutes(time);
    if (tMin < startMin || tMin >= endMin) continue;
    const values = dayData[time];
    if (!(name in values)) continue;
    total++;
    seen.add(values[name]);
  }

  if (total === 0) return { status: 'nodata', total: 0 };
  if (seen.size === 1) {
    const v = [...seen][0];
    const status = v === 1 ? 'red' : v === 2 ? 'other' : 'green';
    return { status, total };
  }
  return { status: 'yellow', total };
}

// そのブロック内で、ある人の予定(1)やその他(2)が入っている時間帯を連続区間としてまとめて返す
// 同じ種類(1 or 2)が連続する場合のみ1つの区間にまとめる
// 例: 13:00,13:30が1、14:30が2 → [{start:'13:00',end:'14:00',value:1}, {start:'14:30',end:'15:00',value:2}]
function getBusyRanges(date, startTime, endTime, name) {
  const dayData = state.slotData[date];
  if (!dayData) return [];

  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime === '24:00' ? '24:00' : endTime);

  const slots = [];
  for (const time in dayData) {
    const tMin = timeToMinutes(time);
    if (tMin < startMin || tMin >= endMin) continue;
    const v = dayData[time][name];
    if (v === 1 || v === 2) slots.push({ min: tMin, value: v });
  }
  slots.sort((a, b) => a.min - b.min);

  const ranges = [];
  slots.forEach(({ min, value }) => {
    const last = ranges[ranges.length - 1];
    if (last && last.endMin === min && last.value === value) {
      last.endMin = min + 30;
    } else {
      ranges.push({ startMin: min, endMin: min + 30, value });
    }
  });

  return ranges.map((r) => ({ start: minutesToTime(r.startMin), end: minutesToTime(r.endMin), value: r.value }));
}

// ツールチップ用のテキストを組み立てる
function formatRangeDetail(ranges, status) {
  if (ranges.length === 0) {
    return status === 'nodata' ? 'データなし' : '予定なし（全て空き）';
  }
  return ranges
    .map((r) => `${r.start}〜${r.end}${r.value === 2 ? '（その他）' : ''}`)
    .join('、') + 'に予定あり';
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
  for (let min = dispStart; min <= dispEnd; min += 30) {
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
