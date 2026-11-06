/*
 * Times Up: listening to a child read out loud, for the speech check and
 * reading practice.
 *
 * Speech is recognized one of two ways, and both look the same to a page:
 * the Web Speech API's SpeechRecognition, with start(), stop(), abort() and
 * its events.
 *  - The browser's own. Chrome sends the audio to Google, or newer Chrome
 *    can recognize it on the device.
 *  - Vosk (vendor/vosk), which runs inside the page on this device and only
 *    listens for the words it's given. It downloads 41 MB the first time.
 *
 * Also here: a microphone level bar, and what device this is.
 */
(function (global) {
  'use strict';

  const BrowserRecognition = global.SpeechRecognition || global.webkitSpeechRecognition || null;
  const AudioCtx = global.AudioContext || global.webkitAudioContext || null;
  const OLD_ANDROID = 13; // reading practice is meant for this Android or newer

  // ---------- this device ----------

  function brandOf(list) {
    const named = list.find((b) => !/Chromium|Not.?A.?Brand/i.test(b.brand)) || list.find((b) => /Chromium/i.test(b.brand));
    return named ? `${named.brand} ${String(named.version).split('.')[0]}` : '';
  }

  /** { os: 'Android 11 (SM-T510)', android: 11, browser: 'Chrome 142' }. android is null on anything else. */
  async function describeDevice() {
    const device = { os: 'Unknown', android: null, browser: 'Unknown' };
    const ua = navigator.userAgent;
    const data = navigator.userAgentData;
    try {
      if (data && data.getHighEntropyValues) {
        // Chrome's user-agent string hides the real Android version; this asks for it.
        const v = await data.getHighEntropyValues(['platformVersion', 'model', 'fullVersionList']);
        const version = String(v.platformVersion || '').split('.')[0];
        if (data.platform === 'Android') {
          device.os = `Android ${version}${v.model ? ` (${v.model})` : ''}`;
          if (/^\d+$/.test(version)) device.android = Number(version);
        } else if (data.platform) {
          device.os = data.platform;
        }
        device.browser = brandOf(v.fullVersionList || []) || device.browser;
      }
    } catch (error) {
      // Fall back to the user-agent string below.
    }
    if (device.os === 'Unknown') {
      device.os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
      // Browsers without the hint above (like Firefox) still put the real version in the string.
      const m = /Android (\d+)/.exec(ua);
      if (device.os === 'Android' && m && !data) {
        device.android = Number(m[1]);
        device.os = `Android ${m[1]}`;
      }
    }
    if (device.browser === 'Unknown') {
      const m = /(Edg|OPR|Firefox|Chrome|Version)\/(\d+)/.exec(ua);
      if (m) device.browser = `${{ Edg: 'Edge', OPR: 'Opera', Version: 'Safari' }[m[1]] || m[1]} ${m[2]}`;
    }
    return device;
  }

  function isOldAndroid(device) {
    return Boolean(device) && device.android !== null && device.android < OLD_ANDROID;
  }

  // On a computer, a level bar can share the mic with the browser's speech recognition.
  // On Android it can't: one of the two gets silence.
  function canShareMic(device) {
    return Boolean(device) && /^(Windows|macOS|Linux|Chrome OS|Chromium OS)/.test(device.os);
  }

  // ---------- microphone level ----------
  // Fills every .meter-fill on the page as the sound gets louder.

  const METER_LOW = -70; // dB at an empty bar
  const METER_HIGH = -10; // dB at a full bar
  const meter = {
    stream: null,
    context: null,
    source: null,
    analyser: null,
    data: null,
    frame: 0,
    owned: false, // whether stopping the bar also lets go of the mic
    level: -100,
    peak: -100,
    loudest: -100,
    floor: null, // the room's background
    error: '',
    onTick: null, // called on every frame while the bar runs
  };

  /** Opens the mic just for the bar, without the browser's voice clean-up, so it shows what the mic really picks up. */
  async function startMeter() {
    if (meter.analyser) return true;
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      if (context.state === 'suspended') await context.resume().catch(() => {});
      attachMeter(context, context.createMediaStreamSource(stream), stream, true);
      return true;
    } catch (error) {
      context.close().catch(() => {});
      meter.error = (error && error.name) || 'error';
      return false;
    }
  }

  /** Shows the level of audio that's already coming in, like Vosk's. */
  function attachMeter(context, source, stream, owned = false) {
    stopMeter();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    Object.assign(meter, { stream, context, source, analyser, owned, data: new Float32Array(analyser.fftSize), level: -100, peak: -100, loudest: -100, floor: null, error: '' });
    meter.frame = requestAnimationFrame(tick);
  }

  function stopMeter() {
    cancelAnimationFrame(meter.frame);
    if (meter.owned) {
      if (meter.stream) for (const track of meter.stream.getTracks()) track.stop();
      if (meter.context) meter.context.close().catch(() => {});
    } else if (meter.source && meter.analyser) {
      try {
        meter.source.disconnect(meter.analyser);
      } catch (error) {
        // Already disconnected.
      }
    }
    Object.assign(meter, { stream: null, context: null, source: null, analyser: null, data: null, owned: false, level: -100 });
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
    if (meter.onTick) meter.onTick();
    meter.frame = requestAnimationFrame(tick);
  }

  function drawMeter(fraction) {
    const scale = `scaleX(${Math.min(1, Math.max(0, fraction)).toFixed(3)})`;
    for (const fill of document.querySelectorAll('.meter-fill')) fill.style.transform = scale;
  }

  /** The loudest sound since the last call, or null when there's no level bar. */
  function takePeak() {
    const peak = meter.peak;
    meter.peak = -100;
    return meter.analyser ? peak : null;
  }

  // ---------- Vosk ----------

  const VOSK = {
    script: 'vendor/vosk/vosk.js',
    model: 'vendor/vosk/vosk-model-small-en-us-0.15.tar.gz',
    name: 'vosk-model-small-en-us-0.15',
    megabytes: 41,
  };
  const SOUND_OVER_FLOOR = 12; // dB over the room's background that counts as someone talking
  const SOUND_MIN = -60; // dB; quieter than this is never talking
  const QUIET_AFTER = 600; // ms of quiet before a sound counts as over
  const STOP_WAIT = 1500; // ms to wait for the last result after stop()
  const LOAD_STALL = 180000; // ms without any news from the loading model before giving up

  const vosk = {
    supported: Boolean(global.WebAssembly && global.Worker && AudioCtx && navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    state: 'idle', // idle, loading, ready or failed
    error: '',
    model: null,
    audio: null, // the open microphone: { stream, context, source, node, rate, floor }
    active: null, // the recognition listening now
    loading: null,
    info: VOSK,
    load: loadVosk,
    open: openVosk,
    close: closeVosk,
    recognition: (words) => new VoskRecognition(words),
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (global.Vosk) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => (global.Vosk ? resolve() : reject(new Error('vosk.js loaded without Vosk')));
      script.onerror = () => reject(new Error('couldn’t download vosk.js'));
      document.head.append(script);
    });
  }

  /**
   * Loads Vosk and its English model, once. progress({ phase, loaded, total })
   * says how it's going: 'code' (vosk.js), 'model' (downloading, the first
   * time only), then 'unpack'.
   */
  function loadVosk(progress = () => {}) {
    if (vosk.loading) return vosk.loading;
    vosk.state = 'loading';
    vosk.error = '';
    vosk.loading = (async () => {
      progress({ phase: 'code' });
      await loadScript(new URL(VOSK.script, document.baseURI).href);
      // A full address: the worker would read a relative one from the site's root folder.
      const model = new global.Vosk.Model(new URL(VOSK.model, document.baseURI).href, -1);
      try {
        await new Promise((resolve, reject) => {
          let stall = 0;
          const wait = () => {
            clearTimeout(stall);
            stall = setTimeout(() => reject(new Error('stopped loading')), LOAD_STALL);
          };
          wait();
          const done = (fn, value) => {
            clearTimeout(stall);
            fn(value);
          };
          model.on('load', (message) => (message.result ? done(resolve) : done(reject, new Error('the model didn’t load'))));
          model.on('error', (message) => done(reject, new Error(message.error || 'error')));
          model.on('progress', (message) => {
            wait();
            const finished = message.total && message.loaded >= message.total;
            progress(finished ? { phase: 'unpack' } : { phase: 'model', loaded: message.loaded, total: message.total });
          });
          model.worker.addEventListener('error', (event) => done(reject, new Error(event.message || 'the recognizer stopped')));
        });
      } catch (error) {
        try {
          model.worker.terminate();
        } catch (ignored) {
          // Already gone.
        }
        throw error;
      }
      vosk.model = model;
      vosk.state = 'ready';
    })().catch((error) => {
      vosk.state = 'failed';
      vosk.error = (error && error.message) || String(error);
      vosk.loading = null; // so it can be tried again
      throw error;
    });
    return vosk.loading;
  }

  /** Opens the microphone for Vosk, and shows its level on the bar. Call it from a tap. */
  async function openVosk() {
    if (vosk.audio) return true;
    if (!vosk.supported) {
      vosk.error = 'not-supported';
      return false;
    }
    let context;
    try {
      context = new AudioCtx(); // made right away, while the tap still lets it run
    } catch (error) {
      vosk.error = 'audio';
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (context.state === 'suspended') await context.resume().catch(() => {});
      const source = context.createMediaStreamSource(stream);
      const node = context.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (event) => hearChunk(event.inputBuffer.getChannelData(0));
      source.connect(node);
      node.connect(context.destination); // a script processor only runs while it's connected; it plays silence
      vosk.audio = { stream, context, source, node, rate: context.sampleRate, floor: null };
      attachMeter(context, source, stream, false);
      return true;
    } catch (error) {
      context.close().catch(() => {});
      vosk.error = (error && error.name) || 'error';
      return false;
    }
  }

  /** Lets go of the microphone. */
  function closeVosk() {
    if (vosk.active) vosk.active.abort();
    const audio = vosk.audio;
    if (!audio) return;
    vosk.audio = null;
    if (meter.context === audio.context) stopMeter();
    audio.node.onaudioprocess = null;
    try {
      audio.source.disconnect();
      audio.node.disconnect();
    } catch (error) {
      // Already disconnected.
    }
    for (const track of audio.stream.getTracks()) track.stop();
    audio.context.close().catch(() => {});
  }

  // Each chunk of microphone audio (about 85 ms) goes to whichever recognition is listening.
  function hearChunk(data) {
    const audio = vosk.audio;
    if (!audio) return;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const db = Math.max(-100, 10 * Math.log10(sum / data.length || 1e-10));
    // The room's background: drops to any quieter moment and creeps back up about 3 dB a second.
    audio.floor = audio.floor === null ? db : Math.min(db, audio.floor + 0.25);
    const loud = db > SOUND_MIN && db > audio.floor + SOUND_OVER_FLOOR;
    if (vosk.active) vosk.active.hear(data, audio.rate, loud, (data.length / audio.rate) * 1000);
  }

  // The words a recognition listens for, lowercase, plus "[unk]" for anything else.
  function grammarFor(words) {
    const list = [];
    for (const item of words) {
      for (const word of String(item).toLowerCase().replace(/’/g, "'").replace(/[^a-z'\s]+/g, ' ').split(/\s+/)) {
        const clean = word.replace(/^'+|'+$/g, '');
        if (clean && !list.includes(clean)) list.push(clean);
      }
    }
    list.push('[unk]');
    return list;
  }

  /**
   * Listens with Vosk for one of the given words (or phrases made of them),
   * and reports it like SpeechRecognition does: audiostart (at once, since
   * the mic is already on), soundstart and soundend, result (partial
   * results, then one final result), nomatch (it only heard other words),
   * error, and end. Each final alternative also has `unknown`: how many
   * other words it heard.
   */
  class VoskRecognition {
    constructor(words) {
      this.grammar = grammarFor(words);
      this.lang = 'en-US';
      this.interimResults = true;
      this.maxAlternatives = 1;
      this.continuous = false;
      this.state = 'new'; // new, live or done
      this.rec = null;
      this.sound = false;
      this.quietMs = 0;
      this.lastPartial = '';
      this.stopping = false;
      this.stopTimer = 0;
      for (const type of ['audiostart', 'soundstart', 'soundend', 'speechstart', 'speechend', 'result', 'nomatch', 'error', 'end']) this[`on${type}`] = null;
    }

    emit(type, detail = {}) {
      const handler = this[`on${type}`];
      if (typeof handler === 'function') handler.call(this, { type, ...detail });
    }

    start() {
      if (this.state !== 'new') throw new Error('This recognition has already started.');
      if (vosk.state !== 'ready' || !vosk.audio) {
        this.state = 'done';
        setTimeout(() => {
          this.emit('error', { error: vosk.audio ? 'not-ready' : 'audio-capture' });
          this.emit('end');
        }, 0);
        return;
      }
      if (vosk.active) vosk.active.abort();
      this.state = 'live';
      vosk.active = this;
      this.rec = new vosk.model.KaldiRecognizer(vosk.audio.rate, JSON.stringify(this.grammar));
      this.rec.setWords(true);
      this.rec.on('result', (message) => this.gotResult(message.result));
      this.rec.on('partialresult', (message) => this.gotPartial(message.result && message.result.partial));
      this.rec.on('error', (message) => {
        if (this.state !== 'live') return;
        this.emit('error', { error: 'recognizer', message: message.error });
        this.end();
      });
      // The mic is already on, so listening starts right away.
      setTimeout(() => {
        if (this.state === 'live') this.emit('audiostart');
      }, 0);
    }

    hear(data, rate, loud, ms) {
      if (this.state !== 'live' || this.stopping) return;
      this.rec.acceptWaveformFloat(data, rate);
      if (loud) {
        this.quietMs = 0;
        if (!this.sound) {
          this.sound = true;
          this.emit('soundstart');
        }
      } else if (this.sound) {
        this.quietMs += ms;
        if (this.quietMs >= QUIET_AFTER) {
          this.sound = false;
          this.emit('soundend');
        }
      }
    }

    gotPartial(partial) {
      if (this.state !== 'live') return;
      const text = String(partial || '').split(/\s+/).filter((w) => w && w !== '[unk]').join(' ');
      if (!text || text === this.lastPartial) return;
      this.lastPartial = text;
      this.emit('result', { resultIndex: 0, results: [Object.assign([{ transcript: text, confidence: 0 }], { isFinal: false })] });
    }

    gotResult(result) {
      if (this.state !== 'live') return;
      const said = String((result && result.text) || '').split(/\s+/).filter(Boolean);
      const known = said.filter((w) => w !== '[unk]');
      const words = result && Array.isArray(result.result) ? result.result.filter((w) => w.word !== '[unk]') : [];
      if (known.length) {
        const confidence = words.length ? words.reduce((sum, w) => sum + (Number(w.conf) || 0), 0) / words.length : 0;
        const alternative = { transcript: known.join(' '), confidence, unknown: said.length - known.length };
        this.emit('result', { resultIndex: 0, results: [Object.assign([alternative], { isFinal: true })] });
        this.end();
      } else if (said.length) {
        this.emit('nomatch'); // it heard talking, but none of the words it listens for
        this.end();
      } else if (this.stopping) {
        this.end();
      }
      // Otherwise it was only silence: keep listening.
    }

    stop() {
      if (this.state !== 'live' || this.stopping) return;
      this.stopping = true;
      try {
        this.rec.retrieveFinalResult();
      } catch (error) {
        this.end();
        return;
      }
      this.stopTimer = setTimeout(() => this.end(), STOP_WAIT);
    }

    abort() {
      if (this.state === 'new') {
        this.state = 'done';
        return;
      }
      if (this.state !== 'live') return;
      this.emit('error', { error: 'aborted' });
      this.end();
    }

    end() {
      if (this.state === 'done') return;
      this.state = 'done';
      clearTimeout(this.stopTimer);
      if (vosk.active === this) vosk.active = null;
      try {
        this.rec.remove();
      } catch (error) {
        // Already removed.
      }
      if (this.sound) {
        this.sound = false;
        this.emit('soundend');
      }
      this.emit('end');
    }
  }

  global.Listen = {
    BrowserRecognition,
    OLD_ANDROID,
    describeDevice,
    isOldAndroid,
    canShareMic,
    meter,
    startMeter,
    stopMeter,
    takePeak,
    vosk,
    grammarFor,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
