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
  const GATE_OVER_FLOOR = 8; // dB over the background that's worth sending to Vosk (a little below talking)
  const SOUND_MIN = -60; // dB; quieter than this is never talking
  const QUIET_AFTER = 600; // ms of quiet before a sound counts as over
  // Vosk only hears the stretches with sound in them, so a slow device keeps up:
  const PREROLL_MS = 600; // audio kept from just before a sound, so its start isn't lost
  const TAIL_MS = 1200; // quiet audio still sent after a sound, so Vosk can tell a word has ended
  const VOSK_RATE = 16000; // Vosk's own sample rate; the browser converts the mic to it
  const STOP_WAIT = 1500; // ms to wait for the last result after stop(), plus however far behind Vosk is
  const STOP_WAIT_MAX = 10000;
  const LOAD_STALL = 180000; // ms without any news from the loading model before giving up
  const SPEED_SECONDS = 2; // seconds of audio in the speed check

  const vosk = {
    supported: Boolean(global.WebAssembly && global.Worker && AudioCtx && navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    state: 'idle', // idle, loading, ready or failed
    error: '',
    model: null,
    speed: null, // seconds it takes to recognize one second of audio here; under 1 keeps up
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
   * time only), 'unpack', then 'speed' (timing how fast this device is).
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
      progress({ phase: 'speed' });
      vosk.speed = await measureSpeed(model);
      vosk.state = 'ready';
    })().catch((error) => {
      vosk.state = 'failed';
      vosk.error = (error && error.message) || String(error);
      vosk.loading = null; // so it can be tried again
      throw error;
    });
    return vosk.loading;
  }

  /**
   * How many seconds Vosk takes here to recognize one second of audio: it's
   * given a couple of seconds of quiet room noise as fast as it will take it.
   * Under 1, it keeps up with someone talking. null if it couldn't tell.
   */
  function measureSpeed(model) {
    const chunk = 2048;
    const total = Math.ceil((VOSK_RATE * SPEED_SECONDS) / chunk);
    return new Promise((resolve) => {
      let rec;
      let answered = 0;
      let timer = 0;
      const finish = (value) => {
        clearTimeout(timer);
        try {
          rec.remove();
        } catch (error) {
          // Already gone.
        }
        resolve(value);
      };
      try {
        rec = new model.KaldiRecognizer(VOSK_RATE, JSON.stringify(['the', '[unk]']));
      } catch (error) {
        resolve(null);
        return;
      }
      const started = performance.now();
      timer = setTimeout(() => finish(null), 60000);
      const count = () => {
        answered += 1;
        if (answered === total) finish((performance.now() - started) / 1000 / ((total * chunk) / VOSK_RATE));
      };
      rec.on('partialresult', count);
      rec.on('result', count);
      rec.on('error', () => finish(null));
      for (let i = 0; i < total; i++) {
        const data = new Float32Array(chunk);
        for (let j = 0; j < chunk; j++) data[j] = (Math.random() - 0.5) * 0.004;
        rec.acceptWaveformFloat(data, VOSK_RATE);
      }
    });
  }

  /** Opens the microphone for Vosk, and shows its level on the bar. Call it from a tap. */
  async function openVosk() {
    if (vosk.audio) return true;
    if (!vosk.supported) {
      vosk.error = 'not-supported';
      return false;
    }
    // At Vosk's own rate (less audio to pass along, and nothing for Vosk to convert), where the browser can.
    let context;
    try {
      context = new AudioCtx({ sampleRate: VOSK_RATE }); // made right away, while the tap still lets it run
    } catch (error) {
      try {
        context = new AudioCtx();
      } catch (again) {
        vosk.error = 'audio';
        return false;
      }
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (context.state === 'suspended') await context.resume().catch(() => {});
      let source;
      try {
        source = context.createMediaStreamSource(stream);
      } catch (error) {
        // Some browsers (Firefox) can't take the mic at another rate.
        context.close().catch(() => {});
        context = new AudioCtx();
        if (context.state === 'suspended') await context.resume().catch(() => {});
        source = context.createMediaStreamSource(stream);
      }
      const node = context.createScriptProcessor(context.sampleRate <= VOSK_RATE ? 2048 : 4096, 1, 1);
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

  // Each chunk of microphone audio (about a tenth of a second) goes to whichever recognition is listening.
  function hearChunk(data) {
    const audio = vosk.audio;
    if (!audio) return;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const db = Math.max(-100, 10 * Math.log10(sum / data.length || 1e-10));
    // The room's background: drops to any quieter moment and creeps back up a couple of dB a second.
    audio.floor = audio.floor === null ? db : Math.min(db, audio.floor + 0.25);
    const loud = db > SOUND_MIN && db > audio.floor + SOUND_OVER_FLOOR;
    const worth = db > SOUND_MIN && db > audio.floor + GATE_OVER_FLOOR;
    if (vosk.active) vosk.active.hear(data, audio.rate, loud, worth, (data.length / audio.rate) * 1000);
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
   *
   * It only passes Vosk the stretches of audio with sound in them (plus a
   * moment before and after), so a slow device doesn't fall behind during
   * silence. sentMs is how much audio it passed on; lagMs and maxLagMs say
   * how far behind Vosk's answers were.
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
      this.preroll = []; // recent quiet audio, kept in case talking starts
      this.prerollMs = 0;
      this.gate = false; // whether audio is going to Vosk
      this.gateQuietMs = 0;
      this.pending = []; // audio sent that Vosk hasn't answered yet: { at, ms }
      this.sentMs = 0;
      this.lagMs = 0;
      this.maxLagMs = 0;
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
      this.rec.on('result', (message) => {
        this.answered();
        this.gotResult(message.result);
      });
      this.rec.on('partialresult', (message) => {
        this.answered();
        this.gotPartial(message.result && message.result.partial);
      });
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

    hear(data, rate, loud, worth, ms) {
      if (this.state !== 'live' || this.stopping) return;
      if (loud || worth) {
        this.gateQuietMs = 0;
        if (!this.gate) {
          this.gate = true;
          for (const kept of this.preroll) this.send(kept.data, rate, kept.ms);
          this.preroll = [];
          this.prerollMs = 0;
        }
        this.send(data, rate, ms);
      } else if (this.gate) {
        this.send(data, rate, ms);
        this.gateQuietMs += ms;
        if (this.gateQuietMs >= TAIL_MS) this.gate = false;
      } else {
        this.preroll.push({ data: data.slice(), ms });
        this.prerollMs += ms;
        while (this.prerollMs > PREROLL_MS && this.preroll.length > 1) this.prerollMs -= this.preroll.shift().ms;
      }
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

    send(data, rate, ms) {
      this.rec.acceptWaveformFloat(data, rate);
      this.pending.push({ at: performance.now(), ms });
      this.sentMs += ms;
    }

    // Vosk answers every piece of audio, in order; how long that took is how far behind it is.
    answered() {
      const sent = this.pending.shift();
      if (!sent) return;
      this.lagMs = performance.now() - sent.at;
      this.maxLagMs = Math.max(this.maxLagMs, this.lagMs);
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
      } else if (this.stopping && !this.pending.length) {
        this.end(); // the last answer, with nothing in it
      }
      // Otherwise it was only a pause, and there may be more audio to go: keep listening.
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
      // Give Vosk time to catch up on the audio it hasn't answered yet.
      const behind = this.pending.reduce((sum, p) => sum + p.ms, 0) * (vosk.speed || 1);
      this.stopTimer = setTimeout(() => this.end(), Math.min(STOP_WAIT_MAX, STOP_WAIT + behind));
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
