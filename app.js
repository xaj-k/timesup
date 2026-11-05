/*
 * Times Up: screens, timer and sound. The quiz rules are in quiz.js, saved
 * history in players.js, and what that history says in insights.js.
 */
(function () {
  'use strict';

  const Quiz = window.Quiz;
  const Insights = window.Insights;
  const STORAGE_KEY = 'timesup.settings';
  const PAUSE_AFTER_RIGHT = 900; // ms before the next question
  const PAUSE_AFTER_MISS = 2400; // longer, so there is time to read the right answer
  const TAP_GUARD = 300; // ms; ignore taps while new tiles appear, so an extra tap can't answer by accident
  const PRAISE = ['Great job!', 'You got it!', 'Awesome!', 'Super!', 'Nice one!', 'Brilliant!', 'Way to go!'];
  const RESULT_TITLES = ['Keep practicing!', 'Good try!', 'Great job!', 'Amazing!'];
  const LEVEL_NAMES = { mastered: 'Got it', learning: 'Getting there', practice: 'Needs practice', new: 'Not tried yet' };

  const $ = (id) => document.getElementById(id);
  const screens = { setup: $('setup'), game: $('game'), results: $('results'), report: $('report') };
  const form = $('settings-form');
  const tilesBox = $('tiles');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const whenFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  let settings = loadSettings();
  let round = null;
  let store = null; // where player history is kept, once Players.openStore() answers
  let players = [];
  let storeProblem = '';
  // playerId -> { status: 'loading' | 'ready' | 'failed', rounds, analysis, busy }
  const histories = new Map();
  let reportFor = null; // the player whose progress is on screen
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

  // ---------- saved settings (best effort: storage can be blocked) ----------

  function loadSettings() {
    try {
      return Quiz.sanitizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch (error) {
      return Quiz.sanitizeSettings(null);
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
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

  function pills(name, values, label) {
    return values.map((v) =>
      `<label class="pill"><input type="radio" name="${name}" value="${v}" id="${name}-${v}"><span>${label(v)}</span></label>`
    ).join('');
  }

  // A times-table chart: rows are the tables, columns the numbers they're multiplied by.
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
      if (row === undefined && col === undefined) continue; // the × corner
      const rowOn = row === undefined || settings.tables.includes(Number(row));
      const colOn = col === undefined || columns.includes(Number(col));
      node.classList.toggle('is-on', rowOn && colOn);
      let weak = false;
      if (analysis && rowOn && colOn && row !== undefined && col !== undefined) {
        const fact = analysis.facts.get(Quiz.factKey(Number(row), Number(col)));
        weak = Boolean(fact) && fact.level === 'practice';
      }
      node.classList.toggle('is-weak', weak);
      if (weak) marked += 1;
    }
    $('chart-key').hidden = marked === 0;
  }

  function multiplyHelp() {
    if (settings.multiplyBy === 'range') {
      return 'Each table you picked is multiplied by every number in this range, like 7 × 1 up to 7 × 10.';
    }
    if (settings.tables.length === 1) {
      const t = settings.tables[0];
      return `That's only ${t} × ${t}. To practice the whole ${t} times table, choose “A range”.`;
    }
    return 'Both numbers in each question come from the tables you picked.';
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
    if (!analysis.totals.questions) return `Weak spots starts working after ${player.name} plays a round or two.`;
    if (effectiveFocus() === 'all') return 'Every fact comes up equally often.';
    const counts = Insights.focusCounts(analysis, Quiz.factsFor(settings));
    if (counts.practice) {
      return `The ${plural(counts.practice, 'fact')} that ${counts.practice === 1 ? 'needs' : 'need'} practice ` +
        `(marked with a dot) come up more often, mixed in with ones ${player.name} knows.`;
    }
    if (counts.learning || counts.new) {
      return `None of these need practice right now, so the round leans on facts that are still getting there${counts.new ? ' or not tried yet' : ''}.`;
    }
    return `${player.name} knows all of these by heart! Try adding a table.`;
  }

  function renderSetup() {
    for (const box of form.elements.table) box.checked = settings.tables.includes(Number(box.value));
    form.elements.multiplyBy.value = settings.multiplyBy;
    $('range-from').value = String(settings.from);
    $('range-to').value = String(settings.to);
    form.elements.mode.value = settings.timed ? 'timed' : 'relaxed';
    form.elements.seconds.value = String(settings.seconds);
    form.elements.count.value = String(settings.count);
    renderSetupState();
  }

  function renderSetupState() {
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
      ? 'Pick at least one times table to start.'
      : `${player ? `${player.name}: ` : ''}` +
        `${settings.count} questions from ${facts.length === 1 ? 'just 1 fact' : `${facts.length} different facts`}${focusNote}, ` +
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

  function setAllTables(on) {
    for (const box of form.elements.table) box.checked = on;
    readSetup();
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
    const analysis = player ? analysisFor(player.id) : null;
    $('open-report').hidden = !(analysis && analysis.totals.questions);
  }

  function playerHelp() {
    if (!store) return 'Loading players…';
    if (storeProblem) return storeProblem;
    const player = currentPlayer();
    if (!player) return players.length ? "Guest rounds aren't saved." : 'Add your first name to keep track of your progress.';
    const entry = histories.get(player.id);
    if (!entry || entry.status === 'loading') return `Loading ${player.name}'s history…`;
    if (entry.status === 'failed') return `${player.name}'s history couldn't load right now. New answers will still be saved.`;
    const totals = analysisFor(player.id).totals;
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
      entry = { status: 'loading', rounds: [], analysis: null, busy: false };
      histories.set(id, entry);
    }
    entry.busy = true;
    store.loadRounds(id)
      .then(
        (rounds) => {
          entry.rounds = mergeRounds(rounds, entry.rounds);
          entry.status = 'ready';
          entry.analysis = null;
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
    entry.analysis = null;
    historyChanged(record.playerId);
  }

  function analysisFor(id) {
    const entry = id ? histories.get(id) : null;
    if (!entry || entry.status !== 'ready') return null;
    if (!entry.analysis) entry.analysis = Insights.analyze(entry.rounds);
    return entry.analysis;
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
      histories.set(player.id, { status: 'ready', rounds: [], analysis: null, busy: false });
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
    const used = { tables: settings.tables.slice(), multiplyBy: settings.multiplyBy };
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
    const player = currentPlayer();
    const focus = effectiveFocus();
    const questions = focus === 'weak'
      ? Quiz.createFocusRound(settings, Insights.needFinder(analysisFor(player.id)))
      : Quiz.createRound(settings);
    round = {
      questions,
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
    $('question-sr').textContent = `What is ${q.a} times ${q.b}?`;
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
      setFeedback(`${timedOut ? "Time's up!" : 'Not quite.'} ${q.a} × ${q.b} = ${q.answer}`, 'is-wrong');
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

    const answered = done.answers.filter((a) => !a.timedOut);
    const average = answered.reduce((sum, a) => sum + a.ms, 0) / (answered.length || 1);
    $('stat-time').textContent = answered.length ? `${secs(average)}s` : '-';

    renderReview(done.answers.filter((a) => !a.right));
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

  function renderReview(misses) {
    const list = $('review-list');
    const seen = new Set();
    list.replaceChildren();
    for (const miss of misses) {
      const key = Quiz.factKey(miss.a, miss.b);
      if (seen.has(key)) continue;
      seen.add(key);
      const item = document.createElement('li');
      const fact = document.createElement('span');
      fact.className = 'review-fact';
      fact.textContent = `${miss.a} × ${miss.b} = ${miss.answer}`;
      const note = document.createElement('span');
      note.className = 'review-note';
      note.textContent = miss.timedOut ? 'Time ran out' : `You picked ${miss.picked}`;
      item.append(fact, note);
      list.append(item);
    }
    $('review').hidden = misses.length === 0;
  }

  // ---------- progress report ----------

  function openReport(id) {
    reportFor = id;
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
    const analysis = analysisFor(player.id);
    let problem = '';
    if (!entry || entry.status === 'loading') problem = `Loading ${player.name}'s history…`;
    else if (entry.status === 'failed') problem = `${player.name}'s history couldn't load right now. Try again in a moment.`;
    else if (!analysis.totals.questions) {
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
    $('report-sub').textContent = `${plural(totals.rounds, 'round')} on ${plural(totals.days, 'day')}, since ${dayFormat.format(totals.firstAt)}`;
    renderKpis(analysis);
    renderAdvice(analysis, player);
    renderTricky(analysis);
    renderMastery(analysis);
    renderTrend(analysis);
    renderRounds(analysis);
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
      head.append(element('span', 'tricky-fact', `${f.a} × ${f.b} = ${f.answer}`), element('span', 'level-tag', LEVEL_NAMES[f.level]));
      const bits = [recentText(f)];
      if (f.slip) bits.push(`picked ${Insights.slipText(f.a, f.b, f.slip.value)}${f.slip.count > 1 ? `, ${times(f.slip.count)}` : ''}`);
      else if (f.timeouts) bits.push(`time ran out ${times(f.timeouts)}`);
      if (f.level === 'learning' && f.typicalMs !== null && f.typicalMs > Insights.FLUENT_MS) bits.push(`about ${secs(f.typicalMs)} s to answer`);
      item.append(head, element('p', 'tricky-note', `${bits.join('; ')}.`));
      return item;
    }));
  }

  function factDetail(analysis, row, col) {
    const fact = analysis.facts.get(Quiz.factKey(row, col));
    if (!fact) return `${row} × ${col} = ${row * col}: not tried yet.`;
    let text = `${row} × ${col} = ${row * col}: ${LEVEL_NAMES[fact.level].toLowerCase()}. ${recentText(fact)}`;
    if (fact.typicalMs !== null) text += `, typically in ${secs(fact.typicalMs)} s`;
    text += '.';
    if (fact.slip) text += ` Picked ${fact.slip.value} ${times(fact.slip.count)}.`;
    return text;
  }

  function renderMastery(analysis) {
    const chart = $('mastery-chart');
    const counts = { mastered: 0, learning: 0, practice: 0, new: 0 };
    const seen = new Set();
    for (const node of chart.children) {
      const { row, col } = node.dataset;
      if (row === undefined || col === undefined) continue;
      const key = Quiz.factKey(Number(row), Number(col));
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
    const groups = Insights.LEVELS.filter((level) => level !== 'new').map((level) => {
      const facts = [...analysis.facts.values()].filter((f) => f.level === level)
        .sort((x, y) => x.a - y.a || x.b - y.b)
        .map((f) => `${f.a} × ${f.b}`);
      const line = element('p', '');
      line.append(element('strong', '', `${LEVEL_NAMES[level]} (${facts.length}): `), document.createTextNode(facts.length ? facts.join(', ') : 'none yet'));
      return line;
    });
    $('map-list').replaceChildren(...groups);
  }

  function pickMasteryCell(event) {
    const cell = event.target.closest('.cell');
    const analysis = reportFor ? analysisFor(reportFor) : null;
    if (!cell || !analysis) return;
    for (const node of $('mastery-chart').querySelectorAll('.is-picked')) node.classList.remove('is-picked');
    cell.classList.add('is-picked');
    $('map-detail').textContent = factDetail(analysis, Number(cell.dataset.row), Number(cell.dataset.col));
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
    const time = point.typicalMs === null ? 'no answers in time' : `typically ${secs(point.typicalMs)} s an answer`;
    const when = unit === 'day' ? dayFormat.format(point.at) : `Round ${point.number}, ${dayFormat.format(point.at)}`;
    return `${when}: ${right} right (${point.right} of ${point.questions}), ${time}.`;
  }

  function renderTrend(analysis) {
    const { unit, points } = analysis.trend;
    if (trendPick < 0 || trendPick >= points.length) trendPick = points.length - 1;
    $('trend-unit').textContent = unit === 'day'
      ? `Each bar and dot is one day of play, for the last ${plural(points.length, 'day')} played.`
      : 'Each bar and dot is one round. After 3 days of play, it switches to one per day.';
    drawTrends(analysis);
    $('trend-table-when').textContent = unit === 'day' ? 'Day' : 'Round';
    $('trend-table-rows').replaceChildren(...points.map((p) => {
      const row = element('tr', '');
      const head = element('th', '', unit === 'day' ? dayFormat.format(p.at) : `${p.number} (${dayFormat.format(p.at)})`);
      head.scope = 'row';
      row.append(
        head,
        element('td', '', String(p.questions)),
        element('td', '', `${p.right} (${percent(p.right / p.questions)})`),
        element('td', '', p.typicalMs === null ? '-' : `${secs(p.typicalMs)} s`)
      );
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
    const analysis = reportFor ? analysisFor(reportFor) : null;
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
      const what = [
        s.multiplyBy === 'range' && s.from !== null && s.to !== null
          ? `${tablesText(s.tables)} × ${s.from}–${s.to}`
          : `Tables ${tablesText(s.tables)}`,
        s.timeLimit ? `${s.timeLimit} s a question` : 'Relaxed',
      ];
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
    $('sound').setAttribute('aria-pressed', String(settings.sound));
  }

  function toggleView(button, panel) {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    button.textContent = open ? button.dataset.close : button.dataset.open;
    panel.hidden = !open;
  }

  form.addEventListener('change', (event) => {
    if (event.target.name === 'player') choosePlayer(event.target.value);
    else if (event.target.id !== 'new-player-name') readSetup(event.target);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!$('start').disabled) startRound();
  });
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
  $('sound').addEventListener('click', () => {
    settings.sound = !settings.sound;
    saveSettings();
    renderSound();
    if (settings.sound) sound.unlock();
  });
  $('again').addEventListener('click', startRound);
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
    settings.focus = 'weak';
    saveSettings();
    renderPlayers();
    renderSetup();
    showSetup();
    $('start').focus({ preventScroll: true });
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
        const analysis = reportFor && !screens.report.hidden ? analysisFor(reportFor) : null;
        if (analysis && analysis.totals.questions) drawTrends(analysis);
      });
    }).observe($('trend-right'));
  }

  buildSetup();
  buildTiles();
  renderSetup();
  renderPlayers();
  renderSound();
  showScreen('setup');
  connectStore();
})();
