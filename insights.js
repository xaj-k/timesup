/*
 * Times Up: what a player's history says. Which facts they know by heart,
 * which ones trip them up (and how), how they're doing over time, and what
 * to practice next. Multiplication and addition are looked at separately.
 * There's no page code in here, so the tests run it too.
 *
 * Each fact gets a level from its latest tries, in either order (6 × 8 and
 * 8 × 6 are one fact, and so are 6 + 8 and 8 + 6):
 *   mastered   Got it          the last 3 tries were right, typically within 4 seconds
 *   learning   Getting there   right lately, but not 3 in a row yet, or slower than that
 *   practice   Needs practice  the last try was wrong, or fewer than half of the last 4 were right
 *   new        Not tried yet
 */
(function (global) {
  'use strict';

  const Quiz = global.Quiz;
  const FLUENT_MS = 4000; // a right answer this quick counts as known by heart
  const RECENT = 4; // the tries that decide how well a fact is known
  const LATELY = 3; // the rounds that count as "lately"; the ones before are "earlier"
  const TREND_POINTS = 14;
  const LEVELS = ['mastered', 'learning', 'practice', 'new'];

  // How often a fact comes up in a weak-spots round, next to one that's known by heart.
  const FOCUS = {
    practice: { weight: 20, maxUses: 2 },
    shaky: { weight: 6, maxUses: 1 }, // getting there, but slow or missed lately
    learning: { weight: 2, maxUses: 1 }, // right every time so far, just not 3 in a row yet
    new: { weight: 2, maxUses: 1 },
    mastered: { weight: 1, maxUses: 1 },
  };

  function median(values) {
    const list = values.filter(Number.isFinite).sort((x, y) => x - y);
    if (!list.length) return null;
    const mid = Math.floor(list.length / 2);
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  }

  function startOfDay(time) {
    const d = new Date(time);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function dayKey(time) {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const listFormat = typeof Intl !== 'undefined' && Intl.ListFormat
    ? new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })
    : null;

  /** "a", "a and b", "a, b, and c" */
  function listOf(items) {
    if (listFormat) return listFormat.format(items);
    if (items.length < 3) return items.join(' and ');
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
  }

  // ---------- cleaning up saved rounds ----------
  // History can come from a shared database, so none of it is trusted.

  function whole(v) {
    return Number.isInteger(v) && v >= Quiz.RANGE_MIN && v <= Quiz.RANGE_MAX;
  }

  function cleanAnswer(raw, operation) {
    if (!raw || typeof raw !== 'object' || !whole(raw.a) || !whole(raw.b)) return null;
    const answer = Quiz.answerFor(raw.a, raw.b, operation);
    const picked = Number.isInteger(raw.picked) ? raw.picked : null; // null: time ran out
    const ms = Number.isFinite(raw.ms) && raw.ms >= 0 ? raw.ms : null;
    return { a: raw.a, b: raw.b, answer, picked, right: picked === answer, ms };
  }

  function cleanRounds(raw) {
    const rounds = [];
    for (const r of Array.isArray(raw) ? raw : []) {
      if (!r || typeof r !== 'object') continue;
      const at = Date.parse(r.startedAt);
      const s = r.settings && typeof r.settings === 'object' ? r.settings : {};
      if (s.operation === 'read') continue; // reading rounds have their own report (reading.js)
      // Rounds saved before addition existed are multiplication.
      const operation = s.operation === 'add' ? 'add' : 'multiply';
      const answers = (Array.isArray(r.answers) ? r.answers : []).map((x) => cleanAnswer(x, operation)).filter(Boolean);
      if (!Number.isFinite(at) || !answers.length) continue;
      rounds.push({
        id: typeof r.id === 'string' ? r.id : '',
        at,
        operation,
        answers,
        finished: r.finished === true,
        settings: {
          operation,
          tables: Array.isArray(s.tables) ? s.tables.filter(whole) : [],
          multiplyBy: s.multiplyBy === 'range' ? 'range' : 'same',
          from: whole(s.from) ? s.from : null,
          to: whole(s.to) ? s.to : null,
          timeLimit: Number.isInteger(s.timeLimit) && s.timeLimit > 0 ? s.timeLimit : 0,
          count: Number.isInteger(s.count) && s.count > 0 ? s.count : answers.length,
          focus: s.focus === 'weak' ? 'weak' : 'all',
        },
      });
    }
    return rounds.sort((x, y) => x.at - y.at);
  }

  // ---------- one fact ----------

  function levelOf(tries) {
    if (!tries.length) return 'new';
    const recent = tries.slice(-RECENT);
    const right = recent.filter((t) => t.right).length;
    if (!tries[tries.length - 1].right || right * 2 < recent.length) return 'practice';
    const last3 = tries.slice(-3);
    const times = last3.map((t) => t.ms);
    const quick = times.every(Number.isFinite) && median(times) <= FLUENT_MS;
    return last3.length === 3 && last3.every((t) => t.right) && quick ? 'mastered' : 'learning';
  }

  // The wrong answer picked most often; the latest one wins a tie.
  function commonSlip(fact) {
    const counts = new Map();
    fact.tries.forEach((t, i) => {
      if (t.right || !Quiz.isSlip(fact.a, fact.b, t.picked, fact.operation)) return;
      const seen = counts.get(t.picked) || { value: t.picked, count: 0, last: -1 };
      seen.count += 1;
      seen.last = i;
      counts.set(t.picked, seen);
    });
    let best = null;
    for (const s of counts.values()) {
      if (!best || s.count > best.count || (s.count === best.count && s.last > best.last)) best = s;
    }
    return best && { value: best.value, count: best.count };
  }

  function describeFact(fact) {
    const tries = fact.tries;
    const recent = tries.slice(-RECENT);
    fact.seen = tries.length;
    fact.right = tries.filter((t) => t.right).length;
    fact.recentCount = recent.length;
    fact.recentRight = recent.filter((t) => t.right).length;
    fact.typicalMs = median(recent.filter((t) => t.right).map((t) => t.ms));
    fact.timeouts = tries.filter((t) => t.picked === null).length;
    fact.lastAt = tries[tries.length - 1].at;
    fact.level = levelOf(tries);
    fact.slip = commonSlip(fact);
    return fact;
  }

  // ---------- a whole history ----------

  function summarizeAnswers(answers) {
    const right = answers.filter((x) => x.right).length;
    return {
      questions: answers.length,
      right,
      accuracy: answers.length ? right / answers.length : null,
      typicalMs: median(answers.filter((x) => x.picked !== null).map((x) => x.ms)),
      timeouts: answers.filter((x) => x.picked === null).length,
    };
  }

  // A table's facts are the ones with that number on either side; its accuracy
  // comes from each fact's latest tries.
  function tableStats(facts) {
    const tables = [];
    for (let table = 1; table <= Quiz.RANGE_MAX; table++) {
      const row = { table, tried: 0, mastered: 0, practice: 0, recentCount: 0, recentRight: 0, accuracy: null };
      for (const f of facts.values()) {
        if (f.a !== table && f.b !== table) continue;
        row.tried += 1;
        row.recentCount += f.recentCount;
        row.recentRight += f.recentRight;
        if (f.level === 'mastered') row.mastered += 1;
        if (f.level === 'practice') row.practice += 1;
      }
      if (row.recentCount) row.accuracy = row.recentRight / row.recentCount;
      tables.push(row);
    }
    return tables;
  }

  // One point per day once there are 3 or more days of play; one per round before that.
  function trendOf(rounds) {
    const days = new Map();
    for (const r of rounds) {
      const key = dayKey(r.at);
      if (!days.has(key)) days.set(key, { at: r.at, answers: [] });
      days.get(key).answers.push(...r.answers);
    }
    const byDay = days.size >= 3;
    const groups = byDay ? [...days.values()] : rounds.map((r, i) => ({ at: r.at, answers: r.answers, number: i + 1 }));
    return {
      unit: byDay ? 'day' : 'round',
      points: groups.slice(-TREND_POINTS).map((g) => ({ at: g.at, number: g.number || null, ...summarizeAnswers(g.answers) })),
    };
  }

  function countLevels(facts) {
    const counts = { mastered: 0, learning: 0, practice: 0 };
    for (const f of facts) counts[f.level] += 1;
    return counts;
  }

  /** Totals across all of a player's rounds, both operations, and which operations they've played. */
  function overall(rawRounds) {
    const rounds = cleanRounds(rawRounds);
    const answers = rounds.flatMap((r) => r.answers);
    return {
      rounds: rounds.length,
      questions: answers.length,
      right: answers.filter((x) => x.right).length,
      operations: Quiz.OPERATION_OPTIONS.filter((op) => rounds.some((r) => r.operation === op)),
    };
  }

  /**
   * Everything the progress report and weak-spots rounds need, from a
   * player's saved rounds (any order; bad records are skipped), for one
   * operation: 'multiply' or 'add'.
   */
  function analyze(rawRounds, now = Date.now(), operation = 'multiply') {
    const rounds = cleanRounds(rawRounds).filter((r) => r.operation === operation);
    const facts = new Map();
    rounds.forEach((round, index) => {
      for (const x of round.answers) {
        const key = Quiz.factKey(x.a, x.b, operation);
        if (!facts.has(key)) facts.set(key, { key, operation, a: Math.min(x.a, x.b), b: Math.max(x.a, x.b), answer: x.answer, tries: [] });
        facts.get(key).tries.push({ right: x.right, ms: x.ms, picked: x.picked, at: round.at, round: index });
      }
    });
    for (const fact of facts.values()) describeFact(fact);

    const split = Math.max(0, rounds.length - LATELY);
    const earlier = rounds.slice(0, split);
    let masteredBefore = null;
    if (earlier.length) {
      masteredBefore = 0;
      for (const fact of facts.values()) {
        if (levelOf(fact.tries.filter((t) => t.round < split)) === 'mastered') masteredBefore += 1;
      }
    }
    const last = rounds.length ? rounds[rounds.length - 1].at : null;
    return {
      operation,
      rounds,
      facts,
      levels: countLevels(facts.values()),
      tables: tableStats(facts),
      totals: {
        ...summarizeAnswers(rounds.flatMap((r) => r.answers)),
        rounds: rounds.length,
        days: new Set(rounds.map((r) => dayKey(r.at))).size,
        firstAt: rounds.length ? rounds[0].at : null,
        lastAt: last,
      },
      lately: summarizeAnswers(rounds.slice(split).flatMap((r) => r.answers)),
      earlier: earlier.length ? summarizeAnswers(earlier.flatMap((r) => r.answers)) : null,
      masteredBefore,
      trend: trendOf(rounds),
      daysSinceLast: last === null ? null : Math.round((startOfDay(now) - startOfDay(last)) / 86400000),
    };
  }

  /** The facts that most need work: "needs practice" first, then shaky "getting there" ones. */
  function trickiest(analysis, limit = 6) {
    const rank = { practice: 0, learning: 1 };
    const share = (f) => f.recentRight / f.recentCount;
    const slow = (f) => (f.typicalMs === null ? Infinity : f.typicalMs);
    return [...analysis.facts.values()]
      .filter((f) => f.level === 'practice' || isShaky(f))
      .sort((x, y) =>
        rank[x.level] - rank[y.level] ||
        share(x) - share(y) ||
        (y.seen - y.right) - (x.seen - x.right) ||
        (slow(y) === slow(x) ? 0 : slow(y) > slow(x) ? 1 : -1) ||
        y.lastAt - x.lastAt)
      .slice(0, limit);
  }

  // Getting there, but slow or missed lately (not just waiting for a third right answer).
  function isShaky(fact) {
    const slow = fact.typicalMs === null || fact.typicalMs > FLUENT_MS;
    return fact.level === 'learning' && (slow || fact.recentRight < fact.recentCount);
  }

  function focusKind(fact) {
    if (!fact) return 'new';
    return isShaky(fact) ? 'shaky' : fact.level;
  }

  /** How strongly a weak-spots round leans on each fact; see Quiz.createFocusRound. */
  function needFinder(analysis) {
    return function needOf(a, b) {
      const fact = analysis ? analysis.facts.get(Quiz.factKey(a, b, analysis.operation)) : null;
      return { ...FOCUS[focusKind(fact)], slips: fact && fact.slip ? [fact.slip.value] : [] };
    };
  }

  /** How many of these [a, b] facts are at each level. */
  function focusCounts(analysis, facts) {
    const counts = { mastered: 0, learning: 0, practice: 0, new: 0 };
    for (const [a, b] of facts) {
      const fact = analysis ? analysis.facts.get(Quiz.factKey(a, b, analysis.operation)) : null;
      counts[fact ? fact.level : 'new'] += 1;
    }
    return counts;
  }

  // ---------- wrong answers, in words ----------

  /** What kind of slip a wrong answer to a × b (or a + b) is. */
  function slipKind(a, b, picked, operation = 'multiply') {
    const answer = Quiz.answerFor(a, b, operation);
    const gap = picked - answer;
    if (operation === 'add') {
      if (Math.abs(gap) === 10) return { kind: 'ten', more: gap > 0 };
      return { kind: 'close', by: Math.abs(gap), more: gap > 0 };
    }
    const step = Math.sign(gap);
    if (a > 0 && Math.abs(gap) === a) return { kind: 'neighbour', a, b: b + step, by: a };
    if (b > 0 && Math.abs(gap) === b) return { kind: 'neighbour', a: a + step, b, by: b };
    // Another fact's answer from close by in the chart, like 54 (6 × 9) for 7 × 8.
    let near = null;
    for (let x = 1; x <= Quiz.RANGE_MAX; x++) {
      for (let y = x; y <= Quiz.RANGE_MAX; y++) {
        if (x * y !== picked) continue;
        const distance = Math.min(Math.abs(x - a) + Math.abs(y - b), Math.abs(y - a) + Math.abs(x - b));
        if (distance <= 2 && (!near || distance < near.distance)) near = { kind: 'other', a: x, b: y, distance };
      }
    }
    if (near) return near;
    if (answer > 10 && answer < 100 && picked === (answer % 10) * 10 + Math.floor(answer / 10)) return { kind: 'swap' };
    if (Math.abs(gap) === 10) return { kind: 'ten', more: gap > 0 };
    return { kind: 'close', by: Math.abs(gap), more: gap > 0 };
  }

  /** A short note on a wrong answer, like "63, which is 7 × 9" or "16, 1 too many". */
  function slipText(a, b, picked, operation = 'multiply') {
    const slip = slipKind(a, b, picked, operation);
    if (slip.kind === 'neighbour' || slip.kind === 'other') return `${picked}, which is ${slip.a} × ${slip.b}`;
    if (slip.kind === 'swap') return `${picked}, the digits swapped`;
    if (slip.kind === 'ten') return `${picked}, ten ${slip.more ? 'too many' : 'too few'}`;
    return `${picked}, ${slip.by} ${slip.more ? 'too many' : 'too few'}`;
  }

  const TIMES = ['no times', 'once', 'twice', 'three times', 'four times', 'five times',
    'six times', 'seven times', 'eight times', 'nine times', 'ten times'];

  /** "once", "twice", "seven times", "12 times" */
  function times(n) {
    return TIMES[n] || `${n} times`;
  }

  function slipTip(fact, name) {
    const { a, b, answer, operation } = fact;
    const picked = fact.slip.value;
    const start = `${name} has picked ${picked} for ${a} ${Quiz.operationOf(operation).symbol} ${b} ${times(fact.slip.count)}.`;
    if (operation === 'add') {
      // Two ways in that kids learn: near doubles, and making a ten.
      if (b - a === 1) return `${start} Doubles can help: ${a} + ${a} = ${a + a}, so ${a} + ${b} is one more: ${answer}.`;
      if (b === 9 && a >= 2) return `${start} Make a ten: ${a} + 9 is the same as ${a - 1} + 10, which is ${answer}.`;
      return `${start} The answer is ${answer}, ${Math.abs(picked - answer)} ${picked > answer ? 'less' : 'more'}.`;
    }
    const slip = slipKind(a, b, picked);
    if (slip.kind === 'neighbour') {
      return `${start} ${picked} is ${slip.a} × ${slip.b}, and ${a} × ${b} is one ${slip.by} ${picked > answer ? 'less' : 'more'}: ${answer}.`;
    }
    if (slip.kind === 'other') return `${start} That's the answer to ${slip.a} × ${slip.b}, an easy one to mix up with ${a} × ${b} = ${answer}.`;
    if (slip.kind === 'swap') return `${start} That's ${answer} with its digits swapped around.`;
    return `${start} The answer is ${answer}, ${Math.abs(picked - answer)} ${picked > answer ? 'less' : 'more'}.`;
  }

  // ---------- what to practice next ----------

  function seconds(ms) {
    return (ms / 1000).toFixed(1).replace(/\.0$/, '');
  }

  function mostCommon(values) {
    const counts = new Map();
    for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    let best = null;
    for (const [v, n] of counts) if (best === null || n > counts.get(best)) best = v;
    return best;
  }

  /** Tables where nearly every fact tried is known by heart. */
  function strongTables(analysis) {
    return analysis.tables.filter((t) => t.tried >= 5 && t.mastered >= 0.9 * t.tried).map((t) => t.table);
  }

  // "a 7", "an 8", "an 11"
  function aNumber(n) {
    return `${n === 8 || n === 11 || n === 18 ? 'an' : 'a'} ${n}`;
  }

  /** Up to four suggestions, most useful first. */
  function advice(analysis, name) {
    const tips = [];
    const { facts, lately, levels } = analysis;
    const adding = analysis.operation === 'add';
    const symbol = Quiz.operationOf(analysis.operation).symbol;
    if (!analysis.totals.questions) return tips;

    if (analysis.daysSinceLast >= 7) {
      tips.push(`It's been ${analysis.daysSinceLast} days since the last round. A few short rounds a week help facts stick.`);
    }

    const practice = trickiest(analysis, 3).filter((f) => f.level === 'practice');
    if (practice.length) {
      tips.push(`Practice ${listOf(practice.map((f) => `${f.a} ${symbol} ${f.b}`))}. ` +
        `Choose “Weak spots” on the setup screen and ${practice.length > 1 ? 'they' : 'it'}'ll come up more often.`);
    }

    const mixup = [...facts.values()]
      .filter((f) => f.level !== 'mastered' && f.slip && f.slip.count >= 2)
      .sort((x, y) => y.slip.count - x.slip.count || y.lastAt - x.lastAt)[0];
    if (mixup) tips.push(slipTip(mixup, name));

    const weakTables = analysis.tables
      .filter((t) => t.recentCount >= 8 && t.accuracy < 0.7)
      .sort((x, y) => x.accuracy - y.accuracy)
      .slice(0, 2);
    if (weakTables.length) {
      const many = weakTables.length > 1;
      const shares = `(${listOf(weakTables.map((t) => `${Math.round(t.accuracy * 100)}%`))} right)`;
      if (adding) {
        tips.push(`Facts with ${weakTables.map((t) => aNumber(t.table)).join(' or ')} are the trickiest lately ${shares}. ` +
          'A few rounds of just those can help.');
      } else {
        tips.push(`The ${listOf(weakTables.map((t) => `${t.table}s`))} are the trickiest ${many ? 'tables' : 'table'} lately ${shares}. ` +
          `A few rounds of just ${many ? 'those' : 'that one'} can help.`);
      }
    }

    const recent = analysis.rounds.slice(-LATELY);
    const timed = recent.filter((r) => r.settings.timeLimit > 0);
    const timedAnswers = timed.flatMap((r) => r.answers);
    const timeouts = timedAnswers.filter((x) => x.picked === null).length;
    if (timedAnswers.length >= 10 && timeouts >= 3 && timeouts / timedAnswers.length >= 0.2) {
      const limit = mostCommon(timed.map((r) => r.settings.timeLimit));
      const more = Quiz.SECONDS_OPTIONS.find((s) => s > limit);
      tips.push(`Time ran out on ${timeouts} of the last ${timedAnswers.length} timed questions. ` +
        (more ? `Try ${more} seconds a question for a while.` : 'Relaxed mode takes the pressure off while the facts settle in.'));
    } else if (lately.questions >= 10 && lately.accuracy >= 0.9) {
      if (lately.typicalMs > FLUENT_MS) {
        const limit = Quiz.SECONDS_OPTIONS.find((s) => s * 1000 >= 2 * lately.typicalMs) || Quiz.SECONDS_OPTIONS[Quiz.SECONDS_OPTIONS.length - 1];
        tips.push(`Answers are right but take a while: about ${seconds(lately.typicalMs)} seconds each. ` +
          `Beat the clock with ${limit} seconds a question can build speed.`);
      } else if (!timed.length) {
        tips.push(`Quick and accurate lately (${Math.round(lately.accuracy * 100)}% right). Ready to try Beat the clock?`);
      } else {
        const limit = Math.min(...timed.map((r) => r.settings.timeLimit));
        const less = [...Quiz.SECONDS_OPTIONS].reverse().find((s) => s < limit);
        if (less) tips.push(`${Math.round(lately.accuracy * 100)}% right with ${limit} seconds a question. Ready to try ${less}?`);
      }
    }

    const tried = levels.mastered + levels.learning + levels.practice;
    if (tried >= 10 && levels.mastered >= 0.8 * tried) {
      const highest = Math.max(...analysis.tables.filter((t) => t.tried > 0).map((t) => t.table));
      const next = analysis.tables.filter((t) => t.table > highest).slice(0, 2).map((t) => t.table);
      if (next.length) {
        tips.push(`${name} knows most of the facts practiced so far by heart. Ready for something new: ` +
          (adding ? `add ${listOf(next.map(String))} to the numbers.` : `add the ${listOf(next.map((t) => `${t}s`))}.`));
      }
    }

    const strong = strongTables(analysis);
    if (strong.length) {
      tips.push(adding
        ? `Strong on facts with ${listOf(strong.map(String))}: nearly every one known by heart.`
        : `Strong on the ${listOf(strong.map((t) => `${t}s`))}: nearly every fact known by heart.`);
    }

    if (!tips.length) tips.push('Keep it up! A few short rounds a week keep the facts fresh.');
    return tips.slice(0, 4);
  }

  const Insights = {
    FLUENT_MS,
    RECENT,
    LATELY,
    LEVELS,
    overall,
    analyze,
    levelOf,
    trickiest,
    isShaky,
    times,
    needFinder,
    focusCounts,
    slipKind,
    slipText,
    strongTables,
    advice,
    listOf,
    dayKey,
    median,
  };

  if (typeof module === 'object' && module.exports) module.exports = Insights;
  global.Insights = Insights;
})(typeof globalThis !== 'undefined' ? globalThis : this);
