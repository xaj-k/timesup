/*
 * Times Up: screens, timer and sound. The quiz rules are in quiz.js, saved
 * history in players.js, and what that history says in insights.js.
 * Reading practice: words and rounds in reading.js (from lessons.js), the
 * reading screen in reader.js, and listening in listen.js.
 */
(function () {
  'use strict';

  const Quiz = window.Quiz;
  const Insights = window.Insights;
  const Reading = window.Reading;
  const Listen = window.Listen;
  const STORAGE_KEY = 'timesup.settings';
  const PAUSE_AFTER_RIGHT = 900; // ms before the next question
  const PAUSE_AFTER_MISS = 2400; // longer, so there is time to read the right answer
  const TAP_GUARD = 300; // ms; ignore taps while new tiles appear, so an extra tap can't answer by accident
  const PRAISE = ['Great job!', 'You got it!', 'Awesome!', 'Super!', 'Nice one!', 'Brilliant!', 'Way to go!'];
  const RESULT_TITLES = ['Keep practicing!', 'Good try!', 'Great job!', 'Amazing!'];
  const LEVEL_NAMES = { mastered: 'Got it', learning: 'Getting there', practice: 'Needs practice', new: 'Not tried yet' };

  const $ = (id) => document.getElementById(id);
  const screens = { setup: $('setup'), game: $('game'), read: $('read'), results: $('results'), report: $('report') };
  const form = $('settings-form');
  const tilesBox = $('tiles');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const whenFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const saved = loadSaved();
  let settings = Quiz.sanitizeSettings(saved);
  let activity = saved && saved.activity === 'read' ? 'read' : 'math'; // what the setup screen is set up for
  let reading = Reading.sanitizeSettings(saved && saved.reading);
  let round = null;
  let readRound = null; // the reading round in progress: who, its record, and how it's saved
  let lastPlayed = 'math'; // what "Play again" plays
  let device = null; // what Listen.describeDevice() found out
  let voskNote = ''; // how loading Vosk is going
  let store = null; // where player history is kept, once Players.openStore() answers
  let players = [];
  let storeProblem = '';
  // playerId -> { status: 'loading' | 'ready' | 'failed', rounds, analyses (one per operation), overall, busy }
  const histories = new Map();
  let reportFor = null; // the player whose progress is on screen
  let reportOp = 'multiply'; // which operation the progress report shows
  let trendPick = -1; // the point picked on the progress charts

  // ---------- small helpers for words and numbers ----------

  function plural(n, one, many = `${one}s`) {
    return `${n} ${n === 1 ? one : many}`;
  }

  function percent(share) {
    return `${Math.round(share * 100)}%`;
  }

  function secs(ms) {
    return (ms / 1000).toFixed(1);
  }

  const times = (n) => Insights.times(n);

  // How a fact has gone in its latest tries (up to 4).
  function recentText(f) {
    const { recentRight: right, recentCount: count } = f;
    if (count === 1) return right ? 'Right the one time so far' : 'Missed the one time so far';
    if (right === count) return f.seen > count ? `Right the last ${count} times` : `Right all ${count} times so far`;
    return `Right ${right} of the last ${count} tries`;
  }

  /** [3, 4, 5, 6, 7, 8, 9, 10] -> "3–10"; [2, 5, 10] -> "2, 5, and 10" */
  function tablesText(tables) {
    const sorted = [...new Set(tables)].sort((x, y) => x - y);
    const parts = [];
    for (let i = 0; i < sorted.length;) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
      if (j - i >= 2) parts.push(`${sorted[i]}–${sorted[j]}`);
      else for (let k = i; k <= j; k++) parts.push(String(sorted[k]));
      i = j + 1;
    }
    return Insights.listOf(parts);
  }

  const symbolOf = (operation) => Quiz.operationOf(operation).symbol;

  // Each operation's words: the setup screen's two labels, what one pick is
  // called, how recent rounds name the picks, and the progress report's map.
  const MATH_WORDS = {
    multiply: { tables: 'Times tables', multiplyBy: 'Multiplied by', one: 'times table', picks: 'Tables', more: 'Try adding a table.', map: 'Times-table map' },
    add: { tables: 'Numbers', multiplyBy: 'Added to', one: 'number', picks: 'Numbers', more: 'Try picking another number.', map: 'Addition map' },
    subtract: { tables: 'Take away', multiplyBy: 'Answers', one: 'number', picks: 'Take away', more: 'Try picking another number.', map: 'Subtraction map' },
    divide: { tables: 'Divide by', multiplyBy: 'Answers', one: 'number', picks: 'Divide by', more: 'Try picking another number.', map: 'Division map' },
  };
  const wordsFor = (operation) => MATH_WORDS[operation] || MATH_WORDS.multiply;

  // The question and history key for the fact [t, m] in a chart's row t and column m.
  function cellFact(t, m, operation) {
    const { a, b } = Quiz.questionFor(t, m, operation);
    return { a, b, key: Quiz.factKey(a, b, operation) };
  }

  // ---------- saved settings (best effort: storage can be blocked) ----------

  function loadSaved() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return raw && typeof raw === 'object' ? raw : null;
    } catch (error) {
      return null;
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, activity, reading }));
    } catch (error) {
      // Settings just won't be remembered next time.
    }
  }

  // ---------- sound effects, made on the fly with Web Audio ----------

  const sound = (function () {
    let context = null;

    // Browsers only allow audio after a tap or click, so this runs from one.
    function unlock() {
      try {
        if (!context) {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (AudioContext) context = new AudioContext();
        }
        if (context && context.state === 'suspended') context.resume();
      } catch (error) {
        context = null;
      }
    }

    function play(notes, type = 'sine', volume = 0.18) {
      if (!settings.sound || !context) return;
      try {
        const start = context.currentTime + 0.01;
        for (const [frequency, at, length] of notes) {
          const osc = context.createOscillator();
          const gain = context.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(frequency, start + at);
          gain.gain.setValueAtTime(0.0001, start + at);
          gain.gain.exponentialRampToValueAtTime(volume, start + at + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + at + length);
          osc.connect(gain).connect(context.destination);
          osc.start(start + at);
          osc.stop(start + at + length + 0.05);
        }
      } catch (error) {
        // No sound is fine.
      }
    }

    const fanfare = [[523, 0, 0.14], [659, 0.12, 0.14], [784, 0.24, 0.14], [1047, 0.36, 0.4]];
    return {
      unlock,
      right: () => play([[660, 0, 0.12], [880, 0.09, 0.22]]),
      wrong: () => play([[247, 0, 0.18], [196, 0.12, 0.3]], 'triangle', 0.22),
      timeUp: () => play([[523, 0, 0.14], [392, 0.13, 0.14], [262, 0.26, 0.32]], 'triangle', 0.2),
      finish: (stars) => { if (stars > 0) play(fanfare.slice(0, stars + 1)); },
    };
  })();

  // ---------- keeping a phone or tablet screen on during a round ----------

  const wake = (function () {
    let lock = null;
    let wanted = false;

    async function request() {
      if (!wanted || lock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
      try {
        const got = await navigator.wakeLock.request('screen');
        if (!wanted) {
          got.release().catch(() => {});
          return;
        }
        lock = got;
        lock.addEventListener('release', () => { lock = null; });
      } catch (error) {
        // Not allowed here; the screen just dims as usual.
      }
    }

    // The lock is dropped whenever the page is hidden, so ask again on return.
    document.addEventListener('visibilitychange', request);
    return {
      on() { wanted = true; request(); },
      off() {
        wanted = false;
        if (lock) lock.release().catch(() => {});
        lock = null;
      },
    };
  })();

  // ---------- setup screen ----------

  function buildSetup() {
    $('table-chips').innerHTML = Quiz.TABLES.map((n) =>
      `<label class="chip"><input type="checkbox" name="table" value="${n}" id="table-${n}"><span>${n}</span></label>`
    ).join('');

    for (const select of [$('range-from'), $('range-to')]) {
      for (let n = Quiz.RANGE_MIN; n <= Quiz.RANGE_MAX; n++) select.add(new Option(String(n), String(n)));
    }

    $('seconds-pills').innerHTML = pills('seconds', Quiz.SECONDS_OPTIONS, (s) => `${s} sec`);
    $('count-pills').innerHTML = pills('count', Quiz.COUNT_OPTIONS, String);
    buildChart($('chart'));
    buildChart($('mastery-chart'));
  }

  // Fills a chart with products or sums. For subtraction and division, each
  // cell shows the number its question starts from: 13 for 13 − 6, 42 for 42 ÷ 6.
  function labelChart(chart, operation) {
    const showAnswers = Quiz.operationOf(operation).eitherOrder;
    for (const node of chart.children) {
      const { row, col } = node.dataset;
      if (row === undefined && col === undefined) {
        node.textContent = symbolOf(operation);
      } else if (row !== undefined && col !== undefined) {
        const { a, b } = cellFact(Number(row), Number(col), operation);
        node.textContent = showAnswers ? Quiz.answerFor(a, b, operation) : a;
      }
    }
  }

  function pills(name, values, label) {
    return values.map((v) =>
      `<label class="pill"><input type="radio" name="${name}" value="${v}" id="${name}-${v}"><span>${label(v)}</span></label>`
    ).join('');
  }

  // A times-table chart: rows are the tables (the numbers picked), columns the
  // numbers they're multiplied by (or added to, or the answers). labelChart fills it in.
  function buildChart(chart) {
    chart.style.setProperty('--cols', Quiz.RANGE_MAX - Quiz.RANGE_MIN + 2);
    let html = '<span class="head corner">×</span>';
    for (let m = Quiz.RANGE_MIN; m <= Quiz.RANGE_MAX; m++) html += `<span class="head" data-col="${m}">${m}</span>`;
    for (const t of Quiz.TABLES) {
      html += `<span class="head" data-row="${t}">${t}</span>`;
      for (let m = Quiz.RANGE_MIN; m <= Quiz.RANGE_MAX; m++) {
        html += `<span class="cell" data-row="${t}" data-col="${m}">${t * m}</span>`;
      }
    }
    chart.innerHTML = html;
  }

  function renderChart() {
    const columns = Quiz.multipliersFor(settings);
    const player = currentPlayer();
    const analysis = effectiveFocus() === 'weak' ? analysisFor(player.id) : null;
    let marked = 0;
    for (const node of $('chart').children) {
      const { row, col } = node.dataset;
      if (row === undefined && col === undefined) continue; // the corner, with the sign
      const rowOn = row === undefined || settings.tables.includes(Number(row));
      const colOn = col === undefined || columns.includes(Number(col));
      node.classList.toggle('is-on', rowOn && colOn);
      let weak = false;
      if (analysis && rowOn && colOn && row !== undefined && col !== undefined) {
        const fact = analysis.facts.get(cellFact(Number(row), Number(col), settings.operation).key);
        weak = Boolean(fact) && fact.level === 'practice';
      }
      node.classList.toggle('is-weak', weak);
      if (weak) marked += 1;
    }
    $('chart-key').hidden = marked === 0;
  }

  function multiplyHelp() {
    if (settings.multiplyBy === 'range') {
      return {
        multiply: 'Each table you picked is multiplied by every number in this range, like 7 × 1 up to 7 × 10.',
        add: 'Each number you picked is added to every number in this range, like 7 + 1 up to 7 + 10.',
        subtract: 'Each number you picked is taken away from a bigger number, with answers in this range, like 8 − 7 = 1 up to 17 − 7 = 10.',
        divide: 'Each number you picked divides a bigger number, with answers in this range, like 7 ÷ 7 = 1 up to 70 ÷ 7 = 10.',
      }[settings.operation];
    }
    if (settings.tables.length === 1) {
      const t = settings.tables[0];
      return {
        multiply: `That's only ${t} × ${t}. To practice the whole ${t} times table, choose “A range”.`,
        add: `That's only ${t} + ${t}. To practice adding ${t} to other numbers, choose “A range”.`,
        subtract: `That's only ${t + t} − ${t}. To practice taking ${t} away from more numbers, choose “A range”.`,
        divide: `That's only ${t * t} ÷ ${t}. To practice dividing more numbers by ${t}, choose “A range”.`,
      }[settings.operation];
    }
    return {
      multiply: 'Both numbers in each question come from the tables you picked.',
      add: 'Both numbers in each question come from the numbers you picked.',
      subtract: 'The number taken away and the answer both come from the numbers you picked.',
      divide: 'The number you divide by and the answer both come from the numbers you picked.',
    }[settings.operation];
  }

  // How to read the setup chart.
  function chartNote(operation) {
    if (operation === 'subtract') return 'Shaded facts can come up. Row 6, column 7 is 13 − 6 = 7.';
    if (operation === 'divide') return 'Shaded facts can come up. Row 6, column 7 is 42 ÷ 6 = 7.';
    const sign = symbolOf(operation);
    return `Shaded facts can come up, in either order: 6 ${sign} 8 or 8 ${sign} 6.`;
  }

  // Weak spots needs a named player with some history.
  function weakSpotsReady() {
    const player = currentPlayer();
    const analysis = player ? analysisFor(player.id) : null;
    return Boolean(analysis && analysis.totals.questions);
  }

  function effectiveFocus() {
    return settings.focus === 'weak' && weakSpotsReady() ? 'weak' : 'all';
  }

  function focusHelp() {
    const player = currentPlayer();
    if (!player) return 'Weak spots works from a player’s history, so pick a name first.';
    const entry = histories.get(player.id);
    if (!entry || entry.status === 'loading') return `Loading ${player.name}'s history…`;
    if (entry.status === 'failed') return `Weak spots can't load ${player.name}'s history right now.`;
    const analysis = analysisFor(player.id);
    if (!analysis.totals.questions) {
      return `Weak spots starts working after ${player.name} plays a round or two of ${Quiz.operationOf(settings.operation).name}.`;
    }
    if (effectiveFocus() === 'all') return 'Every fact comes up equally often.';
    const counts = Insights.focusCounts(analysis, Quiz.factsFor(settings));
    if (counts.practice) {
      return `The ${plural(counts.practice, 'fact')} that ${counts.practice === 1 ? 'needs' : 'need'} practice ` +
        `(marked with a dot) come up more often, mixed in with ones ${player.name} knows.`;
    }
    if (counts.learning || counts.new) {
      return `None of these need practice right now, so the round leans on facts that are still getting there${counts.new ? ' or not tried yet' : ''}.`;
    }
    return `${player.name} knows all of these by heart! ${wordsFor(settings.operation).more}`;
  }

  function renderSetup() {
    const reads = activity === 'read';
    form.elements.operation.value = reads ? 'read' : settings.operation;
    $('math-fields').hidden = reads;
    $('read-fields').hidden = !reads;
    $('math-preview').hidden = reads;
    $('read-preview').hidden = !reads;
    $('chart-label').textContent = reads ? 'In this round' : 'In this quiz';
    if (reads) renderReadSetup();
    else renderMathSetup();
    renderSetupState();
  }

  function renderMathSetup() {
    const words = wordsFor(settings.operation);
    $('tables-label').textContent = words.tables;
    $('multiply-label').textContent = words.multiplyBy;
    $('chart-note').textContent = chartNote(settings.operation);
    labelChart($('chart'), settings.operation);
    for (const box of form.elements.table) box.checked = settings.tables.includes(Number(box.value));
    form.elements.multiplyBy.value = settings.multiplyBy;
    $('range-from').value = String(settings.from);
    $('range-to').value = String(settings.to);
    form.elements.mode.value = settings.timed ? 'timed' : 'relaxed';
    form.elements.seconds.value = String(settings.seconds);
    form.elements.count.value = String(settings.count);
  }

  function renderSetupState() {
    if (activity === 'read') {
      renderReadState();
      return;
    }
    const facts = Quiz.factsFor(settings);
    const player = currentPlayer();
    const focus = effectiveFocus();
    $('range-row').hidden = settings.multiplyBy !== 'range';
    $('multiply-help').textContent = multiplyHelp();
    $('focus-weak').disabled = !weakSpotsReady();
    form.elements.focus.value = focus;
    $('focus-help').textContent = focusHelp();
    $('seconds-field').hidden = !settings.timed;
    $('start').disabled = facts.length === 0;

    let focusNote = '';
    if (focus === 'weak') {
      const tricky = Insights.focusCounts(analysisFor(player.id), facts).practice;
      if (tricky) focusNote = ` (the ${tricky} that ${tricky === 1 ? 'needs practice comes' : 'need practice come'} up more)`;
    }
    $('summary').textContent = facts.length === 0
      ? `Pick at least one ${wordsFor(settings.operation).one} to start.`
      : `${player ? `${player.name}: ` : ''}` +
        `${settings.count} ${Quiz.operationOf(settings.operation).name} questions from ` +
        `${facts.length === 1 ? 'just 1 fact' : `${facts.length} different facts`}${focusNote}, ` +
        (settings.timed ? `with ${settings.seconds} seconds for each.` : 'with no timer.');
    renderChart();
  }

  function readSetup(changed) {
    const from = $('range-from');
    const to = $('range-to');
    // Keep the range the right way round by moving the end that wasn't touched.
    if (Number(from.value) > Number(to.value)) {
      if (changed === to) from.value = to.value;
      else to.value = from.value;
    }
    settings = Quiz.sanitizeSettings({
      operation: settings.operation,
      selections: settings.selections,
      tables: [...form.elements.table].filter((box) => box.checked).map((box) => Number(box.value)),
      multiplyBy: form.elements.multiplyBy.value,
      from: Number(from.value),
      to: Number(to.value),
      timed: form.elements.mode.value === 'timed',
      seconds: Number(form.elements.seconds.value),
      count: Number(form.elements.count.value),
      // While Weak spots can't be used (a guest, or no history yet), keep the choice for later.
      focus: $('focus-weak').disabled ? settings.focus : form.elements.focus.value,
      sound: settings.sound,
      playerId: settings.playerId,
    });
    saveSettings();
    renderSetupState();
  }

  // Switching to another operation brings back that operation's own picks.
  function switchOperation(operation) {
    if (operation === settings.operation) return;
    settings = Quiz.sanitizeSettings({ ...settings, ...settings.selections[operation], operation });
    saveSettings();
  }

  // Multiplication, addition, subtraction, division or reading.
  function chooseActivity(value) {
    if (value === 'read') {
      activity = 'read';
    } else {
      activity = 'math';
      switchOperation(value);
    }
    saveSettings();
    renderSetup();
    renderPlayerHelp();
  }

  function setAllTables(on) {
    for (const box of form.elements.table) box.checked = on;
    readSetup();
  }

  // ---------- reading setup ----------

  const PART_NOUNS = { words: ['word', 'words'], sounds: ['sound', 'sounds'], sentences: ['sentence', 'sentences'] };

  // "page 20" or "pages 20–22"
  function pagesText(plan) {
    return plan.from === plan.to ? `page ${plan.from}` : `pages ${plan.from}–${plan.to}`;
  }

  // "3 sounds, 4 words, and 3 sentences"
  function partsText(plan) {
    return Insights.listOf(Reading.PARTS.filter((part) => plan.parts[part] && plan.parts[part].take)
      .map((part) => { const n = plan.parts[part].take; return `${n} ${PART_NOUNS[part][n === 1 ? 0 : 1]}`; }));
  }

  function readPlan() {
    return Reading.planRound(reading.page, reading.parts, reading.count);
  }

  function buildReadSetup() {
    $('read-count-pills').innerHTML = Reading.COUNTS.map((n) =>
      `<label class="pill"><input type="radio" name="readCount" value="${n}" id="read-count-${n}"><span>${n || 'Whole page'}</span></label>`
    ).join('');
    $('read-page').min = String(Reading.FIRST_PAGE);
    $('read-page').max = String(Reading.LAST_PAGE);
  }

  function renderReadSetup() {
    // A browser that can't recognize speech itself can't check online.
    if (reading.engine === 'online' && !Listen.BrowserRecognition) reading.engine = 'off';
    $('read-page').value = String(reading.page);
    for (const box of form.elements.readPart) box.checked = reading.parts.includes(box.value);
    form.elements.readCount.value = String(reading.count);
    form.elements.engine.value = reading.engine;
  }

  function readReadingSetup(changed) {
    const typed = Math.round(Number($('read-page').value));
    const page = Number.isFinite(typed) && typed > 0 ? Math.min(Reading.LAST_PAGE, Math.max(Reading.FIRST_PAGE, typed)) : reading.page;
    reading = Reading.sanitizeSettings({
      page,
      parts: [...form.elements.readPart].filter((box) => box.checked).map((box) => box.value),
      count: Number(form.elements.readCount.value),
      // While Weak spots can't be used, keep the choice for later.
      focus: $('read-focus-weak').disabled ? reading.focus : form.elements.readFocus.value,
      engine: form.elements.engine.value,
    });
    if (changed === $('read-page')) $('read-page').value = String(reading.page);
    if (reading.engine === 'vosk' && Listen.vosk.state === 'idle') loadVosk();
    saveSettings();
    renderReadState();
  }

  function stepPage(by) {
    $('read-page').value = String(reading.page + by);
    readReadingSetup($('read-page'));
  }

  function loadVosk() {
    if (!Listen.vosk.supported) return;
    voskNote = 'Getting Vosk ready…';
    const update = () => {
      if (activity === 'read' && !screens.setup.hidden) renderReadState();
    };
    Listen.vosk.load((step) => {
      if (step.phase === 'model') {
        const mb = (bytes) => Math.round(bytes / 1e6);
        voskNote = `Downloading English: ${mb(step.loaded)} of ${mb(step.total || Listen.vosk.info.megabytes * 1e6)} MB. This only happens the first time.`;
      } else if (step.phase === 'unpack') {
        voskNote = 'Unpacking English…';
      } else if (step.phase === 'speed') {
        voskNote = 'Checking how fast this device is…';
      }
      update();
    }).then(update, update);
    update();
  }

  // What the reading history says, for one player.
  function readingFor(id) {
    const entry = id ? histories.get(id) : null;
    if (!entry || entry.status !== 'ready') return null;
    if (!entry.analyses.read) entry.analyses.read = Reading.analyze(entry.rounds, Date.now());
    return entry.analyses.read;
  }

  // Weak spots is for sounds and words (sentences always come in the packet's order).
  const weakParts = () => reading.parts.some((part) => part !== 'sentences');

  function readWeakReady() {
    const player = currentPlayer();
    const analysis = player ? readingFor(player.id) : null;
    return Boolean(analysis && analysis.totals.rounds) && weakParts();
  }

  function effectiveReadFocus() {
    return reading.focus === 'weak' && readWeakReady() ? 'weak' : 'all';
  }

  function readEngine() {
    return reading.engine === 'online' && !Listen.BrowserRecognition ? 'off' : reading.engine;
  }

  function engineHelp() {
    const vosk = Listen.vosk;
    if (reading.engine === 'vosk') {
      if (!vosk.supported) return 'This browser can’t check on the device. Choose another way.';
      if (vosk.state === 'ready') {
        if (vosk.speed !== null && vosk.speed > 1) {
          return `Ready, but slow here: this device takes ${vosk.speed.toFixed(1)} s to recognize 1 s of speech, so answers may come late. By voice, online may work better on it.`;
        }
        return 'Ready. Checking happens on this device, so no audio leaves it.';
      }
      if (vosk.state === 'failed') return `Checking on this device couldn’t load (${vosk.error}).`;
      if (vosk.state === 'loading') return voskNote;
      return `The first time, this downloads ${vosk.info.megabytes} MB. After that it works offline, and no audio leaves the device.`;
    }
    if (reading.engine === 'off') return 'No listening: your child reads, and you tap ✓ or Not yet.';
    return 'Chrome sends the audio to Google to check it. You can always tap ✓ yourself.';
  }

  function readFocusHelp(player, analysis, focus) {
    if (!player) return 'Weak spots works from a player’s history, so pick a name first.';
    const entry = histories.get(player.id);
    if (!entry || entry.status === 'loading') return `Loading ${player.name}'s history…`;
    if (!analysis || !analysis.totals.rounds) return `Weak spots starts working after ${player.name} reads a round or two.`;
    return focus === 'weak'
      ? 'Words and sounds that need practice come up more often (they’re marked with a dot).'
      : 'Everything on the page is as likely to come up, and anything new on the page always does.';
  }

  function renderReadState() {
    const l = Reading.lesson(reading.page);
    const player = currentPlayer();
    const analysis = player ? readingFor(player.id) : null;
    const plan = readPlan();

    const pageBits = [`Newest sound: “${l.newSound}”.`];
    if (l.newWords.length) pageBits.push(`New sight ${l.newWords.length === 1 ? 'word' : 'words'}: ${Insights.listOf(l.newWords)}.`);
    $('page-help').textContent = pageBits.join(' ');
    $('page-down').disabled = reading.page <= Reading.FIRST_PAGE;
    $('page-up').disabled = reading.page >= Reading.LAST_PAGE;
    $('part-help').textContent = reading.parts.length
      ? 'In the packet’s order: sounds (your child says each one, and you tap ✓), then sight words and words to sound out, then sentences.'
      : 'Pick at least one.';

    $('read-focus-field').hidden = !weakParts();
    $('read-focus-weak').disabled = !readWeakReady();
    const focus = effectiveReadFocus();
    form.elements.readFocus.value = focus;
    $('read-focus-help').textContent = readFocusHelp(player, analysis, focus);

    $('engine-online').disabled = !Listen.BrowserRecognition;
    $('engine-vosk').disabled = !Listen.vosk.supported;
    $('engine-help').textContent = engineHelp();
    $('read-vosk-retry').hidden = !(reading.engine === 'vosk' && Listen.vosk.state === 'failed');
    const old = Listen.isOldAndroid(device);
    $('old-android').hidden = !old || reading.engine === 'off';
    if (old) {
      $('old-android').textContent = `This tablet has Android ${device.android}. Reading practice is meant for Android ${Listen.OLD_ANDROID} or newer, so checking by voice may miss more words here.`;
    }

    $('read-count-help').textContent = reading.count
      ? `When page ${reading.page} runs out, the round goes on to the next pages.`
      : `Everything on page ${reading.page}, and nothing from other pages.`;

    renderReadPreview(plan, analysis, focus);

    const engine = readEngine();
    const voice = reading.parts.some((part) => part !== 'sounds');
    const how = !voice || engine === 'off' ? 'checked by a grown-up' : { online: 'checked by voice', vosk: 'checked by voice on this device' }[engine];
    $('summary').textContent = !reading.parts.length
      ? 'Pick sounds, words or sentences to start.'
      : `${player ? `${player.name}: ` : ''}${plan.total} from ${pagesText(plan)}${plan.total ? ` (${partsText(plan)})` : ''}` +
        `${focus === 'weak' ? ', leaning on weak spots' : ''}, ${how}.`;
    $('start').disabled = plan.total === 0 || (voice && engine === 'vosk' && Listen.vosk.state !== 'ready');
  }

  // What the round picks from, part by part, with the ones that need practice marked.
  function renderReadPreview(plan, analysis, focus) {
    const levelOf = (key) => {
      const entry = analysis ? analysis.items.get(key) : null;
      return entry ? entry.level : 'new';
    };
    let weak = 0;
    const groups = [];
    for (const part of Reading.PARTS) {
      const p = plan.parts[part];
      if (!p) continue;
      const pages = [...new Set(p.pool.map((item) => item.page))].sort((x, y) => x - y);
      const where = !pages.length ? '' : pages.length === 1 ? ` from page ${pages[0]}` : ` from pages ${pages[0]}–${pages[pages.length - 1]}`;
      const box = element('div', 'read-group');
      const [one, many] = PART_NOUNS[part];
      box.append(element('h3', 'wall-title', p.pool.length ? `${p.take} ${p.take === 1 ? one : many}${p.take < p.pool.length ? ` of these ${p.pool.length}` : ''}${where}` : `No ${many} here`));
      const list = element('ul', 'word-chips');
      for (const item of p.pool) {
        const classes = ['word-chip'];
        if (item.kind === 'sentence') classes.push('is-sentence');
        if (item.kind === 'word') classes.push('is-decodable');
        if (item.isNew) classes.push('is-new');
        if (item.page !== reading.page) classes.push('is-later');
        if (levelOf(item.key) === 'practice') {
          classes.push('is-weak');
          weak += 1;
        }
        const chip = element('li', classes.join(' '));
        if (item.kind === 'word' && item.sound) {
          for (const piece of Reading.mark(item.text, item.sound)) chip.append(piece.mark ? element('span', 'sound-part', piece.text) : document.createTextNode(piece.text));
        } else {
          chip.textContent = item.text;
        }
        list.append(chip);
      }
      box.append(list);
      groups.push(box);
    }
    $('read-groups').replaceChildren(...groups);
    $('read-key').hidden = weak === 0 || focus !== 'weak';
    $('read-note').textContent = plan.total
      ? 'New sight words and the newest sound are outlined, and always come up. Words to sound out have a sound marked.' +
        (plan.to > reading.page || plan.from < reading.page ? ' Dashed ones are from other pages.' : '')
      : '';
  }

  // ---------- players and their history ----------

  async function connectStore() {
    const opened = await Players.openStore();
    try {
      players = (await opened.loadPlayers()).sort(Players.byName);
    } catch (error) {
      players = [];
      storeProblem = "Saved players couldn't load right now. You can still play as a guest.";
    }
    store = opened;
    renderPlayers();
    const player = currentPlayer();
    if (player) loadHistory(player.id);
  }

  function currentPlayer() {
    return players.find((p) => p.id === settings.playerId) || null;
  }

  // Rebuilt only when the list of players changes, so keyboard focus survives picking one.
  function renderPlayers() {
    const list = $('player-list');
    const addButton = $('add-player-open');
    for (const old of list.querySelectorAll('label.pill')) old.remove();
    if (store) {
      const chosen = currentPlayer();
      for (const p of [{ id: '', name: 'Guest' }, ...players]) {
        const label = document.createElement('label');
        label.className = 'pill';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'player';
        input.value = p.id;
        input.id = p.id ? `player-${p.id}` : 'player-guest';
        input.checked = (chosen ? chosen.id : '') === p.id;
        const text = document.createElement('span');
        text.textContent = p.name;
        label.append(input, text);
        list.insertBefore(label, addButton);
      }
    }
    addButton.disabled = !store;
    renderPlayerHelp();
    renderSetupState();
  }

  function renderPlayerHelp() {
    $('player-help').textContent = playerHelp();
    const player = currentPlayer();
    const overall = player ? overallFor(player.id) : null;
    const read = player ? readingFor(player.id) : null;
    $('open-report').hidden = !((overall && overall.questions) || (read && read.totals.rounds));
  }

  function playerHelp() {
    if (!store) return 'Loading players…';
    if (storeProblem) return storeProblem;
    const player = currentPlayer();
    if (!player) return players.length ? "Guest rounds aren't saved." : 'Add your first name to keep track of your progress.';
    const entry = histories.get(player.id);
    if (!entry || entry.status === 'loading') return `Loading ${player.name}'s history…`;
    if (entry.status === 'failed') return `${player.name}'s history couldn't load right now. New answers will still be saved.`;
    if (activity === 'read') {
      const read = readingFor(player.id);
      if (!read.totals.rounds) return `${player.name} hasn't done any reading yet. Every answer will be saved.`;
      return `${player.name}'s reading so far: ${plural(read.totals.rounds, 'round')}, ` +
        `${plural(read.totals.questions, 'word, sound or sentence', 'words, sounds and sentences')}, ${percent(read.totals.accuracy)} read right.`;
    }
    const totals = overallFor(player.id);
    if (!totals.questions) return `${player.name} hasn't played yet. Every answer will be saved.`;
    return `${player.name} so far: ${plural(totals.rounds, 'round')}, ` +
      `${totals.questions} questions, ${percent(totals.right / totals.questions)} right.`;
  }

  function choosePlayer(id) {
    settings.playerId = id || null;
    saveSettings();
    renderPlayerHelp();
    renderSetupState();
    if (id) loadHistory(id);
  }

  /** Loads a player's rounds once; refresh picks up rounds saved on other devices. */
  function loadHistory(id, refresh = false) {
    if (!store || !id) return;
    let entry = histories.get(id);
    if (entry && (entry.busy || (entry.status === 'ready' && !refresh))) return;
    if (!entry) {
      entry = { status: 'loading', rounds: [], analyses: {}, overall: null, busy: false };
      histories.set(id, entry);
    }
    entry.busy = true;
    store.loadRounds(id)
      .then(
        (rounds) => {
          entry.rounds = mergeRounds(rounds, entry.rounds);
          entry.status = 'ready';
          entry.analyses = {};
          entry.overall = null;
        },
        () => { if (entry.status !== 'ready') entry.status = 'failed'; }
      )
      .then(() => {
        entry.busy = false;
        historyChanged(id);
      });
  }

  // A round can be on its way to storage while the list loads; keep the copy with the most answers.
  function mergeRounds(loaded, known) {
    const byId = new Map();
    for (const r of loaded) if (r && typeof r.id === 'string') byId.set(r.id, r);
    for (const r of known) {
      const other = byId.get(r.id);
      const ahead = other && ((r.answers || []).length > (other.answers || []).length || (r.finished && !other.finished));
      if (!other || ahead) byId.set(r.id, r);
    }
    return [...byId.values()].sort((x, y) => String(x.startedAt).localeCompare(String(y.startedAt)));
  }

  // Adds a round that has just been saved to the history in memory.
  function rememberRound(record) {
    const entry = histories.get(record.playerId);
    if (!entry || entry.status !== 'ready') return;
    entry.rounds = mergeRounds([record], entry.rounds.filter((r) => r.id !== record.id));
    entry.analyses = {};
    entry.overall = null;
    historyChanged(record.playerId);
  }

  // What one operation's history says (each operation is kept apart).
  function analysisFor(id, operation = settings.operation) {
    const entry = id ? histories.get(id) : null;
    if (!entry || entry.status !== 'ready') return null;
    if (!entry.analyses[operation]) entry.analyses[operation] = Insights.analyze(entry.rounds, Date.now(), operation);
    return entry.analyses[operation];
  }

  // Totals across every math operation, for the line under the player's name.
  function overallFor(id) {
    const entry = id ? histories.get(id) : null;
    if (!entry || entry.status !== 'ready') return null;
    if (!entry.overall) entry.overall = Insights.overall(entry.rounds);
    return entry.overall;
  }

  function historyChanged(id) {
    const player = currentPlayer();
    if (player && player.id === id) {
      renderPlayerHelp();
      renderSetupState();
    }
    if (!screens.report.hidden && reportFor === id) renderReport();
  }

  function openAddPlayer() {
    $('add-player').hidden = false;
    $('add-player-open').hidden = true;
    $('new-player-name').focus();
  }

  function closeAddPlayer() {
    $('add-player').hidden = true;
    $('add-player-open').hidden = false;
    $('new-player-name').value = '';
  }

  async function addPlayer() {
    const input = $('new-player-name');
    const name = Players.cleanName(input.value);
    if (!name) {
      $('player-help').textContent = 'Type a first name, then press Add.';
      input.focus();
      return;
    }
    // Typing a name that's already there just picks that player.
    const existing = players.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const player = existing || { id: Players.newId('p'), name, created: new Date().toISOString() };
    if (!existing) {
      $('add-player-save').disabled = true;
      try {
        await store.addPlayer(player);
      } catch (error) {
        $('player-help').textContent = `Couldn't add ${name}. ` +
          (isFull(error) ? "There's no room left to save players." : 'Try again in a moment.');
        return;
      } finally {
        $('add-player-save').disabled = false;
      }
      players = [...players, player].sort(Players.byName);
      histories.set(player.id, { status: 'ready', rounds: [], analyses: {}, overall: null, busy: false });
      storeProblem = '';
    }
    closeAddPlayer();
    settings.playerId = player.id;
    saveSettings();
    renderPlayers();
    loadHistory(player.id);
    $(`player-${player.id}`).focus({ preventScroll: true });
  }

  function isFull(error) {
    return Boolean(error) && (error.code === 'quota_exceeded' || error.name === 'QuotaExceededError');
  }

  // What gets saved for each round. Answers are added as they happen.
  function newRecord(player, focus) {
    const used = { operation: settings.operation, tables: settings.tables.slice(), multiplyBy: settings.multiplyBy };
    if (settings.multiplyBy === 'range') Object.assign(used, { from: settings.from, to: settings.to });
    used.timeLimit = settings.timed ? settings.seconds : 0; // seconds per question; 0 means no timer
    used.count = settings.count;
    used.focus = focus;
    return {
      id: Players.newId('r'),
      playerId: player.id,
      startedAt: new Date().toISOString(),
      settings: used,
      answers: [],
      finished: false,
    };
  }

  function persist(current) {
    // Save a copy: the live record keeps changing while a write is in flight.
    const copy = JSON.parse(JSON.stringify(current.record));
    current.lastSave = current.save(copy);
    current.lastSave.then(() => rememberRound(copy), () => {}); // problems are reported on the results screen
    return current.lastSave;
  }

  function showSaveNote(done) {
    const note = $('save-note');
    note.classList.remove('is-problem');
    if (!done.record) {
      note.dataset.round = '';
      note.textContent = "Played as a guest, so this round wasn't saved.";
      return;
    }
    const { id } = done.record;
    const name = done.player.name;
    note.dataset.round = id;
    note.textContent = `Saving to ${name}'s history…`;
    done.lastSave.then(
      () => {
        if (note.dataset.round === id) note.textContent = `Saved to ${name}'s history.`;
      },
      (error) => {
        if (note.dataset.round !== id) return;
        note.textContent = `Couldn't save this round to ${name}'s history.` + (isFull(error) ? " There's no room left." : '');
        note.classList.add('is-problem');
      }
    );
  }

  // ---------- quiz screen ----------

  function buildTiles() {
    tilesBox.innerHTML = [1, 2, 3, 4].map((slot) =>
      `<button type="button" class="tile" data-slot="${slot}">` +
        '<span class="tile-num"></span>' +
        '<svg class="mark mark-yes" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' +
        '<svg class="mark mark-no" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>' +
      '</button>'
    ).join('');
  }

  function tiles() {
    return [...tilesBox.children];
  }

  function startRound() {
    sound.unlock();
    lastPlayed = 'math';
    const player = currentPlayer();
    const focus = effectiveFocus();
    const questions = focus === 'weak'
      ? Quiz.createFocusRound(settings, Insights.needFinder(analysisFor(player.id)))
      : Quiz.createRound(settings);
    round = {
      questions,
      operation: settings.operation,
      seconds: settings.timed ? settings.seconds : 0,
      index: -1,
      score: 0,
      streak: 0,
      bestStreak: 0,
      answers: [],
      locked: true,
      shownAt: 0,
      pending: 0,
      player,
      record: player ? newRecord(player, focus) : null, // saved to the player's history
      save: player ? Players.makeSaver((record) => store.saveRound(record)) : null,
      lastSave: null,
    };
    const cells = $('progress-cells');
    cells.style.setProperty('--count', round.questions.length);
    cells.innerHTML = '<li></li>'.repeat(round.questions.length);
    $('score').textContent = '0';
    $('q-op').textContent = symbolOf(round.operation);
    $('timer').hidden = !round.seconds;
    showScreen('game');
    wake.on();
    nextQuestion();
    tiles()[0].focus({ preventScroll: true });
  }

  function nextQuestion() {
    round.index += 1;
    if (round.index >= round.questions.length) {
      finishRound();
      return;
    }
    const q = round.questions[round.index];
    $('q-a').textContent = q.a;
    $('q-b').textContent = q.b;
    $('question-sr').textContent = `What is ${q.a} ${Quiz.operationOf(round.operation).word} ${q.b}?`;
    $('progress-label').textContent = `Question ${round.index + 1} of ${round.questions.length}`;
    markProgress('is-current');
    setFeedback('', '');

    tilesBox.classList.remove('is-locked');
    tiles().forEach((tile, i) => {
      tile.className = 'tile';
      tile.removeAttribute('aria-disabled');
      tile.querySelector('.tile-num').textContent = q.choices[i];
    });
    animateIn();

    round.locked = false;
    round.shownAt = performance.now();
    if (round.seconds) startTimer(round.seconds);
  }

  function choose(index) {
    if (!round || round.locked || performance.now() - round.shownAt < TAP_GUARD) return;
    const q = round.questions[round.index];
    settle(q.choices[index], index);
  }

  // picked is null when time ran out.
  function settle(picked, pickedIndex) {
    round.locked = true;
    stopTimer();
    const q = round.questions[round.index];
    const right = picked === q.answer;
    const timedOut = picked === null;
    const entry = {
      a: q.a,
      b: q.b,
      answer: q.answer,
      choices: q.choices.slice(),
      picked,
      right,
      ms: Math.round(performance.now() - round.shownAt),
    };
    round.answers.push({ ...entry, timedOut });
    if (round.record) {
      round.record.answers.push(entry);
      persist(round);
    }

    if (right) {
      round.score += 1;
      round.streak += 1;
      round.bestStreak = Math.max(round.bestStreak, round.streak);
    } else {
      round.streak = 0;
    }

    tilesBox.classList.add('is-locked');
    tiles().forEach((tile, i) => {
      tile.setAttribute('aria-disabled', 'true');
      if (q.choices[i] === q.answer) tile.classList.add('is-right');
      else if (i === pickedIndex) tile.classList.add('is-wrong');
      else tile.classList.add('is-faded');
    });
    markProgress(right ? 'is-right' : 'is-wrong');
    $('score').textContent = round.score;

    if (right) {
      const praise = PRAISE[Math.floor(Math.random() * PRAISE.length)];
      setFeedback(round.streak >= 3 ? `${praise} ${round.streak} in a row!` : praise, 'is-right');
      sound.right();
    } else {
      setFeedback(`${timedOut ? "Time's up!" : 'Not quite.'} ${q.a} ${symbolOf(round.operation)} ${q.b} = ${q.answer}`, 'is-wrong');
      if (timedOut) sound.timeUp();
      else sound.wrong();
    }

    round.pending = setTimeout(nextQuestion, right ? PAUSE_AFTER_RIGHT : PAUSE_AFTER_MISS);
  }

  function markProgress(state) {
    const cell = $('progress-cells').children[round.index];
    if (cell) cell.className = state;
  }

  function setFeedback(text, tone) {
    const box = $('feedback');
    box.textContent = text;
    box.className = tone ? `feedback ${tone}` : 'feedback';
  }

  function animateIn() {
    if (reduceMotion.matches || !Element.prototype.animate) return;
    $('question-text').animate(
      [{ transform: 'scale(0.8)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 260, easing: 'cubic-bezier(0.2, 1.3, 0.4, 1)' }
    );
    tiles().forEach((tile, i) => tile.animate(
      [{ transform: 'translateY(12px) scale(0.94)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 220, delay: 40 + i * 40, easing: 'ease-out', fill: 'backwards' }
    ));
  }

  // ---------- timer ----------

  let timerFrame = 0;

  function startTimer(seconds) {
    const limit = seconds * 1000;
    const started = performance.now();
    const fill = $('timer-fill');
    const label = $('timer-secs');
    const tick = (now) => {
      const left = Math.max(0, limit - Math.max(0, now - started));
      const share = left / limit;
      fill.style.transform = `scaleX(${share})`;
      fill.dataset.level = share > 0.5 ? 'ok' : share > 0.25 ? 'warn' : 'low';
      label.textContent = Math.ceil(left / 1000);
      if (left === 0) {
        timerFrame = 0;
        settle(null, -1);
        return;
      }
      timerFrame = requestAnimationFrame(tick);
    };
    tick(started);
  }

  function stopTimer() {
    cancelAnimationFrame(timerFrame);
    timerFrame = 0;
  }

  function stopRound() {
    if (round) clearTimeout(round.pending);
    stopTimer();
    wake.off();
    round = null;
  }

  // ---------- results screen ----------

  function finishRound() {
    const done = round;
    stopRound();
    if (done.record) {
      done.record.finished = true;
      persist(done);
    }
    const total = done.questions.length;
    const stars = Quiz.starsFor(done.score, total);

    $('stars').querySelectorAll('.star').forEach((star, i) => star.classList.toggle('is-on', i < stars));
    $('result-title').textContent = done.score === total ? 'Perfect score!' : RESULT_TITLES[stars];
    $('result-score').textContent = `You got ${done.score} out of ${total} right.`;
    $('stat-right').textContent = percent(done.score / total);
    $('stat-streak').textContent = done.bestStreak;
    $('stat-time-label').textContent = 'Avg. time';

    const answered = done.answers.filter((a) => !a.timedOut);
    const average = answered.reduce((sum, a) => sum + a.ms, 0) / (answered.length || 1);
    $('stat-time').textContent = answered.length ? `${secs(average)}s` : '-';

    renderReview(done.answers.filter((a) => !a.right), done.operation);
    showSaveNote(done);
    const link = $('results-report');
    link.hidden = !done.player;
    if (done.player) {
      link.textContent = `See ${done.player.name}'s progress`;
      link.dataset.player = done.player.id;
    }
    showScreen('results');
    sound.finish(stars);
    $('again').focus({ preventScroll: true });
  }

  function renderReview(misses, operation) {
    const list = $('review-list');
    const seen = new Set();
    list.replaceChildren();
    for (const miss of misses) {
      const key = Quiz.factKey(miss.a, miss.b, operation);
      if (seen.has(key)) continue;
      seen.add(key);
      const item = document.createElement('li');
      const fact = document.createElement('span');
      fact.className = 'review-fact';
      fact.textContent = `${miss.a} ${symbolOf(operation)} ${miss.b} = ${miss.answer}`;
      const note = document.createElement('span');
      note.className = 'review-note';
      note.textContent = miss.timedOut ? 'Time ran out' : `You picked ${miss.picked}`;
      item.append(fact, note);
      list.append(item);
    }
    $('review').hidden = misses.length === 0;
  }

  // ---------- a round of reading ----------

  const reader = window.Reader.create({
    sound,
    onAnswer(answer) {
      if (readRound && readRound.record) {
        readRound.record.answers.push(answer);
        persist(readRound);
      }
    },
    onFinish: finishReading,
  });

  // What gets saved for each reading round. Answers are added as they happen.
  function newReadRecord(player, focus, engine, plan) {
    const settings = { operation: 'read', page: reading.page, parts: reading.parts.slice(), count: reading.count, focus, engine };
    if (plan.to !== reading.page) settings.to = plan.to;
    return {
      id: Players.newId('r'),
      playerId: player.id,
      startedAt: new Date().toISOString(),
      settings,
      answers: [],
      finished: false,
    };
  }

  async function startReading() {
    if (readRound) return;
    sound.unlock();
    const player = currentPlayer();
    const focus = effectiveReadFocus();
    const plan = readPlan();
    const items = Reading.createRound(reading.page, { ...reading, focus }, Reading.weightFinder(player ? readingFor(player.id) : null));
    if (!items.length) return;
    // Sounds are always checked by a grown-up, so a round of only sounds never listens.
    const engine = items.every((item) => item.kind === 'sound') ? 'off' : readEngine();
    if (engine === 'vosk') {
      if (Listen.vosk.state !== 'ready') return;
      const opened = await Listen.vosk.open(); // asks for the mic, so it runs straight from the tap
      if (!opened) {
        $('engine-help').textContent = Listen.vosk.error === 'NotAllowedError'
          ? 'The browser isn’t allowed to use the microphone. Allow it for this site, then try again.'
          : 'Couldn’t open the microphone.';
        return;
      }
    }
    readRound = {
      player,
      parts: [...new Set(items.map((item) => (item.kind === 'sight' || item.kind === 'word' ? 'words' : `${item.kind}s`)))],
      engine,
      record: player ? newReadRecord(player, focus, engine, plan) : null,
      save: player ? Players.makeSaver((record) => store.saveRound(record)) : null,
      lastSave: null,
    };
    lastPlayed = 'read';
    showScreen('read');
    wake.on();
    reader.start({
      items,
      engine,
      vocabulary: Reading.vocabularyOf(plan.pages),
      names: Reading.lesson(reading.page).names,
      // A level bar while listening: Vosk always has the mic; the browser's recognition can share it only on a computer.
      meter: engine === 'vosk' || (engine === 'online' && Listen.canShareMic(device)),
    });
    $('read-right').focus({ preventScroll: true });
  }

  function stopReading() {
    const quitting = readRound;
    reader.stop();
    wake.off();
    readRound = null;
    return quitting;
  }

  function finishReading(summary) {
    const done = stopReading();
    if (!done) return;
    if (done.record) {
      done.record.finished = true;
      persist(done);
    }
    const total = summary.answers.length;
    const stars = Quiz.starsFor(summary.score, total);
    $('stars').querySelectorAll('.star').forEach((star, i) => star.classList.toggle('is-on', i < stars));
    $('result-title').textContent = total && summary.score === total ? 'Perfect reading!' : RESULT_TITLES[stars];
    if (done.parts.length === 1) {
      const [one, many] = PART_NOUNS[done.parts[0]];
      $('result-score').textContent = `You ${done.parts[0] === 'sounds' ? 'said' : 'read'} ${summary.score} of ${total} ${total === 1 ? one : many} right.`;
    } else {
      $('result-score').textContent = `You got ${summary.score} of ${total} right.`;
    }
    $('stat-right').textContent = total ? percent(summary.score / total) : '-';
    $('stat-streak').textContent = summary.bestStreak;
    $('stat-time-label').textContent = 'Checked by voice';
    $('stat-time').textContent = done.engine === 'off' ? '-' : `${summary.byVoice} of ${total}`;
    renderReadReview(summary.answers.filter((a) => !a.right));
    showSaveNote(done);
    const link = $('results-report');
    link.hidden = !done.player;
    if (done.player) {
      link.textContent = `See ${done.player.name}'s progress`;
      link.dataset.player = done.player.id;
    }
    showScreen('results');
    sound.finish(stars);
    $('again').focus({ preventScroll: true });
  }

  function renderReadReview(misses) {
    const list = $('review-list');
    list.replaceChildren(...misses.map((miss) => {
      const item = element('li', '');
      item.append(
        element('span', `review-fact${miss.kind === 'sentence' ? ' is-sentence' : ''}`, miss.shown || miss.item),
        element('span', 'review-note', miss.how === 'skip' ? 'Not yet' : 'Read after Hear it')
      );
      return item;
    }));
    $('review').hidden = misses.length === 0;
  }

  // ---------- progress report ----------

  function openReport(id) {
    reportFor = id;
    reportOp = activity === 'read' ? 'read' : settings.operation;
    trendPick = -1;
    for (const [buttonId, panelId] of [['map-list-toggle', 'map-list'], ['trend-table-toggle', 'trend-table-box']]) {
      const button = $(buttonId);
      button.setAttribute('aria-expanded', 'false');
      button.textContent = button.dataset.open;
      $(panelId).hidden = true;
    }
    showScreen('report');
    renderReport();
    loadHistory(id, true);
    $('report-back').focus({ preventScroll: true });
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderReport() {
    const player = players.find((p) => p.id === reportFor);
    if (!player) return;
    $('report-title').textContent = `${player.name}'s progress`;
    const entry = histories.get(player.id);
    const note = $('report-note');
    const body = $('report-body');
    // Show what's set up on the setup screen, or what's been played.
    const read = readingFor(player.id);
    const played = [...(overallFor(player.id) ? overallFor(player.id).operations : []), ...(read && read.totals.rounds ? ['read'] : [])];
    if (played.length && !played.includes(reportOp)) reportOp = played[0];
    $('report-ops').hidden = played.length < 2;
    for (const op of [...Quiz.OPERATION_OPTIONS, 'read']) $(`report-op-${op}`).closest('.pill').hidden = !played.includes(op);
    $(`report-op-${reportOp}`).checked = true;
    const reads = reportOp === 'read';
    setReportKind(reads);
    const analysis = reportAnalysis();
    let problem = '';
    if (!entry || entry.status === 'loading') problem = `Loading ${player.name}'s history…`;
    else if (entry.status === 'failed') problem = `${player.name}'s history couldn't load right now. Try again in a moment.`;
    else if (reads && !analysis.totals.rounds) {
      problem = `${player.name} hasn't done any reading yet. After a round or two, this page shows which words and sounds are known, which need practice, and how it's going over time.`;
    } else if (!reads && !analysis.totals.questions) {
      problem = `${player.name} hasn't played yet. After a round or two, this page shows which facts are known by heart, which need practice, and how it's going over time.`;
    }
    note.textContent = problem;
    note.hidden = !problem;
    body.hidden = Boolean(problem);
    $('report-print').hidden = Boolean(problem) || window.self !== window.top || typeof window.print !== 'function';
    if (problem) {
      $('report-sub').textContent = '';
      return;
    }

    const { totals } = analysis;
    $('report-sub').textContent = `${plural(totals.rounds, reads ? 'reading round' : 'round')} on ${plural(totals.days, 'day')}, since ${dayFormat.format(totals.firstAt)}`;
    if (reads) {
      renderReadKpis(analysis);
      renderReadAdvice(analysis, player);
      renderReadTricky(analysis);
      renderWordWall(analysis);
      renderTrend(analysis);
      renderReadRounds(analysis);
      return;
    }
    renderKpis(analysis);
    renderAdvice(analysis, player);
    renderTricky(analysis);
    renderMastery(analysis);
    renderTrend(analysis);
    renderRounds(analysis);
  }

  // The analysis behind the report on screen: one math operation's, or reading's.
  function reportAnalysis() {
    if (!reportFor) return null;
    return reportOp === 'read' ? readingFor(reportFor) : analysisFor(reportFor, reportOp);
  }

  // The report's panels show math facts or reading; these change with it.
  function setReportKind(reads) {
    $('tricky-title').textContent = reads ? 'Trickiest words and sounds' : 'Trickiest facts';
    $('mastery-chart').hidden = reads;
    $('word-wall').hidden = !reads;
    $('trend-time-figure').hidden = reads;
    $('trend-time-head').hidden = reads;
  }

  // A stat tile: label, value, a short note, and how it changed (tone: 'good', 'bad' or '').
  function kpi(label, value, note, change) {
    const box = element('div', 'kpi');
    box.append(element('dt', '', label), element('dd', 'kpi-value', value));
    if (note) box.append(element('dd', 'kpi-note', note));
    if (change) {
      const delta = element('dd', `kpi-change${change.tone ? ` is-${change.tone}` : ''}`);
      if (change.tone) delta.append(element('span', 'kpi-arrow', change.arrow));
      delta.append(document.createTextNode(change.text));
      box.append(delta);
    }
    return box;
  }

  function renderKpis(analysis) {
    const { levels, lately, earlier, masteredBefore, totals } = analysis;
    const tried = levels.mastered + levels.learning + levels.practice;
    const span = earlier ? `last ${Insights.LATELY} rounds` : 'so far';
    const tiles = [];

    let change = null;
    if (masteredBefore !== null) {
      const gained = levels.mastered - masteredBefore;
      const ago = `${Insights.LATELY} rounds ago`;
      change = gained === 0
        ? { tone: '', text: `Same as ${ago}` }
        : { tone: gained > 0 ? 'good' : 'bad', arrow: gained > 0 ? '↑' : '↓', text: `${Math.abs(gained)} ${gained > 0 ? 'more' : 'fewer'} than ${ago}` };
    }
    tiles.push(kpi('Known by heart', String(levels.mastered), `of ${plural(tried, 'fact')} tried`, change));

    change = null;
    if (earlier) {
      const points = Math.round(lately.accuracy * 100) - Math.round(earlier.accuracy * 100);
      change = Math.abs(points) < 3
        ? { tone: '', text: `About the same as before (${percent(earlier.accuracy)})` }
        : { tone: points > 0 ? 'good' : 'bad', arrow: points > 0 ? '↑' : '↓', text: `${points > 0 ? 'Up' : 'Down'} from ${percent(earlier.accuracy)}` };
    }
    tiles.push(kpi(earlier ? 'Right lately' : 'Right so far', percent(lately.accuracy), span, change));

    change = null;
    if (earlier && earlier.typicalMs !== null && lately.typicalMs !== null) {
      const faster = earlier.typicalMs - lately.typicalMs;
      change = Math.abs(faster) < 300
        ? { tone: '', text: 'About the same as before' }
        : { tone: faster > 0 ? 'good' : 'bad', arrow: faster > 0 ? '↓' : '↑', text: `${secs(Math.abs(faster))} s ${faster > 0 ? 'faster' : 'slower'}` };
    }
    tiles.push(kpi(earlier ? 'Answer time lately' : 'Answer time so far', lately.typicalMs === null ? '-' : `${secs(lately.typicalMs)} s`, `typical, ${span}`, change));

    tiles.push(kpi('Played', plural(totals.rounds, 'round'), `${totals.questions} questions on ${plural(totals.days, 'day')}`, null));
    $('report-kpis').replaceChildren(...tiles);
  }

  function renderAdvice(analysis, player) {
    const list = $('report-advice');
    list.replaceChildren(...Insights.advice(analysis, player.name).map((tip) => element('li', '', tip)));
    const { practice, learning } = analysis.levels;
    $('report-practice').hidden = practice + learning === 0;
  }

  function renderTricky(analysis) {
    const list = $('tricky-list');
    const facts = Insights.trickiest(analysis);
    if (!facts.length) {
      list.replaceChildren(element('li', 'tricky-none', 'Nothing tricky right now: every fact tried lately was right, and quick.'));
      return;
    }
    list.replaceChildren(...facts.map((f) => {
      const item = element('li', `tricky lv-${f.level}`);
      const head = element('div', 'tricky-head');
      head.append(element('span', 'tricky-fact', `${f.a} ${symbolOf(f.operation)} ${f.b} = ${f.answer}`), element('span', 'level-tag', LEVEL_NAMES[f.level]));
      const bits = [recentText(f)];
      if (f.slip) bits.push(`picked ${Insights.slipText(f.a, f.b, f.slip.value, f.operation)}${f.slip.count > 1 ? `, ${times(f.slip.count)}` : ''}`);
      else if (f.timeouts) bits.push(`time ran out ${times(f.timeouts)}`);
      if (f.level === 'learning' && f.typicalMs !== null && f.typicalMs > Insights.FLUENT_MS) bits.push(`about ${secs(f.typicalMs)} s to answer`);
      item.append(head, element('p', 'tricky-note', `${bits.join('; ')}.`));
      return item;
    }));
  }

  function factDetail(analysis, row, col) {
    const { a, b, key } = cellFact(row, col, analysis.operation);
    const fact = analysis.facts.get(key);
    const name = `${a} ${symbolOf(analysis.operation)} ${b} = ${Quiz.answerFor(a, b, analysis.operation)}`;
    if (!fact) return `${name}: not tried yet.`;
    let text = `${name}: ${LEVEL_NAMES[fact.level].toLowerCase()}. ${recentText(fact)}`;
    if (fact.typicalMs !== null) text += `, typically in ${secs(fact.typicalMs)} s`;
    text += '.';
    if (fact.slip) text += ` Picked ${fact.slip.value} ${times(fact.slip.count)}.`;
    return text;
  }

  function renderMastery(analysis) {
    const chart = $('mastery-chart');
    const counts = { mastered: 0, learning: 0, practice: 0, new: 0 };
    const seen = new Set();
    $('map-title').textContent = wordsFor(analysis.operation).map;
    labelChart(chart, analysis.operation);
    for (const node of chart.children) {
      const { row, col } = node.dataset;
      if (row === undefined || col === undefined) continue;
      const { key } = cellFact(Number(row), Number(col), analysis.operation);
      const fact = analysis.facts.get(key);
      const level = fact ? fact.level : 'new';
      node.className = `cell lv-${level}`;
      if (!seen.has(key)) {
        seen.add(key);
        counts[level] += 1;
      }
    }
    $('mastery-legend').replaceChildren(...Insights.LEVELS.map((level) => {
      const item = element('li', '');
      item.append(element('span', `swatch lv-${level}`), element('span', '', LEVEL_NAMES[level]));
      // No count for facts not tried: that would include every table left out on purpose.
      if (level !== 'new') item.append(element('b', '', String(counts[level])));
      return item;
    }));
    $('map-detail').textContent = 'Tap or point at a fact to see how it’s going.';

    // The same map as a list, for screen readers and anyone who'd rather read it.
    // Subtraction and division go row by row, like the map: 8 − 7, 9 − 7, and so on.
    const byRow = !Quiz.operationOf(analysis.operation).eitherOrder;
    const groups = Insights.LEVELS.filter((level) => level !== 'new').map((level) => {
      const facts = [...analysis.facts.values()].filter((f) => f.level === level)
        .sort((x, y) => (byRow ? x.b - y.b || x.a - y.a : x.a - y.a || x.b - y.b))
        .map((f) => `${f.a} ${symbolOf(f.operation)} ${f.b}`);
      const line = element('p', '');
      line.append(element('strong', '', `${LEVEL_NAMES[level]} (${facts.length}): `), document.createTextNode(facts.length ? facts.join(', ') : 'none yet'));
      return line;
    });
    $('map-list').replaceChildren(...groups);
  }

  function pickMasteryCell(event) {
    const cell = event.target.closest('.cell');
    const analysis = reportFor ? analysisFor(reportFor, reportOp) : null;
    if (!cell || !analysis) return;
    for (const node of $('mastery-chart').querySelectorAll('.is-picked')) node.classList.remove('is-picked');
    cell.classList.add('is-picked');
    $('map-detail').textContent = factDetail(analysis, Number(cell.dataset.row), Number(cell.dataset.col));
  }

  // ---------- the reading report ----------

  const READ_KIND_NAMES = { sight: 'sight word', word: 'word to sound out', sound: 'sound', sentence: 'sentence' };

  function renderReadKpis(analysis) {
    const { items, lately, earlier, totals } = analysis;
    const known = (kinds) => {
      const tried = [...items.values()].filter((e) => kinds.includes(e.kind));
      return { tried: tried.length, mastered: tried.filter((e) => e.level === 'mastered').length };
    };
    const tiles = [];
    const sight = known(['sight']);
    tiles.push(kpi('Sight words known', String(sight.mastered), `of ${plural(sight.tried, 'sight word')} tried`, null));
    let change = null;
    if (earlier) {
      const points = Math.round(lately.accuracy * 100) - Math.round(earlier.accuracy * 100);
      change = Math.abs(points) < 3
        ? { tone: '', text: `About the same as before (${percent(earlier.accuracy)})` }
        : { tone: points > 0 ? 'good' : 'bad', arrow: points > 0 ? '↑' : '↓', text: `${points > 0 ? 'Up' : 'Down'} from ${percent(earlier.accuracy)}` };
    }
    tiles.push(kpi(earlier ? 'Read right lately' : 'Read right so far', percent(lately.accuracy), earlier ? `last ${Reading.LATELY} rounds` : 'so far', change));
    const sounds = known(['sound']);
    const decode = known(['word']);
    if (sounds.tried) tiles.push(kpi('Sounds known', String(sounds.mastered), `of ${plural(sounds.tried, 'sound')} tried`, null));
    else tiles.push(kpi('Words to sound out', String(decode.mastered), `known, of ${decode.tried} tried`, null));
    tiles.push(kpi('Read', plural(totals.rounds, 'round'), `${totals.questions} items on ${plural(totals.days, 'day')}`, null));
    $('report-kpis').replaceChildren(...tiles);
  }

  function renderReadAdvice(analysis, player) {
    const tips = [];
    if (analysis.daysSinceLast >= 7) {
      tips.push(`It's been ${analysis.daysSinceLast} days since the last reading round. A few minutes most days helps words stick.`);
    }
    const words = Reading.trickiest(analysis, ['sight', 'word'], 4).filter((e) => e.level === 'practice');
    if (words.length) {
      tips.push(`Practice ${Insights.listOf(words.map((e) => `“${e.item}”`))}. Choose “Weak spots” on the setup screen and ${words.length > 1 ? 'they' : 'it'}'ll come up more often.`);
    }
    const misheard = words.find((e) => e.lastHeard && !Reading.checkWord(e.item, [{ transcript: e.lastHeard }]).ok);
    if (misheard) {
      tips.push(`“${misheard.item}” was last heard as “${misheard.lastHeard}”. If that's what ${player.name} said, sound it out together.`);
    }
    const sounds = Reading.trickiest(analysis, ['sound'], 4).filter((e) => e.level === 'practice');
    if (sounds.length) tips.push(`Sounds to practice: ${Insights.listOf(sounds.map((e) => `“${e.item}”`))}.`);
    const sentences = Reading.trickiest(analysis, ['sentence'], 2).filter((e) => e.level === 'practice');
    if (sentences.length) tips.push(`Read ${sentences.length > 1 ? 'these sentences' : 'this sentence'} together again: ${sentences.map((e) => `“${e.item}”`).join(' ')}`);
    if (!tips.length) tips.push('Keep it up! A few minutes of reading most days keeps the words fresh.');
    $('report-advice').replaceChildren(...tips.slice(0, 4).map((tip) => element('li', '', tip)));
    $('report-practice').hidden = !Reading.trickiest(analysis, ['sight', 'word', 'sound'], 1).length;
  }

  function readingDetail(entry) {
    let text = `${recentText(entry)}.`;
    const last = entry.tries[entry.tries.length - 1];
    if (!last.right) text += last.how === 'skip' ? ' Last time: Not yet.' : ' Last time: read after Hear it.';
    else if (last.how === 'grown-up') text += ' Last time: checked by a grown-up.';
    if (entry.lastHeard) text += ` Heard as “${entry.lastHeard}” when it was missed.`;
    return text;
  }

  function renderReadTricky(analysis) {
    const list = $('tricky-list');
    const items = Reading.trickiest(analysis);
    if (!items.length) {
      list.replaceChildren(element('li', 'tricky-none', 'Nothing tricky right now: everything read lately was read right.'));
      return;
    }
    list.replaceChildren(...items.map((e) => {
      const item = element('li', `tricky lv-${e.level}`);
      const head = element('div', 'tricky-head');
      head.append(element('span', `tricky-fact${e.kind === 'sentence' ? ' is-sentence' : ''}`, e.item), element('span', 'level-tag', LEVEL_NAMES[e.level]));
      item.append(head, element('p', 'tricky-note', `${READ_KIND_NAMES[e.kind][0].toUpperCase()}${READ_KIND_NAMES[e.kind].slice(1)}. ${readingDetail(e)}`));
      return item;
    }));
  }

  // Every sight word the packet has taught up to the furthest page read, then the sounds and words tried.
  function renderWordWall(analysis) {
    $('map-title').textContent = 'Word wall';
    const furthest = Math.max(Reading.FIRST_PAGE, ...analysis.rounds.map((r) => r.settings.to || r.settings.page));
    const taught = [];
    for (let page = Reading.FIRST_PAGE; page <= furthest; page++) {
      const l = Reading.lesson(page);
      if (l) for (const w of l.newWords) if (!taught.includes(w)) taught.push(w);
    }
    const levelOf = (key) => {
      const entry = analysis.items.get(key);
      return entry ? entry.level : 'new';
    };
    const counts = { mastered: 0, learning: 0, practice: 0, new: 0 };
    const group = (title, entries) => {
      const box = element('div', 'wall-group');
      box.append(element('h4', 'wall-title', title));
      const list = element('ul', 'word-chips');
      for (const [key, text] of entries) {
        const level = levelOf(key);
        counts[level] += 1;
        const chip = element('li', `word-chip wall-chip lv-${level}`, text);
        chip.dataset.key = key;
        chip.tabIndex = 0;
        list.append(chip);
      }
      box.append(list);
      return box;
    };
    const tried = (kind) => [...analysis.items.values()].filter((e) => e.kind === kind).map((e) => [e.key, e.item]);
    const groups = [group(`Sight words up to page ${furthest}`, taught.map((w) => [Reading.keyOf('sight', w), w]))];
    if (tried('word').length) groups.push(group('Words sounded out', tried('word')));
    if (tried('sound').length) groups.push(group('Sounds', tried('sound')));
    $('word-wall').replaceChildren(...groups);
    $('mastery-legend').replaceChildren(...Insights.LEVELS.map((level) => {
      const item = element('li', '');
      item.append(element('span', `swatch lv-${level}`), element('span', '', LEVEL_NAMES[level]), element('b', '', String(counts[level])));
      return item;
    }));
    $('map-detail').textContent = 'Tap a word to see how it’s going.';
    // The same wall as a list.
    $('map-list').replaceChildren(...Insights.LEVELS.map((level) => {
      const names = [...$('word-wall').querySelectorAll(`.lv-${level}`)].map((chip) => chip.textContent);
      const line = element('p', '');
      line.append(element('strong', '', `${LEVEL_NAMES[level]} (${names.length}): `), document.createTextNode(names.length ? names.join(', ') : 'none yet'));
      return line;
    }));
  }

  function pickWallChip(event) {
    const chip = event.target.closest('.wall-chip');
    const analysis = reportOp === 'read' ? reportAnalysis() : null;
    if (!chip || !analysis) return;
    for (const node of $('word-wall').querySelectorAll('.is-picked')) node.classList.remove('is-picked');
    chip.classList.add('is-picked');
    const entry = analysis.items.get(chip.dataset.key);
    $('map-detail').textContent = entry ? `${entry.item}: ${LEVEL_NAMES[entry.level].toLowerCase()}. ${readingDetail(entry)}` : `${chip.textContent}: not tried yet.`;
  }

  function renderReadRounds(analysis) {
    const checks = { online: 'checked by voice', vosk: 'checked by voice on the device', off: 'checked by a grown-up' };
    const recent = analysis.rounds.slice(-8).reverse();
    $('round-list').replaceChildren(...recent.map((r) => {
      const s = r.settings;
      const right = r.answers.filter((x) => x.right).length;
      const parts = s.parts.map((part) => PART_NOUNS[part][1]);
      const what = [s.to && s.to !== s.page ? `Pages ${Math.min(s.page, s.to)}–${Math.max(s.page, s.to)}` : `Page ${s.page}`, parts.length ? `${parts[0][0].toUpperCase()}${Insights.listOf(parts).slice(1)}` : '', checks[s.engine]].filter(Boolean);
      if (s.focus === 'weak') what.push('Weak spots');
      if (!r.finished) what.push(`stopped after ${r.answers.length}`);
      const item = element('li', 'round-row');
      const text = element('div', 'round-text');
      text.append(element('span', 'round-when', whenFormat.format(r.at)), element('span', 'round-what', what.join(' · ')));
      item.append(text, element('span', 'round-score', `${right}/${r.answers.length}`));
      return item;
    }));
  }

  // ---------- progress charts ----------
  // Two small charts over the same days (or rounds): the share of right
  // answers, and the typical time to answer. One point is picked at a time;
  // it's marked in both charts and spelled out underneath.

  const CHART = { height: 150, top: 22, right: 14, bottom: 24, left: 44 };

  function trendLabel(point, unit) {
    return unit === 'day' ? dayFormat.format(point.at) : `Round ${point.number}`;
  }

  function niceTop(maxSeconds) {
    return [2, 4, 6, 8, 10, 15, 20, 30, 40, 60, 90, 120].find((n) => n >= maxSeconds) || Math.ceil(maxSeconds / 60) * 60;
  }

  // A bar with a rounded top and a square foot on the baseline.
  function barPath(x, y, w, h) {
    const r = Math.min(4, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  function drawTrend(box, points, unit, options) {
    const width = Math.max(220, Math.floor(box.clientWidth));
    const { height, top, right, bottom, left } = CHART;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const slot = plotW / points.length;
    const x = (i) => left + slot * (i + 0.5);
    const y = (v) => top + plotH * (1 - v / options.max);
    const pick = trendPick;
    const parts = [`<svg class="trend-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">`];
    for (const t of options.ticks) {
      parts.push(`<line class="grid${t === 0 ? ' base' : ''}" x1="${left}" x2="${width - right}" y1="${y(t)}" y2="${y(t)}"/>`);
      parts.push(`<text class="tick" x="${left - 8}" y="${y(t)}" dy="0.32em" text-anchor="end">${options.format(t)}</text>`);
    }
    parts.push(`<line class="crosshair" x1="${x(pick)}" x2="${x(pick)}" y1="${top}" y2="${top + plotH}"/>`);
    const values = points.map(options.value);
    if (options.kind === 'bars') {
      const w = Math.max(2, Math.min(24, slot - 2));
      values.forEach((v, i) => {
        if (v === null) return;
        const h = Math.max(2, plotH * (v / options.max));
        parts.push(`<path class="bar${i === pick ? ' is-picked' : ''}" d="${barPath(x(i) - w / 2, top + plotH - h, w, h)}"/>`);
      });
    } else {
      let d = '';
      let drawing = false;
      values.forEach((v, i) => {
        if (v === null) {
          drawing = false;
          return;
        }
        d += `${drawing ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        drawing = true;
      });
      parts.push(`<path class="line" d="${d}"/>`);
      values.forEach((v, i) => {
        if (v !== null) parts.push(`<circle class="dot${i === pick ? ' is-picked' : ''}" cx="${x(i)}" cy="${y(v)}" r="${i === pick ? 5 : 4}"/>`);
      });
    }
    // Label the picked point's value; the axis and the line under the charts carry the rest.
    const picked = values[pick];
    if (picked !== null && picked !== undefined) {
      const anchor = points.length > 1 && pick === 0 ? 'start' : points.length > 1 && pick === points.length - 1 ? 'end' : 'middle';
      const nudge = anchor === 'start' ? -6 : anchor === 'end' ? 6 : 0;
      parts.push(`<text class="value" x="${x(pick) + nudge}" y="${y(picked) - 9}" text-anchor="${anchor}">${options.format(picked)}</text>`);
    }
    parts.push(`<text class="tick" x="${left}" y="${height - 6}">${trendLabel(points[0], unit)}</text>`);
    if (points.length > 1) parts.push(`<text class="tick" x="${width - right}" y="${height - 6}" text-anchor="end">${trendLabel(points[points.length - 1], unit)}</text>`);
    parts.push('</svg>');
    box.innerHTML = parts.join('');
    box.dataset.slot = String(slot);
  }

  function trendRow(point, unit) {
    const right = point.questions ? percent(point.right / point.questions) : '-';
    const when = unit === 'day' ? dayFormat.format(point.at) : `Round ${point.number}, ${dayFormat.format(point.at)}`;
    if (reportOp === 'read') return `${when}: ${right} read right (${point.right} of ${point.questions}).`;
    const time = point.typicalMs === null ? 'no answers in time' : `typically ${secs(point.typicalMs)} s an answer`;
    return `${when}: ${right} right (${point.right} of ${point.questions}), ${time}.`;
  }

  function renderTrend(analysis) {
    const { unit, points } = analysis.trend;
    if (trendPick < 0 || trendPick >= points.length) trendPick = points.length - 1;
    const reads = reportOp === 'read';
    $('trend-unit').textContent = unit === 'day'
      ? `Each ${reads ? 'bar' : 'bar and dot'} is one day of ${reads ? 'reading' : 'play'}, for the last ${plural(points.length, 'day')} ${reads ? 'read' : 'played'}.`
      : `Each ${reads ? 'bar' : 'bar and dot'} is one round. After 3 days of ${reads ? 'reading' : 'play'}, it switches to one per day.`;
    drawTrends(analysis);
    $('trend-table-when').textContent = unit === 'day' ? 'Day' : 'Round';
    $('trend-table-rows').replaceChildren(...points.map((p) => {
      const row = element('tr', '');
      const head = element('th', '', unit === 'day' ? dayFormat.format(p.at) : `${p.number} (${dayFormat.format(p.at)})`);
      head.scope = 'row';
      row.append(head, element('td', '', String(p.questions)), element('td', '', `${p.right} (${percent(p.right / p.questions)})`));
      if (!reads) row.append(element('td', '', p.typicalMs === null ? '-' : `${secs(p.typicalMs)} s`));
      return row;
    }));
  }

  function drawTrends(analysis) {
    const { unit, points } = analysis.trend;
    drawTrend($('trend-right'), points, unit, {
      kind: 'bars',
      max: 1,
      ticks: [0, 0.5, 1],
      value: (p) => (p.questions ? p.right / p.questions : null),
      format: (v) => percent(v),
    });
    const slowest = Math.max(...points.map((p) => p.typicalMs || 0)) / 1000;
    const topSeconds = niceTop(Math.max(slowest, 1));
    drawTrend($('trend-time'), points, unit, {
      kind: 'line',
      max: topSeconds * 1000,
      ticks: [0, topSeconds * 500, topSeconds * 1000],
      value: (p) => p.typicalMs,
      format: (v) => `${Number((v / 1000).toFixed(1))} s`,
    });
    $('trend-detail').textContent = trendRow(points[trendPick], unit);
  }

  function pickTrend(index) {
    const analysis = reportAnalysis();
    if (!analysis) return;
    const next = Math.max(0, Math.min(analysis.trend.points.length - 1, index));
    if (next === trendPick) return;
    trendPick = next;
    drawTrends(analysis);
  }

  function trendPointer(event) {
    const box = event.currentTarget;
    const slot = Number(box.dataset.slot);
    if (!slot) return;
    const rect = box.getBoundingClientRect();
    pickTrend(Math.floor((event.clientX - rect.left - CHART.left) / slot));
  }

  function trendKey(event) {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (step) {
      event.preventDefault();
      pickTrend(trendPick + step);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      pickTrend(event.key === 'Home' ? 0 : Infinity);
    }
  }

  function renderRounds(analysis) {
    const recent = analysis.rounds.slice(-8).reverse();
    $('round-list').replaceChildren(...recent.map((r) => {
      const s = r.settings;
      const right = r.answers.filter((x) => x.right).length;
      // "Tables 3–10", "7 × 1–10", "Take away 7, answers 1–10"
      let picks = `${wordsFor(s.operation).picks} ${tablesText(s.tables)}`;
      if (s.multiplyBy === 'range' && s.from !== null && s.to !== null) {
        picks = Quiz.operationOf(s.operation).eitherOrder
          ? `${tablesText(s.tables)} ${symbolOf(s.operation)} ${s.from}–${s.to}`
          : `${picks}, answers ${s.from}–${s.to}`;
      }
      const what = [picks, s.timeLimit ? `${s.timeLimit} s a question` : 'Relaxed'];
      if (s.focus === 'weak') what.push('Weak spots');
      if (!r.finished) what.push(`stopped after ${r.answers.length}`);
      const item = element('li', 'round-row');
      const text = element('div', 'round-text');
      text.append(element('span', 'round-when', whenFormat.format(r.at)), element('span', 'round-what', what.join(' · ')));
      item.append(text, element('span', 'round-score', `${right}/${r.answers.length}`));
      return item;
    }));
  }

  // ---------- wiring ----------

  function showScreen(name) {
    for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
    window.scrollTo(0, 0);
  }

  function showSetup() {
    showScreen('setup');
    const player = currentPlayer();
    if (player) loadHistory(player.id, true);
    renderPlayerHelp();
    renderSetupState();
  }

  function renderSound() {
    for (const id of ['sound', 'read-sound']) $(id).setAttribute('aria-pressed', String(settings.sound));
  }

  function toggleView(button, panel) {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    button.textContent = open ? button.dataset.close : button.dataset.open;
    panel.hidden = !open;
  }

  form.addEventListener('change', (event) => {
    const target = event.target;
    if (target.name === 'player') choosePlayer(target.value);
    else if (target.name === 'operation') chooseActivity(target.value);
    else if (target.closest('#read-fields')) readReadingSetup(target);
    else if (target.id !== 'new-player-name') readSetup(target);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if ($('start').disabled) return;
    if (activity === 'read') startReading();
    else startRound();
  });
  $('page-down').addEventListener('click', () => stepPage(-1));
  $('page-up').addEventListener('click', () => stepPage(1));
  // Enter in the page box picks the page instead of starting a round.
  $('read-page').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      readReadingSetup($('read-page'));
    }
  });
  $('read-vosk-retry').addEventListener('click', loadVosk);
  $('tables-all').addEventListener('click', () => setAllTables(true));
  $('tables-none').addEventListener('click', () => setAllTables(false));

  tilesBox.addEventListener('click', (event) => {
    const tile = event.target.closest('.tile');
    if (tile) choose(tiles().indexOf(tile));
  });

  $('quit').addEventListener('click', () => {
    const quitting = round;
    stopRound();
    // Keep whatever was answered before stopping.
    if (quitting && quitting.record && quitting.record.answers.length) persist(quitting).catch(() => {});
    showSetup();
  });
  for (const id of ['sound', 'read-sound']) {
    $(id).addEventListener('click', () => {
      settings.sound = !settings.sound;
      saveSettings();
      renderSound();
      if (settings.sound) sound.unlock();
    });
  }
  $('read-quit').addEventListener('click', () => {
    const quitting = stopReading();
    // Keep whatever was read before stopping.
    if (quitting && quitting.record && quitting.record.answers.length) persist(quitting).catch(() => {});
    showSetup();
  });
  $('again').addEventListener('click', () => {
    if (lastPlayed === 'read') startReading();
    else startRound();
  });
  $('change').addEventListener('click', showSetup);

  $('add-player-open').addEventListener('click', openAddPlayer);
  $('add-player-cancel').addEventListener('click', closeAddPlayer);
  $('add-player-save').addEventListener('click', addPlayer);
  $('new-player-name').addEventListener('keydown', (event) => {
    // Enter would otherwise submit the settings form and start a round.
    if (event.key === 'Enter') {
      event.preventDefault();
      addPlayer();
    } else if (event.key === 'Escape') {
      closeAddPlayer();
    }
  });

  $('open-report').addEventListener('click', () => {
    const player = currentPlayer();
    if (player) openReport(player.id);
  });
  $('results-report').addEventListener('click', (event) => openReport(event.currentTarget.dataset.player));
  $('report-back').addEventListener('click', showSetup);
  $('report-print').addEventListener('click', () => window.print());
  $('report-practice').addEventListener('click', () => {
    if (reportFor) settings.playerId = reportFor;
    if (reportOp === 'read') {
      activity = 'read';
      reading.focus = 'weak';
      if (!weakParts()) reading.parts = ['words'];
    } else {
      activity = 'math';
      switchOperation(reportOp);
      settings.focus = 'weak';
    }
    saveSettings();
    renderPlayers();
    renderSetup();
    showSetup();
    $('start').focus({ preventScroll: true });
  });
  $('report-ops').addEventListener('change', (event) => {
    reportOp = event.target.value;
    trendPick = -1;
    renderReport();
  });
  $('word-wall').addEventListener('click', pickWallChip);
  $('word-wall').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pickWallChip(event);
    }
  });
  $('mastery-chart').addEventListener('pointerover', pickMasteryCell);
  $('mastery-chart').addEventListener('click', pickMasteryCell);
  for (const id of ['trend-right', 'trend-time']) {
    $(id).addEventListener('pointermove', trendPointer);
    $(id).addEventListener('pointerdown', trendPointer);
    $(id).addEventListener('keydown', trendKey);
  }
  for (const [buttonId, open, close, panelId] of [
    ['map-list-toggle', 'Show as a list', 'Hide the list', 'map-list'],
    ['trend-table-toggle', 'Show as a table', 'Hide the table', 'trend-table-box'],
  ]) {
    const button = $(buttonId);
    Object.assign(button.dataset, { open, close });
    button.addEventListener('click', () => toggleView(button, $(panelId)));
  }
  // The charts are drawn to fit their box, so redraw them when it changes size.
  if (window.ResizeObserver) {
    let frame = 0;
    let lastWidth = 0;
    new ResizeObserver((entries) => {
      const width = Math.round(entries[0].contentRect.width);
      if (width === lastWidth) return;
      lastWidth = width;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const analysis = !screens.report.hidden ? reportAnalysis() : null;
        if (analysis && analysis.totals.questions) drawTrends(analysis);
      });
    }).observe($('trend-right'));
  }

  buildSetup();
  buildReadSetup();
  buildTiles();
  renderSetup();
  renderPlayers();
  renderSound();
  showScreen('setup');
  connectStore();
  Listen.describeDevice().then((found) => {
    device = found;
    if (activity === 'read') renderSetupState();
  }, () => {});
  // Checking on the device was picked last time: get it ready (after the first time, it loads from this browser).
  if (reading.engine === 'vosk') loadVosk();
})();
