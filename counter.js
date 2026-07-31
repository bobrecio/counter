'use strict';
// ============================================================
// Configuration
// ============================================================
/*
    All app data is stored under one key. This makes exporting,
    importing later, and versioning the data structure easier.
*/
const STORAGE_KEY = 'counterApp.data';
/*
    Current data format version. This gives us a way to migrate
    older saved data if the app changes in the future.
*/
const DATA_VERSION = 2;
/*
    Long-press timing:
    - Wait before auto-repeat begins.
    - Then repeat while the button remains held.
*/
const LONG_PRESS_DELAY_MS = 450;
const LONG_PRESS_REPEAT_MS = 100;
/*
    Dice animation timing.
*/
const DICE_ANIMATION_DURATION_MS = 300;
const DICE_ANIMATION_FRAME_MS = 80;
const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
/*
    Rendering every archived session at once could eventually make
    the page slow. All data is still stored and exported forever,
    but only the newest sessions are drawn on screen.
*/
const MAX_VISIBLE_ARCHIVED_SESSIONS = 20;
// ============================================================
// Application state
// ============================================================
/*
    appData contains:
    - current counter and active-session values
    - all completed sessions
    - all-time high and low records
*/
let appData = createDefaultData();
let longPressDelayTimer = null;
let longPressRepeatTimer = null;
let suppressNextPointerClick = false;
// ============================================================
// Cached element references
// ============================================================
let counter;
let display;
let plusButton;
let minusButton;
let resetButton;
let highValue;
let highTime;
let lowValue;
let lowTime;
let sparkline;
let currentSessionMeta;
let deleteCurrentSessionButton;
let rollButton;
let die1;
let die2;
let rollCount;
let diceTotal;
let exportJsonButton;
let exportCsvButton;
let archiveSummary;
let emptyArchive;
let sessionList;
let keepScore;
// ============================================================
// Initialization
// ============================================================
/*
    This is the application's single startup entry point.
    Future startup work should be added here instead of scattered
    throughout the script.
*/
initialize();
function initialize() {
  cacheElements();
  loadData();
  migrateLegacyData();
  ensureValidData();
  wireEvents();
  renderApp();
}
/*
    Find page elements once and keep references to them.
*/
function cacheElements() {
  counter = document.getElementById('counter');
  display = document.getElementById('display');
  plusButton = document.getElementById('plus');
  minusButton = document.getElementById('minus');
  resetButton = document.getElementById('resetCounter');
  highValue = document.getElementById('highValue');
  highTime = document.getElementById('highTime');
  lowValue = document.getElementById('lowValue');
  lowTime = document.getElementById('lowTime');
  sparkline = document.getElementById('sparkline');
  currentSessionMeta = document.getElementById('currentSessionMeta');
  deleteCurrentSessionButton = document.getElementById('deleteCurrentSession');
  rollButton = document.getElementById('rollDice');
  die1 = document.getElementById('die1');
  die2 = document.getElementById('die2');
  diceTotal = document.getElementById('diceTotal');
  exportJsonButton = document.getElementById('exportJson');
  exportCsvButton = document.getElementById('exportCsv');
  archiveSummary = document.getElementById('archiveSummary');
  emptyArchive = document.getElementById('emptyArchive');
  sessionList = document.getElementById('sessionList');
  keepScore = document.getElementById('chkKeepScore');
}
/*
    Attach all event handlers in one place.
*/
function wireEvents() {
  plusButton.addEventListener('click', (event) => {
    handleCounterButtonClick(event, 1);
  });
  minusButton.addEventListener('click', (event) => {
    handleCounterButtonClick(event, -1);
  });
  addLongPressSupport(plusButton, 1);
  addLongPressSupport(minusButton, -1);
  resetButton.addEventListener('click', archiveAndResetSession);
  deleteCurrentSessionButton.addEventListener('click', deleteCurrentSession);
  rollButton.addEventListener('click', rollDiceAnimated);
  exportJsonButton.addEventListener('click', exportAsJson);
  exportCsvButton.addEventListener('click', exportAsCsv);
  document.addEventListener('keydown', handleKeyDown);
  /*
        Redraw canvases after resizing so they remain sharp.
    */
  window.addEventListener('resize', () => {
    drawCurrentSparkline();
    drawArchivedSparklines();
  });
}
// ============================================================
// Data creation, loading and validation
// ============================================================
/*
    Return a clean data object for a first-time user.
*/
function createDefaultData() {
  const now = new Date().toISOString();
  return {
    version: DATA_VERSION,
    current: {
      value: 0,
      startedAt: now,
      values: [
        {
          value: 0,
          timestamp: now,
        },
      ],
    },
    records: {
      high: {
        value: 0,
        timestamp: now,
      },
      low: {
        value: 0,
        timestamp: now,
      },
    },
    sessions: [],
  };
}
/*
    Load the saved JSON object from localStorage.
*/
function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    appData = createDefaultData();
    return;
  }
  try {
    appData = JSON.parse(saved);
  } catch (error) {
    console.warn('Saved counter data was invalid:', error);
    appData = createDefaultData();
  }
}
/*
    Migrate values saved by the earlier versions of this app.
    Earlier code used:
    - "counterApp.count"
    - "counterApp.history"
    - and, before that, simply "count"
*/
function migrateLegacyData() {
  const alreadyHasNewData = localStorage.getItem(STORAGE_KEY);
  if (alreadyHasNewData) {
    return;
  }
  const legacyCount =
    localStorage.getItem('counterApp.count') ?? localStorage.getItem('count');
  const parsedCount = Number(legacyCount);
  if (legacyCount !== null && Number.isFinite(parsedCount)) {
    appData.current.value = parsedCount;
    const now = new Date().toISOString();
    appData.current.values = [
      {
        value: parsedCount,
        timestamp: now,
      },
    ];
    appData.records.high = {
      value: Math.max(0, parsedCount),
      timestamp: now,
    };
    appData.records.low = {
      value: Math.min(0, parsedCount),
      timestamp: now,
    };
  }
  /*
        Migrate the previous sparkline history when available.
        Old history did not contain timestamps, so each migrated
        point receives the migration time.
    */
  try {
    const legacyHistory = JSON.parse(
      localStorage.getItem('counterApp.history'),
    );
    if (Array.isArray(legacyHistory) && legacyHistory.length > 0) {
      const migrationTime = new Date().toISOString();
      appData.current.values = legacyHistory
        .map(Number)
        .filter(Number.isFinite)
        .map((value) => ({
          value,
          timestamp: migrationTime,
        }));
      const values = appData.current.values.map((entry) => entry.value);
      appData.current.value =
        values[values.length - 1] ?? appData.current.value;
      appData.records.high = {
        value: Math.max(...values),
        timestamp: migrationTime,
      };
      appData.records.low = {
        value: Math.min(...values),
        timestamp: migrationTime,
      };
    }
  } catch (error) {
    console.warn('Could not migrate old history:', error);
  }
  saveData();
}
/*
    Repair missing or malformed fields so a damaged value does not
    prevent the entire app from loading.
*/
function ensureValidData() {
  if (!appData || typeof appData !== 'object') {
    appData = createDefaultData();
  }
  appData.version = DATA_VERSION;
  if (!appData.current || typeof appData.current !== 'object') {
    appData.current = createDefaultData().current;
  }
  if (!Number.isFinite(Number(appData.current.value))) {
    appData.current.value = 0;
  }
  appData.current.value = Number(appData.current.value);
  if (!Array.isArray(appData.current.values)) {
    appData.current.values = [];
  }
  appData.current.values = appData.current.values
    .map(normalizeValueEntry)
    .filter(Boolean);
  if (appData.current.values.length === 0) {
    const now = new Date().toISOString();
    appData.current.values.push({
      value: appData.current.value,
      timestamp: now,
    });
  }
  if (!isValidTimestamp(appData.current.startedAt)) {
    appData.current.startedAt = appData.current.values[0].timestamp;
  }
  if (!Array.isArray(appData.sessions)) {
    appData.sessions = [];
  }
  appData.sessions = appData.sessions.map(normalizeSession).filter(Boolean);
  /*
        Recalculate records from all stored values. This guarantees
        high and low scores remain accurate after migration or repair.
    */
  recalculateAllTimeRecords();
  saveData();
}
function normalizeValueEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const value = Number(entry.value);
  if (!Number.isFinite(value)) {
    return null;
  }
  return {
    value,
    timestamp: isValidTimestamp(entry.timestamp)
      ? entry.timestamp
      : new Date().toISOString(),
  };
}
function normalizeSession(session) {
  if (!session || typeof session !== 'object') {
    return null;
  }
  const values = Array.isArray(session.values)
    ? session.values.map(normalizeValueEntry).filter(Boolean)
    : [];
  if (values.length === 0) {
    return null;
  }
  const numericValues = values.map((entry) => entry.value);
  return {
    id: String(session.id ?? `session-${Date.now()}-${Math.random()}`),
    startedAt: isValidTimestamp(session.startedAt)
      ? session.startedAt
      : values[0].timestamp,
    endedAt: isValidTimestamp(session.endedAt)
      ? session.endedAt
      : values[values.length - 1].timestamp,
    startingValue: Number.isFinite(Number(session.startingValue))
      ? Number(session.startingValue)
      : numericValues[0],
    endingValue: Number.isFinite(Number(session.endingValue))
      ? Number(session.endingValue)
      : numericValues[numericValues.length - 1],
    high: Math.max(...numericValues),
    low: Math.min(...numericValues),
    values,
  };
}
function isValidTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
/*
    Save the complete app state after every counter change or reset.
*/
function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
  } catch (error) {
    /*
            localStorage has a browser-defined size limit. Exporting
            regularly protects the permanent history if that limit is
            eventually reached.
        */
    console.error('Could not save counter data:', error);
    alert(
      'The browser could not save more counter history. ' +
        'Export your data now, then consider clearing old data.',
    );
  }
}
// ============================================================
// Counter operations
// ============================================================
function handleCounterButtonClick(event, amount) {
  const isPointerClick = event.detail > 0;
  if (isPointerClick && suppressNextPointerClick) {
    suppressNextPointerClick = false;
    return;
  }
  changeCount(amount);
}
/*
    Record every counter value with an ISO timestamp.
*/
function changeCount(amount) {
  appData.current.value += amount;
  const entry = {
    value: appData.current.value,
    timestamp: new Date().toISOString(),
  };
  appData.current.values.push(entry);
  updateRecordsWithEntry(entry);
  saveData();
  renderApp();
}
/*
    Archive the full current session, including every stored value,
    then begin a new session at zero.
*/
function archiveAndResetSession() {
  const endedAt = new Date().toISOString();
  const values = [...appData.current.values];
  const numericValues = values.map((entry) => entry.value);
  appData.sessions.push({
    id: createSessionId(),
    startedAt: appData.current.startedAt,
    endedAt,
    startingValue: numericValues[0],
    endingValue: appData.current.value,
    high: Math.max(...numericValues),
    low: Math.min(...numericValues),
    values,
  });
  const newSessionTime = new Date().toISOString();
  appData.current = {
    value: 0,
    startedAt: newSessionTime,
    values: [
      {
        value: 0,
        timestamp: newSessionTime,
      },
    ],
  };
  /*
        Zero is also a real stored value in the new session.
    */
  updateRecordsWithEntry(appData.current.values[0]);
  saveData();
  renderApp();
}
/*
    Discard the current session without adding it to the archive.

    Because deleted values may have created an all-time high or
    low, records are recalculated using only archived sessions and
    the new clean session.
*/
function deleteCurrentSession() {
  const valueCount = appData.current.values.length;

  const confirmed = window.confirm(
    'Delete the current session?\n\n' +
      `${valueCount.toLocaleString()} stored value` +
      `${valueCount === 1 ? '' : 's'} will be permanently discarded. ` +
      'This session will not be archived.',
  );

  if (!confirmed) {
    return;
  }

  const newSessionTime = new Date().toISOString();

  appData.current = {
    value: 0,
    startedAt: newSessionTime,
    values: [
      {
        value: 0,
        timestamp: newSessionTime,
      },
    ],
  };

  recalculateAllTimeRecords();
  saveData();
  renderApp();
}

function createSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
// ============================================================
// High and low records
// ============================================================
/*
    Update all-time records whenever a new value is recorded.
    A timestamp changes only when a genuinely new high or low occurs.
*/
function updateRecordsWithEntry(entry) {
  if (entry.value > appData.records.high.value) {
    appData.records.high = {
      value: entry.value,
      timestamp: entry.timestamp,
    };
  }
  if (entry.value < appData.records.low.value) {
    appData.records.low = {
      value: entry.value,
      timestamp: entry.timestamp,
    };
  }
}
/*
    Rebuild records from all current and archived values.
*/
function recalculateAllTimeRecords() {
  const allEntries = [
    ...appData.sessions.flatMap((session) => session.values),
    ...appData.current.values,
  ];
  if (allEntries.length === 0) {
    const now = new Date().toISOString();
    appData.records = {
      high: { value: 0, timestamp: now },
      low: { value: 0, timestamp: now },
    };
    return;
  }
  let high = allEntries[0];
  let low = allEntries[0];
  for (const entry of allEntries) {
    if (entry.value > high.value) {
      high = entry;
    }
    if (entry.value < low.value) {
      low = entry;
    }
  }
  appData.records = {
    high: {
      value: high.value,
      timestamp: high.timestamp,
    },
    low: {
      value: low.value,
      timestamp: low.timestamp,
    },
  };
}
// ============================================================
// Rendering
// ============================================================
function renderApp() {
  renderCounter();
  renderRecords();
  renderCurrentSession();
  renderSessionArchive();
}
function renderCounter() {
  display.textContent = appData.current.value;
  if (appData.current.value < 0) {
    counter.style.backgroundColor = 'red';
  } else if (appData.current.value > 0) {
    counter.style.backgroundColor = 'green';
  } else {
    counter.style.backgroundColor = '#555';
  }
}
function renderRecords() {
  highValue.textContent = appData.records.high.value;
  highTime.textContent = formatTimestamp(appData.records.high.timestamp);
  lowValue.textContent = appData.records.low.value;
  lowTime.textContent = formatTimestamp(appData.records.low.timestamp);
}
function renderCurrentSession() {
  const values = appData.current.values.map((entry) => entry.value);
  drawSparkline(sparkline, values);
  currentSessionMeta.textContent =
    `${values.length.toLocaleString()} stored values · ` +
    `Started ${formatTimestamp(appData.current.startedAt)}`;
}
function renderSessionArchive() {
  const sessions = appData.sessions;
  const totalArchivedValues = sessions.reduce(
    (total, session) => total + session.values.length,
    0,
  );
  archiveSummary.textContent =
    `${sessions.length.toLocaleString()} completed sessions · ` +
    `${totalArchivedValues.toLocaleString()} archived values · ` +
    `${appData.current.values.length.toLocaleString()} current values`;
  emptyArchive.hidden = sessions.length > 0;
  sessionList.replaceChildren();
  /*
        Display newest sessions first. All older sessions remain in
        localStorage and are included in both export formats.
    */
  const visibleSessions = sessions
    .slice(-MAX_VISIBLE_ARCHIVED_SESSIONS)
    .reverse();
  visibleSessions.forEach((session, index) => {
    const originalSessionNumber = sessions.length - index;
    const card = document.createElement('article');
    card.className = 'sessionCard';
    const header = document.createElement('div');
    header.className = 'sessionHeader';
    const name = document.createElement('div');
    name.className = 'sessionName';
    name.textContent = `Session ${originalSessionNumber}`;
    const date = document.createElement('div');
    date.className = 'sessionDate';
    date.textContent =
      `${formatTimestamp(session.startedAt)} → ` +
      `${formatTimestamp(session.endedAt)}`;
    header.append(name, date);
    const stats = document.createElement('div');
    stats.className = 'sessionStats';
    stats.textContent =
      `Start ${session.startingValue} · ` +
      `End ${session.endingValue} · ` +
      `High ${session.high} · ` +
      `Low ${session.low} · ` +
      `${session.values.length.toLocaleString()} values`;
    const canvas = document.createElement('canvas');
    canvas.className = 'sparkline';
    canvas.dataset.sessionId = session.id;
    canvas.setAttribute(
      'aria-label',
      `Sparkline for session ${originalSessionNumber}`,
    );
    card.append(header, stats, canvas);
    sessionList.append(card);
  });
  /*
        Wait until the canvases exist in the page before measuring
        and drawing them.
    */
  requestAnimationFrame(drawArchivedSparklines);
}
function drawCurrentSparkline() {
  drawSparkline(
    sparkline,
    appData.current.values.map((entry) => entry.value),
  );
}
function drawArchivedSparklines() {
  const sessionsById = new Map(
    appData.sessions.map((session) => [session.id, session]),
  );
  sessionList.querySelectorAll('canvas[data-session-id]').forEach((canvas) => {
    const session = sessionsById.get(canvas.dataset.sessionId);
    if (!session) {
      return;
    }
    drawSparkline(
      canvas,
      session.values.map((entry) => entry.value),
    );
  });
}
/*
    Draw a compact line graph without an external chart library.
*/
function drawSparkline(canvas, values) {
  if (!canvas || values.length === 0) {
    return;
  }
  const context = canvas.getContext('2d');
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio));
  canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio));
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const width = bounds.width;
  const height = bounds.height;
  const padding = 10;
  context.clearRect(0, 0, width, height);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const valueRange = maximum - minimum || 1;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  /*
        Draw a faint zero line when zero falls inside the range.
    */
  if (minimum <= 0 && maximum >= 0) {
    const zeroY = padding + ((maximum - 0) / valueRange) * usableHeight;
    context.beginPath();
    context.moveTo(padding, zeroY);
    context.lineTo(width - padding, zeroY);
    context.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    context.lineWidth = 1;
    context.stroke();
  }
  context.beginPath();
  values.forEach((value, index) => {
    const x =
      values.length === 1
        ? width / 2
        : padding + (index / (values.length - 1)) * usableWidth;
    const y = padding + ((maximum - value) / valueRange) * usableHeight;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.strokeStyle = 'white';
  context.lineWidth = 2;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.stroke();
  const lastValue = values[values.length - 1];
  const lastX = values.length === 1 ? width / 2 : width - padding;
  const lastY = padding + ((maximum - lastValue) / valueRange) * usableHeight;
  context.beginPath();
  context.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
  context.fillStyle = 'white';
  context.fill();
}
function formatTimestamp(isoTimestamp) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(isoTimestamp));
}
// ============================================================
// Long-press support
// ============================================================
function addLongPressSupport(button, amount) {
  button.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    stopLongPress();
    button.setPointerCapture(event.pointerId);
    longPressDelayTimer = setTimeout(() => {
      changeCount(amount);
      suppressNextPointerClick = true;
      longPressRepeatTimer = setInterval(() => {
        changeCount(amount);
      }, LONG_PRESS_REPEAT_MS);
    }, LONG_PRESS_DELAY_MS);
  });
  button.addEventListener('pointerup', stopLongPress);
  button.addEventListener('pointercancel', stopLongPress);
  button.addEventListener('lostpointercapture', stopLongPress);
  button.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
}
function stopLongPress() {
  clearTimeout(longPressDelayTimer);
  clearInterval(longPressRepeatTimer);
  longPressDelayTimer = null;
  longPressRepeatTimer = null;
}
// ============================================================
// Keyboard support
// ============================================================
function handleKeyDown(event) {
  if (event.key === 'Enter' && event.shiftKey) {
    event.preventDefault();
    archiveAndResetSession();
    return;
  }
  switch (event.key) {
    case 'ArrowUp':
    case 'ArrowRight':
      event.preventDefault();
      pressButton(plusButton);
      break;
    case 'ArrowDown':
    case 'ArrowLeft':
      event.preventDefault();
      pressButton(minusButton);
      break;
    case ' ':
      event.preventDefault();
      pressButton(rollButton);
      break;
  }
}
function pressButton(button) {
  button.classList.add('pressed');
  button.click();
  setTimeout(() => {
    button.classList.remove('pressed');
  }, 100);
}
// ============================================================
// Animated dice
// ============================================================
function rollDiceAnimated() {
  rollCount++;
  rollButton.disabled = true;
  diceTotal.textContent = 'Rolling...';
  let animationFrame = 0;
  const animationTimer = setInterval(() => {
    showDice(randomDieValue(), randomDieValue());
    animationFrame++;
    //// only roll on even (die1) or odd (die2) frames
    //const shouldTilt = animationFrame % 2 === 0;
    //die1.classList.toggle("rolling", shouldTilt);
    //die2.classList.toggle("rolling", !shouldTilt);
  }, DICE_ANIMATION_FRAME_MS);
  setTimeout(() => {
    clearInterval(animationTimer);
    const finalDie1 = randomDieValue();
    const finalDie2 = randomDieValue();
    showDice(finalDie1, finalDie2);
    die1.classList.remove('rolling');
    die2.classList.remove('rolling');
    diceTotal.textContent = `Total: ${finalDie1 + finalDie2}`;
    rollButton.disabled = false;
    rollButton.focus();
  }, DICE_ANIMATION_DURATION_MS);
  /*
  if(keepScore === true){
    if(rollCount = 1)
  }*/
}
function randomDieValue() {
  return Math.floor(Math.random() * 6) + 1;
}
function showDice(firstValue, secondValue) {
  die1.textContent = DICE_FACES[firstValue - 1];
  die2.textContent = DICE_FACES[secondValue - 1];
}
// ============================================================
// Export tools
// ============================================================
/*
    JSON preserves the complete data structure and is the best
    backup format for restoring or processing the app's history.
*/
function exportAsJson() {
  const exportData = {
    exportedAt: new Date().toISOString(),
    app: 'Counter',
    ...appData,
  };
  downloadTextFile(
    createExportFilename('json'),
    JSON.stringify(exportData, null, 2),
    'application/json',
  );
}
/*
    CSV creates one row for every stored value. The current session
    is included along with every archived session.
*/
function exportAsCsv() {
  const rows = [
    [
      'session_id',
      'session_status',
      'session_started_at',
      'session_ended_at',
      'value_timestamp',
      'value',
    ],
  ];
  appData.sessions.forEach((session) => {
    session.values.forEach((entry) => {
      rows.push([
        session.id,
        'completed',
        session.startedAt,
        session.endedAt,
        entry.timestamp,
        entry.value,
      ]);
    });
  });
  appData.current.values.forEach((entry) => {
    rows.push([
      'current',
      'active',
      appData.current.startedAt,
      '',
      entry.timestamp,
      entry.value,
    ]);
  });
  const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
  downloadTextFile(createExportFilename('csv'), csv, 'text/csv;charset=utf-8');
}
function escapeCsvValue(value) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}
function createExportFilename(extension) {
  const timestamp = new Date()
    .toISOString()
    .replaceAll(':', '-')
    .replace(/\.\d{3}Z$/, 'Z');
  return `counter-history-${timestamp}.${extension}`;
}
function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
