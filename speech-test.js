/*
 * Times Up speech check: shows 20 words one at a time, listens with the
 * browser's speech recognition, and reports how often it understood. It's a
 * trial run before building a reading mode, so nothing is saved.
 */
(function () {
  'use strict';

  const Reading = window.Reading;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const PAUSE_AFTER_RIGHT = 900; // ms before the next word
  const LISTEN_LIMIT = 8000; // ms; stop listening after this if the browser hasn't

  const $ = (id) => document.getElementById(id);
  const items = Reading.speechCheckItems();
  const device = { os: 'Unknown', browser: 'Unknown', local: 'not available' };
  let results = [];
  let index = -1;
  let session = null; // the recognition that's listening now
  let advance = 0;
  let useLocal = false;

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
      'not available': 'Not in this browser',
    }[device.local] || device.local;
    $('fact-local').textContent = local;
    $('local-row').hidden = device.local !== 'available';
    $('install-local').hidden = device.local !== 'downloadable';
    if (!Recognition) {
      $('unsupported').hidden = false;
      $('unsupported').textContent = window.isSecureContext
        ? "This browser can't recognize speech. Open this page in Chrome."
        : 'Speech recognition only works on pages opened over https.';
      $('begin').disabled = true;
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

  function begin() {
    useLocal = $('local').checked && device.local === 'available';
    results = items.map((item) => ({ ...item, tries: [], helped: false }));
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
    $('heard').textContent = '';
    setStatus('', '');
    listen();
  }

  function stopListening() {
    if (session) {
      session.cancelled = true;
      try {
        session.abort();
      } catch (error) {
        // Already stopped.
      }
    }
    session = null;
    $('listening').hidden = true;
  }

  function listen() {
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
    const attempt = { heard: [], confidence: null, ok: false, ms: null, error: '' };
    const started = performance.now();
    let settled = false;
    const timer = setTimeout(() => {
      try {
        rec.stop();
      } catch (error) {
        // Already stopped.
      }
    }, LISTEN_LIMIT);

    function settle() {
      if (settled || rec.cancelled) return;
      settled = true;
      clearTimeout(timer);
      if (session === rec) session = null;
      $('listening').hidden = true;
      if (attempt.ms === null) attempt.ms = Math.round(performance.now() - started);
      result.tries.push(attempt);
      if (attempt.ok) {
        setStatus(`Heard “${attempt.match}”`, 'is-right');
        $('heard').textContent = '';
        const at = index;
        advance = setTimeout(() => { if (index === at) nextWord(); }, PAUSE_AFTER_RIGHT);
      } else if (attempt.error) {
        setStatus(messageFor(attempt.error), 'is-wrong');
      } else {
        setStatus(`Heard “${attempt.heard.slice(0, 3).join('”, “')}”`, 'is-wrong');
        $('heard').textContent = 'Tap Try again, Hear it, or Next.';
      }
    }

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
          attempt.ms = Math.round(performance.now() - started);
          attempt.match = Reading.heardIt(item.word, attempt.heard);
          attempt.ok = attempt.match !== null;
          settle();
          return;
        }
        interim += res[0].transcript;
      }
      if (interim.trim()) $('heard').textContent = `Hearing “${interim.trim()}”…`;
    };
    rec.onerror = (event) => {
      if (rec.cancelled) return;
      attempt.error = event.error || 'error';
      settle();
    };
    rec.onend = () => {
      if (rec.cancelled) return;
      if (!settled && !attempt.heard.length && !attempt.error) attempt.error = 'no-speech';
      settle();
    };

    session = rec;
    try {
      rec.start();
      $('listening').hidden = false;
      setStatus('', '');
    } catch (error) {
      attempt.error = 'start';
      settle();
    }
  }

  function messageFor(code) {
    return {
      'no-speech': "Didn't hear anything. Tap Try again, then say the word.",
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
    results[index].helped = true;
    if (!('speechSynthesis' in window)) {
      listen();
      return;
    }
    const say = new SpeechSynthesisUtterance(items[index].word);
    say.lang = 'en-US';
    say.rate = 0.8;
    const at = index;
    say.onend = () => { if (index === at) listen(); };
    speechSynthesis.cancel();
    speechSynthesis.speak(say);
    setStatus('Listen, then say it.', '');
  }

  // ---------- results ----------

  function seconds(ms) {
    return ms === null ? '?' : `${(ms / 1000).toFixed(1)} s`;
  }

  function attemptText(t) {
    if (t.error) return t.error;
    const heard = t.heard.length ? t.heard.slice(0, 3).map((h) => `"${h}"`).join(', ') : 'nothing';
    const sure = typeof t.confidence === 'number' && t.confidence > 0 ? ` ${t.confidence.toFixed(2)}` : '';
    return `${t.ok ? '✓' : '✗'} ${heard}${sure}, ${seconds(t.ms)}`;
  }

  function summary() {
    const first = results.filter((r) => r.tries.length && r.tries[0].ok).length;
    const any = results.filter((r) => r.tries.some((t) => t.ok)).length;
    return { first, any };
  }

  function resultsText() {
    const { first, any } = summary();
    const lines = [
      `Times Up speech check, ${new Date().toLocaleString()}`,
      `Device: ${device.os}, ${device.browser}`,
      `Recognizing: ${useLocal ? 'on this device' : 'by Google (online)'}; on-device status: ${device.local}`,
      `Understood on the first try: ${first} of ${results.length}. With more tries: ${any} of ${results.length}.`,
      '',
    ];
    for (const r of results) {
      const label = r.sound ? `${r.word} (${r.sound})` : r.word;
      const tries = r.tries.length ? r.tries.map(attemptText).join(' | ') : 'skipped';
      lines.push(`${label}: ${tries}${r.helped ? ' | used Hear it' : ''}`);
    }
    return lines.join('\n');
  }

  function finish() {
    stopListening();
    const { first, any } = summary();
    $('score').textContent = `Understood ${first} of ${results.length} words on the first try, and ${any} with more tries.`;
    $('list').replaceChildren(...results.map((r) => {
      const ok = r.tries.some((t) => t.ok);
      const item = document.createElement('li');
      item.className = ok ? 'is-ok' : 'is-miss';
      const word = document.createElement('span');
      word.className = 'result-word';
      word.textContent = r.word;
      const note = document.createElement('span');
      note.className = 'result-note';
      note.textContent = r.tries.length ? r.tries.map(attemptText).join('; ') : 'Skipped';
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
    listen();
  });
  $('hear').addEventListener('click', hear);
  $('next').addEventListener('click', nextWord);
  $('copy').addEventListener('click', copyResults);
  $('share').addEventListener('click', shareResults);
  $('restart').addEventListener('click', () => show('intro'));
  $('install-local').addEventListener('click', installLocal);

  if (!Recognition) renderDevice(); // say so right away; the rest fills in once the device has been checked
  describeDevice().then(renderDevice, renderDevice);
})();
