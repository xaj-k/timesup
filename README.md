# Times Up!

A math facts quiz for kids, for multiplication and addition. A question like **6 × 8** or **6 + 8** appears on a chalkboard at the top of the screen, and the player taps the one tile out of four that has the right answer.

## Play

Play it at **https://xaj-k.github.io/timesup/**, or open `index.html` from this folder in a web browser. Either way there's nothing to install, and the fonts come with it, so it works offline too.

To put it on a phone or tablet like an app, see [Install on a phone or tablet](#install-on-a-phone-or-tablet).

## Settings

| Setting | Choices |
| --- | --- |
| Who's playing? | A first name, or Guest (guest rounds aren't saved) |
| Practice | **× Multiplication** or **+ Addition**. Each one remembers its own picks for the next two settings. |
| Times tables (Numbers, for addition) | Any of 1 to 12 |
| Multiplied by (Added to, for addition) | **The same numbers**: both numbers come from the ones you picked, so turning off 1 and 2 means no 1s or 2s at all. **A range**: each one you picked is multiplied by (or added to) every number in a range from 0 to 12, for whole tables like 7 × 1 to 7 × 10, or 7 + 0 to 7 + 10. |
| Focus | **Everything**: every fact comes up equally often. **Weak spots**: facts the player has been missing come up more often (see below). Needs a named player with some history. |
| Mode | **Relaxed** (no timer) or **Beat the clock** (5, 10, 15, 20 or 30 seconds per question) |
| Questions per round | 10, 20 or 30 |

The chart on the setup screen shades every fact that can come up. Each question shows its two numbers in either order (6 × 8 or 8 × 6, 6 + 8 or 8 + 6). With Focus on Everything, no fact repeats until all of them have been asked. The browser remembers your settings for next time.

After a wrong answer or when time runs out, the right tile turns green and the answer is shown before the next question. At the end of a round you get up to three stars, your best streak, your average answer time, and a list of the facts to practice.

## How the wrong answers are picked

The three wrong tiles are mistakes kids really make, so the right answer can't be spotted just by looking for the odd one out.

- **Multiplying:** a neighboring fact (6 × 7 or 6 × 9 instead of 6 × 8), one or two off, ten off, or swapped digits (65 instead of 56).
- **Adding:** counting one, two or three too far or not far enough, or ten off (5 or 25 instead of 15).

## Progress report

Pick a player and tap **See progress** (on the setup screen or after a round). Multiplication and addition are looked at separately; when a player has done both, a switch at the top picks which one to show. The report shows:

- **Known by heart**: how many facts are known, and how that's changed over the last 3 rounds.
- **Right lately** and **Answer time lately**: the last 3 rounds, compared with the rounds before them.
- **What to practice next**: up to four suggestions. For example, which facts to practice, a mix-up that keeps happening ("Maya has picked 54 for 7 × 8 seven times. That's the answer to 6 × 9…"), the trickiest table, whether to try the timer or a shorter time limit, or when to add a new table. For addition it suggests the ways in kids learn, like near doubles (7 + 7 = 14, so 7 + 8 is one more) and making a ten (6 + 9 is the same as 5 + 10).
- **Trickiest facts**: what each one's latest tries were like, and the wrong answer picked most.
- **Times-table map**: every fact, colored by how well it's known. Tap a fact for details, or show the map as a list.
- **Over time**: the share of right answers and the typical answer time for each day played (each round, until there are 3 days). Use the arrow keys to step through, or show it as a table.
- **Recent rounds**.

Each fact gets a level from its latest tries, in either order (6 × 8 and 8 × 6 count as one fact, and so do 6 + 8 and 8 + 6):

| Level | When |
| --- | --- |
| Got it | The last 3 tries were right, typically within 4 seconds |
| Getting there | Right lately, but not 3 in a row yet, or slower than that |
| Needs practice | The last try was wrong, or fewer than half of the last 4 were right |
| Not tried yet | No tries |

The report can be printed from a browser, including to a PDF.

## Weak spots

With Focus on **Weak spots**, a round still uses only the tables and numbers you picked, and only the history of the operation being practiced. It just doesn't ask the facts equally often:

- Facts that **need practice** come up the most, up to twice in a round. The setup chart marks them with a dot.
- Facts that are **getting there** but slow, or missed lately, come up a bit more than usual.
- Facts that are **known by heart** still come up now and then, for a confidence boost.
- A fact never comes back within three questions of itself.
- The wrong answer a player picked most for a fact comes back as one of its choices, so they practice telling the two apart.

The rules are in `insights.js` (`FOCUS`, and the levels above) and `quiz.js` (`createFocusRound`).

## Player history

Every answer a named player gives is saved as it happens, so a round that's stopped early keeps what was answered. The setup screen shows each player's totals so far.

Each round is saved as one record:

```json
{
  "id": "r-mw09x0kq-2b7d1c",
  "playerId": "p-mw09x084-6xdi57",
  "startedAt": "2026-11-03T05:55:01.348Z",
  "settings": { "operation": "multiply", "tables": [3, 4, 5, 6, 7, 8, 9, 10], "multiplyBy": "same", "timeLimit": 0, "count": 10, "focus": "all" },
  "answers": [
    { "a": 8, "b": 9, "answer": 72, "choices": [71, 62, 64, 72], "picked": 71, "right": false, "ms": 3473 }
  ],
  "finished": true
}
```

- `operation` is `"multiply"` or `"add"`. Rounds saved before addition existed don't have it, and count as multiplication.
- `a` and `b` are in the order they were shown, and `answer` is their product or sum.
- `picked` is `null` when time ran out.
- `ms` is how long the answer took.
- `timeLimit` is seconds per question, with `0` meaning no timer.
- `from` and `to` appear in `settings` when "A range" was used.
- `focus` is `"weak"` for a weak-spots round. Rounds saved before Focus existed don't have it.
- `finished` is `false` if the round was stopped early.

Where it's kept:

- **Opened in a browser, or installed on a phone or tablet:** in that browser's localStorage, under `timesup.players` (the list of players) and one `timesup.round.<playerId>.<roundId>` key per round. It stays on that device. An installed app keeps its own history, separate from the browser's. Clearing the site's data erases it, and removing the app can too.
- **Published on claude.ai:** in the artifact's database, at `players/<playerId>` and `players/<playerId>/rounds/<roundId>`. It's the same on every device signed in with access, and anyone the page is shared with can see it.

## Install on a phone or tablet

Times Up is a Progressive Web App: once installed, it opens from the home screen like any other app and works offline.

1. **Open https://xaj-k.github.io/timesup/ on the phone or tablet.**
2. **Install it:**
   - **Android (Chrome):** tap **Install app** on the setup screen, or choose **Install app** from the browser menu.
   - **iPhone or iPad (Safari):** tap the Share button, then **Add to Home Screen**. The app's **Install app** button shows these steps too.
3. **Open it once while online.** After that it works without a connection.

On a phone held sideways, the board and the answer tiles sit side by side. During a round the screen stays on, where the browser allows it.

### Publishing changes

The site is served by GitHub Pages from the `main` branch of this repository, so pushing to `main` updates it within a minute or two.

**After changing any file the app uses**, also change `VERSION` at the top of `sw.js`. Installed copies check for a new version each time they're opened, download the new files in the background, and switch to them the next time the app is opened. Without a new `VERSION`, they keep the old files.

To try changes on your computer first, run `python3 -m http.server` in this folder and open <http://localhost:8000>. Browsers only install apps, and only keep offline copies, from HTTPS addresses or `localhost`, so a phone opening your computer over plain HTTP on Wi-Fi can play but not install.

Any other static host with HTTPS works too, such as [Netlify Drop](https://app.netlify.com/drop).

## Speech check (a trial for reading practice)

`speech-test.html`, at https://xaj-k.github.io/timesup/speech-test.html, checks how well a device's speech recognition understands a child reading 20 words out loud: sight words, and phonics words with the sound pattern highlighted. The words come from the class's phonics homework packet (`reading.js`). Each word appears once the microphone is on, so its first sound isn't cut off. If the page hears nothing or a different word, it listens again by itself, up to three more times. A grown-up can tap Said it right when the child read a word right but the page didn't get it. At the end the page gives results to copy or send: the device's Android and browser versions, what it heard for each word, when it first heard sound, its partial results (the guesses speech recognition makes before its final answer), and how long the microphone took to turn on. If a try ends with no final answer but the latest partial result had the word, it counts. It isn't part of the app yet, and it saves nothing.

A mic check on the first screen shows a sound level bar: how loud the child sounds, and how noisy the room is. On a computer the bar also shows while the page listens for words. On Android it can't, because the level bar and speech recognition can't share the microphone there (one of them gets silence). So on Android the bar stops before the words start, and while listening the board says "Hearing sound…" whenever speech recognition picks up sound.

The first screen picks how speech is recognized:

- **Google, online**: Chrome sends the audio to Google.
- **Chrome, on this device**: offered when newer Chrome can recognize speech itself.
- **Vosk, on this device**: [Vosk](https://alphacephei.com/vosk/) runs inside the page, so no audio leaves the device. It listens only for the packet's words, plus "anything else". The first time, it downloads 41 MB (its code and a small English model, in `vendor/vosk`), and the page shows how far along that is. After that the browser keeps it. Vosk also works in browsers that can't recognize speech themselves, like Firefox. With Vosk the level bar shows while listening on Android too, because Vosk and the bar share one hold on the mic.

On Android older than 13, the page notes that reading practice is meant for Android 13 or newer.

Words that sound the same count as right: "two" heard as "to" or "2" is fine, and so is "a" heard as "hey".

## Files

- `index.html`: the four screens (setup, quiz, results, progress)
- `style.css`: styles, with light and dark themes
- `quiz.js`: the quiz rules (which facts, answer choices, weak-spots rounds, scoring), with no page code
- `players.js`: players and saved history
- `insights.js`: what the history says (fact levels, trends, suggestions), with no page code
- `reading.js`: sight words and phonics words, and matching what speech recognition heard; `speech-test.html` and `speech-test.js`: the speech check page
- `listen.js`: speech recognition (the browser's, or Vosk), the mic level bar, and which device this is
- `vendor/vosk/`: Vosk for recognizing speech on the device (see its README)
- `app.js`: screens, timer, sound effects and the progress report
- `manifest.webmanifest`, `sw.js`, `pwa.js`, `icons/`: what makes it installable and work offline
- `fonts/`: Lilita One and Andika (SIL Open Font License; see the `OFL-*.txt` files)
- `test/index.html`: open it in a browser to run the tests for `quiz.js`, `insights.js` and `reading.js`

The lists of choices (tables, range, time limits, round lengths) and the default settings are at the top of `quiz.js`.
