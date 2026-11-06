/*
 * Times Up: words for reading practice, and how to tell whether what speech
 * recognition heard matches the word on the screen. There's no page code in
 * here, so the tests run it too.
 *
 * The sight words are the 72 in the class's phonics homework packet, in the
 * order it teaches them. The phonics words practice each sound pattern the
 * packet teaches, mostly using the packet's own example words.
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

  const Reading = { SIGHT_WORDS, PHONICS, SOUNDS_LIKE, wordsIn, heardIt, mark, speechCheckItems };

  if (typeof module === 'object' && module.exports) module.exports = Reading;
  global.Reading = Reading;
})(typeof globalThis !== 'undefined' ? globalThis : this);
