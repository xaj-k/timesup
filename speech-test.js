/*
 * Times Up speech check: shows 20 words one at a time, listens with the
 * browser's speech recognition, and reports how often it understood. It's a
 * trial run before building a reading mode, so nothing is saved.
 */
(function () {
  'use strict';

  const Reading = window.Reading;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const PAGE_VERSION = 2; // in the results, so it's clear which page made them
  const PAUSE_AFTER_RIGHT = 900; // ms before the next word
  const LISTEN_LIMIT = 8000; // ms; stop listening after this if the browser hasn't
  const READY_LIMIT = 1500; // ms; show the word by then, even if the browser never says the mic is on
  const RELISTEN = 3; // times to listen again by itself after silence or a different word
  const RELISTEN_GAP = 300; // ms between one listen ending and the next starting
  // Endings where nothing useful was heard, so it's worth listening again.
  const QUIET = new Set(['no-speech', 'no-match', 'nothing', 'time-up']);

  const $ = (id) => document.getElementById(id);
  const items = Reading.speechCheckItems();
  const device = { os: 'Unknown', browser: 'Unknown', local: 'not available' };
  let results = [];
  let index = -1;
  let session = null; // the recognition that's listening now
  let advance = 0; // timer for moving on to the next word
  let relisten = 0; // timer for listening again
  let triesLeft = RELISTEN; // listens left before the page waits for a tap
  let useLocal = false;
  let liveRun = false; // whether the level bar runs while the page listens for words
  let micCheck = null; // what the mic check before starting measured
  let starting = false;

  // ---------- this device ----------

  function brandOf(list) {
    const named = list.find((b) => !/Chromium|Not.?A.?Brand/i.test(b.brand)) || list.find((b) => /Chromium/i.test(b.brand));
    return named ? `${named.brand} ${String(named.version).split('.')[0]}` : '';
  }

  async function describeDevice() {
    try {
      const data = navigator.userAgentData;
      if (data && data.getHighEntropyValues) {
        // The browser's user-agent string hides the real Android version; this asks for it.
        const v = await data.getHighEntropyValues(['platformVersion', 'model', 'fullVersionList']);
        const version = String(v.platformVersion || '').split('.')[0];
        device.os = data.platform === 'Android' ? `Android ${version}${v.model ? ` (${v.model})` : ''}` : data.platform || device.os;
        device.browser = brandOf(v.fullVersionList || []) || device.browser;
      }
    } catch (error) {
      // Fall back to the user-agent string below.
    }
    const ua = navigator.userAgent;
    if (device.os === 'Unknown') {
      device.os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
    }
    if (device.browser === 'Unknown') {
      const m = /(Edg|OPR|Firefox|Chrome|Version)\/(\d+)/.exec(ua);
      if (m) device.browser = `${{ Edg: 'Edge', OPR: 'Opera', Version: 'Safari' }[m[1]] || m[1]} ${m[2]}`;
    }
    device.local = await localStatus();
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
    device.local = await localStatus();
    button.disabled = false;
    button.textContent = 'Download English for this device';
    renderDevice();
  }

  function renderDevice() {
    $('fact-device').textContent = `${device.os} · ${device.browser}`;
    $('fact-speech').textContent = Recognition ? 'Yes' : 'No';
    const local = {
      available: 'Ready',
      downloadable: 'Can be downloaded',
      downloading: 'Downloading…',
      unavailable: 'Not on this device',
      'not available': 'Not in this browser',
    }[device.local] || device.local;
    $('fact-local').textContent = local;
    $('local-row').hidden = device.local !== 'available';
    $('install-local').hidden = device.local !== 'downloadable';
    if (!meter.stream && !micCheck) {
      $('mic-readout').textContent = 'Tap Test the mic, then have your child say something from where they’ll sit. The bar should jump when they talk.'
        + (canShareMic() ? ' It also shows while the page listens for words.' : ' On this device it can’t run while the page listens for words, so check here first.');
    }
    if (!Recognition) {
      $('unsupported').hidden = false;
      $('unsupported').textContent = window.isSecureContext
        ? "This browser can't recognize speech. Open this page in Chrome."
        : 'Speech recognition only works on pages opened over https.';
      $('begin').disabled = true;
    }
  }

  // ---------- microphone level ----------
  // The level bar needs its own hold on the microphone. On a computer it can
  // share the mic with speech recognition. On Android it can't (one of the two
  // gets silence), so there it only runs for the mic check, before the words start.

  const METER_LOW = -70; // dB at an empty bar
  const METER_HIGH = -10; // dB at a full bar
  const meter = { stream: null, context: null, analyser: null, data: null, frame: 0, level: -100, peak: -100, loudest: -100, floor: null, shown: 0, error: '' };

  function canShareMic() {
    return /^(Windows|macOS|Linux|Chrome OS|Chromium OS)/.test(device.os);
  }

  async function startMeter() {
    if (meter.stream) return true;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !AudioCtx) {
      meter.error = 'not-supported';
      return false;
    }
    let context;
    try {
      context = new AudioCtx(); // made right away, while the tap still lets it run
    } catch (error) {
      meter.error = 'audio';
      return false;
    }
    try {
      // Without the browser's voice clean-up, so the bar shows what the mic really picks up.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      if (context.state === 'suspended') await context.resume().catch(() => {});
      Object.assign(meter, { stream, context, analyser, data: new Float32Array(analyser.fftSize), level: -100, peak: -100, loudest: -100, floor: null, error: '' });
      meter.frame = requestAnimationFrame(tick);
      return true;
    } catch (error) {
      context.close().catch(() => {});
      meter.error = (error && error.name) || 'error';
      return false;
    }
  }

  function stopMeter() {
    cancelAnimationFrame(meter.frame);
    if (meter.stream) for (const track of meter.stream.getTracks()) track.stop();
    if (meter.context) meter.context.close().catch(() => {});
    Object.assign(meter, { stream: null, context: null, analyser: null, data: null, level: -100 });
    drawMeter(0);
  }

  function tick() {
    if (!meter.analyser) return;
    meter.analyser.getFloatTimeDomainData(meter.data);
    let sum = 0;
    for (let i = 0; i < meter.data.length; i++) sum += meter.data[i] * meter.data[i];
    const db = Math.max(-100, 10 * Math.log10(sum / meter.data.length || 1e-10));
    // Jump up with a sound and sink back slowly, like a sound meter.
    meter.level = db > meter.level ? db : meter.level - Math.min(meter.level - db, 0.5);
    meter.peak = Math.max(meter.peak, db);
    meter.loudest = Math.max(meter.loudest, db);
    // The room's background: drops to any quieter moment and creeps back up slowly.
    meter.floor = meter.floor === null ? db : Math.min(db, meter.floor + 0.03);
    drawMeter((meter.level - METER_LOW) / (METER_HIGH - METER_LOW));
    const now = performance.now();
    if (now - meter.shown > 500 && !$('intro').hidden) {
      meter.shown = now;
      $('mic-readout').textContent = micReadout();
    }
    meter.frame = requestAnimationFrame(tick);
  }

  function drawMeter(fraction) {
    const scale = `scaleX(${Math.min(1, Math.max(0, fraction)).toFixed(3)})`;
    for (const fill of document.querySelectorAll('.meter-fill')) fill.style.transform = scale;
  }

  // The loudest sound since the last call, or null when there's no level bar.
  function takePeak() {
    const peak = meter.peak;
    meter.peak = -100;
    return meter.stream ? peak : null;
  }

  const dB = (value) => (typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)} dB` : '?');

  function micReadout() {
    const loud = meter.loudest < -42 ? 'too quiet (have your child talk, or move closer)' : meter.loudest > -6 ? 'very loud' : 'good';
    const room = meter.floor < -50 ? 'quiet' : meter.floor < -38 ? 'a little noisy' : 'noisy';
    return `Loudest so far: ${loud}, ${dB(meter.loudest)}. Room: ${room}, ${dB(meter.floor)}.`;
  }

  function keepMicCheck() {
    if (meter.stream && meter.floor !== null) micCheck = { loudest: meter.loudest, floor: meter.floor };
  }

  async function toggleMicTest() {
    const button = $('mic-test');
    if (meter.stream) {
      keepMicCheck();
      stopMeter();
      button.textContent = 'Test the mic';
      return;
    }
    button.disabled = true;
    const ok = await startMeter();
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
    useLocal = $('local').checked && device.local === 'available';
    keepMicCheck();
    $('mic-test').textContent = 'Test the mic';
    if (canShareMic()) {
      liveRun = await startMeter(); // keeps the mic check's bar going, or starts one
    } else {
      liveRun = false;
      if (meter.stream) {
        stopMeter();
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
    const rec = new Recognition();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.maxAlternatives = 5;
    rec.continuous = false;
    if (useLocal) {
      if ('processLocally' in rec) rec.processLocally = true;
      else if ('mode' in rec) rec.mode = 'ondevice-only';
    }
    // readyMs: when the browser said the mic was on. sound: whether it noticed any sound.
    const attempt = { heard: [], confidence: null, ok: false, ms: null, readyMs: null, sound: false, error: '' };
    const started = performance.now();
    const since = () => Math.round(performance.now() - started);
    takePeak(); // the level bar's loudest, from here on
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
      attempt.peak = takePeak();
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
      attempt.sound = true;
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
          for (let j = 0; j < res.length; j++) guesses.push({ text: String(res[j].transcript).trim(), confidence: res[j].confidence });
          attempt.heard = guesses.map((g) => g.text).filter(Boolean);
          attempt.confidence = guesses.length ? guesses[0].confidence : null;
          attempt.ms = since();
          attempt.match = Reading.heardIt(item.word, attempt.heard);
          attempt.ok = attempt.match !== null;
          settle();
          return;
        }
        interim += res[0].transcript;
      }
      goLive();
      if (interim.trim()) setHint(`Hearing “${interim.trim()}”…`);
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
      'language-not-supported': 'This device can’t recognize English this way. Try without “Recognize on this device”.',
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

  function seconds(ms) {
    return ms === null ? '?' : `${(ms / 1000).toFixed(1)} s`;
  }

  function attemptText(t) {
    if (t.error) {
      const notes = [];
      if (t.sound) notes.push('sound');
      if (typeof t.peak === 'number') notes.push(`loudest ${dB(t.peak)}`);
      return notes.length ? `${t.error} (${notes.join(', ')})` : t.error;
    }
    const heard = t.heard.length ? t.heard.slice(0, 3).map((h) => `"${h}"`).join(', ') : 'nothing';
    const sure = typeof t.confidence === 'number' && t.confidence > 0 ? ` ${t.confidence.toFixed(2)}` : '';
    return `${t.ok ? '✓' : '✗'} ${heard}${sure}, ${seconds(t.ms)}`;
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
      `Recognizing: ${useLocal ? 'on this device' : 'by Google (online)'}; on-device status: ${device.local}`,
      `Understood on the first try: ${first} of ${n}. With more tries: ${any} of ${n}.${marked ? ` Marked right by a grown-up: ${marked}.` : ''}`,
      micText(),
      micLevelText(),
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
    stopMeter();
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
  window.addEventListener('pagehide', stopMeter);

  if (!Recognition) renderDevice(); // say so right away; the rest fills in once the device has been checked
  describeDevice().then(renderDevice, renderDevice);
})();
