/*
 * Times Up speech check: shows 20 words one at a time, listens with the
 * browser's speech recognition or with Vosk on the device (listen.js), and
 * reports how often it understood. It's a trial run for reading practice,
 * so nothing is saved.
 */
(function () {
  'use strict';

  const Reading = window.Reading;
  const Listen = window.Listen;
  const Recognition = Listen.BrowserRecognition;
  const vosk = Listen.vosk;
  const meter = Listen.meter;
  const PAGE_VERSION = 5; // in the results, so it's clear which page made them
  const PAUSE_AFTER_RIGHT = 900; // ms before the next word
  const LISTEN_LIMIT = 8000; // ms; stop listening after this if the browser hasn't
  const READY_LIMIT = 1500; // ms; show the word by then, even if the browser never says the mic is on
  const RELISTEN = 3; // times to listen again by itself after silence or a different word
  const RELISTEN_GAP = 300; // ms between one listen ending and the next starting
  // Endings where nothing useful was heard, so it's worth listening again.
  const QUIET = new Set(['no-speech', 'no-match', 'nothing', 'time-up']);

  const $ = (id) => document.getElementById(id);
  const items = Reading.speechCheckItems();
  // Vosk listens for these: the words on this page, the packet's other words, and "[unk]" for anything else.
  const VOSK_WORDS = [...new Set([...items.map((i) => i.word), ...Reading.SIGHT_WORDS, ...Reading.PHONICS.flatMap((g) => g.words)])];
  let device = { os: 'Unknown', android: null, browser: 'Unknown' };
  let localStatusText = 'not available'; // Chrome's own on-device recognition
  let engine = 'online'; // 'online' (Google), 'device' (Chrome on the device) or 'vosk'
  let results = [];
  let index = -1;
  let session = null; // the recognition that's listening now
  let advance = 0; // timer for moving on to the next word
  let relisten = 0; // timer for listening again
  let triesLeft = RELISTEN; // listens left before the page waits for a tap
  let runEngine = 'online'; // the recognizer the last run used
  let liveRun = false; // whether the level bar runs while the page listens for words
  let micCheck = null; // what the mic check before starting measured
  let starting = false;

  // ---------- this device ----------

  async function checkDevice() {
    device = await Listen.describeDevice();
    localStatusText = await localStatus();
  }

  // Newer Chrome can recognize speech without sending audio anywhere. The API
  // is new, so each step is checked before it's used.
  async function localStatus() {
    if (!Recognition) return 'not available';
    try {
      if (typeof Recognition.available === 'function') {
        return String(await Recognition.available({ langs: ['en-US'], processLocally: true }));
      }
      if (typeof Recognition.availableOnDevice === 'function') return String(await Recognition.availableOnDevice('en-US'));
    } catch (error) {
      return 'not available';
    }
    return 'not available';
  }

  async function installLocal() {
    const button = $('install-local');
    button.disabled = true;
    button.textContent = 'Downloading…';
    try {
      if (typeof Recognition.install === 'function') await Recognition.install({ langs: ['en-US'], processLocally: true });
      else if (typeof Recognition.installOnDevice === 'function') await Recognition.installOnDevice('en-US');
    } catch (error) {
      // The status below says whether it worked.
    }
    localStatusText = await localStatus();
    button.disabled = false;
    button.textContent = 'Download English for this device';
    renderDevice();
  }

  // What this device is, and which ways of recognizing speech it has.
  function renderDevice() {
    $('fact-device').textContent = `${device.os} · ${device.browser}`;
    $('fact-speech').textContent = Recognition ? 'Yes' : 'No';
    $('fact-local').textContent = {
      available: 'Ready',
      downloadable: 'Can be downloaded',
      downloading: 'Downloading…',
      unavailable: 'Not on this device',
      'not available': 'Not in this browser',
    }[localStatusText] || localStatusText;
    const old = Listen.isOldAndroid(device);
    $('fact-old').hidden = !old;
    if (old) {
      $('fact-old-text').textContent = `This is Android ${device.android}. Reading practice is meant for Android ${Listen.OLD_ANDROID} or newer, `
        + 'so it may not work as well here. The results will show how it does.';
    }
    $('engine-device-row').hidden = localStatusText !== 'available';
    $('install-local').hidden = localStatusText !== 'downloadable';
    $('engine-vosk-row').hidden = !vosk.supported;
    $('engine-online').disabled = !Recognition;
    if (engine === 'device' && localStatusText !== 'available') chooseEngine(Recognition ? 'online' : 'vosk');
    renderMicHelp();
    renderEngine();
  }

  // ---------- which recognizer ----------

  let voskNote = '';

  function chooseEngine(value) {
    engine = value;
    const box = document.querySelector(`input[name="engine"][value="${value}"]`);
    if (box) box.checked = true;
    if (engine === 'vosk' && vosk.state !== 'ready' && vosk.state !== 'loading') loadVosk();
    renderMicHelp();
    renderEngine();
  }

  function loadVosk() {
    voskNote = 'Getting Vosk ready…';
    vosk.load((step) => {
      if (step.phase === 'model') {
        const mb = (bytes) => Math.round(bytes / 1e6);
        voskNote = step.total
          ? `Downloading English for Vosk: ${mb(step.loaded)} of ${mb(step.total)} MB. This only happens the first time.`
          : `Downloading English for Vosk: ${mb(step.loaded)} MB. This only happens the first time.`;
      } else if (step.phase === 'unpack') {
        voskNote = 'Unpacking English…';
      } else if (step.phase === 'speed') {
        voskNote = 'Checking how fast this device is…';
      }
      renderEngine();
    }).then(
      () => {
        voskNote = 'Ready. Vosk only listens for the packet’s words, and no audio leaves this device. ' + speedText();
        renderEngine();
      },
      () => {
        voskNote = `Vosk couldn’t load (${vosk.error}).`;
        renderEngine();
      }
    );
    renderEngine();
  }

  // How fast Vosk is here, in words.
  function speedText() {
    if (vosk.speed === null) return 'It couldn’t tell how fast this device is.';
    const took = `It takes ${vosk.speed.toFixed(1)} s to recognize 1 s of speech here`;
    return vosk.speed <= 1 ? `${took}, fast enough to keep up.` : `${took}, too slow to keep up, so answers may come late or not at all.`;
  }

  function renderEngine() {
    let ready;
    let note;
    if (engine === 'vosk') {
      ready = vosk.state === 'ready';
      note = voskNote;
    } else if (engine === 'device') {
      ready = Boolean(Recognition);
      note = 'Chrome recognizes the words on this device. No audio is sent.';
    } else {
      ready = Boolean(Recognition);
      note = Recognition ? 'Chrome sends the audio to Google to recognize it.' : '';
    }
    $('engine-status').textContent = note;
    $('vosk-retry').hidden = !(engine === 'vosk' && vosk.state === 'failed');
    $('begin').disabled = !ready;
    const problem = $('unsupported');
    if (!Recognition && !vosk.supported) {
      problem.textContent = window.isSecureContext
        ? "This browser can't recognize speech. Open this page in Chrome."
        : 'Speech recognition only works on pages opened over https.';
    } else if (!Recognition && engine !== 'vosk') {
      problem.textContent = "This browser can't recognize speech itself. Choose Vosk to recognize it on this device.";
    } else {
      problem.textContent = '';
    }
    problem.hidden = !problem.textContent;
  }

  // ---------- microphone level ----------
  // The level bar (in listen.js) needs a hold on the microphone. With Vosk it
  // shows Vosk's own audio. With the browser's recognition, a computer can
  // share the mic between the two, but Android can't (one of them gets
  // silence), so there it only runs for the mic check, before the words start.

  let meterShown = 0;
  meter.onTick = () => {
    const now = performance.now();
    if (now - meterShown > 500 && !$('intro').hidden) {
      meterShown = now;
      $('mic-readout').textContent = micReadout();
    }
  };

  // Whether the level bar can run while the page listens for words.
  const barWhileListening = () => engine === 'vosk' || Listen.canShareMic(device);

  function renderMicHelp() {
    if (meter.analyser || micCheck) return;
    $('mic-readout').textContent = 'Tap Test the mic, then have your child say something from where they’ll sit. The bar should jump when they talk.'
      + (barWhileListening() ? ' It also shows while the page listens for words.' : ' On this device it can’t run while the page listens for words, so check here first.');
  }

  const dB = (value) => (typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)} dB` : '?');

  function micReadout() {
    const loud = meter.loudest < -42 ? 'too quiet (have your child talk, or move closer)' : meter.loudest > -6 ? 'very loud' : 'good';
    const room = meter.floor < -50 ? 'quiet' : meter.floor < -38 ? 'a little noisy' : 'noisy';
    return `Loudest so far: ${loud}, ${dB(meter.loudest)}. Room: ${room}, ${dB(meter.floor)}.`;
  }

  function keepMicCheck() {
    if (meter.analyser && meter.floor !== null) micCheck = { loudest: meter.loudest, floor: meter.floor };
  }

  async function toggleMicTest() {
    const button = $('mic-test');
    if (meter.analyser) {
      keepMicCheck();
      Listen.stopMeter();
      button.textContent = 'Test the mic';
      return;
    }
    button.disabled = true;
    const ok = await Listen.startMeter();
    button.disabled = false;
    if (ok) {
      button.textContent = 'Stop the mic test';
      $('mic-readout').textContent = 'Listening to the mic…';
    } else {
      $('mic-readout').textContent = meter.error === 'NotAllowedError'
        ? 'The browser isn’t allowed to use the microphone. Allow it for this site, then try again.'
        : 'Couldn’t open the microphone.';
    }
  }

  // ---------- one word at a time ----------

  function show(name) {
    for (const id of ['intro', 'run', 'done']) $(id).hidden = id !== name;
    window.scrollTo(0, 0);
  }

  function setStatus(text, tone) {
    const box = $('status');
    box.textContent = text;
    box.className = tone ? `feedback ${tone}` : 'feedback';
  }

  function setHint(text) {
    $('heard').textContent = text;
  }

  // The listening line: off, getting ready (the mic isn't on yet), on, or on and hearing sound.
  function cue(state) {
    const line = $('listening');
    line.hidden = state === 'off';
    line.classList.toggle('is-on', state === 'on' || state === 'sound');
    if (state !== 'off') $('listen-text').textContent = { wait: 'Get ready…', on: 'Listening…', sound: 'Hearing sound…' }[state];
  }

  function reveal() {
    $('word').classList.remove('is-waiting');
  }

  async function begin() {
    if (starting) return;
    starting = true;
    keepMicCheck();
    $('mic-test').textContent = 'Test the mic';
    runEngine = engine;
    if (engine === 'vosk') {
      // Vosk opens the mic itself, and the level bar shows what it hears.
      Listen.stopMeter();
      liveRun = await vosk.open();
      if (!liveRun) {
        starting = false;
        const problem = $('unsupported');
        problem.textContent = messageFor({ NotAllowedError: 'not-allowed', NotFoundError: 'audio-capture' }[vosk.error] || vosk.error);
        problem.hidden = false;
        return;
      }
    } else if (Listen.canShareMic(device)) {
      liveRun = await Listen.startMeter(); // keeps the mic check's bar going, or starts one
    } else {
      liveRun = false;
      if (meter.analyser) {
        Listen.stopMeter();
        // Let go of the mic before speech recognition asks for it.
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    $('run-meter').hidden = !liveRun;
    starting = false;
    results = items.map((item) => ({ ...item, tries: [], helped: false, grownUp: false }));
    index = -1;
    show('run');
    nextWord();
  }

  function nextWord() {
    stopListening();
    clearTimeout(advance);
    index += 1;
    if (index >= items.length) {
      finish();
      return;
    }
    const item = items[index];
    $('count').textContent = `Word ${index + 1} of ${items.length}`;
    $('kind').textContent = item.sound ? `Sound: ${item.sound}` : 'Sight word';
    const word = $('word');
    word.dataset.word = item.word;
    word.replaceChildren(...Reading.mark(item.word, item.sound).map((part) => {
      const span = document.createElement('span');
      span.textContent = part.text;
      if (part.mark) span.className = 'sound-part';
      return span;
    }));
    // A child reads a word as soon as they see it, so it waits until the mic is on.
    word.classList.add('is-waiting');
    setStatus('', '');
    setHint('');
    triesLeft = RELISTEN;
    listen();
  }

  function stopListening() {
    clearTimeout(relisten);
    if (session) {
      session.cancelled = true;
      try {
        session.abort();
      } catch (error) {
        // Already stopped.
      }
    }
    session = null;
    cue('off');
  }

  // auto: listening again by itself, so what it said about the last try stays up.
  function listen(auto = false) {
    stopListening();
    const item = items[index];
    const result = results[index];
    const rec = runEngine === 'vosk' ? vosk.recognition(VOSK_WORDS) : new Recognition();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    rec.continuous = false;
    if (runEngine === 'device') {
      if ('processLocally' in rec) rec.processLocally = true;
      else if ('mode' in rec) rec.mode = 'ondevice-only';
    }
    // readyMs: when the browser said the mic was on. soundMs: when it first noticed sound.
    // Partial results are its guesses before the final one: hit is the first that had
    // the word, last the latest. Each is { text, ms }.
    const attempt = { heard: [], confidence: null, ok: false, ms: null, readyMs: null, soundMs: null, hit: null, last: null, error: '' };
    const started = performance.now();
    const since = () => Math.round(performance.now() - started);
    Listen.takePeak(); // the level bar's loudest, from here on
    let settled = false;
    let live = false;
    let timeUp = false;
    const timer = setTimeout(() => {
      timeUp = true;
      try {
        rec.stop();
      } catch (error) {
        // Already stopped.
      }
    }, LISTEN_LIMIT);
    const readyTimer = setTimeout(goLive, READY_LIMIT);

    // The mic is on: show the word and the Listening cue.
    function goLive() {
      if (live || settled || rec.cancelled) return;
      live = true;
      clearTimeout(readyTimer);
      reveal();
      cue('on');
    }

    function settle() {
      if (settled || rec.cancelled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(readyTimer);
      if (session === rec) session = null;
      reveal();
      if (attempt.ms === null) attempt.ms = since();
      attempt.peak = Listen.takePeak();
      // No final answer came, but the latest partial result had the word: count it.
      if (!attempt.heard.length && attempt.last && (!attempt.error || QUIET.has(attempt.error)) && Reading.heardIt(item.word, [attempt.last.text])) {
        attempt.ok = true;
        attempt.fromPartial = true;
        attempt.match = attempt.last.text;
      }
      if (rec.sentMs !== undefined) Object.assign(attempt, { sentMs: rec.sentMs, lagMs: rec.maxLagMs });
      result.tries.push(attempt);
      const at = index;
      const silent = !attempt.heard.length;
      if (attempt.ok) {
        cue('off');
        setStatus(`Heard “${attempt.match}”`, 'is-right');
        setHint('');
        advance = setTimeout(() => { if (index === at) nextWord(); }, PAUSE_AFTER_RIGHT);
      } else if (attempt.error && !QUIET.has(attempt.error)) {
        cue('off');
        setStatus(messageFor(attempt.error), 'is-wrong');
        setHint('');
      } else if (triesLeft > 0) {
        // Silence, or a different word: say so, and listen again without waiting for a tap.
        triesLeft -= 1;
        cue('wait');
        setStatus(silent ? 'Didn’t catch that.' : `Heard “${attempt.heard[0]}”`, silent ? '' : 'is-wrong');
        setHint('Say it again.');
        relisten = setTimeout(() => { if (index === at && !session) listen(true); }, RELISTEN_GAP);
      } else if (silent) {
        cue('off');
        setStatus('Didn’t hear anything.', 'is-wrong');
        setHint('Tap Try again, then say the word.');
      } else {
        cue('off');
        setStatus(`Heard “${attempt.heard.slice(0, 3).join('”, “')}”`, 'is-wrong');
        setHint('Tap Try again, Hear it, Said it right, or Next.');
      }
    }

    rec.onaudiostart = () => {
      if (rec.cancelled) return;
      if (attempt.readyMs === null) attempt.readyMs = since();
      goLive();
    };
    rec.onsoundstart = rec.onspeechstart = () => {
      if (rec.cancelled) return;
      if (attempt.soundMs === null) attempt.soundMs = since();
      goLive();
      if (!settled) cue('sound');
    };
    rec.onsoundend = rec.onspeechend = () => {
      if (!rec.cancelled && !settled && live) cue('on');
    };
    rec.onresult = (event) => {
      if (rec.cancelled) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          const guesses = [];
          for (let j = 0; j < res.length; j++) guesses.push({ text: String(res[j].transcript).trim(), confidence: res[j].confidence, unknown: res[j].unknown });
          attempt.heard = guesses.map((g) => g.text).filter(Boolean);
          attempt.confidence = guesses.length ? guesses[0].confidence : null;
          // Vosk also says how many other words it heard, which it can't name.
          if (guesses.length && typeof guesses[0].unknown === 'number') attempt.unknown = guesses[0].unknown;
          attempt.ms = since();
          attempt.match = Reading.heardIt(item.word, attempt.heard);
          attempt.ok = attempt.match !== null;
          settle();
          return;
        }
        interim += res[0].transcript;
      }
      goLive();
      interim = interim.trim();
      if (interim) {
        const partial = { text: interim, ms: since() };
        attempt.last = partial;
        if (!attempt.hit && Reading.heardIt(item.word, [interim])) attempt.hit = partial;
        setHint(`Hearing “${interim}”…`);
      }
    };
    // Heard sound, but couldn't make it into words. Chrome reports this as its own event, not an error.
    rec.onnomatch = () => {
      if (rec.cancelled) return;
      attempt.error = 'no-match';
      settle();
    };
    rec.onerror = (event) => {
      if (rec.cancelled) return;
      attempt.error = event.error || 'error';
      settle();
    };
    rec.onend = () => {
      if (rec.cancelled) return;
      if (!settled && !attempt.heard.length && !attempt.error) attempt.error = timeUp ? 'time-up' : 'nothing';
      settle();
    };

    session = rec;
    try {
      rec.start();
      cue('wait');
      if (!auto) {
        setStatus('', '');
        setHint('');
      }
    } catch (error) {
      attempt.error = 'start';
      settle();
    }
  }

  function messageFor(code) {
    return {
      'not-allowed': 'Chrome isn’t allowed to use the microphone. Allow it for this site, then tap Try again.',
      'service-not-allowed': 'Chrome isn’t allowed to use speech recognition here.',
      'audio-capture': 'No microphone was found.',
      network: 'Speech recognition needs an internet connection.',
      'language-not-supported': 'This device can’t recognize English this way. Choose another way to recognize speech.',
      'not-ready': 'Vosk isn’t ready yet.',
      recognizer: 'Vosk ran into a problem. Tap Try again.',
    }[code] || `Something went wrong (${code}). Tap Try again.`;
  }

  // The device says the word, then listens again.
  function hear() {
    if (index < 0 || index >= items.length) return;
    clearTimeout(advance);
    stopListening();
    reveal();
    results[index].helped = true;
    triesLeft = RELISTEN;
    if (!('speechSynthesis' in window)) {
      listen();
      return;
    }
    const say = new SpeechSynthesisUtterance(items[index].word);
    say.lang = 'en-US';
    say.rate = 0.8;
    const at = index;
    let done = false;
    say.onend = say.onerror = () => {
      if (done) return;
      done = true;
      if (index === at) listen();
    };
    speechSynthesis.cancel();
    speechSynthesis.speak(say);
    setStatus('Listen, then say it.', '');
    setHint('');
  }

  // A grown-up heard the child read the word right, whatever the page heard.
  function saidIt() {
    if (index < 0 || index >= items.length) return;
    clearTimeout(advance);
    stopListening();
    reveal();
    const result = results[index];
    if (!result.tries.some((t) => t.ok)) result.grownUp = true;
    setStatus('Marked right', 'is-right');
    setHint('');
    const at = index;
    advance = setTimeout(() => { if (index === at) nextWord(); }, PAUSE_AFTER_RIGHT);
  }

  // ---------- results ----------

  function engineText(name) {
    if (name === 'vosk') return `by Vosk on this device (${vosk.info.name}${vosk.speed === null ? '' : `, ${vosk.speed.toFixed(2)} s to recognize 1 s of audio`})`;
    return name === 'device' ? 'by Chrome on this device' : 'by Google (online)';
  }

  function seconds(ms) {
    return ms === null ? '?' : `${(ms / 1000).toFixed(1)} s`;
  }

  // One try: what came of it and when it ended, then [when sound started, a partial result, how loud].
  function attemptText(t) {
    let outcome;
    if (t.fromPartial) {
      outcome = `✓ partial${t.error ? ` (${t.error})` : ''}`;
    } else if (t.error) {
      outcome = t.error;
    } else {
      const heard = t.heard.length ? t.heard.slice(0, 3).map((h) => `"${h}"`).join(', ') : 'nothing';
      const sure = typeof t.confidence === 'number' && t.confidence > 0 ? ` ${t.confidence.toFixed(2)}` : '';
      outcome = `${t.ok ? '✓' : '✗'} ${heard}${sure}`;
    }
    const notes = [];
    if (t.soundMs !== null) notes.push(`sound ${seconds(t.soundMs)}`);
    const partial = t.hit || t.last;
    if (partial) notes.push(`partial "${partial.text}" ${seconds(partial.ms)}`);
    if (typeof t.unknown === 'number' && t.unknown > 0) notes.push(`${t.unknown} other ${t.unknown === 1 ? 'word' : 'words'}`);
    if (typeof t.sentMs === 'number') notes.push(`heard ${seconds(t.sentMs)}`);
    if (typeof t.lagMs === 'number' && t.lagMs >= 300) notes.push(`behind ${seconds(t.lagMs)}`);
    if (typeof t.peak === 'number') notes.push(`loudest ${dB(t.peak)}`);
    return `${outcome}, ${seconds(t.ms)}${notes.length ? ` [${notes.join(', ')}]` : ''}`;
  }

  const understood = (r) => r.tries.some((t) => t.ok);

  function summary() {
    const first = results.filter((r) => r.tries.length && r.tries[0].ok).length;
    const any = results.filter(understood).length;
    const marked = results.filter((r) => r.grownUp && !understood(r)).length;
    return { first, any, marked };
  }

  // How long the mic took to come on after the page asked it to listen.
  function micText() {
    const tries = results.flatMap((r) => r.tries);
    const ready = tries.map((t) => t.readyMs).filter((ms) => ms !== null).sort((a, b) => a - b);
    if (!tries.length) return 'Mic on after: no tries.';
    if (!ready.length) return `Mic on after: not reported (${tries.length} tries).`;
    const missing = tries.length - ready.length;
    const typical = ready[Math.floor((ready.length - 1) / 2)];
    return `Mic on after: typically ${seconds(typical)}, at most ${seconds(ready[ready.length - 1])}`
      + (missing ? `; not reported ${missing} of ${tries.length} times.` : '.');
  }

  // How often partial results came, and how much sooner than the final result they had the word.
  function partialText() {
    const tries = results.flatMap((r) => r.tries);
    if (!tries.length) return 'Partial results: no tries.';
    const came = tries.filter((t) => t.last).length;
    if (!came) return `Partial results: none in ${tries.length} tries.`;
    const leads = tries.filter((t) => t.ok && !t.fromPartial && t.hit).map((t) => t.ms - t.hit.ms).sort((a, b) => a - b);
    const parts = [`in ${came} of ${tries.length} tries`];
    if (leads.length) parts.push(`had the word before a right final result ${leads.length} times, typically ${seconds(leads[Math.floor((leads.length - 1) / 2)])} sooner`);
    parts.push(`counted with no final result: ${tries.filter((t) => t.fromPartial).length}`);
    parts.push(`had the word when the try didn't count: ${tries.filter((t) => t.hit && !t.ok).length}`);
    return `Partial results: ${parts.join('; ')}.`;
  }

  // How much audio Vosk was given, and how far behind its answers were.
  function voskText() {
    const tries = results.flatMap((r) => r.tries).filter((t) => typeof t.sentMs === 'number');
    if (!tries.length) return 'Vosk: no tries.';
    const lags = tries.map((t) => t.lagMs).sort((a, b) => a - b);
    const heard = tries.reduce((sum, t) => sum + t.sentMs, 0);
    return `Vosk: heard ${seconds(heard)} of audio in ${tries.length} tries (only when there was sound); `
      + `answers were typically ${seconds(lags[Math.floor((lags.length - 1) / 2)])} behind, at most ${seconds(lags[lags.length - 1])}.`;
  }

  function micLevelText() {
    const before = micCheck ? `checked before starting: loudest ${dB(micCheck.loudest)}, room ${dB(micCheck.floor)}` : 'not checked before starting';
    return `Mic level: ${before}; ${liveRun ? 'shown while listening' : 'not shown while listening'}.`;
  }

  function resultsText() {
    const { first, any, marked } = summary();
    const n = results.length;
    const lines = [
      `Times Up speech check (version ${PAGE_VERSION}), ${new Date().toLocaleString()}`,
      `Device: ${device.os}, ${device.browser}`,
      `Recognizing: ${engineText(runEngine)}; Chrome on-device status: ${localStatusText}`,
      `Understood on the first try: ${first} of ${n}. With more tries: ${any} of ${n}.${marked ? ` Marked right by a grown-up: ${marked}.` : ''}`,
      micText(),
      micLevelText(),
      partialText(),
      ...(runEngine === 'vosk' ? [voskText()] : []),
      '',
    ];
    for (const r of results) {
      const label = r.sound ? `${r.word} (${r.sound})` : r.word;
      const parts = r.tries.length ? r.tries.map(attemptText) : ['no tries'];
      if (r.helped) parts.push('used Hear it');
      if (r.grownUp) parts.push('grown-up marked it right');
      lines.push(`${label}: ${parts.join(' | ')}`);
    }
    return lines.join('\n');
  }

  function finish() {
    stopListening();
    Listen.stopMeter();
    vosk.close();
    const { first, any, marked } = summary();
    $('score').textContent = `Understood ${first} of ${results.length} words on the first try, and ${any} with more tries.`
      + (marked ? ` You marked ${marked} more as right.` : '');
    $('list').replaceChildren(...results.map((r) => {
      const ok = understood(r);
      const item = document.createElement('li');
      item.className = ok ? 'is-ok' : r.grownUp ? 'is-said' : 'is-miss';
      const word = document.createElement('span');
      word.className = 'result-word';
      word.textContent = r.word;
      const note = document.createElement('span');
      note.className = 'result-note';
      const parts = r.tries.length ? r.tries.map(attemptText) : ['No tries'];
      if (r.grownUp && !ok) parts.push('marked right by you');
      note.textContent = parts.join('; ');
      item.append(word, note);
      return item;
    }));
    $('results-text').value = resultsText();
    $('copied').textContent = '';
    $('share').hidden = typeof navigator.share !== 'function';
    show('done');
  }

  async function copyResults() {
    const text = $('results-text').value;
    try {
      await navigator.clipboard.writeText(text);
      $('copied').textContent = 'Copied. Paste it into your message to Claude.';
    } catch (error) {
      $('results-text').select();
      $('copied').textContent = 'Select the text below and copy it.';
    }
  }

  async function shareResults() {
    try {
      await navigator.share({ title: 'Times Up speech check', text: $('results-text').value });
    } catch (error) {
      // Closing the share sheet isn't a problem.
    }
  }

  // ---------- wiring ----------

  $('begin').addEventListener('click', begin);
  $('again').addEventListener('click', () => {
    clearTimeout(advance);
    triesLeft = RELISTEN;
    listen();
  });
  $('hear').addEventListener('click', hear);
  $('said').addEventListener('click', saidIt);
  $('next').addEventListener('click', nextWord);
  $('copy').addEventListener('click', copyResults);
  $('share').addEventListener('click', shareResults);
  $('restart').addEventListener('click', () => show('intro'));
  $('install-local').addEventListener('click', installLocal);
  $('mic-test').addEventListener('click', toggleMicTest);
  window.addEventListener('pagehide', () => {
    Listen.stopMeter();
    vosk.close();
  });
  for (const box of document.querySelectorAll('input[name="engine"]')) box.addEventListener('change', () => chooseEngine(box.value));
  $('vosk-retry').addEventListener('click', () => chooseEngine('vosk'));

  renderDevice(); // say what's known right away; the rest fills in once the device has been checked
  checkDevice().then(renderDevice, renderDevice);
})();
