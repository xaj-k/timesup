/*
 * Tests for quiz.js, insights.js, lessons.js and reading.js. Open test/index.html in a browser to run them.
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
    same(Quiz.sanitizeSettings({ operation: 'power' }).operation, 'multiply', 'an unknown operation falls back to multiplication');
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

  // ---------- subtraction and division ----------

  const DIFFERENT = ['subtract', 'divide']; // the two operations where order matters
  const sign = (operation) => Quiz.OPERATIONS[operation].symbol;
  // A question as shown, from a fact [t, m]: "13−6" for taking 6 away with answer 7.
  const shown = (operation, t, m) => {
    const { a, b } = Quiz.questionFor(t, m, operation);
    return `${a}${sign(operation)}${b}`;
  };
  // A saved answer to the question a fact [t, m] makes; the right answer is m.
  const answered = (operation, t, m, picked, ms = 2000) => {
    const { a, b } = Quiz.questionFor(t, m, operation);
    return { a, b, answer: m, choices: [], picked, right: picked === m, ms };
  };

  test('subtraction and division: four different whole-number choices, one right, for every fact', () => {
    same(sign('subtract'), '−', 'subtraction uses the real minus sign');
    for (const operation of DIFFERENT) {
      for (let seed = 1; seed <= 30; seed++) {
        const random = seeded(100 + seed);
        for (let t = 1; t <= 12; t++) {
          for (let m = 0; m <= 12; m++) {
            const { a, b } = Quiz.questionFor(t, m, operation);
            const answer = Quiz.answerFor(a, b, operation);
            const choices = Quiz.makeChoices(a, b, random, [], operation);
            const label = `${a} ${sign(operation)} ${b} gave ${choices}`;
            same(answer, m, `the answer to ${a} ${sign(operation)} ${b}`);
            check(choices.length === 4 && new Set(choices).size === 4, `${label}: needs 4 different choices`);
            check(choices.filter((c) => c === answer).length === 1, `${label}: right answer must appear once`);
            check(choices.every((c) => Number.isInteger(c) && c >= 0), `${label}: choices must be whole numbers, 0 or more`);
          }
        }
      }
    }
  });

  test('subtraction slips are 1, 2, 3 or 10 off; division slips are 1, 2 or 3 off, or the number you divide by', () => {
    const random = seeded(31);
    for (let k = 0; k < 10; k++) {
      for (let t = 1; t <= 12; t++) {
        for (let m = 0; m <= 12; m++) {
          const s = Quiz.questionFor(t, m, 'subtract');
          for (const c of Quiz.makeChoices(s.a, s.b, random, [], 'subtract')) {
            if (c !== m) check([1, 2, 3, 10].includes(Math.abs(c - m)), `${s.a} − ${s.b}: ${c} is not a taking-away slip`);
          }
          const d = Quiz.questionFor(t, m, 'divide');
          for (const c of Quiz.makeChoices(d.a, d.b, random, [], 'divide')) {
            if (c !== m) check([1, 2, 3].includes(Math.abs(c - m)) || c === d.b, `${d.a} ÷ ${d.b}: ${c} is not a dividing slip`);
          }
        }
      }
    }
    let divisor = 0;
    for (let i = 0; i < 200; i++) if (Quiz.makeChoices(27, 9, random, [], 'divide').includes(9)) divisor += 1;
    check(divisor > 100, `9, the number you divide by, came up for 27 ÷ 9 in ${divisor} of 200 questions`);
    const seen = [0, 0, 0, 0];
    for (let i = 0; i < 400; i++) seen[Quiz.makeChoices(42, 6, random, [], 'divide').indexOf(7)] += 1;
    check(seen.every((n) => n > 60), `right answer positions for 42 ÷ 6 were ${seen}`);
    check(Quiz.isSlip(27, 9, 9, 'divide') && Quiz.isSlip(42, 6, 4, 'divide') && !Quiz.isSlip(42, 6, 17, 'divide') && !Quiz.isSlip(42, 6, 7, 'divide'), 'isSlip for dividing');
    check(Quiz.isSlip(13, 6, 17, 'subtract') && Quiz.isSlip(13, 6, 4, 'subtract') && !Quiz.isSlip(13, 6, 13, 'subtract') && !Quiz.isSlip(24, 12, 21, 'subtract'), 'isSlip for taking away (no swapped digits)');
    check(Quiz.makeChoices(13, 6, random, [10], 'subtract').includes(10) && !Quiz.makeChoices(13, 6, random, [12], 'subtract').includes(12), 'a slip picked before comes back, and only a slip');
  });

  test('division always divides evenly, and taking away never goes below zero', () => {
    for (const operation of DIFFERENT) {
      const settings = { operation, tables: Quiz.TABLES.slice(), multiplyBy: 'range', from: 0, to: 12, count: 30 };
      for (let seed = 1; seed <= 20; seed++) {
        for (const q of Quiz.createRound(settings, seeded(seed))) {
          const label = `${q.a} ${sign(operation)} ${q.b} = ${q.answer}`;
          if (operation === 'divide') check(q.b >= 1 && q.a % q.b === 0, `${label} doesn't divide evenly`);
          else check(q.a >= q.b, `${label} goes below zero`);
          check(Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 12, `${label}: the answer must be a whole number from 0 to 12`);
          same(q.answer, Quiz.answerFor(q.a, q.b, operation), `the answer to ${label}`);
          check(q.choices.includes(q.answer), `${label}: right answer missing from the choices`);
        }
      }
    }
  });

  test('subtraction and division facts: the numbers picked, with the same numbers or a range of answers', () => {
    const facts = (operation, settings) => Quiz.factsFor({ operation, ...settings }).map(([t, m]) => shown(operation, t, m));
    same(facts('subtract', { tables: [6, 7], multiplyBy: 'same' }), ['12−6', '13−6', '13−7', '14−7'], 'take away 6 and 7, answers 6 and 7');
    same(facts('divide', { tables: [6, 7], multiplyBy: 'same' }), ['36÷6', '42÷6', '42÷7', '49÷7'], 'divide by 6 and 7, answers 6 and 7');
    same(facts('subtract', { tables: [7], multiplyBy: 'range', from: 1, to: 10 }), ['8−7', '9−7', '10−7', '11−7', '12−7', '13−7', '14−7', '15−7', '16−7', '17−7'], 'take away 7, answers 1 to 10');
    same(facts('divide', { tables: [7], multiplyBy: 'range', from: 0, to: 3 }), ['0÷7', '7÷7', '14÷7', '21÷7'], 'divide by 7, answers 0 to 3');
    same(Quiz.factsFor({ operation: 'divide', tables: Quiz.TABLES.slice(), multiplyBy: 'range', from: 0, to: 12 }).length, 156, 'every pair is its own fact: 12 × 13');
    same(Quiz.factsFor({ operation: 'subtract', tables: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], multiplyBy: 'same' }).length, 100, 'take away 1 to 10, answers 1 to 10');
    same(Quiz.factsFor({ tables: [6, 7], multiplyBy: 'same' }).length, 3, 'multiplying still counts 6 × 7 and 7 × 6 once');
  });

  test('subtraction and division keys keep the order shown', () => {
    same([Quiz.factKey(48, 6, 'divide'), Quiz.factKey(48, 8, 'divide')], ['48÷6', '48÷8'], '48 ÷ 6 and 48 ÷ 8 are two facts');
    same([Quiz.factKey(14, 6, 'subtract'), Quiz.factKey(14, 8, 'subtract')], ['14−6', '14−8'], '14 − 6 and 14 − 8 are two facts');
    check(Quiz.factKey(6, 8) === Quiz.factKey(8, 6) && Quiz.factKey(6, 8, 'add') === Quiz.factKey(8, 6, 'add'), 'multiplying and adding still go either way');
    same([Quiz.questionFor(6, 8, 'subtract'), Quiz.questionFor(6, 8, 'divide'), Quiz.questionFor(6, 8, 'add')], [{ a: 14, b: 6 }, { a: 48, b: 6 }, { a: 6, b: 8 }], 'the question each fact makes');
    for (const operation of DIFFERENT) {
      const questions = Quiz.createRound({ operation, tables: [6], multiplyBy: 'range', from: 8, to: 8, count: 10 }, seeded(41));
      check(questions.every((q) => q.b === 6 && q.answer === 8), `${operation}: always starts from the number you take from or divide`);
    }
  });

  test('subtraction and division weak-spots rounds stay inside the chosen facts', () => {
    for (const operation of DIFFERENT) {
      const settings = { operation, tables: [6, 7, 8], multiplyBy: 'range', from: 2, to: 9, count: 20 };
      const keyOf = (t, m) => {
        const { a, b } = Quiz.questionFor(t, m, operation);
        return Quiz.factKey(a, b, operation);
      };
      const allowed = new Set(Quiz.factsFor(settings).map(([t, m]) => keyOf(t, m)));
      const tricky = keyOf(7, 8); // 15 − 7 or 56 ÷ 7
      const slip = operation === 'divide' ? 7 : 9;
      const needOf = (t, m) => (keyOf(t, m) === tricky ? { weight: 20, maxUses: 2, slips: [slip] } : { weight: 1, maxUses: 1 });
      const random = seeded(51);
      let trickyAsked = 0;
      for (let r = 0; r < 100; r++) {
        const questions = Quiz.createFocusRound(settings, needOf, random);
        same(questions.length, 20, 'question count');
        for (const q of questions) {
          const key = Quiz.factKey(q.a, q.b, operation);
          check(allowed.has(key), `${key} is outside the chosen facts`);
          check(q.answer >= 2 && q.answer <= 9 && q.choices.includes(q.answer), `${key}: answer ${q.answer} and choices ${q.choices}`);
          if (key === tricky) {
            trickyAsked += 1;
            check(q.choices.includes(slip), `${key}: ${slip}, picked before, should come back as a choice`);
          }
        }
      }
      check(trickyAsked / 100 > 1.5, `${tricky} came up ${trickyAsked / 100} times a round`);
    }
  });

  test('settings keep separate picks for all four operations', () => {
    const s = Quiz.sanitizeSettings({
      operation: 'divide', tables: [6, 7], multiplyBy: 'range', from: 0, to: 12,
      selections: { multiply: { tables: [2, 3] }, add: { tables: [4] }, subtract: { tables: [9, 10], multiplyBy: 'range', from: 1, to: 5 } },
    });
    same(s.operation, 'divide', 'division is kept');
    same(Object.keys(s.selections), ['multiply', 'add', 'subtract', 'divide'], 'picks for every operation');
    same(s.selections.divide, { tables: [6, 7], multiplyBy: 'range', from: 0, to: 12 }, 'division picks are the current ones');
    same(s.selections.subtract, { tables: [9, 10], multiplyBy: 'range', from: 1, to: 5 }, 'subtraction picks kept');
    same([s.selections.multiply.tables, s.selections.add.tables], [[2, 3], [4]], 'multiplication and addition picks kept');
    same(Quiz.sanitizeSettings({ operation: 'subtract' }).selections.divide.tables, Quiz.DEFAULT_SETTINGS.tables, 'division starts with the default numbers');
  });

  test('subtraction and division history: facts keep their order, and bad saved answers are skipped', () => {
    const minus = (t, m, picked) => answered('subtract', t, m, picked);
    const share = (t, m, picked) => answered('divide', t, m, picked);
    const rounds = [
      roundOf(on(0), [minus(6, 7, 7), minus(7, 6, 5), minus(6, 8, 9), minus(7, 6, 5), minus(7, 2, 2)], { operation: 'subtract', tables: [6, 7] }),
      roundOf(on(1), [share(6, 8, 8), share(8, 6, 7), share(8, 6, 7), share(9, 3, 9), share(4, 2, 2)], { operation: 'divide', tables: [4, 6, 8, 9] }),
      // Answers the quiz couldn't have asked, and one saved with the wrong answer.
      roundOf(on(2), [
        { a: 5, b: 7, picked: 0 }, { a: 30, b: 6, picked: 24 }, { a: 13, b: 0, picked: 13 }, { a: 13.5, b: 6, picked: 7 }, { a: '13', b: 6, picked: 7 },
        { a: 14, b: 6, answer: 9, picked: 9, right: true, ms: 1500 },
      ], { operation: 'subtract' }),
      roundOf(on(2, 5), [
        { a: 50, b: 6, picked: 8 }, { a: 48, b: 0, picked: 0 }, { a: 156, b: 12, picked: 13 }, { a: -12, b: 6, picked: -2 }, { a: 6, b: 13, picked: 0 },
        share(7, 0, 0),
      ], { operation: 'divide' }),
    ];
    const subs = Insights.analyze(rounds, START + 2 * DAY, 'subtract');
    const divs = Insights.analyze(rounds, START + 2 * DAY, 'divide');
    same([...subs.facts.keys()], ['13−6', '13−7', '14−6', '9−7'], 'subtraction facts, as shown');
    same([...divs.facts.keys()], ['48÷6', '48÷8', '27÷9', '8÷4', '0÷7'], 'division facts, as shown');
    const f = subs.facts.get('13−7');
    same([f.a, f.b, f.answer, f.level, f.slip], [13, 7, 6, 'practice', { value: 5, count: 2 }], '13 − 7: kept as shown, missed twice with 5');
    const g = divs.facts.get('48÷8');
    same([g.a, g.b, g.answer, g.level, g.slip], [48, 8, 6, 'practice', { value: 7, count: 2 }], '48 ÷ 8: kept as shown, missed twice with 7');
    same(divs.facts.get('27÷9').slip, { value: 9, count: 1 }, 'the number divided by, picked for 27 ÷ 9');
    same(subs.facts.get('14−6').tries.map((t) => t.right), [false, false], 'the answer is worked out again, not taken from the record');
    same([subs.totals.rounds, subs.totals.questions, divs.totals.rounds, divs.totals.questions], [2, 6, 2, 6], 'rounds and questions');
    // A table is the number taken away or divided by, not the number you start from.
    const table = (analysis, n) => analysis.tables.find((t) => t.table === n).tried;
    same([table(subs, 6), table(subs, 7), table(subs, 9)], [2, 2, 0], 'take away 6, take away 7, and no take away 9');
    same([table(divs, 4), table(divs, 8), table(divs, 6)], [1, 1, 1], 'divide by 4, by 8 (not 8 ÷ 4), and by 6');
    same(Insights.overall(rounds), { rounds: 4, questions: 12, right: 5, operations: ['subtract', 'divide'] }, 'totals across both');
    // Weak spots look facts up from the setup screen's pairs.
    same(Insights.needFinder(subs)(7, 6), { weight: 20, maxUses: 2, slips: [5] }, '13 − 7 needs practice, and 5 comes back');
    same(Insights.needFinder(divs)(8, 6), { weight: 20, maxUses: 2, slips: [7] }, '48 ÷ 8 needs practice, and 7 comes back');
    same(Insights.needFinder(divs)(6, 8).weight, 2, '48 ÷ 6 was right, so it is a different fact from 48 ÷ 8');
    same(Insights.focusCounts(subs, [[6, 7], [7, 6], [6, 8], [9, 9]]), { mastered: 0, learning: 1, practice: 2, new: 1 }, 'levels of the facts in play');
    same(Insights.analyze(rounds, START + 2 * DAY).totals.rounds, 0, 'multiplication has none of these rounds');
  });

  test('subtraction and division: wrong answers explained', () => {
    same(Insights.slipText(13, 6, 8, 'subtract'), '8, 1 too many', 'one too many');
    same(Insights.slipText(13, 6, 4, 'subtract'), '4, 3 too few', 'three too few');
    same(Insights.slipText(13, 6, 17, 'subtract'), '17, ten too many', 'ten off');
    same(Insights.slipText(27, 9, 9, 'divide'), '9, the number you divide by', 'the number you divide by');
    same(Insights.slipText(42, 6, 6, 'divide'), '6, the number you divide by', 'the number you divide by, next to the answer');
    same(Insights.slipText(42, 6, 9, 'divide'), '9, 2 too many', 'a fact nearby in the same table');
  });

  test('subtraction and division advice, in each one’s own words', () => {
    const facts = (t) => [1, 2, 3, 4].map((m) => [t, m]);
    // Taking away 7 (or dividing by 7): each fact right once in three rounds, missed with one too many.
    const tricky = (operation) => [0, 1, 2].map((day) => roundOf(on(day),
      facts(7).map(([t, m]) => answered(operation, t, m, (m + day) % 3 === 0 ? m : m + 1)), { operation, tables: [7] }));
    // Taking away 3 and 4 (or dividing by them), answers 1 to 5: every one quick and right.
    const known = (operation) => [0, 1, 2].map((day) => roundOf(on(day),
      [3, 4].flatMap((t) => [1, 2, 3, 4, 5].map((m) => answered(operation, t, m, m, 1500))), { operation, tables: [3, 4] }));

    let tips = Insights.advice(Insights.analyze(tricky('subtract'), START + 2 * DAY, 'subtract'), 'Leo');
    check(tips[0].startsWith('Practice 8 − 7, '), `first tip: ${tips[0]}`);
    check(tips.includes('Leo has picked 2 for 8 − 7 twice. Think addition: 8 − 7 asks what to add to 7 to make 8, and 7 + 1 = 8.'), `think-addition tip missing: ${tips}`);
    check(tips.includes('Taking away 7 is the trickiest lately (33% right). A few rounds of taking away just 7 can help.'), `trickiest tip missing: ${tips}`);
    tips = Insights.advice(Insights.analyze(known('subtract'), START + 2 * DAY, 'subtract'), 'Leo');
    check(tips.includes('Leo knows most of the facts practiced so far by heart. Ready for something new: try taking away 5 and 6 too.'), `ready tip missing: ${tips}`);
    check(tips.includes('Strong on taking away 3 and 4: nearly every fact known by heart.'), `strong tip missing: ${tips}`);

    tips = Insights.advice(Insights.analyze(tricky('divide'), START + 2 * DAY, 'divide'), 'Leo');
    check(tips[0].startsWith('Practice 7 ÷ 7, '), `first tip: ${tips[0]}`);
    check(tips.includes('Leo has picked 2 for 7 ÷ 7 twice. Think multiplication: 7 ÷ 7 asks what to multiply 7 by to make 7, and 7 × 1 = 7.'), `think-multiplication tip missing: ${tips}`);
    check(tips.includes('Dividing by 7 is the trickiest lately (33% right). A few rounds of dividing by just 7 can help.'), `trickiest tip missing: ${tips}`);
    tips = Insights.advice(Insights.analyze(known('divide'), START + 2 * DAY, 'divide'), 'Leo');
    check(tips.includes('Leo knows most of the facts practiced so far by heart. Ready for something new: try dividing by 5 and 6 too.'), `ready tip missing: ${tips}`);
    check(tips.includes('Strong on dividing by 3 and 4: nearly every fact known by heart.'), `strong tip missing: ${tips}`);

    // Picking the number you divide by, again and again.
    const divisor = [0, 1].map((day) => roundOf(on(day), [answered('divide', 9, 3, 9)], { operation: 'divide', tables: [9] }));
    tips = Insights.advice(Insights.analyze(divisor, START + 1 * DAY, 'divide'), 'Leo');
    check(tips.includes("Leo has picked 9 for 27 ÷ 9 twice. That's the number you divide by. Think multiplication: 27 ÷ 9 asks what to multiply 9 by to make 27, and 9 × 3 = 27."), `divisor tip missing: ${tips}`);
    const take = [0, 1].map((day) => roundOf(on(day), [answered('subtract', 6, 7, 8)], { operation: 'subtract', tables: [6] }));
    tips = Insights.advice(Insights.analyze(take, START + 1 * DAY, 'subtract'), 'Leo');
    check(tips.includes('Leo has picked 8 for 13 − 6 twice. Think addition: 13 − 6 asks what to add to 6 to make 13, and 6 + 7 = 13.'), `13 − 6 tip missing: ${tips}`);
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
    same(Reading.heardIt('a', ['hey']), 'hey', 'a said as "ay"');
    same(Reading.heardIt('I', ['I bye', 'Bye']), 'I bye', 'a word said twice, heard as two');
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

  test('reading: the packet has pages 4 to 143, with sounds, sight words and sentences', () => {
    const pages = global.Lessons.PAGES;
    same(pages.length, 140, 'pages');
    same([pages[0][0], pages[139][0]], [4, 143], 'first and last page');
    same(pages.reduce((n, p) => n + p[3].length, 0), 680, 'sentences');
    const twenty = Reading.lesson(20);
    same(twenty.newSound, 't', 'page 20 teaches t');
    same(twenty.newWords, ['yellow', 'green', 'I', 'see'], 'sight words new on page 20');
    same(twenty.sounds, ['T', 'l', 'h', 'L', 't', 'o', 'G'], 'each printed sound once, in order');
    same(twenty.decodable.map((d) => d.word), ['log', 'hat', 'pop', 'hog'], 'words to sound out come from the sentences');
    same(Reading.lesson(126).newSound, 'silent e', 'silent e has no mark in the Sounds line, but is taught on page 126');
    same(Reading.lesson(3), null, 'no lesson before page 4');
  });

  test('reading: words to sound out skip sight words and names, and mark the newest sound in them', () => {
    const l = Reading.lesson(115);
    const words = l.decodable.map((d) => d.word);
    check(!words.includes('trish') && !words.includes('shon'), `names are left out: ${words}`);
    check(!words.includes('the') && !words.includes('went'), 'sight words are left out');
    same(l.decodable.find((d) => d.word === 'ship').sound, 'sh', 'ship shows sh on the sh page');
    same(l.decodable.find((d) => d.word === 'lick').sound, 'ck', 'lick shows ck, taught before');
    same(l.decodable.find((d) => d.word === 'dog').sound, null, 'dog has nothing to mark');
    same(Reading.lesson(126).decodable.find((d) => d.word === 'pine').sound, 'silent e', 'pine shows its silent e');
    check(l.names.has('tim') && !l.names.has('mom') && !l.names.has('pop'), 'a name is never written in lowercase (Mom and pop are)');
  });

  test('reading: one word counts when said nearly on its own', () => {
    same(Reading.checkWord('ship', [{ transcript: 'ship' }]).ok, true, 'the word');
    same(Reading.checkWord('ship', [{ transcript: 'sh ship' }]).ok, true, 'sounded out first');
    same(Reading.checkWord('two', [{ transcript: '2' }]).ok, true, 'sounds the same');
    same(Reading.checkWord('ship', [{ transcript: 'sip' }]), { ok: false, match: null, long: false }, 'a different word is a miss');
    same(Reading.checkWord('ship', [{ transcript: 'say the whole word ship' }]), { ok: false, match: null, long: true }, 'talk with the word in it does not count either way');
    same(Reading.checkWord('ship', [{ transcript: 'ship', unknown: 3 }]).long, true, 'other words Vosk could not name count toward the length');
    same(Reading.checkWord('ship', []).long, false, 'nothing heard');
  });

  test('reading: a sentence counts when each word is heard in order', () => {
    const show = (r) => r.matched.map((m, i) => (m ? r.words[i] : '_')).join(' ');
    same(show(Reading.checkSentence('I see one green log.', 'I see 1 green log')), 'i see one green log', 'digits and capitals are fine');
    same(Reading.checkSentence('I see one green log.', 'I see one green').ok, false, 'a missing word');
    same(show(Reading.checkSentence('I see one green log.', 'I see one')), 'i see one _ _', 'partly read, for lighting up words as they are read');
    same(Reading.checkSentence('See the hog.', 'see hog').ok, false, 'a short sentence needs every word');
    const names = Reading.lesson(115).names;
    same(Reading.checkSentence('Trish and Shon wish they can wash the dish.', 'trish and sean wish they can wash a dish', names).ok, true, 'names and one "the" may be missed');
    same(Reading.checkSentence('The ship will crash into the trash.', 'the ship will crash into trash can', names).ok, true, 'extra words are fine');
    same(Reading.checkSentence('The ship will crash into the trash.', 'the sheep will crash into the trash', names).ok, false, 'a misread word is not');
  });

  test('reading: a round always has the number asked for, going on to the next pages when a page runs out', () => {
    const all = ['sounds', 'words', 'sentences'];
    for (const [page, parts, count] of [[4, ['words'], 10], [8, ['words'], 30], [4, all, 10], [20, all, 20], [115, ['sounds'], 30], [142, ['sentences'], 30]]) {
      const round = Reading.createRound(page, { parts, count, focus: 'all' }, () => 1, seeded(page + count));
      same(round.length, count, `page ${page}, ${parts.join(' and ')}, ${count}`);
      same(new Set(round.map((i) => (i.kind === 'sound' ? i.text : i.key))).size, count, `no repeats on page ${page}`);
    }
    const four = Reading.planRound(4, ['words'], 10);
    same([four.from, four.pages.includes(8), four.parts.words.take], [4, true, 10], 'page 4 has one word, so 10 words go on to pages 8 and on');
    const end = Reading.planRound(142, ['sentences'], 30);
    check(end.from < 142 && end.to === 143, `near the end of the packet it goes back to earlier pages: ${end.from}–${end.to}`);
    same(Reading.planRound(12, all, 0).pages, [12], 'the whole page uses only that page');
    same(Reading.createRound(12, { parts: all, count: 0, focus: 'all' }).length, 13, 'page 12 has 6 sounds, 4 words and 3 sentences');
  });

  test('reading: a round goes sounds, then words, then sentences, sharing the count out', () => {
    same(Reading.shares(['sounds', 'words', 'sentences'], 10), { words: 4, sounds: 3, sentences: 3 }, '10 shared out');
    same(Reading.shares(['words', 'sentences'], 20), { words: 10, sentences: 10 }, '20 shared out');
    const round = Reading.createRound(20, { parts: ['sounds', 'words', 'sentences'], count: 20, focus: 'all' }, () => 1, seeded(3));
    const order = round.map((i) => ({ sound: 0, sight: 1, word: 1, sentence: 2 }[i.kind]));
    same(order.slice().sort((x, y) => x - y), order, 'in the packet’s order');
    const sentences = round.filter((i) => i.kind === 'sentence').map((i) => i.text);
    same(sentences, Reading.lesson(20).sentences.concat(Reading.lesson(21).sentences).slice(0, sentences.length), 'sentences in the packet’s order, page 20 first');
    const l = Reading.lesson(20);
    const words = Reading.createRound(20, { parts: ['words'], count: 10, focus: 'all' }, () => 1, seeded(4));
    for (const w of l.newWords) check(words.some((i) => i.text === w), `${w} is new on page 20, so it always comes up`);
    check(words.every((i) => i.page === 20), 'page 20 has 12 words, so 10 stay on page 20');
  });

  test('reading: weak spots lean on what was missed', () => {
    const big = Reading.lesson(115);
    const weak = Reading.keyOf('sight', 'went');
    let picked = 0;
    for (let n = 0; n < 40; n++) {
      const r = Reading.createRound(115, { parts: ['words'], count: 10, focus: 'weak' }, (key) => (key === weak ? 20 : 1), seeded(n));
      if (r.some((i) => i.key === weak)) picked += 1;
    }
    check(picked >= 30, `a weak word comes up in most weak-spots rounds (${picked} of 40)`);
    check(Reading.createRound(115, { parts: ['sounds'], count: 10, focus: 'all' }, () => 1, seeded(5)).some((i) => i.text === 'sh'), 'the newest sound always comes up');
    check(big.words.length > 10, 'page 115 has plenty of words');
  });

  test('reading: history levels, weak spots, and math history ignores reading rounds', () => {
    const round = (minutes, answers) => ({ id: `r${minutes}`, startedAt: new Date(Date.UTC(2026, 10, 1, 0, minutes)).toISOString(), settings: { operation: 'read', page: 20, part: 'words', count: 10, focus: 'all', engine: 'online' }, answers, finished: true });
    const said = (item, right, extra = {}) => ({ kind: 'sight', item, right, how: right ? 'voice' : 'skip', tries: 1, helped: false, ms: 900, ...extra });
    const rounds = [
      round(1, [said('see', true), said('green', false, { heard: 'grain' }), said('the', true)]),
      round(2, [said('see', true), said('green', true), said('the', true)]),
      round(3, [said('See', true), said('green', false, { heard: 'grin' }), said('the', true)]),
      { id: 'm', startedAt: '2026-11-01T00:04:00Z', settings: { operation: 'multiply', tables: [2], multiplyBy: 'same', timeLimit: 0, count: 1 }, answers: [{ a: 2, b: 2, picked: 4, ms: 900 }] },
    ];
    const a = Reading.analyze(rounds, Date.UTC(2026, 10, 2));
    same(a.totals.rounds, 3, 'only reading rounds');
    same(a.items.get('w:see').level, 'mastered', 'see, right 3 times');
    same(a.items.get('w:green').level, 'practice', 'green, missed last time');
    same(a.items.get('w:green').lastHeard, 'grin', 'what the recognizer heard the last time it was missed');
    same(Reading.trickiest(a).map((e) => e.item), ['green'], 'trickiest');
    same(Reading.weightFinder(a)('w:green') > Reading.weightFinder(a)('w:see'), true, 'weak spots lean on green');
    same(Insights.analyze(rounds).totals.rounds, 1, 'the multiplication report skips reading rounds');
    same(Insights.overall(rounds).rounds, 1, 'and so do the math totals');
  });

  test('reading: saved settings are cleaned up', () => {
    same(Reading.sanitizeSettings({ page: 999, parts: ['spelling', 'words'], count: 7, engine: 'vosk' }), { page: 4, parts: ['words'], count: 10, focus: 'all', engine: 'vosk' }, 'bad values fall back');
    same(Reading.sanitizeSettings({ page: 47, parts: ['sentences', 'sounds'], count: 0, focus: 'weak', engine: 'off', to: 49 }), { page: 47, parts: ['sounds', 'sentences'], count: 0, focus: 'weak', engine: 'off', to: 49 }, 'good values stay, parts in the packet’s order');
    same(Reading.sanitizeSettings({ part: 'sentences' }).parts, ['sentences'], 'settings saved with one part still work');
    same(Reading.sanitizeSettings(null).parts, ['sounds', 'words', 'sentences'], 'everything, to start with');
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
