/*
 * Tests for quiz.js, insights.js and reading.js. Open test/index.html in a browser to run them.
 */
(function (global) {
  'use strict';

  const Quiz = global.Quiz;
  const Insights = global.Insights;
  const results = [];

  function test(name, fn) {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, message: error.message });
    }
  }

  function check(condition, message) {
    if (!condition) throw new Error(message);
  }

  function same(actual, expected, label) {
    const got = JSON.stringify(actual);
    const want = JSON.stringify(expected);
    if (got !== want) throw new Error(`${label}: expected ${want}, got ${got}`);
  }

  // Seeded random numbers (mulberry32), so a failure can be reproduced.
  function seeded(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  test('6 × 8 and 8 × 6 count as one fact', () => {
    // 6×6, 6×7, 6×8, 8×7, 8×8. 8×6 is already there as 6×8.
    same(Quiz.buildFacts([6, 8], [6, 7, 8]).length, 5, 'facts for the 6 and 8 tables, × 6 to 8');
  });

  test('the 1 to 10 tables, multiplied by the same numbers, make 55 facts', () => {
    same(Quiz.factsFor({ tables: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], multiplyBy: 'same' }).length, 55, 'fact count');
  });

  test('turning off the 1 and 2 tables leaves no 1s or 2s on either side', () => {
    const settings = { tables: [3, 4, 5, 6, 7, 8, 9, 10], multiplyBy: 'same', from: 1, to: 10, count: 30 };
    for (const q of Quiz.createRound(settings, seeded(7))) {
      check(q.a > 2 && q.b > 2, `${q.a} × ${q.b} uses a number that was turned off`);
    }
  });

  test('a range covers a whole table: the 7s from 1 to 10', () => {
    const facts = Quiz.factsFor({ tables: [7], multiplyBy: 'range', from: 1, to: 10 });
    same(facts.map(([t, m]) => t * m), [7, 14, 21, 28, 35, 42, 49, 56, 63, 70], 'the 7 times table');
  });

  test('every question has four different choices and exactly one right answer', () => {
    const random = seeded(1);
    for (let a = 0; a <= 12; a++) {
      for (let b = 0; b <= 12; b++) {
        for (let k = 0; k < 20; k++) {
          const choices = Quiz.makeChoices(a, b, random);
          const label = `${a} × ${b} gave ${choices}`;
          check(choices.length === 4, `${label}: needs 4 choices`);
          check(new Set(choices).size === 4, `${label}: choices must all differ`);
          check(choices.filter((c) => c === a * b).length === 1, `${label}: right answer must appear once`);
          check(choices.every((c) => Number.isInteger(c) && c >= 0), `${label}: choices must be whole numbers, 0 or more`);
        }
      }
    }
  });

  test('wrong choices are believable slips', () => {
    const random = seeded(2);
    for (let a = 0; a <= 12; a++) {
      for (let b = 0; b <= 12; b++) {
        const answer = a * b;
        const swapped = (answer % 10) * 10 + Math.floor(answer / 10);
        for (const c of Quiz.makeChoices(a, b, random)) {
          if (c === answer) continue;
          const gap = Math.abs(c - answer);
          check([a, b, 1, 2, 10].includes(gap) || c === swapped, `${a} × ${b}: ${c} is not a near miss`);
        }
      }
    }
  });

  test('the right answer turns up in every tile position', () => {
    const random = seeded(3);
    const seen = [0, 0, 0, 0];
    for (let i = 0; i < 400; i++) seen[Quiz.makeChoices(7, 8, random).indexOf(56)] += 1;
    check(seen.every((n) => n > 60), `right answer positions were ${seen}`);
  });

  test('a round asks the chosen number of questions from the chosen tables', () => {
    const settings = { tables: [3, 7], multiplyBy: 'range', from: 2, to: 5, count: 30 };
    const fits = (t, m) => settings.tables.includes(t) && m >= settings.from && m <= settings.to;
    const questions = Quiz.createRound(settings, seeded(4));
    same(questions.length, 30, 'question count');
    for (const q of questions) {
      check(fits(q.a, q.b) || fits(q.b, q.a), `${q.a} × ${q.b} is outside the settings`);
      same(q.answer, q.a * q.b, `answer to ${q.a} × ${q.b}`);
      check(q.choices.includes(q.answer), `${q.a} × ${q.b}: right answer missing from the choices`);
    }
  });

  test('no fact repeats until every fact has been asked', () => {
    const settings = { tables: [2, 5, 10], multiplyBy: 'range', from: 1, to: 10, count: 60 };
    const total = Quiz.factsFor(settings).length;
    const keys = Quiz.createRound(settings, seeded(5)).map((q) => Quiz.factKey(q.a, q.b));
    same(new Set(keys.slice(0, total)).size, total, 'different facts in the first pass');
    for (let i = 1; i < keys.length; i++) check(keys[i] !== keys[i - 1], `${keys[i]} was asked twice in a row`);
  });

  test('both orders show up (6 × 8 and 8 × 6)', () => {
    const questions = Quiz.createRound({ tables: [6], multiplyBy: 'range', from: 8, to: 8, count: 30 }, seeded(6));
    check(questions.some((q) => q.a === 6) && questions.some((q) => q.a === 8), 'expected both 6 × 8 and 8 × 6');
  });

  test('a round needs at least one times table', () => {
    let threw = false;
    try {
      Quiz.createRound({ tables: [], multiplyBy: 'range', from: 1, to: 10, count: 10 });
    } catch (error) {
      threw = true;
    }
    check(threw, 'createRound should refuse an empty list of tables');
  });

  test('stars: 3 for 90% and up, 2 for 70%, 1 for 50%', () => {
    same([10, 9, 8, 7, 6, 5, 4, 0].map((n) => Quiz.starsFor(n, 10)), [3, 3, 2, 2, 1, 1, 0, 0], 'stars out of 10');
  });

  test('saved settings are cleaned up before use', () => {
    same(Quiz.sanitizeSettings(null), Quiz.sanitizeSettings({}), 'missing settings fall back to the defaults');
    const s = Quiz.sanitizeSettings({ tables: [12, 3, 3, 99, 'x'], multiplyBy: 'range', from: 9, to: 4, timed: true, seconds: 7, count: 20, sound: false });
    same(s.tables, [3, 12], 'tables');
    same([s.from, s.to], [4, 9], 'range turned the right way round');
    same(s.seconds, Quiz.DEFAULT_SETTINGS.seconds, 'unknown time limit falls back to the default');
    same([s.multiplyBy, s.timed, s.count, s.sound], ['range', true, 20, false], 'good values are kept');
    same(Quiz.sanitizeSettings({ multiplyBy: 'sideways' }).multiplyBy, 'same', 'unknown multiply-by choice falls back to the same numbers');
    same(Quiz.sanitizeSettings({ playerId: 'p-mh2k1x-4f9z2c' }).playerId, 'p-mh2k1x-4f9z2c', 'a saved player is kept');
    same(Quiz.sanitizeSettings({ playerId: '../x y' }).playerId, null, 'a malformed player id plays as a guest');
    same(Quiz.sanitizeSettings({ tables: [] }).tables, [], 'an empty selection stays empty');
    same(Quiz.sanitizeSettings({ focus: 'weak' }).focus, 'weak', 'weak spots is kept');
    same(Quiz.sanitizeSettings({ focus: 'hard' }).focus, 'all', 'an unknown focus falls back to everything');
  });

  // ---------- addition ----------

  test('addition: the 1 to 10 numbers added to each other make 55 facts, and the answers are sums', () => {
    const settings = { operation: 'add', tables: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], multiplyBy: 'same', count: 30 };
    same(Quiz.factsFor(settings).length, 55, 'fact count');
    for (const q of Quiz.createRound(settings, seeded(11))) {
      same(q.answer, q.a + q.b, `answer to ${q.a} + ${q.b}`);
      check(q.choices.includes(q.a + q.b), `${q.a} + ${q.b}: right answer missing from the choices`);
    }
  });

  test('addition: four different choices, one right, all believable adding slips', () => {
    const random = seeded(12);
    for (let a = 0; a <= 12; a++) {
      for (let b = 0; b <= 12; b++) {
        for (let k = 0; k < 10; k++) {
          const choices = Quiz.makeChoices(a, b, random, [], 'add');
          const label = `${a} + ${b} gave ${choices}`;
          check(choices.length === 4 && new Set(choices).size === 4, `${label}: needs 4 different choices`);
          check(choices.filter((c) => c === a + b).length === 1, `${label}: right answer must appear once`);
          for (const c of choices) {
            if (c === a + b) continue;
            check(c >= 0 && [1, 2, 3, 10].includes(Math.abs(c - (a + b))), `${label}: ${c} is not an adding slip`);
          }
        }
      }
    }
    const seen = [0, 0, 0, 0];
    for (let i = 0; i < 400; i++) seen[Quiz.makeChoices(7, 8, random, [], 'add').indexOf(15)] += 1;
    check(seen.every((n) => n > 60), `right answer positions were ${seen}`);
    check(Quiz.isSlip(7, 8, 18, 'add') && !Quiz.isSlip(7, 8, 18) && !Quiz.isSlip(7, 8, 51, 'add'), 'isSlip knows which operation');
  });

  test('settings remember the picks for each operation', () => {
    const s = Quiz.sanitizeSettings({ operation: 'add', tables: [1, 2, 3], selections: { multiply: { tables: [6, 7, 8], multiplyBy: 'range', from: 2, to: 9 } } });
    same([s.operation, s.tables], ['add', [1, 2, 3]], 'the current operation and its numbers');
    same(s.selections.add.tables, [1, 2, 3], 'addition picks kept with the operation');
    same([s.selections.multiply.tables, s.selections.multiply.multiplyBy, s.selections.multiply.from, s.selections.multiply.to], [[6, 7, 8], 'range', 2, 9], 'multiplication picks kept');
    same(Quiz.sanitizeSettings({}).operation, 'multiply', 'multiplication by default');
    same(Quiz.sanitizeSettings({ operation: 'divide' }).operation, 'multiply', 'an unknown operation falls back to multiplication');
    same(Quiz.sanitizeSettings({ tables: [4] }).selections.add.tables, Quiz.DEFAULT_SETTINGS.tables, 'addition starts with the default numbers');
  });

  // ---------- weak-spots rounds ----------

  test('a wrong answer picked before comes back as a choice, if it is a believable slip', () => {
    const random = seeded(8);
    for (let i = 0; i < 50; i++) {
      check(Quiz.makeChoices(7, 8, random, [54]).includes(54), '54 should be offered for 7 × 8');
      const choices = Quiz.makeChoices(7, 8, random, [99]);
      check(!choices.includes(99), '99 is not a near miss for 7 × 8, so it is never offered');
      check(new Set(choices).size === 4 && choices.includes(56), `choices ${choices} need 56 and three different wrong answers`);
    }
    check(Quiz.isSlip(7, 8, 63) && Quiz.isSlip(7, 8, 65) && !Quiz.isSlip(7, 8, 56) && !Quiz.isSlip(7, 8, 60), 'isSlip');
  });

  test('a weak-spots round leans on the tricky facts and stays inside the chosen tables', () => {
    const settings = { tables: [3, 4, 5, 6, 7, 8, 9, 10], multiplyBy: 'same', count: 10 };
    const tricky = new Set(['7x8', '6x7']);
    const needOf = (a, b) => (tricky.has(Quiz.factKey(a, b)) ? { weight: 10, maxUses: 2 } : { weight: 1, maxUses: 1 });
    const random = seeded(9);
    let asked = 0;
    let trickyAsked = 0;
    for (let r = 0; r < 200; r++) {
      const questions = Quiz.createFocusRound(settings, needOf, random);
      same(questions.length, 10, 'question count');
      questions.forEach((q, i) => {
        check(q.a > 2 && q.b > 2 && q.a < 11 && q.b < 11, `${q.a} × ${q.b} is outside the tables`);
        check(q.choices.includes(q.a * q.b), 'right answer offered');
        const key = Quiz.factKey(q.a, q.b);
        for (let back = 1; back <= 3 && i - back >= 0; back++) {
          const earlier = questions[i - back];
          check(Quiz.factKey(earlier.a, earlier.b) !== key, `${key} came back within 3 questions`);
        }
        asked += 1;
        if (tricky.has(key)) trickyAsked += 1;
      });
    }
    // 2 of 36 facts, so about 0.6 questions a round if every fact were equally likely.
    check(trickyAsked / 200 > 2.5, `tricky facts came up ${trickyAsked / 200} times a round`);
  });

  test('a weak-spots round with one fact still fills the round', () => {
    const questions = Quiz.createFocusRound({ tables: [7], multiplyBy: 'same', count: 10 }, () => ({ weight: 10, maxUses: 2 }), seeded(10));
    same(questions.map((q) => q.a * q.b), Array(10).fill(49), 'all ten questions are 7 × 7');
  });

  // ---------- insights ----------

  const START = new Date(2026, 9, 1, 16, 0).getTime(); // 1 October, 4 pm, local time
  const DAY = 86400000;
  const on = (day, minutes = 0) => new Date(START + day * DAY + minutes * 60000).toISOString();
  const hit = (a, b, ms = 2000) => ({ a, b, answer: a * b, choices: [], picked: a * b, right: true, ms });
  const miss = (a, b, picked, ms = 2000) => ({ a, b, answer: a * b, choices: [], picked, right: false, ms });
  const roundOf = (startedAt, answers, settings) => ({
    id: `r-${startedAt}`, playerId: 'p-1', startedAt, finished: true, answers,
    settings: { tables: [3, 4, 5, 6, 7, 8, 9, 10], multiplyBy: 'same', timeLimit: 0, count: answers.length, ...settings },
  });
  const tries = (...list) => list.map(([right, ms]) => ({ right, ms, picked: right ? 1 : 2 }));

  test('a fact is known by heart after 3 quick right answers in a row', () => {
    const level = (...list) => Insights.levelOf(tries(...list));
    same(level(), 'new', 'no tries');
    same(level([true, 2000], [true, 2500], [true, 1500]), 'mastered', 'three quick right answers');
    same(level([true, 6000], [true, 7000], [true, 5000]), 'learning', 'right but slow');
    same(level([true, 2000], [true, 2000]), 'learning', 'only two tries so far');
    same(level([false, 2000], [true, 2000]), 'learning', 'right after a miss');
    same(level([false, 2000], [false, 2000], [true, 2000]), 'practice', 'one right out of three');
    same(level([true, 2000], [true, 2000], [true, 2000], [false, 2000]), 'practice', 'the latest try was wrong');
    same(level([false, 2000], [true, 2000], [true, 2000], [true, 2000]), 'mastered', 'three in a row after a miss');
  });

  test('history: both orders count as one fact, and bad records are skipped', () => {
    const rounds = [
      roundOf(on(0), [hit(6, 8), miss(8, 6, 42), hit(6, 8, 3000)]),
      { startedAt: 'yesterday', answers: [hit(2, 2)] },
      roundOf(on(1), [{ a: 99, b: 2, picked: 198, ms: 1 }, { a: 3, b: 4, picked: 'twelve' }, null]),
    ];
    const analysis = Insights.analyze(rounds, START + 2 * DAY);
    same([...analysis.facts.keys()], ['6x8', '3x4'], 'facts found');
    const fact = analysis.facts.get('6x8');
    same([fact.seen, fact.right, fact.level], [3, 2, 'learning'], '6 × 8 seen, right, level');
    same(fact.slip, { value: 42, count: 1 }, 'the wrong pick');
    same(analysis.facts.get('3x4').timeouts, 1, 'a missing pick counts as time running out');
    same([analysis.totals.rounds, analysis.totals.questions, analysis.daysSinceLast], [2, 4, 1], 'rounds, questions, days since');
  });

  test('history: lately is the last 3 rounds, and progress is measured against before them', () => {
    const rounds = [
      roundOf(on(0), [miss(7, 8, 63), miss(6, 7, 48), hit(3, 4)]),
      roundOf(on(1), [miss(7, 8, 63), hit(6, 7, 6000), hit(3, 4)]),
      roundOf(on(2), [hit(7, 8), hit(6, 7), hit(3, 4)]),
      roundOf(on(3), [hit(7, 8), hit(6, 7), hit(3, 4)]),
      roundOf(on(4), [hit(7, 8), hit(6, 7), hit(3, 4)]),
    ];
    const analysis = Insights.analyze(rounds, START + 4 * DAY);
    same([analysis.lately.questions, analysis.lately.right], [9, 9], 'lately');
    same([analysis.earlier.questions, analysis.earlier.right], [6, 3], 'earlier');
    same(analysis.masteredBefore, 0, 'nothing known by heart before the last 3 rounds');
    same(analysis.levels, { mastered: 3, learning: 0, practice: 0 }, 'levels now');
    same(analysis.trend.unit, 'day', 'five days of play, so the trend is by day');
    same(analysis.trend.points.map((p) => p.right), [1, 2, 3, 3, 3], 'right answers each day');
    const twoRounds = Insights.analyze(rounds.slice(0, 2));
    same([twoRounds.trend.unit, twoRounds.earlier, twoRounds.masteredBefore], ['round', null, null], 'too little history to compare');
  });

  test('wrong answers are explained', () => {
    same(Insights.slipText(7, 8, 63), '63, which is 7 × 9', 'one 7 too many');
    same(Insights.slipText(7, 8, 48), '48, which is 6 × 8', 'one 8 too few');
    same(Insights.slipText(7, 8, 54), '54, which is 6 × 9', 'a fact close by in the chart');
    same(Insights.slipText(7, 8, 65), '65, the digits swapped', 'swapped digits');
    same(Insights.slipText(7, 8, 66), '66, ten too many', 'ten off');
    same(Insights.slipText(7, 8, 57), '57, 1 too many', 'one off');
  });

  test('advice names the tricky facts, the mix-up, and what to try next', () => {
    const rounds = [
      roundOf(on(0), [miss(7, 8, 54), hit(3, 3), hit(4, 4), hit(5, 5)]),
      roundOf(on(1), [miss(7, 8, 54), hit(3, 3), hit(4, 4), hit(5, 5)]),
      roundOf(on(2), [miss(6, 7, 48), hit(3, 3), hit(4, 4), hit(5, 5)]),
    ];
    const analysis = Insights.analyze(rounds, START + 2 * DAY);
    same(Insights.trickiest(analysis).map((f) => f.key), ['7x8', '6x7'], 'trickiest facts, worst first');
    const tips = Insights.advice(analysis, 'Maya');
    check(tips[0].startsWith('Practice 7 × 8 and 6 × 7.'), `first tip: ${tips[0]}`);
    check(tips.includes('Maya has picked 54 for 7 × 8 twice. That\'s the answer to 6 × 9, an easy one to mix up with 7 × 8 = 56.'), `mix-up tip missing: ${tips}`);
    const away = Insights.advice(Insights.analyze(rounds, START + 12 * DAY), 'Maya');
    check(away[0].startsWith("It's been 10 days since the last round."), `break tip: ${away[0]}`);
  });

  test('advice: time running out, and being ready for more', () => {
    const timed = [0, 1, 2].map((day) => roundOf(on(day), [3, 4, 5, 6, 7].flatMap((n) => [hit(n, n), miss(n, n + 1, null, 10000)]), { timeLimit: 10 }));
    const tips = Insights.advice(Insights.analyze(timed, START + 2 * DAY), 'Leo');
    check(tips.some((t) => t === 'Time ran out on 15 of the last 30 timed questions. Try 15 seconds a question for a while.'), `timeout tip missing: ${tips}`);

    const facts = [];
    for (let a = 3; a <= 6; a++) for (let b = a; b <= 6; b++) facts.push([a, b]);
    const known = [0, 1, 2].map((day) => roundOf(on(day), facts.map(([a, b]) => hit(a, b, 1500))));
    const ready = Insights.advice(Insights.analyze(known, START + 2 * DAY), 'Leo');
    check(ready.some((t) => t === 'Leo knows most of the facts practiced so far by heart. Ready for something new: add the 7s and 8s.'), `ready tip missing: ${ready}`);
    check(ready.some((t) => t.startsWith('Quick and accurate lately (100% right).')), `timer tip missing: ${ready}`);
  });

  test('addition history is looked at apart from multiplication', () => {
    const plus = (a, b, picked, ms = 2000) => ({ a, b, answer: a + b, choices: [], picked, right: picked === a + b, ms });
    const rounds = [
      roundOf(on(0), [hit(3, 4), hit(3, 4), miss(6, 7, 48)]),
      roundOf(on(1), [plus(7, 8, 16), plus(7, 8, 16), plus(3, 4, 7)], { operation: 'add' }),
      roundOf(on(2), [plus(8, 7, 15), plus(6, 9, 14)], { operation: 'add' }),
    ];
    const times = Insights.analyze(rounds, START + 2 * DAY);
    const adds = Insights.analyze(rounds, START + 2 * DAY, 'add');
    same([...times.facts.keys()], ['3x4', '6x7'], 'multiplication facts');
    same([...adds.facts.keys()], ['7+8', '3+4', '6+9'], 'addition facts');
    same([times.totals.rounds, adds.totals.rounds], [1, 2], 'rounds for each');
    same(adds.facts.get('7+8').slip, { value: 16, count: 2 }, 'the wrong sum picked');
    same(Insights.overall(rounds), { rounds: 3, questions: 8, right: 4, operations: ['multiply', 'add'] }, 'totals across both');
    same(Insights.slipText(7, 8, 16, 'add'), '16, 1 too many', 'adding slip');
    same(Insights.slipText(7, 8, 5, 'add'), '5, ten too few', 'adding slip by ten');
    const tips = Insights.advice(adds, 'Leo');
    check(tips[0] === 'Practice 6 + 9 and 7 + 8. Choose “Weak spots” on the setup screen and they\'ll come up more often.', `first tip: ${tips[0]}`);
    check(tips.includes('Leo has picked 16 for 7 + 8 twice. Doubles can help: 7 + 7 = 14, so 7 + 8 is one more: 15.'), `near-doubles tip missing: ${tips}`);
    same(Insights.needFinder(adds)(9, 6).weight, 20, '6 + 9 needs practice in a weak-spots round');
    same(Insights.needFinder(adds)(6, 9).slips, [14], 'the 14 picked for 6 + 9 comes back as a choice');
  });

  test('a weak-spots round can be built from a history', () => {
    const rounds = [0, 1].map((day) => roundOf(on(day), [miss(7, 8, 54), hit(3, 3)]));
    const needOf = Insights.needFinder(Insights.analyze(rounds));
    same(needOf(8, 7), { weight: 20, maxUses: 2, slips: [54] }, '7 × 8 needs practice');
    same(needOf(3, 3).weight, 2, '3 × 3 has been right every time, twice');
    same(needOf(9, 9).weight, 2, 'a fact not tried yet');
    const slow = Insights.needFinder(Insights.analyze([roundOf(on(0), [hit(4, 6, 7000)])]));
    same(slow(6, 4).weight, 6, 'right but slow comes up more than right and quick');
    const counts = Insights.focusCounts(Insights.analyze(rounds), [[7, 8], [3, 3], [9, 9]]);
    same(counts, { mastered: 0, learning: 1, practice: 1, new: 1 }, 'levels of the facts in play');
  });

  // ---------- reading ----------

  const Reading = global.Reading;

  test('reading: a word counts when the recognizer hears it, or a word that sounds the same', () => {
    same(Reading.heardIt('said', ['said']), 'said', 'the word itself');
    same(Reading.heardIt('said', ['sad', 'um said']), 'um said', 'among other words');
    same(Reading.heardIt('two', ['2']), '2', 'written as a digit');
    same(Reading.heardIt('two', ['to']), 'to', 'a word that sounds the same');
    same(Reading.heardIt('there', ["They're"]), "They're", 'capitals and apostrophes');
    same(Reading.heardIt('I', ['eye']), 'eye', 'the word I');
    same(Reading.heardIt('in', ['into']), null, 'a longer word is a different word');
    same(Reading.heardIt('ship', ['sheep', 'chip']), null, 'a near miss is a miss');
    same(Reading.heardIt('said', []), null, 'nothing heard');
  });

  test('reading: the sound pattern is marked inside its word', () => {
    const show = (parts) => parts.map((p) => (p.mark ? `[${p.text}]` : p.text)).join('');
    same(show(Reading.mark('ship', 'sh')), '[sh]ip', 'sh');
    same(show(Reading.mark('duck', 'ck')), 'du[ck]', 'ck');
    same(show(Reading.mark('cone', 'silent e')), 'c[o]n[e]', 'silent e marks the vowel and the e');
    same(show(Reading.mark('said', null)), 'said', 'a sight word has no mark');
  });

  test('reading: the speech check has 20 different words, 72 sight words in all', () => {
    const items = Reading.speechCheckItems();
    same(items.length, 20, 'items');
    same(new Set(items.map((i) => i.word)).size, 20, 'all different');
    same(items.filter((i) => i.sound).length, 8, 'phonics words');
    same(Reading.SIGHT_WORDS.length, 72, 'sight words');
    for (const group of Reading.PHONICS) {
      for (const word of group.words) check(Reading.mark(word, group.sound).some((p) => p.mark), `${word} should show ${group.sound}`);
    }
  });

  const failed = results.filter((r) => !r.ok).length;
  global.quizTestResults = { passed: results.length - failed, failed, results };

  if (typeof document !== 'undefined') {
    const summary = document.getElementById('summary');
    summary.textContent = failed ? `${failed} of ${results.length} tests failed` : `All ${results.length} tests passed`;
    summary.className = failed ? 'fail' : 'pass';
    const list = document.getElementById('results');
    for (const r of results) {
      const item = document.createElement('li');
      item.className = r.ok ? 'pass' : 'fail';
      item.textContent = r.ok ? `Pass: ${r.name}` : `Fail: ${r.name}. ${r.message}`;
      list.append(item);
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
