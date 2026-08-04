// ============================================================
// 空き時間ビューア — app.js
// ============================================================

const state = {
  names: [],                 // 人物名の配列
  dates: [],                 // 'YYYY-MM-DD' の配列（昇順）
  // slotData[date][time] = { name: 0|1, ... }  time は 'HH:MM' (30分刻み)
  slotData: {},
  granularity: 'day',
  customBlocks: [],          // {id, start, end, label}
};

const SAMPLE_CSV =
`datetime,田中,鈴木,佐藤,山本
2026-08-01 09:00,1,0,0,0
2026-08-01 09:30,1,0,0,0
2026-08-01 10:00,1,1,0,0
2026-08-01 10:30,0,1,0,0
2026-08-01 11:00,0,0,0,0
2026-08-01 11:30,0,0,0,0
2026-08-01 13:00,1,1,1,1
2026-08-01 13:30,1,1,1,1
2026-08-01 14:00,0,1,1,0
2026-08-01 14:30,0,0,1,0
2026-08-02 09:00,0,0,0,0
2026-08-02 09:30,0,0,0,0
2026-08-02 10:00,1,0,0,1
2026-08-02 10:30,1,0,0,1
2026-08-02 11:00,1,1,0,1
2026-08-02 11:30,1,1,0,1
2026-08-02 13:00,0,0,0,0
2026-08-02 13:30,0,0,0,0
2026-08-02 14:00,0,0,1,0
2026-08-02 14:30,0,0,1,0
2026-08-03 09:00,1,1,1,1
2026-08-03 09:30,1,1,1,1
2026-08-03 10:00,1,1,1,1
2026-08-03 10:30,1,1,1,1
2026-08-03 11:00,0,0,0,0
2026-08-03 11:30,0,0,0,0
2026-08-03 13:00,0,1,0,0
2026-08-03 13:30,0,0,0,0
2026-08-03 14:00,0,0,0,1
2026-08-03 14:30,0,0,0,0`;

// ---------------- DOM refs ----------------
const el = (id) => document.getElementById(id);
const sheetUrlInput = el('sheetUrl');
const csvPasteInput = el('csvPaste');
const yearInput = el('yearInput');
const loadError = el('loadError');
const statusDot = el('statusDot');
const statusText = el('statusText');
const gridPanel = el('gridPanel');
const mainGridTable = el('mainGrid');
const addBlockToggle = el('addBlockToggle');
const addBlockBar = el('addBlockBar');
const customChipRow = el('customChipRow');
const customStartSel = el('customStart');
const customEndSel = el('customEnd');
const customLabelInput = el('customLabel');
const tooltip = el('tooltip');

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
  const defaultYear = parseInt(yearInput.value, 10) || new Date().getFullYear();
  const parsed = Papa.parse(csvText.trim(), { skipEmptyLines: true });
  if (parsed.errors && parsed.errors.length) {
    // Papa is lenient; only bail on hard failures
  }
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
      values[name] = raw === '1' || raw.toLowerCase() === 'true' || raw === '○' || raw === '×' ? (raw === '×' ? 0 : 1) : 0;
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

  statusDot.className = 'status-dot ok';
  statusText.textContent = `読み込み完了：${state.dates.length}日分 × ${names.length}人（${parsedCount}コマ）`;
  gridPanel.hidden = false;
  buildCustomTimeOptions();
  renderMainGrid();
  renderCustomChips();
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
// Returns 'red' (全コマ埋まり) | 'yellow' (混在) | 'green' (全コマ空き) | 'nodata', plus busy/total counts
function aggregate(date, startTime, endTime, name) {
  const dayData = state.slotData[date];
  if (!dayData) return { status: 'nodata', busy: 0, total: 0 };

  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime === '24:00' ? '24:00' : endTime);
  let busy = 0, total = 0;

  for (const time in dayData) {
    const tMin = timeToMinutes(time);
    if (tMin < startMin || tMin >= endMin) continue;
    const values = dayData[time];
    if (!(name in values)) continue;
    total++;
    if (values[name] === 1) busy++;
  }

  if (total === 0) return { status: 'nodata', busy: 0, total: 0 };
  if (busy === total) return { status: 'red', busy, total };
  if (busy === 0) return { status: 'green', busy, total };
  return { status: 'yellow', busy, total };
}

// ---------------- Block definitions per granularity ----------------
function blocksForGranularity(g) {
  switch (g) {
    case 'day':
      return [{ label: '終日', start: '00:00', end: '24:00' }];
    case 'ampm':
      return [
        { label: '午前', start: '00:00', end: '12:00' },
        { label: '午後', start: '12:00', end: '24:00' },
      ];
    case 'hour': {
      const arr = [];
      for (let h = 0; h < 24; h++) {
        arr.push({ label: `${pad2(h)}:00`, start: `${pad2(h)}:00`, end: `${pad2(h + 1 === 24 ? 24 : h + 1)}:00` });
      }
      return arr;
    }
    case 'half': {
      const arr = [];
      for (let h = 0; h < 24; h++) {
        for (const m of [0, 30]) {
          const start = `${pad2(h)}:${pad2(m)}`;
          const endMin = h * 60 + m + 30;
          const end = endMin === 24 * 60 ? '24:00' : minutesToTime(endMin);
          arr.push({ label: start, start, end });
        }
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

function renderMainGrid() {
  const presetBlocks = blocksForGranularity(state.granularity);
  const table = mainGridTable;

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.innerHTML = `<th class="corner">日時</th>` + state.names.map((n) => `<th>${n}</th>`).join('');
  thead.appendChild(headRow);

  const tbody = document.createElement('tbody');

  state.dates.forEach((date) => {
    const groupTr = document.createElement('tr');
    groupTr.className = 'date-group';
    groupTr.innerHTML = `<th>${formatDateLabel(date)}</th>` + `<td class="spacer" colspan="${state.names.length}"></td>`;
    tbody.appendChild(groupTr);

    presetBlocks.forEach((block) => appendBlockRow(tbody, date, block, false));
    state.customBlocks.forEach((block) => appendBlockRow(tbody, date, block, true));
  });

  table.innerHTML = '';
  table.appendChild(thead);
  table.appendChild(tbody);
}

function appendBlockRow(tbody, date, block, isCustom) {
  const tr = document.createElement('tr');
  if (isCustom) tr.className = 'custom-row';
  const th = document.createElement('th');
  th.innerHTML = `<span class="tick"></span>${block.label}`;
  tr.appendChild(th);

  state.names.forEach((name) => {
    const { status, busy, total } = aggregate(date, block.start, block.end, name);
    const td = document.createElement('td');
    td.className = 'cell';
    const box = document.createElement('div');
    box.className = `cellbox ${status}`;
    td.appendChild(box);
    td.addEventListener('mousemove', (e) =>
      showTooltip(e, `${formatDateLabel(date)} ${block.label}\n${name}：${busy}/${total} コマ埋まり`)
    );
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

function showTooltip(e, text) {
  tooltip.hidden = false;
  tooltip.style.left = e.clientX + 14 + 'px';
  tooltip.style.top = e.clientY + 14 + 'px';
  tooltip.textContent = text;
}
function hideTooltip() {
  tooltip.hidden = true;
}

// ---------------- Custom block controls ----------------
function buildCustomTimeOptions() {
  customStartSel.innerHTML = '';
  customEndSel.innerHTML = '';
  for (let min = 0; min <= 24 * 60; min += 30) {
    const label = min === 24 * 60 ? '24:00' : minutesToTime(min);
    const optS = document.createElement('option');
    optS.value = label; optS.textContent = label;
    customStartSel.appendChild(optS);
    const optE = document.createElement('option');
    optE.value = label; optE.textContent = label;
    customEndSel.appendChild(optE);
  }
  customStartSel.value = '13:00';
  customEndSel.value = '15:00';
}

el('addBlockToggle').addEventListener('click', () => {
  addBlockBar.hidden = !addBlockBar.hidden;
  addBlockToggle.classList.toggle('active', !addBlockBar.hidden);
});

el('addBlockBtn').addEventListener('click', () => {
  const start = customStartSel.value;
  const end = customEndSel.value;
  if (timeToMinutes(end === '24:00' ? '24:00' : end) <= timeToMinutes(start)) {
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

// ---------------- Granularity control ----------------
el('granularityControl').addEventListener('click', (e) => {
  const btn = e.target.closest('.gbtn');
  if (!btn) return;
  document.querySelectorAll('.gbtn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  state.granularity = btn.dataset.g;
  renderMainGrid();
});

// ---------------- Data source controls ----------------
el('loadUrlBtn').addEventListener('click', async () => {
  const url = sheetUrlInput.value.trim();
  if (!url) { showError('URLを入力してください。'); return; }
  statusText.textContent = '読み込み中…';
  statusDot.className = 'status-dot';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    ingestCSV(text);
  } catch (err) {
    showError('URLからの取得に失敗しました（' + err.message + '）。ブラウザのCORS制限の可能性があります。下のCSV貼り付け欄をお試しください。');
  }
});

el('loadPasteBtn').addEventListener('click', () => {
  const text = csvPasteInput.value.trim();
  if (!text) { showError('CSVを貼り付けてください。'); return; }
  ingestCSV(text);
});

el('loadSampleBtn').addEventListener('click', () => {
  csvPasteInput.value = SAMPLE_CSV;
  yearInput.value = 2026;
  ingestCSV(SAMPLE_CSV);
});
