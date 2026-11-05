/*
 * Times Up: the quiz rules. Which facts get asked, the four answer choices,
 * and scoring. There is no page code in here, so the same file runs in the
 * game (as window.Quiz) and in the tests (test/index.html).
 */
(function (global) {
  'use strict';

  const TABLES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const RANGE_MIN = 0;
  const RANGE_MAX = 12;
  const SECONDS_OPTIONS = [5, 10, 15, 20, 30];
  const COUNT_OPTIONS = [10, 20, 30];
  // What the chosen tables are multiplied by: 'same' uses only the chosen
  // numbers on both sides; 'range' uses every number from `from` to `to`.
  const MULTIPLY_OPTIONS = ['same', 'range'];
  // 'all' asks every fact equally often; 'weak' leans on the ones a player finds tricky.
  const FOCUS_OPTIONS = ['all', 'weak'];

  const DEFAULT_SETTINGS = Object.freeze({
    tables: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    multiplyBy: 'same',
    from: 1,
    to: 10,
    timed: false,
    seconds: 10,
    count: 10,
    focus: 'all',
    sound: true,
    playerId: null, // null plays as a guest
  });

  /** Fisher-Yates shuffle, in place. */
  function shuffle(items, random = Math.random) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  /** 6 × 8 and 8 × 6 share a key: they are the same fact. */
  function factKey(a, b) {
    return a <= b ? `${a}x${b}` : `${b}x${a}`;
  }

  /** The numbers the chosen times tables get multiplied by. */
  function multipliersFor(settings) {
    if (settings.multiplyBy !== 'range') return settings.tables.slice();
    const list = [];
    for (let m = settings.from; m <= settings.to; m++) list.push(m);
    return list;
  }

  /**
   * Every distinct fact for the given times tables, each multiplied by
   * each of the multipliers. Returns [table, multiplier] pairs.
   */
  function buildFacts(tables, multipliers) {
    const seen = new Set();
    const facts = [];
    for (const table of tables) {
      for (const m of multipliers) {
        const key = factKey(table, m);
        if (!seen.has(key)) {
          seen.add(key);
          facts.push([table, m]);
        }
      }
    }
    return facts;
  }

  /** Every fact that can come up with these settings. */
  function factsFor(settings) {
    return buildFacts(settings.tables, multipliersFor(settings));
  }

  /** Swapped digits: 65 for 56. Only for two-digit answers that don't end in 0. */
  function swapDigits(answer) {
    return answer > 10 && answer < 100 && answer % 10 !== 0 ? (answer % 10) * 10 + Math.floor(answer / 10) : null;
  }

  /** Whether n is one of the believable wrong answers to a × b that makeChoices offers. */
  function isSlip(a, b, n) {
    const answer = a * b;
    if (!Number.isInteger(n) || n < 0 || n === answer) return false;
    return [a, b, 1, 2, 10].includes(Math.abs(n - answer)) || n === swapDigits(answer);
  }

  /**
   * The right answer plus three believable wrong ones, in random order.
   * Wrong answers copy real slips: landing on a neighbouring fact
   * (6 × 7 or 6 × 9 instead of 6 × 8), being off by one or two, slipping
   * by ten, or swapping the digits (65 for 56).
   * `wanted` can name a wrong answer to include, such as one the player
   * picked before; it's used only if it's one of those slips.
   */
  function makeChoices(a, b, random = Math.random, wanted = []) {
    const answer = a * b;
    const wrong = [];
    const favourite = wanted.find((n) => isSlip(a, b, n));
    if (favourite !== undefined) wrong.push(favourite);
    const slips = [];
    // One slip per kind, going up or down at random, so the right answer
    // isn't always the one in the middle.
    for (const step of [a, b, 1, 2, 10]) {
      if (step === 0) continue;
      const below = answer - step;
      slips.push(below >= 0 && random() < 0.5 ? below : answer + step);
    }
    const swapped = swapDigits(answer);
    if (swapped !== null) slips.push(swapped);
    // The steps 1, 2 and 10 always give three different wrong numbers,
    // so this loop always finds three.
    for (const n of shuffle(slips, random)) {
      if (wrong.length === 3) break;
      if (n !== answer && !wrong.includes(n)) wrong.push(n);
    }
    return shuffle([answer, ...wrong], random);
  }

  /**
   * The questions for one round. Facts come out of a shuffled bag, so none
   * repeats until all of them have been asked, and each question shows its
   * two numbers in a random order.
   */
  function createRound(settings, random = Math.random) {
    const facts = factsFor(settings);
    if (facts.length === 0) throw new Error('Pick at least one times table.');

    const questions = [];
    let bag = [];
    let previous = null;
    while (questions.length < settings.count) {
      if (bag.length === 0) {
        bag = shuffle(facts.slice(), random);
        // Facts are drawn from the end. A refilled bag shouldn't start with
        // the fact that was just asked.
        const last = bag.length - 1;
        if (last > 0 && bag[last] === previous) [bag[0], bag[last]] = [bag[last], bag[0]];
      }
      const fact = bag.pop();
      previous = fact;
      const [a, b] = random() < 0.5 ? fact : [fact[1], fact[0]];
      questions.push({ a, b, answer: a * b, choices: makeChoices(a, b, random) });
    }
    return questions;
  }

  /** A random item, each one as likely as its weight. */
  function weightedPick(items, random) {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let roll = random() * total;
    for (const item of items) {
      roll -= item.weight;
      if (roll < 0) return item;
    }
    return items[items.length - 1];
  }

  /**
   * A round that leans on the facts a player finds tricky, still drawn only
   * from the facts these settings allow. needOf(a, b) answers
   * { weight, maxUses, slips }: how likely the fact is to come up, how many
   * times it may come up in the round, and wrong answers the player picked
   * before, which come back as choices so they learn to tell them apart.
   * A fact never comes back within three questions of itself.
   */
  function createFocusRound(settings, needOf, random = Math.random) {
    const facts = factsFor(settings);
    if (facts.length === 0) throw new Error('Pick at least one times table.');
    const pool = facts.map((fact) => {
      const need = needOf(fact[0], fact[1]) || {};
      return {
        fact,
        weight: need.weight > 0 ? need.weight : 1,
        maxUses: need.maxUses > 1 ? need.maxUses : 1,
        slips: Array.isArray(need.slips) ? need.slips : [],
        uses: 0,
        last: -Infinity,
      };
    });
    // With fewer than four facts, the gap shrinks so there's always one to ask.
    const gap = Math.min(3, pool.length - 1);
    const questions = [];
    for (let i = 0; i < settings.count; i++) {
      const rested = pool.filter((p) => i - p.last > gap);
      const fresh = rested.filter((p) => p.uses < p.maxUses);
      const pick = weightedPick(fresh.length ? fresh : rested, random);
      pick.uses += 1;
      pick.last = i;
      const [a, b] = random() < 0.5 ? pick.fact : [pick.fact[1], pick.fact[0]];
      questions.push({ a, b, answer: a * b, choices: makeChoices(a, b, random, pick.slips) });
    }
    return questions;
  }

  /** 3 stars for 90% or more, 2 for 70%, 1 for 50%. */
  function starsFor(right, total) {
    const share = total > 0 ? right / total : 0;
    if (share >= 0.9) return 3;
    if (share >= 0.7) return 2;
    if (share >= 0.5) return 1;
    return 0;
  }

  /** Cleans up settings loaded from storage, falling back to defaults. */
  function sanitizeSettings(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const d = DEFAULT_SETTINGS;
    const whole = (v, fallback) => (Number.isInteger(v) && v >= RANGE_MIN && v <= RANGE_MAX ? v : fallback);
    const pick = (v, options, fallback) => (options.includes(v) ? v : fallback);
    const flag = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

    let from = whole(s.from, d.from);
    let to = whole(s.to, d.to);
    if (from > to) [from, to] = [to, from];

    return {
      // An empty list is allowed here; the setup screen asks for a table before starting.
      tables: Array.isArray(s.tables) ? TABLES.filter((t) => s.tables.includes(t)) : d.tables.slice(),
      multiplyBy: pick(s.multiplyBy, MULTIPLY_OPTIONS, d.multiplyBy),
      from,
      to,
      timed: flag(s.timed, d.timed),
      seconds: pick(s.seconds, SECONDS_OPTIONS, d.seconds),
      count: pick(s.count, COUNT_OPTIONS, d.count),
      focus: pick(s.focus, FOCUS_OPTIONS, d.focus),
      sound: flag(s.sound, d.sound),
      playerId: typeof s.playerId === 'string' && /^[A-Za-z0-9_.~:@+-]{1,80}$/.test(s.playerId) ? s.playerId : null,
    };
  }

  const Quiz = {
    TABLES,
    RANGE_MIN,
    RANGE_MAX,
    SECONDS_OPTIONS,
    COUNT_OPTIONS,
    MULTIPLY_OPTIONS,
    FOCUS_OPTIONS,
    DEFAULT_SETTINGS,
    shuffle,
    factKey,
    multipliersFor,
    buildFacts,
    factsFor,
    isSlip,
    makeChoices,
    createRound,
    createFocusRound,
    starsFor,
    sanitizeSettings,
  };

  if (typeof module === 'object' && module.exports) module.exports = Quiz;
  global.Quiz = Quiz;
})(typeof globalThis !== 'undefined' ? globalThis : this);
