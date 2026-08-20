// ============================================================
// 空き時間ビューア — GitHub Pages frontend
// ============================================================

const CONFIG = {
  GAS_URL:
    'https://script.google.com/macros/s/AKfycbx_-WATnisOs0lWx3ltkmuWEEaOww6cVkggSBIuTfV15jGpjsqGxXwjSARjZaw3Pf1Vtw/exec',
};


const state = {
  eventName: '',
  dates: [],
  names: [],
  rolesByName: {},
  roleDefs: [],
  eventsByPersonDate: {},
  granularity: 'day',
  customBlocks: [],
  hiddenNames: new Set(),
  collapsedDates: new Set(),
  displayStart: '10:00',
  displayEnd: '22:00',
};


const el =
  (id) =>
    document.getElementById(id);


const loadError =
  el('loadError');

const statusDot =
  el('statusDot');

const statusText =
  el('statusText');

const gridPanel =
  el('gridPanel');

const mainGridTable =
  el('mainGrid');

const tooltip =
  el('tooltip');

const addBlockToggle =
  el('addBlockToggle');

const addBlockBar =
  el('addBlockBar');

const customChipRow =
  el('customChipRow');

const customStartSel =
  el('customStart');

const customEndSel =
  el('customEnd');

const customLabelInput =
  el('customLabel');

const memberChipRow =
  el('memberChipRow');


const pad2 =
  (n) =>
    String(n)
      .padStart(
        2,
        '0'
      );


function timeToMinutes(t) {
  const parts =
    String(t)
      .split(':')
      .map(Number);

  return (
    parts[0] * 60 +
    parts[1]
  );
}


function minutesToTime(min) {
  if (
    min >=
    24 * 60
  ) {
    return '24:00';
  }

  return (
    `${pad2(
      Math.floor(
        min / 60
      )
    )}:${pad2(
      min % 60
    )}`
  );
}


function endToMinutes(t) {
  return (
    t === '24:00'
      ? 24 * 60
      : timeToMinutes(t)
  );
}


function addDaysToDateStr(
  dateStr,
  days
) {
  const parts =
    dateStr
      .split('-')
      .map(Number);

  const dt =
    new Date(
      parts[0],
      parts[1] - 1,
      parts[2] + days
    );

  return (
    `${dt.getFullYear()}-` +
    `${pad2(
      dt.getMonth() + 1
    )}-` +
    `${pad2(
      dt.getDate()
    )}`
  );
}


function generateDateRange(
  startStr,
  endStr
) {
  const dates = [];

  let cur =
    startStr;

  let guard =
    0;

  while (
    cur <= endStr &&
    guard < 3660
  ) {
    dates.push(cur);

    cur =
      addDaysToDateStr(
        cur,
        1
      );

    guard++;
  }

  return dates;
}


function getEventNameFromUrl() {
  return (
    new URLSearchParams(
      window.location.search
    ).get('event') ||
    ''
  );
}


function findColumnIndex(
  header,
  names
) {
  const normalized =
    header.map(
      (h) =>
        String(
          h || ''
        )
          .trim()
          .toLowerCase()
    );

  return normalized
    .findIndex(
      (h) =>
        names.some(
          (name) =>
            h ===
            name.toLowerCase()
        )
    );
}


function ingestCSV(csvText) {
  const parsed =
    Papa.parse(
      String(
        csvText || ''
      )
        .replace(
          /^\uFEFF/,
          ''
        )
        .trim(),
      {
        skipEmptyLines:
          true
      }
    );

  const rows =
    parsed.data || [];


  if (
    rows.length === 0
  ) {
    state.names =
      [];

    state.rolesByName =
      {};

    state.eventsByPersonDate =
      {};

    finishLoad(0);

    return;
  }


  const header =
    rows[0].map(
      (h) =>
        String(
          h || ''
        )
          .replace(
            /[\uFEFF\u200B]/g,
            ''
          )
          .trim()
    );


  const idx = {
    name:
      findColumnIndex(
        header,
        [
          'name',
          '名前',
          '氏名'
        ]
      ),

    date:
      findColumnIndex(
        header,
        [
          'date',
          '日付'
        ]
      ),

    start:
      findColumnIndex(
        header,
        [
          'start',
          '開始'
        ]
      ),

    end:
      findColumnIndex(
        header,
        [
          'end',
          '終了'
        ]
      ),

    status:
      findColumnIndex(
        header,
        [
          'status',
          '状態',
          'ステータス'
        ]
      ),

    note:
      findColumnIndex(
        header,
        [
          'note',
          '備考',
          'メモ'
        ]
      ),

    role:
      findColumnIndex(
        header,
        [
          'role',
          '役割'
        ]
      )
  };


  if (
    [
      idx.name,
      idx.date,
      idx.start,
      idx.end,
      idx.status
    ].some(
      (i) =>
        i === -1
    )
  ) {
    throw new Error(
      'CSVの列見出しが不正です。'
    );
  }


  const eventsByPersonDate =
    {};

  const rolesByName =
    {};

  const names =
    [];

  const seen =
    new Set();

  let count =
    0;


  for (
    let i = 1;
    i < rows.length;
    i++
  ) {
    const row =
      rows[i];

    const name =
      String(
        row[idx.name] || ''
      ).trim();

    const date =
      String(
        row[idx.date] || ''
      ).trim();

    const start =
      String(
        row[idx.start] || ''
      ).trim() ||
      '00:00';

    const end =
      String(
        row[idx.end] || ''
      ).trim() ||
      '24:00';

    const statusRaw =
      String(
        row[idx.status] || ''
      )
        .trim()
        .toLowerCase();

    const note =
      idx.note >= 0
        ? String(
            row[idx.note] || ''
          ).trim()
        : '';

    const role =
      idx.role >= 0
        ? String(
            row[idx.role] || ''
          ).trim()
        : '';


    if (
      !name ||
      !date
    ) {
      continue;
    }


    const startMin =
      timeToMinutes(
        start
      );

    const endMin =
      endToMinutes(
        end
      );


    if (
      !Number.isFinite(
        startMin
      ) ||
      !Number.isFinite(
        endMin
      ) ||
      endMin <= startMin
    ) {
      console.warn(
        '不正な予定時刻をスキップ:',
        {
          name,
          date,
          start,
          end
        }
      );

      continue;
    }


    if (
      !seen.has(name)
    ) {
      seen.add(name);
      names.push(name);
    }


    if (
      role &&
      !rolesByName[name]
    ) {
      rolesByName[name] =
        role;
    }


    if (
      !eventsByPersonDate[
        name
      ]
    ) {
      eventsByPersonDate[
        name
      ] = {};
    }


    if (
      !eventsByPersonDate[
        name
      ][date]
    ) {
      eventsByPersonDate[
        name
      ][date] = [];
    }


    eventsByPersonDate[
      name
    ][date].push({
      start:
        start,

      end:
        end,

      status:
        (
          statusRaw === 'busy' ||
          statusRaw === '1'
        )
          ? 'busy'
          : 'other',

      note:
        note
    });

    count++;
  }


  state.names =
    names;

  state.rolesByName =
    rolesByName;

  state.eventsByPersonDate =
    eventsByPersonDate;

  finishLoad(count);
}


function finishLoad(count) {
  state.collapsedDates =
    new Set(
      state.dates
    );

  statusDot.className =
    'status-dot ok';

  statusText.textContent =
    `読み込み完了：${state.dates.length}日分 × ${state.names.length}人（予定${count}件）`;

  loadError.hidden =
    true;

  gridPanel.hidden =
    false;

  buildCustomTimeOptions();
  renderMemberChips();
  renderMainGrid();
}


function showError(msg) {
  loadError.textContent =
    msg;

  loadError.hidden =
    false;

  statusDot.className =
    'status-dot err';

  statusText.textContent =
    '読み込みエラー';
}


// ------------------------------------------------------------
// 色判定
// ------------------------------------------------------------

function aggregate(
  date,
  startTime,
  endTime,
  name
) {
  const bStart =
    timeToMinutes(
      startTime
    );

  const bEnd =
    endToMinutes(
      endTime
    );

  if (
    bEnd <= bStart
  ) {
    return {
      status: 'nodata'
    };
  }


  const events =
    (
      (
        state.eventsByPersonDate[
          name
        ] || {}
      )[date] || []
    )
      .map(
        (ev) => ({
          start:
            Math.max(
              bStart,
              timeToMinutes(
                ev.start
              )
            ),

          end:
            Math.min(
              bEnd,
              endToMinutes(
                ev.end
              )
            ),

          status:
            ev.status
        })
      )
      .filter(
        (ev) =>
          ev.end >
          ev.start
      );


  const boundaries =
    new Set([
      bStart,
      bEnd
    ]);

  events.forEach(
    (ev) => {
      boundaries.add(
        ev.start
      );

      boundaries.add(
        ev.end
      );
    }
  );


  const points =
    [
      ...boundaries
    ].sort(
      (a, b) =>
        a - b
    );


  const types =
    new Set();


  for (
    let i = 0;
    i < points.length - 1;
    i++
  ) {
    const s =
      points[i];

    const e =
      points[i + 1];

    if (
      e <= s
    ) {
      continue;
    }


    const covering =
      events.filter(
        (ev) =>
          ev.start < e &&
          ev.end > s
      );


    if (
      covering.length === 0
    ) {
      types.add(
        'free'
      );

    } else {
      covering.forEach(
        (ev) =>
          types.add(
            ev.status === 'busy'
              ? 'busy'
              : 'other'
          )
      );
    }
  }


  if (
    types.size === 1
  ) {
    const type =
      [
        ...types
      ][0];

    if (
      type === 'busy'
    ) {
      return {
        status: 'red'
      };
    }

    if (
      type === 'other'
    ) {
      return {
        status: 'other'
      };
    }

    return {
      status: 'green'
    };
  }


  return {
    status: 'yellow'
  };
}


function getBusyRanges(
  date,
  startTime,
  endTime,
  name
) {
  const bStart =
    timeToMinutes(
      startTime
    );

  const bEnd =
    endToMinutes(
      endTime
    );

  return (
    (
      (
        state.eventsByPersonDate[
          name
        ] || {}
      )[date] || []
    )
  )
    .map(
      (ev) => ({
        startMin:
          Math.max(
            bStart,
            timeToMinutes(
              ev.start
            )
          ),

        endMin:
          Math.min(
            bEnd,
            endToMinutes(
              ev.end
            )
          ),

        status:
          ev.status,

        note:
          ev.note
      })
    )
    .filter(
      (ev) =>
        ev.endMin >
        ev.startMin
    )
    .sort(
      (a, b) =>
        a.startMin -
        b.startMin
    )
    .map(
      (ev) => ({
        start:
          minutesToTime(
            ev.startMin
          ),

        end:
          minutesToTime(
            ev.endMin
          ),

        value:
          ev.status === 'busy'
            ? 1
            : (
                ev.note ||
                'その他'
              )
      })
    );
}


function formatRangeDetail(
  ranges
) {
  if (
    ranges.length === 0
  ) {
    return (
      '予定なし（全て空き）'
    );
  }

  return ranges
    .map(
      (r) =>
        r.value === 1
          ? (
              `${r.start}〜${r.end}に予定あり`
            )
          : (
              `${r.start}〜${r.end}：${r.value}`
            )
    )
    .join('、');
}


// ------------------------------------------------------------
// 表示時間ブロック
// ------------------------------------------------------------

function blocksForGranularity(g) {
  const dispStart =
    timeToMinutes(
      state.displayStart
    );

  const dispEnd =
    endToMinutes(
      state.displayEnd
    );


  if (
    g === 'day'
  ) {
    return [{
      label:
        '終日',

      start:
        state.displayStart,

      end:
        state.displayEnd
    }];
  }


  if (
    g === 'ampm'
  ) {
    const noon =
      12 * 60;

    const blocks =
      [];

    if (
      dispStart < noon
    ) {
      blocks.push({
        label:
          '午前',

        start:
          state.displayStart,

        end:
          minutesToTime(
            Math.min(
              noon,
              dispEnd
            )
          )
      });
    }

    if (
      dispEnd > noon
    ) {
      blocks.push({
        label:
          '午後',

        start:
          minutesToTime(
            Math.max(
              noon,
              dispStart
            )
          ),

        end:
          state.displayEnd
      });
    }

    return blocks;
  }


  const step =
    g === 'hour'
      ? 60
      : g === 'half'
        ? 30
        : 15;


  const blocks =
    [];


  for (
    let min = dispStart;
    min < dispEnd;
    min += step
  ) {
    const end =
      Math.min(
        min + step,
        dispEnd
      );

    blocks.push({
      label:
        minutesToTime(
          min
        ),

      start:
        minutesToTime(
          min
        ),

      end:
        minutesToTime(
          end
        )
    });
  }

  return blocks;
}


function formatDateLabel(dateStr) {
  const parts =
    dateStr
      .split('-')
      .map(Number);

  const dow =
    [
      '日',
      '月',
      '火',
      '水',
      '木',
      '金',
      '土'
    ][
      new Date(
        parts[0],
        parts[1] - 1,
        parts[2]
      ).getDay()
    ];

  return (
    `${parts[1]}/${parts[2]} (${dow})`
  );
}


// ------------------------------------------------------------
// ロール
// ------------------------------------------------------------

function roleGroup(name) {
  const role =
    state.rolesByName[
      name
    ] || '';

  // ロールなしは金
  if (!role) {
    return 'staff';
  }

  const def =
    state.roleDefs.find(
      (r) =>
        r.name === role
    );

  // 定義不明でも金
  return (
    def
      ? def.group
      : 'staff'
  );
}


function groupRank(name) {
  const group =
    roleGroup(name);

  return (
    group === 'staff'
      ? 2
      : group === 'tbd'
        ? 1
        : 0
  );
}


function getOrderedNames(names) {
  return names
    .map(
      (name, i) => ({
        name,
        i,
        rank:
          groupRank(name)
      })
    )
    .sort(
      (a, b) =>
        a.rank -
          b.rank ||
        a.i -
          b.i
    )
    .map(
      (x) =>
        x.name
    );
}


function nameColClass(name) {
  const group =
    roleGroup(name);

  return (
    group === 'staff'
      ? 'staff-col'
      : group === 'tbd'
        ? 'tbd-col'
        : ''
  );
}


function nameChipClass(name) {
  const group =
    roleGroup(name);

  return (
    group === 'staff'
      ? 'staff'
      : group === 'tbd'
        ? 'tbd'
        : ''
  );
}


// ------------------------------------------------------------
// 入力ページURL
// ------------------------------------------------------------

function inputUrl(params) {
  const url =
    new URL(
      CONFIG.GAS_URL
    );

  url.searchParams.set(
    'page',
    'input'
  );

  url.searchParams.set(
    'event',
    state.eventName
  );

  Object.entries(
    params || {}
  ).forEach(
    ([k, v]) =>
      url.searchParams.set(
        k,
        v
      )
  );

  return url.toString();
}


// ------------------------------------------------------------
// Grid
// ------------------------------------------------------------

function renderMainGrid() {
  const presetBlocks =
    blocksForGranularity(
      state.granularity
    );

  const visibleNames =
    getOrderedNames(
      state.names.filter(
        (n) =>
          !state.hiddenNames.has(
            n
          )
      )
    );


  const thead =
    document.createElement(
      'thead'
    );

  const headRow =
    document.createElement(
      'tr'
    );


  headRow.innerHTML =
    `<th class="corner">日時</th>` +

    visibleNames
      .map(
        (name) =>
          `<th class="${nameColClass(name)}"><a href="${inputUrl({
            name: name
          })}">${name}</a></th>`
      )
      .join('') +

    `<th class="add-col"><a href="${inputUrl({
      new: '1'
    })}" title="新しいメンバーを追加">＋</a></th>`;


  thead.appendChild(
    headRow
  );


  const tbody =
    document.createElement(
      'tbody'
    );


  state.dates.forEach(
    (date) => {
      const isCollapsed =
        state.collapsedDates.has(
          date
        );

      appendDateGroupRow(
        tbody,
        date,
        visibleNames,
        isCollapsed
      );

      if (!isCollapsed) {
        presetBlocks.forEach(
          (block) =>
            appendBlockRow(
              tbody,
              date,
              block,
              visibleNames,
              false
            )
        );

        state.customBlocks.forEach(
          (block) =>
            appendBlockRow(
              tbody,
              date,
              block,
              visibleNames,
              true
            )
        );
      }
    }
  );


  mainGridTable.innerHTML =
    '';

  mainGridTable.appendChild(
    thead
  );

  mainGridTable.appendChild(
    tbody
  );
}


function appendDateGroupRow(
  tbody,
  date,
  visibleNames,
  isCollapsed
) {
  const tr =
    document.createElement(
      'tr'
    );

  tr.className =
    'date-group';


  const th =
    document.createElement(
      'th'
    );

  th.innerHTML =
    `<span class="chevron">${isCollapsed ? '▶' : '▼'}</span>${formatDateLabel(date)}`;

  th.addEventListener(
    'click',
    () => {
      if (
        state.collapsedDates.has(
          date
        )
      ) {
        state.collapsedDates.delete(
          date
        );

      } else {
        state.collapsedDates.add(
          date
        );
      }

      renderMainGrid();
    }
  );

  tr.appendChild(th);


  if (
    isCollapsed
  ) {
    visibleNames.forEach(
      (name) => {
        const result =
          aggregate(
            date,
            state.displayStart,
            state.displayEnd,
            name
          );

        const td =
          document.createElement(
            'td'
          );

        const columnClass =
          nameColClass(
            name
          );

        td.className =
          'cell' +
          (
            columnClass
              ? ' ' +
                columnClass
              : ''
          );

        const box =
          document.createElement(
            'div'
          );

        box.className =
          `cellbox mini ${result.status}`;

        td.appendChild(box);

        td.addEventListener(
          'mousemove',
          (e) =>
            showTooltip(
              e,
              `${name}：${formatRangeDetail(
                getBusyRanges(
                  date,
                  state.displayStart,
                  state.displayEnd,
                  name
                )
              )}`
            )
        );

        td.addEventListener(
          'mouseleave',
          hideTooltip
        );

        tr.appendChild(td);
      }
    );

    // ＋列用
    tr.appendChild(
      document.createElement(
        'td'
      )
    );

  } else {
    const spacer =
      document.createElement(
        'td'
      );

    spacer.className =
      'spacer';

    spacer.colSpan =
      visibleNames.length +
      1;

    tr.appendChild(
      spacer
    );
  }

  tbody.appendChild(
    tr
  );
}


function appendBlockRow(
  tbody,
  date,
  block,
  visibleNames,
  isCustom
) {
  const tr =
    document.createElement(
      'tr'
    );

  if (
    isCustom
  ) {
    tr.className =
      'custom-row';
  }

  const th =
    document.createElement(
      'th'
    );

  th.innerHTML =
    `<span class="tick"></span>${block.label}`;

  tr.appendChild(th);


  visibleNames.forEach(
    (name) => {
      const result =
        aggregate(
          date,
          block.start,
          block.end,
          name
        );

      const td =
        document.createElement(
          'td'
        );

      const columnClass =
        nameColClass(
          name
        );

      td.className =
        'cell' +
        (
          columnClass
            ? ' ' +
              columnClass
            : ''
        );

      const box =
        document.createElement(
          'div'
        );

      box.className =
        `cellbox ${result.status}`;

      td.appendChild(box);

      td.addEventListener(
        'mousemove',
        (e) =>
          showTooltip(
            e,
            `${name}：${formatRangeDetail(
              getBusyRanges(
                date,
                block.start,
                block.end,
                name
              )
            )}`
          )
      );

      td.addEventListener(
        'mouseleave',
        hideTooltip
      );

      tr.appendChild(td);
    }
  );

  tr.appendChild(
    document.createElement(
      'td'
    )
  );

  tbody.appendChild(
    tr
  );
}


// ------------------------------------------------------------
// UI
// ------------------------------------------------------------

function renderCustomChips() {
  customChipRow.innerHTML =
    '';

  state.customBlocks.forEach(
    (block) => {
      const chip =
        document.createElement(
          'span'
        );

      chip.className =
        'custom-chip';

      chip.innerHTML =
        `${block.label}<span class="chip-remove" title="削除">×</span>`;

      chip
        .querySelector(
          '.chip-remove'
        )
        .onclick =
          () => {
            state.customBlocks =
              state.customBlocks.filter(
                (b) =>
                  b.id !==
                  block.id
              );

            renderCustomChips();
            renderMainGrid();
          };

      customChipRow.appendChild(
        chip
      );
    }
  );
}


function renderMemberChips() {
  memberChipRow.innerHTML =
    '';

  getOrderedNames(
    state.names
  ).forEach(
    (name) => {
      const chip =
        document.createElement(
          'button'
        );

      const isHidden =
        state.hiddenNames.has(
          name
        );

      chip.type =
        'button';

      chip.className =
        'member-chip' +
        (
          isHidden
            ? ' off'
            : ''
        ) +
        (
          nameChipClass(name)
            ? ' ' +
              nameChipClass(name)
            : ''
        );

      chip.textContent =
        name;

      chip.title =
        isHidden
          ? 'クリックで表示'
          : 'クリックで非表示';

      chip.addEventListener(
        'click',
        () => {
          if (
            state.hiddenNames.has(
              name
            )
          ) {
            state.hiddenNames.delete(
              name
            );

          } else {
            state.hiddenNames.add(
              name
            );
          }

          renderMemberChips();
          renderMainGrid();
        }
      );

      memberChipRow.appendChild(
        chip
      );
    }
  );
}


function showTooltip(
  e,
  text
) {
  tooltip.hidden =
    false;

  tooltip.style.left =
    e.clientX +
    14 +
    'px';

  tooltip.style.top =
    e.clientY +
    14 +
    'px';

  tooltip.textContent =
    text;
}


function hideTooltip() {
  tooltip.hidden =
    true;
}


function buildCustomTimeOptions() {
  customStartSel.innerHTML =
    '';

  customEndSel.innerHTML =
    '';

  const start =
    timeToMinutes(
      state.displayStart
    );

  const end =
    endToMinutes(
      state.displayEnd
    );

  for (
    let min = start;
    min <= end;
    min += 15
  ) {
    const label =
      minutesToTime(
        min
      );

    customStartSel.appendChild(
      new Option(
        label,
        label
      )
    );

    customEndSel.appendChild(
      new Option(
        label,
        label
      )
    );
  }

  customStartSel.value =
    state.displayStart;

  customEndSel.value =
    state.displayEnd;
}


el(
  'granularityControl'
).addEventListener(
  'click',
  (e) => {
    const btn =
      e.target.closest(
        '.gbtn'
      );

    if (!btn) {
      return;
    }

    document
      .querySelectorAll(
        '.gbtn'
      )
      .forEach(
        (b) =>
          b.classList.remove(
            'active'
          )
      );

    btn.classList.add(
      'active'
    );

    state.granularity =
      btn.dataset.g;

    renderMainGrid();
  }
);


el(
  'expandAllBtn'
).addEventListener(
  'click',
  () => {
    state.collapsedDates.clear();
    renderMainGrid();
  }
);


el(
  'collapseAllBtn'
).addEventListener(
  'click',
  () => {
    state.collapsedDates =
      new Set(
        state.dates
      );

    renderMainGrid();
  }
);


addBlockToggle.addEventListener(
  'click',
  () => {
    addBlockBar.hidden =
      !addBlockBar.hidden;

    addBlockToggle
      .classList
      .toggle(
        'active',
        !addBlockBar.hidden
      );
  }
);


el(
  'addBlockBtn'
).addEventListener(
  'click',
  () => {
    const start =
      customStartSel.value;

    const end =
      customEndSel.value;

    if (
      endToMinutes(end) <=
      timeToMinutes(start)
    ) {
      alert(
        '終了時刻は開始時刻より後にしてください。'
      );

      return;
    }

    const label =
      customLabelInput
        .value
        .trim() ||
      `${start}〜${end}`;

    state.customBlocks.push({
      id:
        `${Date.now()}-${Math.random()}`,

      start:
        start,

      end:
        end,

      label:
        label
    });

    customLabelInput.value =
      '';

    addBlockBar.hidden =
      true;

    addBlockToggle
      .classList
      .remove(
        'active'
      );

    renderCustomChips();
    renderMainGrid();
  }
);


// ------------------------------------------------------------
// Load
// ------------------------------------------------------------

async function autoLoad() {
  state.eventName =
    getEventNameFromUrl();

  if (
    !state.eventName
  ) {
    showError(
      'イベントが指定されていません。予定表のURLを確認してください。'
    );

    return;
  }

  statusText.textContent =
    '読み込み中…';

  try {
    const metaUrl =
      new URL(
        CONFIG.GAS_URL
      );

    metaUrl.searchParams.set(
      'page',
      'meta'
    );

    metaUrl.searchParams.set(
      'event',
      state.eventName
    );


    const csvUrl =
      new URL(
        CONFIG.GAS_URL
      );

    csvUrl.searchParams.set(
      'event',
      state.eventName
    );


    // GAS側やブラウザ側に空のCSVがキャッシュされないよう毎回URLを変える
    const cacheBust =
      Date.now()
        .toString();

    metaUrl.searchParams.set(
      '_ts',
      cacheBust
    );

    csvUrl.searchParams.set(
      '_ts',
      cacheBust
    );


    const responses =
      await Promise.all([
        fetch(
          metaUrl,
          {
            cache:
              'no-store'
          }
        ),

        fetch(
          csvUrl,
          {
            cache:
              'no-store'
          }
        )
      ]);

    const metaRes =
      responses[0];

    const csvRes =
      responses[1];


    if (
      !metaRes.ok
    ) {
      throw new Error(
        `メタ情報 HTTP ${metaRes.status}`
      );
    }

    if (
      !csvRes.ok
    ) {
      throw new Error(
        `予定データ HTTP ${csvRes.status}`
      );
    }


    const meta =
      await metaRes.json();

    if (
      meta.error
    ) {
      throw new Error(
        meta.error
      );
    }


    state.eventName =
      meta.eventName;

    state.displayStart =
      meta.displayStart;

    state.displayEnd =
      meta.displayEnd;

    state.roleDefs =
      Array.isArray(
        meta.roles
      )
        ? meta.roles
        : [];

    state.dates =
      generateDateRange(
        meta.dateStart,
        meta.dateEnd
      );


    el(
      'eventTitle'
    ).textContent =
      meta.eventName;

    document.title =
      `${meta.eventName} | 空き時間ビューア`;


    const csvText =
      await csvRes.text();

    ingestCSV(
      csvText
    );

  } catch (err) {
    showError(
      '予定表の読み込みに失敗しました（' +
      err.message +
      '）。'
    );
  }
}


autoLoad();
