/*
 * Times Up: reading practice. Words and sounds from the class's phonics
 * homework packet (lessons.js), how to tell whether what speech recognition
 * heard matches what's on the screen, the items in a round, and what a
 * player's reading history says. There's no page code in here, so the tests
 * run it too.
 *
 * The sight words are the 72 in the packet's guide, in the order it teaches
 * them. The phonics words practice each sound pattern the packet teaches,
 * mostly using the packet's own example words; the speech check uses them.
 */
(function (global) {
  'use strict';

  const SIGHT_WORDS = [
    'the', 'a', 'one', 'two', 'I', 'see', 'yellow', 'green', 'purple', 'white', 'pink', 'black',
    'and', 'brown', 'is', 'red', 'orange', 'to', 'in', 'are', 'blue', 'of', 'you', 'go',
    'gray', 'from', 'what', 'have', 'who', 'four', 'was', 'my', 'little', 'like', 'down', 'look',
    'will', 'said', 'good', 'into', 'do', 'why', 'love', 'for', 'they', 'that', 'me', 'so',
    'be', 'no', 'we', 'he', 'she', 'there', 'this', 'want', 'went', 'well', 'too', 'please',
    'under', 'where', 'pretty', 'our', 'how', 'now', 'must', 'ride', 'saw', 'say', 'fly', 'once',
  ];

  // Each sound pattern with words that use it. "silent e" marks the vowel and the e.
  const PHONICS = [
    { sound: 'ck', words: ['duck', 'sock', 'clock', 'back', 'crack'] },
    { sound: 'sh', words: ['ship', 'fish', 'dish', 'wash', 'shed'] },
    { sound: 'th', words: ['path', 'math', 'bath', 'moth', 'thick'] },
    { sound: 'wh', words: ['when', 'whale', 'whip', 'which'] },
    { sound: 'oo', words: ['moon', 'spoon', 'scoop', 'look', 'foot'] },
    { sound: 'silent e', words: ['cone', 'pine', 'vine', 'note', 'time'] },
    { sound: 'ch', words: ['chip', 'chin', 'much', 'lunch', 'chime'] },
    { sound: 'ee', words: ['bee', 'tree', 'sheep', 'jeep', 'sleep'] },
    { sound: 'ar', words: ['star', 'car', 'barn', 'park', 'farm'] },
    { sound: 'or', words: ['fork', 'corn', 'horn', 'north', 'storm'] },
    { sound: 'er', words: ['her', 'river', 'ruler', 'fern', 'herd'] },
    { sound: 'qu', words: ['queen', 'quick', 'quest', 'quit', 'quack'] },
  ];

  // Other ways speech recognition writes a word that sounds the same.
  // Saying any of these is reading the word right.
  const SOUNDS_LIKE = {
    // "a" said as "ay" often comes back as "hey"; a lone "uh" is usually dropped as a filler sound.
    a: ['uh', 'ah', 'ay', 'hey', 'hay', 'eh'],
    i: ['eye', 'aye'],
    one: ['1', 'won'],
    two: ['2', 'to', 'too'],
    to: ['2', 'two', 'too'],
    too: ['2', 'two', 'to'],
    four: ['4', 'for', 'fore'],
    for: ['4', 'four', 'fore'],
    see: ['sea', 'c'],
    be: ['bee', 'b'],
    bee: ['be', 'b'],
    no: ['know'],
    so: ['sew', 'sow'],
    you: ['u', 'ewe'],
    are: ['r'],
    our: ['hour'],
    why: ['y'],
    red: ['read'],
    blue: ['blew'],
    there: ['their', "they're"],
    where: ['wear', 'ware'],
    gray: ['grey'],
    do: ['dew', 'due'],
    we: ['wee'],
    the: ['thee'],
    in: ['inn'],
    whale: ['wail', 'wale'],
    which: ['witch'],
    herd: ['heard'],
    time: ['thyme'],
  };

  // The words a recognizer wrote, lowercase, without punctuation or apostrophes.
  function wordsIn(text) {
    return String(text == null ? '' : text)
      .toLowerCase()
      .replace(/[^a-z0-9'’\s]+/g, ' ')
      .replace(/['’]/g, '')
      .split(/\s+/)
      .filter(Boolean);
  }

  /**
   * Which of the recognizer's guesses says the target word (as one of its
   * words, so "um said" counts for "said"), or null if none does.
   */
  function heardIt(target, guesses) {
    const want = String(target).toLowerCase();
    const forms = new Set([want, ...(SOUNDS_LIKE[want] || [])].map((f) => f.replace(/['’]/g, '')));
    for (const guess of guesses) {
      if (wordsIn(guess).some((w) => forms.has(w))) return guess;
    }
    return null;
  }

  /**
   * A word split into parts, with the sound pattern marked:
   * mark('ship', 'sh') -> [{ text: 'sh', mark: true }, { text: 'ip', mark: false }]
   */
  function mark(word, sound) {
    const ranges = [];
    if (sound === 'silent e') {
      const m = /([aeiou])([^aeiou]+)e$/.exec(word);
      if (m) ranges.push([m.index, m.index + 1], [word.length - 1, word.length]);
    } else if (sound) {
      const at = word.indexOf(sound);
      if (at >= 0) ranges.push([at, at + sound.length]);
    }
    const parts = [];
    let from = 0;
    for (const [start, end] of ranges) {
      if (start > from) parts.push({ text: word.slice(from, start), mark: false });
      parts.push({ text: word.slice(start, end), mark: true });
      from = end;
    }
    if (from < word.length) parts.push({ text: word.slice(from), mark: false });
    return parts;
  }

  /** The 20 words on the speech check page: short and long sight words, and phonics words. */
  function speechCheckItems() {
    const sight = ['the', 'a', 'I', 'one', 'two', 'of', 'said', 'was', 'you', 'where', 'little', 'yellow'];
    const phonics = [['ship', 'sh'], ['chip', 'ch'], ['path', 'th'], ['when', 'wh'], ['duck', 'ck'], ['sheep', 'ee'], ['star', 'ar'], ['cone', 'silent e']];
    const items = [];
    for (let i = 0; i < sight.length; i++) {
      items.push({ word: sight[i], sound: null });
      if (i % 3 !== 0 && phonics.length) {
        const [word, sound] = phonics.shift();
        items.push({ word, sound });
      }
    }
    for (const [word, sound] of phonics) items.push({ word, sound });
    return items;
  }

  // ---------- matching what was heard in reading practice ----------

  const MAX_WORDS_FOR_ONE = 3; // a longer stretch of talk isn't the child reading one word

  // Whether a heard word is the target word, or sounds the same.
  function sameWord(target, heard) {
    const want = String(target).toLowerCase().replace(/['’]/g, '');
    return heard === want || (SOUNDS_LIKE[want] || []).some((f) => f.replace(/['’]/g, '') === heard);
  }

  /**
   * Checks the recognizer's guesses ({ transcript, unknown }) for one word.
   * The word has to be said nearly on its own: a guess with more than three
   * words (counting ones Vosk couldn't name) is someone talking, and doesn't
   * count either way. Returns { ok, match, long }.
   */
  function checkWord(target, guesses) {
    let long = guesses.length > 0;
    for (const guess of guesses) {
      const words = wordsIn(guess.transcript);
      if (words.length + (Number(guess.unknown) || 0) > MAX_WORDS_FOR_ONE) continue;
      long = false;
      if (words.some((w) => sameWord(target, w))) return { ok: true, match: guess.transcript, long: false };
    }
    return { ok: false, match: null, long };
  }

  /**
   * How much of a sentence was read, from what the recognizer heard: each of
   * the sentence's words is looked for in order, allowing a few extra words
   * in between. ok when every word was heard. Names (which recognizers spell
   * every which way) and one "a" or "the" may be missed.
   * Returns { words, matched: [true or false per word], ok }.
   */
  function checkSentence(sentence, transcript, names = new Set()) {
    const words = wordsIn(sentence);
    const heard = wordsIn(transcript);
    const matched = words.map(() => false);
    let from = 0;
    words.forEach((word, i) => {
      for (let j = from; j < Math.min(heard.length, from + 4); j++) {
        if (sameWord(word, heard[j])) {
          matched[i] = true;
          from = j + 1;
          return;
        }
      }
    });
    const isName = (w) => names.has(w) || names.has(w.replace(/s$/, '')); // "tims" is Tim's
    const missed = words.filter((w, i) => !matched[i] && !isName(w));
    const small = missed.filter((w) => w === 'a' || w === 'the');
    const ok = words.length > 0 && (missed.length === 0 || (missed.length === 1 && small.length === 1 && words.length >= 4));
    return { words, matched, ok };
  }

  // ---------- the packet, page by page ----------

  const Lessons = global.Lessons || null;
  const FIRST_PAGE = Lessons ? Lessons.FIRST_PAGE : 4;
  const LAST_PAGE = Lessons ? Lessons.LAST_PAGE : 143;
  let packet = null;

  // A sight word as practiced: lowercase, except "I".
  function sightForm(word) {
    const low = String(word).toLowerCase();
    return low === 'i' ? 'I' : low;
  }

  // A sentence's words, each with whether it starts a sentence (so a capital there isn't a name).
  function sentenceTokens(sentence) {
    const tokens = [];
    let start = true;
    for (const raw of String(sentence).split(/\s+/).filter(Boolean)) {
      const word = raw.replace(/^[^A-Za-z]+|[^A-Za-z'’]+$/g, '').replace(/['’]+$/, '');
      if (/^["“‘]/.test(raw)) start = true;
      if (word) tokens.push({ word, start });
      start = /[.!?]["”’]?$/.test(raw);
    }
    return tokens;
  }

  // Everything that's worked out once from the whole packet.
  function buildPacket() {
    const pages = Lessons ? Lessons.PAGES : [];
    const sight = new Set();
    const lower = new Set();
    const capitalized = new Set();
    for (const [, , words, sentences] of pages) {
      for (const w of words.split(/\s+/).filter(Boolean)) {
        sight.add(w.toLowerCase());
        lower.add(w.toLowerCase());
      }
      for (const sentence of sentences) {
        for (const t of sentenceTokens(sentence)) {
          const base = t.word.replace(/['’]s$/i, '').toLowerCase(); // Tim’s is Tim
          if (/^[a-z]/.test(t.word)) lower.add(base);
          else if (!t.start && t.word !== 'I') capitalized.add(base);
        }
      }
    }
    // A name: written with a capital in the middle of a sentence, and never in lowercase.
    const names = new Set([...capitalized].filter((w) => !lower.has(w)));
    return { pages, sight, names, lessons: new Map() };
  }

  function thePacket() {
    if (!packet) packet = buildPacket();
    return packet;
  }

  // The sound taught most recently by this page: 'sh', 't' or 'silent e'.
  function newSoundOn(page) {
    let sound = null;
    for (const [from, s] of (Lessons ? Lessons.NEW_SOUNDS : [])) if (from <= page) sound = s;
    return sound;
  }

  // The sound pattern to highlight in a word to sound out: the newest one
  // taught by this page that's in the word, or the page's new letter.
  function soundFor(word, page) {
    const taught = (Lessons ? Lessons.NEW_SOUNDS : []).filter(([from, s]) => from <= page && (s.length > 1));
    for (let i = taught.length - 1; i >= 0; i--) {
      const sound = taught[i][1];
      if (mark(word, sound).some((p) => p.mark)) return sound;
    }
    const letter = newSoundOn(page);
    return letter && letter.length === 1 && word.includes(letter) ? letter : null;
  }

  /**
   * One page of the packet, ready to practice: its sounds (as printed, each
   * once), its sight words (each once), the sight words new on this page,
   * its sentences, and the words to sound out from its sentences (not sight
   * words, not names), each with the sound to highlight.
   */
  function lesson(page) {
    const p = thePacket();
    if (p.lessons.has(page)) return p.lessons.get(page);
    const index = p.pages.findIndex((row) => row[0] === page);
    if (index < 0) return null;
    const [, sounds, words, sentences] = p.pages[index];
    const earlier = new Set();
    for (let i = 0; i < index; i++) for (const w of p.pages[i][2].split(/\s+/)) earlier.add(sightForm(w));
    const sightList = [...new Set(words.split(/\s+/).filter(Boolean).map(sightForm))];
    const decodable = [];
    for (const sentence of sentences) {
      for (const t of sentenceTokens(sentence)) {
        const w = t.word.toLowerCase();
        if (/['’]/.test(w) || w === 'i' || p.sight.has(w) || p.names.has(w) || decodable.some((d) => d.word === w)) continue;
        decodable.push({ word: w, sound: soundFor(w, page) });
      }
    }
    const result = {
      page,
      newSound: newSoundOn(page),
      sounds: [...new Set(sounds.split(/\s+/).filter(Boolean))],
      words: sightList,
      newWords: sightList.filter((w) => !earlier.has(w)),
      sentences: sentences.slice(),
      decodable,
      names: p.names,
    };
    p.lessons.set(page, result);
    return result;
  }

  /** The words a recognizer should listen for on a page: its sight words, the words in its sentences, and its words to sound out. */
  function vocabulary(l) {
    const words = new Set(l.words.map((w) => w.toLowerCase()));
    for (const sentence of l.sentences) for (const w of wordsIn(sentence)) words.add(w);
    for (const d of l.decodable) words.add(d.word);
    return [...words];
  }

  function soundNote(token) {
    const notes = Lessons ? Lessons.SOUND_NOTES : {};
    return notes[String(token).toLowerCase()] || null;
  }

  // ---------- a round of reading ----------
  // A round starts at a page and has the number of items asked for. It goes
  // through the parts in the packet's order (sounds, then words, then
  // sentences). When the page runs out, it goes on to the next pages, so
  // page breaks don't cut a round short. Only near the end of the packet,
  // with nothing left after it, does it go back to earlier pages.

  const PARTS = ['sounds', 'words', 'sentences']; // the packet's order
  const COUNTS = [10, 20, 30, 0]; // 0: the whole page, and only that page
  const ENGINES = ['online', 'vosk', 'off']; // Google, Vosk on the device, or a grown-up checks
  const DEFAULT_SETTINGS = Object.freeze({ page: FIRST_PAGE, parts: PARTS.slice(), count: 10, focus: 'all', engine: 'online' });

  function sanitizeSettings(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const d = DEFAULT_SETTINGS;
    const pick = (v, options, fallback) => (options.includes(v) ? v : fallback);
    // Rounds and settings saved before several parts could be picked have one `part`.
    const listed = Array.isArray(s.parts) ? s.parts : typeof s.part === 'string' ? [s.part] : d.parts;
    const page = Number.isInteger(s.page) && s.page >= FIRST_PAGE && s.page <= LAST_PAGE ? s.page : d.page;
    const clean = {
      page,
      // An empty list is allowed here; the setup screen asks for a part before starting.
      parts: PARTS.filter((part) => listed.includes(part)),
      count: pick(s.count, COUNTS, d.count),
      focus: pick(s.focus, ['all', 'weak'], d.focus),
      engine: pick(s.engine, ENGINES, d.engine),
    };
    // The last page a saved round used, when it went past its first.
    if (Number.isInteger(s.to) && s.to >= FIRST_PAGE && s.to <= LAST_PAGE) clean.to = s.to;
    return clean;
  }

  // History keys: one per word (sight word or word to sound out), sound or sentence.
  function keyOf(kind, text) {
    if (kind === 'sound') return `s:${String(text).toLowerCase()}`;
    if (kind === 'sentence') return `n:${wordsIn(text).join(' ')}`;
    return `w:${String(text).toLowerCase()}`;
  }

  function shuffled(items, random) {
    const list = items.slice();
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  // One page's items for one part, in the page's order.
  function partItems(l, part) {
    if (part === 'sounds') {
      return l.sounds.map((t) => ({ kind: 'sound', text: t, key: keyOf('sound', t), sound: null, page: l.page, isNew: t.toLowerCase() === l.newSound }));
    }
    if (part === 'sentences') {
      return l.sentences.map((t) => ({ kind: 'sentence', text: t, key: keyOf('sentence', t), sound: null, page: l.page, isNew: false }));
    }
    return [
      ...l.words.map((w) => ({ kind: 'sight', text: w, key: keyOf('sight', w), sound: null, page: l.page, isNew: l.newWords.includes(w) })),
      ...l.decodable.map((d) => ({ kind: 'word', text: d.word, key: keyOf('word', d.word), sound: d.sound, page: l.page, isNew: false })),
    ];
  }

  // A sound's capital and small letter are both practiced, so they're different items (with one history).
  const sameItem = (item) => (item.kind === 'sound' ? `t:${item.text}` : item.key);

  /** How a round of `count` is shared out among the parts: evenly, with any extra going to words, then sounds. */
  function shares(parts, count) {
    const order = ['words', 'sounds', 'sentences'].filter((part) => parts.includes(part));
    const out = {};
    order.forEach((part, i) => { out[part] = Math.floor(count / order.length) + (i < count % order.length ? 1 : 0); });
    return out;
  }

  /**
   * What a round starting at `page` draws on: for each part, the items to
   * pick from (`pool`, each with its page) and how many to pick (`take`),
   * plus every page used and the first and last of them. count 0 is the
   * whole page: everything the page has for those parts, and nothing else.
   */
  function planRound(page, parts, count) {
    const plan = { parts: {}, pages: [], from: page, to: page, total: 0 };
    const want = count > 0 ? shares(parts, count) : null;
    const order = [];
    for (let p = page; p <= LAST_PAGE; p++) order.push(p);
    for (let p = page - 1; p >= FIRST_PAGE; p--) order.push(p); // only when nothing's left after the page
    const used = new Set();
    for (const part of PARTS) {
      if (!parts.includes(part)) continue;
      const pool = [];
      const seen = new Set();
      for (const p of want ? order : [page]) {
        const l = lesson(p);
        if (!l) continue;
        let added = false;
        for (const item of partItems(l, part)) {
          if (seen.has(sameItem(item))) continue;
          seen.add(sameItem(item));
          pool.push(item);
          added = true;
        }
        if (added) used.add(p);
        if (want && pool.length >= want[part]) break;
      }
      const take = want ? Math.min(want[part], pool.length) : pool.length;
      plan.parts[part] = { pool, take };
      plan.total += take;
    }
    plan.pages = [...used].sort((x, y) => x - y);
    if (plan.pages.length) {
      plan.from = plan.pages[0];
      plan.to = plan.pages[plan.pages.length - 1];
    }
    return plan;
  }

  // Picks `take` items from a pool, page by page in the pool's order. On a
  // page with more than there's room for, its new items come first, then the
  // rest at random (leaning on weak spots when focus is 'weak').
  function pickFrom(pool, take, focus, weightOf, random) {
    const pages = [];
    for (const item of pool) {
      if (!pages.length || pages[pages.length - 1][0].page !== item.page) pages.push([]);
      pages[pages.length - 1].push(item);
    }
    const picked = [];
    for (const items of pages) {
      const room = take - picked.length;
      if (room <= 0) break;
      if (items.length <= room) {
        picked.push(...items);
        continue;
      }
      const fresh = shuffled(items.filter((i) => i.isNew), random).slice(0, room);
      picked.push(...fresh);
      let rest = items.filter((i) => !fresh.includes(i)).map((i) => ({ i, weight: focus === 'weak' ? Math.max(0.01, weightOf(i.key)) : 1 }));
      while (picked.length < take && rest.length) {
        const total = rest.reduce((sum, r) => sum + r.weight, 0);
        let roll = random() * total;
        let choice = rest[rest.length - 1];
        for (const r of rest) {
          roll -= r.weight;
          if (roll < 0) {
            choice = r;
            break;
          }
        }
        picked.push(choice.i);
        rest = rest.filter((r) => r !== choice);
      }
    }
    return picked;
  }

  /**
   * The items for a round: { kind, text, shown, key, sound, page }. kind is
   * 'sound', 'sight' (a sight word), 'word' (a word to sound out) or
   * 'sentence'. They come in the packet's order: sounds, then words, then
   * sentences. Sounds and words are mixed up within their part; sentences
   * keep the packet's order. Nothing repeats, a page's new sight words and
   * new sound always come up, and sight words sometimes start with a
   * capital, like in the packet. options: { parts, count, focus }.
   */
  function createRound(page, options, weightOf = () => 1, random = Math.random) {
    const plan = planRound(page, options.parts, options.count);
    const items = [];
    for (const part of PARTS) {
      const p = plan.parts[part];
      if (!p) continue;
      // Sentences are read in the packet's order; sounds and words are mixed up.
      items.push(...(part === 'sentences' ? p.pool.slice(0, p.take) : shuffled(pickFrom(p.pool, p.take, options.focus, weightOf, random), random)));
    }
    return items.map(({ isNew, ...item }) => ({
      ...item,
      shown: item.kind === 'sight' && item.text !== 'I' && random() < 0.25 ? item.text[0].toUpperCase() + item.text.slice(1) : item.text,
    }));
  }

  /** The words a recognizer should listen for, on all of these pages. */
  function vocabularyOf(pages) {
    const words = new Set();
    for (const p of pages) {
      const l = lesson(p);
      if (l) for (const w of vocabulary(l)) words.add(w);
    }
    return [...words];
  }

  // ---------- what a reading history says ----------
  // Each word, sound or sentence gets a level from its latest tries, like the math facts:
  //   mastered  the last 3 tries were right
  //   learning  right lately, but not 3 in a row yet
  //   practice  the last try wasn't right, or fewer than half of the last 4 were
  // A try is right when it was read (heard by voice, or checked by a grown-up) without Hear it.

  const RECENT = 4;
  const LATELY = 3; // rounds
  const KINDS = ['sight', 'word', 'sound', 'sentence'];
  const HOWS = ['voice', 'grown-up', 'skip'];
  const WEIGHTS = { practice: 20, learning: 3, new: 2, mastered: 1 };

  function dayKey(time) {
    const d = new Date(time);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function cleanRounds(raw) {
    const rounds = [];
    for (const r of Array.isArray(raw) ? raw : []) {
      if (!r || typeof r !== 'object' || !r.settings || r.settings.operation !== 'read') continue;
      const at = Date.parse(r.startedAt);
      const answers = [];
      for (const x of Array.isArray(r.answers) ? r.answers : []) {
        if (!x || typeof x !== 'object' || !KINDS.includes(x.kind) || typeof x.item !== 'string' || !x.item) continue;
        answers.push({
          kind: x.kind,
          item: x.item.slice(0, 200),
          key: keyOf(x.kind, x.item),
          right: x.right === true,
          how: HOWS.includes(x.how) ? x.how : 'skip',
          helped: x.helped === true,
          heard: typeof x.heard === 'string' ? x.heard.slice(0, 80) : '',
        });
      }
      if (!Number.isFinite(at) || !answers.length) continue;
      const s = sanitizeSettings(r.settings);
      rounds.push({ id: typeof r.id === 'string' ? r.id : '', at, answers, finished: r.finished === true, settings: s });
    }
    return rounds.sort((x, y) => x.at - y.at);
  }

  function levelOf(tries) {
    if (!tries.length) return 'new';
    const recent = tries.slice(-RECENT);
    const right = recent.filter((t) => t.right).length;
    if (!tries[tries.length - 1].right || right * 2 < recent.length) return 'practice';
    const last3 = tries.slice(-3);
    return last3.length === 3 && last3.every((t) => t.right) ? 'mastered' : 'learning';
  }

  function summarize(answers) {
    const right = answers.filter((x) => x.right).length;
    return { questions: answers.length, right, accuracy: answers.length ? right / answers.length : null };
  }

  /** Everything the reading report and weak-spots rounds need, from a player's saved rounds (any kind; others are skipped). */
  function analyze(rawRounds, now = Date.now()) {
    const rounds = cleanRounds(rawRounds);
    const items = new Map();
    rounds.forEach((round, index) => {
      for (const x of round.answers) {
        if (!items.has(x.key)) items.set(x.key, { key: x.key, kind: x.kind, item: x.kind === 'sight' ? sightForm(x.item) : x.item, tries: [] });
        const entry = items.get(x.key);
        if (x.kind === 'sight' || x.kind === 'word') entry.kind = x.kind; // the latest kind wins
        entry.tries.push({ right: x.right, how: x.how, helped: x.helped, heard: x.heard, at: round.at, round: index });
      }
    });
    for (const entry of items.values()) {
      const recent = entry.tries.slice(-RECENT);
      entry.level = levelOf(entry.tries);
      entry.seen = entry.tries.length;
      entry.recentCount = recent.length;
      entry.recentRight = recent.filter((t) => t.right).length;
      entry.lastAt = entry.tries[entry.tries.length - 1].at;
      const miss = [...entry.tries].reverse().find((t) => !t.right && t.heard);
      entry.lastHeard = miss ? miss.heard : '';
    }
    const split = Math.max(0, rounds.length - LATELY);
    const days = new Map();
    for (const r of rounds) {
      const key = dayKey(r.at);
      if (!days.has(key)) days.set(key, { at: r.at, answers: [] });
      days.get(key).answers.push(...r.answers);
    }
    const byDay = days.size >= 3;
    const groups = byDay ? [...days.values()] : rounds.map((r, i) => ({ at: r.at, answers: r.answers, number: i + 1 }));
    const last = rounds.length ? rounds[rounds.length - 1] : null;
    const levels = {};
    for (const kind of ['words', 'sound', 'sentence']) levels[kind] = { mastered: 0, learning: 0, practice: 0 };
    for (const entry of items.values()) {
      const group = entry.kind === 'sound' ? 'sound' : entry.kind === 'sentence' ? 'sentence' : 'words';
      levels[group][entry.level] += 1;
    }
    return {
      rounds,
      items,
      levels,
      totals: {
        ...summarize(rounds.flatMap((r) => r.answers)),
        rounds: rounds.length,
        days: days.size,
        firstAt: rounds.length ? rounds[0].at : null,
        lastAt: last ? last.at : null,
      },
      lately: summarize(rounds.slice(split).flatMap((r) => r.answers)),
      earlier: split ? summarize(rounds.slice(0, split).flatMap((r) => r.answers)) : null,
      trend: {
        unit: byDay ? 'day' : 'round',
        points: groups.slice(-14).map((g) => ({ at: g.at, number: g.number || null, ...summarize(g.answers), typicalMs: null })),
      },
      lastPage: last ? last.settings.page : null,
      daysSinceLast: last ? Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(last.at).setHours(0, 0, 0, 0)) / 86400000) : null,
    };
  }

  /** How strongly a weak-spots round leans on each item, by its key. */
  function weightFinder(analysis) {
    return (key) => {
      const entry = analysis ? analysis.items.get(key) : null;
      return WEIGHTS[entry ? entry.level : 'new'];
    };
  }

  /** The words, sounds or sentences that most need work, worst first. */
  function trickiest(analysis, kinds = KINDS, limit = 6) {
    const rank = { practice: 0, learning: 1 };
    return [...analysis.items.values()]
      .filter((e) => kinds.includes(e.kind) && (e.level === 'practice' || (e.level === 'learning' && e.recentRight < e.recentCount)))
      .sort((x, y) => rank[x.level] - rank[y.level] || x.recentRight / x.recentCount - y.recentRight / y.recentCount || y.lastAt - x.lastAt)
      .slice(0, limit);
  }

  const Reading = {
    SIGHT_WORDS, PHONICS, SOUNDS_LIKE, wordsIn, heardIt, mark, speechCheckItems,
    FIRST_PAGE, LAST_PAGE, PARTS, COUNTS, ENGINES, DEFAULT_SETTINGS, LATELY,
    checkWord, checkSentence, lesson, vocabulary, vocabularyOf, soundNote, sightForm, newSoundOn,
    sanitizeSettings, keyOf, shares, planRound, createRound, cleanRounds, levelOf, analyze, weightFinder, trickiest,
  };

  if (typeof module === 'object' && module.exports) module.exports = Reading;
  global.Reading = Reading;
})(typeof globalThis !== 'undefined' ? globalThis : this);
