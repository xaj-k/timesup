/*
 * Times Up: players and their history.
 *
 * Each player is a first name. Every round they play is saved with the
 * settings it used and every question asked: the two numbers, the four
 * choices, what was picked (null when time ran out), whether it was right,
 * and how many milliseconds the answer took.
 *
 * Opened as a file, history is kept in this browser's localStorage.
 * Published on claude.ai, it goes in the artifact's shared database
 * instead, so it is the same on every device and Claude can read it back.
 *
 * Both stores have the same four async methods:
 *   loadPlayers()        -> [{ id, name, created }]
 *   addPlayer(player)
 *   saveRound(round)     creates or replaces one round record
 *   loadRounds(playerId) -> rounds, oldest first
 */
(function (global) {
  'use strict';

  const MAX_NAME = 24;

  function newId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function cleanName(raw) {
    return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  }

  function byName(a, b) {
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  }

  function byStart(a, b) {
    return String(a.startedAt).localeCompare(String(b.startedAt));
  }

  function isPlayer(p) {
    return p && typeof p.id === 'string' && typeof p.name === 'string' && p.name !== '';
  }

  /**
   * Serializes saves of one record: never two writes in flight at once, and
   * the newest state always gets written last. save(value) resolves once
   * everything queued so far is stored, or rejects with the write's error.
   */
  function makeSaver(write) {
    let pending = null;
    let running = null;
    async function drain() {
      while (pending) {
        const next = pending;
        pending = null;
        await write(next);
      }
    }
    return function save(value) {
      pending = value;
      if (!running) running = drain().finally(() => { running = null; });
      return running;
    };
  }

  // ---------- this browser ----------

  function browserStore() {
    const PLAYERS = 'timesup.players';
    const ROUND = 'timesup.round.'; // + playerId + "." + roundId

    function read(key) {
      try {
        return JSON.parse(localStorage.getItem(key));
      } catch (error) {
        return null;
      }
    }

    async function loadPlayers() {
      const list = read(PLAYERS);
      return Array.isArray(list) ? list.filter(isPlayer) : [];
    }

    return {
      kind: 'browser',
      loadPlayers,
      async addPlayer(player) {
        const list = await loadPlayers();
        list.push(player);
        localStorage.setItem(PLAYERS, JSON.stringify(list));
      },
      async saveRound(round) {
        localStorage.setItem(`${ROUND}${round.playerId}.${round.id}`, JSON.stringify(round));
      },
      async loadRounds(playerId) {
        const prefix = `${ROUND}${playerId}.`;
        const rounds = [];
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
              const round = read(key);
              if (round) rounds.push(round);
            }
          }
        } catch (error) {
          return [];
        }
        return rounds.sort(byStart);
      },
    };
  }

  // ---------- the artifact's shared database on claude.ai ----------
  // players/<playerId>                   { name, created }
  // players/<playerId>/rounds/<roundId>  one round, answers included

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { code: 'unavailable' })), ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); }
      );
    });
  }

  // The store asks for one retry after a short random pause when it's briefly unavailable.
  async function retryOnce(call) {
    try {
      return await call();
    } catch (error) {
      if (!error || error.code !== 'unavailable') throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 600));
      return call();
    }
  }

  function databaseStore(db) {
    return {
      kind: 'database',
      async loadPlayers() {
        const snap = await retryOnce(() => withTimeout(db.collection('players').get(), 10000));
        return snap.docs.filter((d) => d.exists).map((d) => ({ id: d.id, ...d.data() })).filter(isPlayer);
      },
      async addPlayer(player) {
        await retryOnce(() => db.collection('players').doc(player.id).set({ name: player.name, created: player.created }));
      },
      async saveRound(round) {
        await retryOnce(() => db.collection(`players/${round.playerId}/rounds`).doc(round.id).set(round));
      },
      async loadRounds(playerId) {
        const snap = await retryOnce(() => withTimeout(db.collection(`players/${playerId}/rounds`).get(), 10000));
        return snap.docs.filter((d) => d.exists).map((d) => d.data()).sort(byStart);
      },
    };
  }

  /** Use the artifact database when the page runs on claude.ai and this viewer may write to it. */
  async function openStore() {
    const claude = global.claude;
    if (claude && typeof claude.use === 'function') {
      try {
        const db = await claude.use('db');
        if (db) {
          const user = await claude.use('user');
          const canWrite = user ? await user.can('data.write') : null;
          if (canWrite !== false) return databaseStore(db);
        }
      } catch (error) {
        // Fall back to this browser's storage.
      }
    }
    return browserStore();
  }

  global.Players = { openStore, browserStore, databaseStore, makeSaver, newId, cleanName, byName };
})(typeof globalThis !== 'undefined' ? globalThis : this);
