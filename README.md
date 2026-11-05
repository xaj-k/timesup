# Times Up!

A multiplication quiz for kids. A question like **6 × 8** appears on a chalkboard at the top of the screen, and the player taps the one tile out of four that has the right answer.

## Play

Open `index.html` in a web browser. There's nothing to install, and the fonts come with it, so it works offline too.

To put it on a phone or tablet like an app, see [Install on a phone or tablet](#install-on-a-phone-or-tablet).

## Settings

| Setting | Choices |
| --- | --- |
| Who's playing? | A first name, or Guest (guest rounds aren't saved) |
| Times tables | Any of 1 to 12 |
| Multiplied by | **The same numbers**: both numbers come from the tables you picked, so turning off 1 and 2 means no 1s or 2s at all. **A range**: each table is multiplied by every number in a range from 0 to 12, for whole tables like 7 × 1 to 7 × 10. |
| Focus | **Everything**: every fact comes up equally often. **Weak spots**: facts the player has been missing come up more often (see below). Needs a named player with some history. |
| Mode | **Relaxed** (no timer) or **Beat the clock** (5, 10, 15, 20 or 30 seconds per question) |
| Questions per round | 10, 20 or 30 |

The chart on the setup screen shades every fact that can come up. Each question shows its two numbers in either order (6 × 8 or 8 × 6). With Focus on Everything, no fact repeats until all of them have been asked. The browser remembers your settings for next time.

After a wrong answer or when time runs out, the right tile turns green and the answer is shown before the next question. At the end of a round you get up to three stars, your best streak, your average answer time, and a list of the facts to practice.

## How the wrong answers are picked

The three wrong tiles are mistakes kids really make: a neighboring fact (6 × 7 or 6 × 9 instead of 6 × 8), one or two off, ten off, or swapped digits (65 instead of 56). So the right answer can't be spotted just by looking for the odd one out.

## Progress report

Pick a player and tap **See progress** (on the setup screen or after a round). The report shows:

- **Known by heart**: how many facts are known, and how that's changed over the last 3 rounds.
- **Right lately** and **Answer time lately**: the last 3 rounds, compared with the rounds before them.
- **What to practice next**: up to four suggestions. For example, which facts to practice, a mix-up that keeps happening ("Maya has picked 54 for 7 × 8 seven times. That's the answer to 6 × 9…"), the trickiest table, whether to try the timer or a shorter time limit, or when to add a new table.
- **Trickiest facts**: what each one's latest tries were like, and the wrong answer picked most.
- **Times-table map**: every fact, colored by how well it's known. Tap a fact for details, or show the map as a list.
- **Over time**: the share of right answers and the typical answer time for each day played (each round, until there are 3 days). Use the arrow keys to step through, or show it as a table.
- **Recent rounds**.

Each fact gets a level from its latest tries, in either order (6 × 8 and 8 × 6 count as one fact):

| Level | When |
| --- | --- |
| Got it | The last 3 tries were right, typically within 4 seconds |
| Getting there | Right lately, but not 3 in a row yet, or slower than that |
| Needs practice | The last try was wrong, or fewer than half of the last 4 were right |
| Not tried yet | No tries |

The report can be printed from a browser, including to a PDF.

## Weak spots

With Focus on **Weak spots**, a round still uses only the tables and numbers you picked. It just doesn't ask them all equally often:

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
  "settings": { "tables": [3, 4, 5, 6, 7, 8, 9, 10], "multiplyBy": "same", "timeLimit": 0, "count": 10, "focus": "all" },
  "answers": [
    { "a": 8, "b": 9, "answer": 72, "choices": [71, 62, 64, 72], "picked": 71, "right": false, "ms": 3473 }
  ],
  "finished": true
}
```

- `a` and `b` are in the order they were shown.
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

1. **Put the folder on a web server that uses HTTPS.** Browsers only install apps, and only keep offline copies, from HTTPS addresses (or `localhost` on the same computer). Any static host works, for example:
   - **GitHub Pages**: push this folder to a GitHub repository, then in its Settings choose Pages and deploy from the main branch. The app is then at `https://<your-name>.github.io/<repository>/`.
   - **Netlify Drop**: drag the folder onto [app.netlify.com/drop](https://app.netlify.com/drop).
2. **Open that address on the phone or tablet, then install:**
   - **Android (Chrome):** tap **Install app** on the setup screen, or choose **Install app** from the browser menu.
   - **iPhone or iPad (Safari):** tap the Share button, then **Add to Home Screen**. The app's **Install app** button shows these steps too.
3. **Open it once while online.** After that it works without a connection.

On a phone held sideways, the board and the answer tiles sit side by side. During a round the screen stays on, where the browser allows it.

To try it on your computer first, run `python3 -m http.server` in this folder and open <http://localhost:8000>. A phone can open the same server at your computer's address on your Wi-Fi network, but over plain HTTP it can't install the app or work offline.

**After changing any file**, change `VERSION` at the top of `sw.js`. Installed copies check for a new version each time they're opened, download the new files in the background, and switch to them the next time the app is opened.

## Files

- `index.html`: the four screens (setup, quiz, results, progress)
- `style.css`: styles, with light and dark themes
- `quiz.js`: the quiz rules (which facts, answer choices, weak-spots rounds, scoring), with no page code
- `players.js`: players and saved history
- `insights.js`: what the history says (fact levels, trends, suggestions), with no page code
- `app.js`: screens, timer, sound effects and the progress report
- `manifest.webmanifest`, `sw.js`, `pwa.js`, `icons/`: what makes it installable and work offline
- `fonts/`: Lilita One and Andika (SIL Open Font License; see the `OFL-*.txt` files)
- `test/index.html`: open it in a browser to run the tests for `quiz.js` and `insights.js`

The lists of choices (tables, range, time limits, round lengths) and the default settings are at the top of `quiz.js`.
