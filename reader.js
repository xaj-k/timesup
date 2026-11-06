/*
 * Times Up: the reading screen. Shows one word, sound or sentence at a
 * time, listens for the child reading it (listen.js), and moves on by itself
 * when it hears it. A grown-up can always tap ✓ or Not yet. app.js builds
 * the round and saves the answers.
 *
 * The child never sees what the recognizer heard. Talk that's much longer
 * than the item (a grown-up helping) doesn't count either way.
 */
(function (global) {
  'use strict';

  const Reading = global.Reading;
  const Listen = global.Listen;
  const PAUSE_AFTER_RIGHT = 1100; // ms before the next item
  const PAUSE_AFTER_SKIP = 500;
  const WORD_LIMIT = 8000; // ms to listen for a word
  const SENTENCE_LIMIT = 15000; // and for a sentence
  const READY_LIMIT = 1500; // show the item by then, even if the mic never says it's on
  const RELISTEN_GAP = 300; // ms between one listen ending and the next
  const MAX_MISSES = 3; // different words heard before it stops listening by itself
  const MAX_LISTENS = 6; // listens in a row by itself, silence included
  const QUIET = new Set(['no-speech', 'no-match', 'aborted']);
  const PRAISE = ['Great reading!', 'You got it!', 'Super!', 'Nice one!', 'Awesome!', 'Way to go!', 'Brilliant!'];
  const AGAIN = ['Try again!', 'Have another go!', 'Once more!'];
  const KIND_NAMES = { sight: 'Sight word', word: 'Sound it out', sound: 'Sound', sentence: 'Sentence' };
  const COUNTED = { sight: 'Word', word: 'Word', sound: 'Sound', sentence: 'Sentence' };

  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  /**
   * env: { sound, wake, onAnswer(answer), onFinish(summary), onQuit(), soundOn() }
   * answer: { kind, item, shown, right, how ('voice', 'grown-up' or 'skip'), tries, helped, ms, heard }
   */
  function create(env) {
    const $ = (id) => document.getElementById(id);
    let round = null;

    function current() {
      return round && round.index >= 0 && round.index < round.items.length ? round.items[round.index] : null;
    }

    const listening = () => round && round.engine !== 'off' && current() && current().kind !== 'sound';

    // ---------- what's on the screen ----------

    function setFeedback(text, tone) {
      const box = $('read-feedback');
      box.textContent = text;
      box.className = tone ? `feedback ${tone}` : 'feedback';
    }

    function setHint(text) {
      $('read-hint').textContent = text;
    }

    // The listening line: off, getting ready (the mic isn't on yet), on, or on and hearing sound.
    function cue(state) {
      const line = $('read-listening');
      line.hidden = state === 'off';
      line.classList.toggle('is-on', state === 'on' || state === 'sound');
      if (state !== 'off') $('read-listen-text').textContent = { wait: 'Get ready…', on: 'Listening…', sound: 'Hearing you…' }[state];
    }

    function reveal() {
      $('read-item').classList.remove('is-waiting');
    }

    function renderItem(item) {
      const box = $('read-item');
      box.className = `question read-item is-${item.kind}`;
      box.replaceChildren();
      if (item.kind === 'sentence') {
        // One span per word, so words can light up as they're read.
        let at = 0;
        item.tokens = [];
        for (const piece of item.text.split(/(\s+)/)) {
          if (!piece.trim()) {
            box.append(piece);
            continue;
          }
          const span = document.createElement('span');
          span.className = 'read-word';
          span.textContent = piece;
          const count = Reading.wordsIn(piece).length;
          span.dataset.words = count ? `${at}` : '';
          at += count;
          item.tokens.push(span);
          box.append(span);
        }
      } else if (item.kind === 'word' && item.sound) {
        for (const part of Reading.mark(item.text, item.sound)) {
          const span = document.createElement('span');
          span.textContent = part.text;
          if (part.mark) span.className = 'sound-part';
          box.append(span);
        }
      } else {
        box.textContent = item.shown;
      }
    }

    // Lights up the words of a sentence heard so far.
    function showRead(item, matched) {
      if (!item.tokens) return;
      for (const span of item.tokens) {
        const at = span.dataset.words;
        span.classList.toggle('is-read', at !== '' && matched[Number(at)] === true);
      }
    }

    function hintFor(item) {
      if (item.kind === 'sound') {
        const note = Reading.soundNote(item.text);
        return `Say the sound. Grown-up: tap ✓ if it’s right.${note ? ` (${note.charAt(0).toUpperCase()}${note.slice(1)}.)` : ''}`;
      }
      if (round.engine === 'off') return 'Grown-up: tap ✓ when it’s read right.';
      if (item.kind === 'word') return 'Read the whole word.';
      if (item.kind === 'sentence') return 'Read the whole sentence.';
      return '';
    }

    function markCell(state) {
      const cell = $('read-cells').children[round.index];
      if (cell) cell.className = state;
    }

    function renderButtons() {
      const item = current();
      const done = !item || item.done;
      const sound = item && item.kind === 'sound';
      $('read-hear').hidden = sound || !('speechSynthesis' in global);
      $('read-again').hidden = sound || round.engine === 'off' || Boolean(round.session) || Boolean(round.relisten);
      for (const id of ['read-hear', 'read-again', 'read-skip', 'read-right']) $(id).disabled = done;
    }

    // ---------- one item at a time ----------

    function start(options) {
      stop();
      round = {
        items: options.items.map((item) => ({ ...item })),
        engine: options.engine, // 'online', 'vosk' or 'off'
        vocabulary: options.vocabulary || [],
        names: options.names || new Set(),
        index: -1,
        score: 0,
        streak: 0,
        bestStreak: 0,
        byVoice: 0,
        answers: [],
        session: null,
        relisten: 0,
        advance: 0,
        meter: false,
      };
      const cells = $('read-cells');
      cells.style.setProperty('--count', round.items.length);
      cells.innerHTML = '<li></li>'.repeat(round.items.length);
      $('read-score').textContent = '0';
      // The level bar: Vosk always has the mic; the browser's recognition can only share it on a computer.
      round.meter = Boolean(options.meter);
      $('read-meter').hidden = !round.meter;
      if (round.meter && options.engine !== 'vosk') Listen.startMeter().then((ok) => { if (!ok && round) $('read-meter').hidden = true; });
      next();
    }

    function next() {
      if (!round) return;
      stopListening();
      clearTimeout(round.advance);
      round.index += 1;
      const item = current();
      if (!item) {
        finish();
        return;
      }
      Object.assign(item, { misses: 0, listens: 0, helped: false, heard: '', done: false, shownAt: performance.now() });
      $('read-progress').textContent = `${COUNTED[item.kind]} ${round.index + 1} of ${round.items.length}`;
      $('read-kind').textContent = KIND_NAMES[item.kind];
      renderItem(item);
      markCell('is-current');
      setFeedback('', '');
      setHint(hintFor(item));
      if (listening()) {
        // A child reads as soon as they see it, so the item waits until the mic is on.
        $('read-item').classList.add('is-waiting');
        listen();
      } else {
        cue('off');
      }
      renderButtons();
    }

    function stopListening() {
      if (!round) return;
      clearTimeout(round.relisten);
      round.relisten = 0;
      const rec = round.session;
      round.session = null;
      if (rec) {
        rec.cancelled = true;
        try {
          rec.abort();
        } catch (error) {
          // Already stopped.
        }
      }
      cue('off');
    }

    // What the recognizer's final guesses mean for this item.
    function judge(item, guesses) {
      const heard = guesses.length ? guesses[0].transcript : '';
      if (item.kind === 'sentence') {
        let best = null;
        for (const guess of guesses) {
          const result = Reading.checkSentence(item.text, guess.transcript, round.names);
          if (!best || result.matched.filter(Boolean).length > best.matched.filter(Boolean).length) best = result;
        }
        if (best && best.ok) return { kind: 'right', heard, matched: best.matched };
        const said = Reading.wordsIn(heard).length + (Number(guesses[0] && guesses[0].unknown) || 0);
        if (best && !best.matched.some(Boolean) && said > best.words.length + 5) return { kind: 'talk', heard };
        return { kind: heard ? 'miss' : 'quiet', heard, matched: best ? best.matched : [] };
      }
      const check = Reading.checkWord(item.text, guesses);
      if (check.ok) return { kind: 'right', heard: check.match };
      if (check.long) return { kind: 'talk', heard };
      return { kind: heard ? 'miss' : 'quiet', heard };
    }

    function listen() {
      stopListening();
      const r = round;
      const item = current();
      if (!r || !item || item.done) return;
      const rec = r.engine === 'vosk' ? Listen.vosk.recognition(r.vocabulary) : new Listen.BrowserRecognition();
      rec.lang = 'en-US';
      rec.interimResults = true;
      rec.maxAlternatives = 5;
      rec.continuous = false;
      item.listens += 1;
      let settled = false;
      let live = false;
      let lastGuesses = null; // the latest partial result, in case no final one comes
      const timer = setTimeout(() => {
        try {
          rec.stop();
        } catch (error) {
          // Already stopped.
        }
      }, item.kind === 'sentence' ? SENTENCE_LIMIT : WORD_LIMIT);
      const readyTimer = setTimeout(goLive, READY_LIMIT);

      function goLive() {
        if (live || settled || rec.cancelled) return;
        live = true;
        clearTimeout(readyTimer);
        reveal();
        cue('on');
      }

      function settle(outcome) {
        if (settled || rec.cancelled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(readyTimer);
        if (r.session === rec) r.session = null;
        reveal();
        // No final answer, but the latest partial result read it: that counts.
        if (outcome.kind === 'quiet' && lastGuesses) {
          const late = judge(item, lastGuesses);
          if (late.kind === 'right') outcome = late;
        }
        heardIt(outcome);
      }

      rec.onaudiostart = () => {
        if (!rec.cancelled) goLive();
      };
      rec.onsoundstart = rec.onspeechstart = () => {
        if (rec.cancelled) return;
        goLive();
        if (!settled) cue('sound');
      };
      rec.onsoundend = rec.onspeechend = () => {
        if (!rec.cancelled && !settled && live) cue('on');
      };
      rec.onresult = (event) => {
        if (rec.cancelled) return;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const guesses = [];
          for (let j = 0; j < res.length; j++) {
            guesses.push({ transcript: String(res[j].transcript || '').trim(), confidence: res[j].confidence, unknown: res[j].unknown });
          }
          if (!guesses.length || !guesses[0].transcript) continue;
          if (item.kind === 'sentence') showRead(item, Reading.checkSentence(item.text, guesses[0].transcript, r.names).matched);
          if (res.isFinal) {
            settle(judge(item, guesses));
            return;
          }
          lastGuesses = guesses;
        }
        goLive();
      };
      // Heard sound, but no words. Chrome reports this as its own event, not an error.
      rec.onnomatch = () => {
        if (!rec.cancelled) settle({ kind: 'quiet' });
      };
      rec.onerror = (event) => {
        if (rec.cancelled) return;
        const code = event.error || 'error';
        settle(QUIET.has(code) ? { kind: 'quiet' } : { kind: 'error', error: code });
      };
      rec.onend = () => {
        if (!rec.cancelled) settle({ kind: 'quiet' });
      };

      r.session = rec;
      try {
        rec.start();
        cue('wait');
      } catch (error) {
        settle({ kind: 'error', error: 'start' });
      }
      renderButtons();
    }

    // What happens after one listen.
    function heardIt(outcome) {
      const r = round;
      const item = current();
      if (!r || !item || item.done) return;
      if (outcome.kind === 'right') {
        if (item.kind === 'sentence') showRead(item, outcome.matched.map(() => true));
        accept('voice');
        return;
      }
      if (outcome.kind === 'error') {
        cue('off');
        setFeedback(errorText(outcome.error), 'is-wrong');
        setHint('Grown-up: tap ✓ if it was read right, or Not yet.');
        renderButtons();
        return;
      }
      if (outcome.kind === 'miss') {
        item.misses += 1;
        item.heard = outcome.heard;
        setFeedback(pick(AGAIN), 'is-wrong');
      }
      // Silence and talk say nothing; it just listens again.
      if (item.misses >= MAX_MISSES || item.listens >= MAX_LISTENS) {
        cue('off');
        setHint(`Tap Try again${'speechSynthesis' in global ? ' or Hear it' : ''}. Grown-up: tap ✓ if it was read right.`);
        renderButtons();
        return;
      }
      cue('wait');
      const at = r.index;
      r.relisten = setTimeout(() => {
        r.relisten = 0;
        if (round === r && r.index === at && !r.session) listen();
      }, RELISTEN_GAP);
      renderButtons();
    }

    function errorText(code) {
      return {
        'not-allowed': 'The microphone isn’t allowed. Allow it for this site, then tap Try again.',
        'service-not-allowed': 'Speech recognition isn’t allowed here.',
        'audio-capture': 'No microphone was found.',
        network: 'Checking by voice needs the internet.',
        'language-not-supported': 'This device can’t check English by voice.',
      }[code] || 'Something went wrong while listening.';
    }

    // ---------- answers ----------

    function record(how, right) {
      const item = current();
      item.done = true;
      const answer = {
        kind: item.kind,
        item: item.text,
        shown: item.shown,
        right,
        how,
        tries: item.misses + (how === 'skip' ? 0 : 1),
        helped: item.helped,
        ms: Math.round(performance.now() - item.shownAt),
        heard: item.heard.slice(0, 80),
      };
      round.answers.push(answer);
      env.onAnswer(answer);
    }

    // Read right: heard by voice, or a grown-up says so.
    function accept(how) {
      const r = round;
      const item = current();
      if (!r || !item || item.done) return;
      stopListening();
      reveal();
      const right = !item.helped; // read without Hear it
      record(how, right);
      if (how === 'voice') r.byVoice += 1;
      if (right) {
        r.score += 1;
        r.streak += 1;
        r.bestStreak = Math.max(r.bestStreak, r.streak);
      } else {
        r.streak = 0;
      }
      $('read-score').textContent = r.score;
      markCell(right ? 'is-right' : 'is-later');
      const praise = pick(PRAISE);
      setFeedback(right && r.streak >= 3 ? `${praise} ${r.streak} in a row!` : praise, 'is-right');
      setHint('');
      env.sound.right();
      renderButtons();
      r.advance = setTimeout(next, PAUSE_AFTER_RIGHT);
    }

    function skip() {
      const r = round;
      const item = current();
      if (!r || !item || item.done) return;
      stopListening();
      reveal();
      record('skip', false);
      r.streak = 0;
      markCell('is-later');
      setFeedback('On to the next one.', '');
      setHint('');
      renderButtons();
      r.advance = setTimeout(next, PAUSE_AFTER_SKIP);
    }

    function tryAgain() {
      const item = current();
      if (!item || item.done || !listening()) return;
      item.misses = 0;
      item.listens = 0;
      setFeedback('', '');
      setHint(hintFor(item));
      listen();
    }

    // The device reads it out loud, then listens again. It counts as help.
    function hear() {
      const r = round;
      const item = current();
      if (!r || !item || item.done || item.kind === 'sound') return;
      stopListening();
      reveal();
      item.helped = true;
      item.misses = 0;
      item.listens = 0;
      if (!('speechSynthesis' in global)) return;
      const say = new SpeechSynthesisUtterance(item.text);
      say.lang = 'en-US';
      say.rate = item.kind === 'sentence' ? 0.85 : 0.8;
      const at = r.index;
      let done = false;
      say.onend = say.onerror = () => {
        if (done) return;
        done = true;
        if (round === r && r.index === at && !item.done) {
          setFeedback('', '');
          if (listening()) listen();
        }
      };
      speechSynthesis.cancel();
      speechSynthesis.speak(say);
      setFeedback('Listen, then you try.', '');
      renderButtons();
    }

    function finish() {
      const done = round;
      stop();
      env.onFinish({
        answers: done.answers,
        score: done.score,
        bestStreak: done.bestStreak,
        byVoice: done.byVoice,
        engine: done.engine,
      });
    }

    /** Stops listening and lets go of the mic. */
    function stop() {
      if (!round) return;
      stopListening();
      clearTimeout(round.advance);
      if (global.speechSynthesis) speechSynthesis.cancel();
      Listen.stopMeter();
      Listen.vosk.close();
      round = null;
    }

    $('read-right').addEventListener('click', () => accept('grown-up'));
    $('read-skip').addEventListener('click', skip);
    $('read-again').addEventListener('click', tryAgain);
    $('read-hear').addEventListener('click', hear);

    return {
      start,
      stop,
      get running() {
        return Boolean(round);
      },
    };
  }

  global.Reader = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
