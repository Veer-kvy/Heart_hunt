/* HEART HUNT - core game logic (no DOM, no network).
   Pure, deterministic when given a seeded rng, and unit-testable in Node. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HHCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* =====================================================================
     CONFIG - every number that affects balance lives here.
     ===================================================================== */
  var CONFIG = {
    tickMs: 125,          /* one game tick */
    cells: 16,            /* 4x4 grid */
    popTicks: 3,          /* how long the "+1" feedback stays in a cell */

    classic: {
      points: { pink: 1, gold: 5, broken: -3 },
      goldTtl: 9,
      starRatios: [1, 1.25, 1.5],   /* score / goal needed for 1, 2, 3 stars */
      /* target = goal points, time = seconds, spawn = chance per tick,
         ttl = ticks a heart stays, gold/broken = share of spawned hearts */
      levels: [
        { target: 12, time: 30, spawn: 0.26, ttl: 16, gold: 0.08, broken: 0.10 },
        { target: 18, time: 30, spawn: 0.28, ttl: 15, gold: 0.09, broken: 0.14 },
        { target: 25, time: 30, spawn: 0.30, ttl: 14, gold: 0.09, broken: 0.18 },
        { target: 32, time: 30, spawn: 0.32, ttl: 13, gold: 0.10, broken: 0.20 },
        { target: 40, time: 35, spawn: 0.34, ttl: 12, gold: 0.10, broken: 0.22 },
        { target: 48, time: 35, spawn: 0.36, ttl: 11, gold: 0.10, broken: 0.24 },
        { target: 56, time: 35, spawn: 0.38, ttl: 10, gold: 0.10, broken: 0.26 },
        { target: 65, time: 40, spawn: 0.40, ttl: 9,  gold: 0.10, broken: 0.28 },
        { target: 75, time: 40, spawn: 0.42, ttl: 8,  gold: 0.10, broken: 0.30 },
        { target: 90, time: 40, spawn: 0.45, ttl: 7,  gold: 0.10, broken: 0.30 }
      ]
    },

    infinity: {
      strikesToEnd: 3,
      maxScore: 100000,     /* sanity cap, also enforced by the server */
      maxOnBoard: 8,        /* never let the board fill up completely */
      minTtl: 8,            /* no heart (except pop feedback) lives shorter than 1 second */
      graceTicks: 24,       /* no bombs during the first 3 seconds of a run */
      points: { pink: 1, gold: 5, broken: -3, rainbow: 10, bomb: 0, power: 0 },
      /* gold / rainbow hearts live shorter than normal ones (fraction of normal ttl) */
      ttlFactor: { pink: 1, broken: 1, power: 1, gold: 0.6, rainbow: 0.5 },

      /* Smooth difficulty curve: [score, spawn chance per tick, heart lifetime in ticks].
         Values are linearly interpolated between points, so difficulty rises gradually. */
      ramp: [[0, 0.26, 20], [50, 0.30, 17], [100, 0.34, 15], [200, 0.38, 13], [350, 0.42, 11], [600, 0.46, 9]],

      /* Difficulty tiers (named levels) and the spawn mix used inside each tier.
         weights are relative; bombGap = minimum ticks between two bomb spawns;
         maxBombs = max bombs on the board at once; bombTtl = how long a bomb stays (ticks). */
      tiers: [
        { from: 0,   name: 'EASY',    weights: { pink: 70, gold: 8,  broken: 10, rainbow: 1,   bomb: 4,  power: 5 }, bombGap: 32, maxBombs: 1, bombTtl: 24 },
        { from: 50,  name: 'NORMAL',  weights: { pink: 66, gold: 9,  broken: 12, rainbow: 1.5, bomb: 6,  power: 5 }, bombGap: 28, maxBombs: 1, bombTtl: 22 },
        { from: 100, name: 'HARD',    weights: { pink: 62, gold: 9,  broken: 14, rainbow: 2,   bomb: 8,  power: 5 }, bombGap: 24, maxBombs: 1, bombTtl: 20 },
        { from: 200, name: 'EXTREME', weights: { pink: 58, gold: 9,  broken: 15, rainbow: 2,   bomb: 10, power: 5 }, bombGap: 20, maxBombs: 2, bombTtl: 18 },
        { from: 350, name: 'INSANE',  weights: { pink: 54, gold: 9,  broken: 16, rainbow: 2.5, bomb: 12, power: 5 }, bombGap: 16, maxBombs: 2, bombTtl: 16 }
      ],

      ranks: [
        { from: 0,   name: 'HEART NOVICE' },
        { from: 50,  name: 'HEART HUNTER' },
        { from: 100, name: 'HEART MASTER' },
        { from: 200, name: 'INFINITY CHAMPION' },
        { from: 350, name: 'INFINITY LEGEND' }
      ],

      /* Combo: +1 for every pink/gold/rainbow collected. A broken heart or a bomb
         strike resets it to 0. A shield-blocked bomb does NOT reset it.
         Each milestone pays once per streak. Bonus points are never doubled. */
      combo: {
        milestones: [
          { at: 3,  msg: 'NICE!',         bonus: 0 },
          { at: 5,  msg: 'GREAT!',        bonus: 2 },
          { at: 10, msg: 'AWESOME!',      bonus: 5 },
          { at: 20, msg: 'HEART MASTER!', bonus: 10 },
          { at: 35, msg: 'UNSTOPPABLE!',  bonus: 20 }
        ]
      },

      /* Power hearts. Collecting the same power again refreshes it (never stacks). */
      powers: {
        enabled: { shield: true, double: true, magnet: true, slow: true },
        weights: { shield: 3, double: 3, magnet: 2, slow: 2 },
        doubleSec: 8,      /* DOUBLE: positive heart points x2 (not bonuses, not penalties) */
        magnetSec: 6,      /* MAGNET: auto-collects one pink/gold/rainbow heart every magnetEvery ticks */
        magnetEvery: 3,
        slowSec: 8,        /* SLOW: hearts age at half speed (they stay twice as long) */
        slowFactor: 2
      }
    }
  };

  function secToTicks(sec) { return Math.max(1, Math.round(sec * 1000 / CONFIG.tickMs)); }
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }

  /* seedable RNG - lets a server replay a run deterministically */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function newCells() { var a = []; for (var i = 0; i < CONFIG.cells; i++) a.push(null); return a; }
  function emptyIndexes(cells) { var e = []; for (var i = 0; i < cells.length; i++) if (!cells[i]) e.push(i); return e; }
  function popLabel(n) { return (n > 0 ? '+' : '') + n; }

  /* =====================================================================
     CLASSIC (level) mode
     ===================================================================== */
  function createClassic(levelIndex, opts) {
    opts = opts || {};
    var L = CONFIG.classic.levels[levelIndex];
    if (!L) throw new Error('unknown level ' + levelIndex);
    return {
      mode: 'classic', level: levelIndex, cfg: L, rng: opts.rng || Math.random,
      cells: newCells(), score: 0, time: L.time, ticks: 0, over: false, goalMet: false,
      hearts: 0, golds: 0, brokenHit: 0, events: []
    };
  }

  function classicTick(s) {
    if (s.over) return;
    var L = s.cfg, cc = CONFIG.classic;
    s.ticks++;
    for (var i = 0; i < s.cells.length; i++) {
      var c = s.cells[i]; if (!c) continue;
      c.ttl--; if (c.ttl <= 0) s.cells[i] = null;
    }
    if (s.rng() < L.spawn) {
      var empty = emptyIndexes(s.cells);
      if (empty.length) {
        var idx = empty[Math.floor(s.rng() * empty.length)], r = s.rng();
        s.cells[idx] = r < L.gold ? { kind: 'gold', ttl: Math.min(cc.goldTtl, L.ttl) }
          : r < L.gold + L.broken ? { kind: 'broken', ttl: L.ttl } : { kind: 'pink', ttl: L.ttl };
      }
    }
    if (s.ticks % Math.round(1000 / CONFIG.tickMs) === 0) s.time--;
    if (s.time <= 0) { s.time = 0; s.over = true; s.cells = newCells(); s.events.push({ type: 'over' }); }
  }

  function classicTap(s, i) {
    if (s.over || !isInt(i) || i < 0 || i >= s.cells.length) return { ok: false };
    var c = s.cells[i];
    if (!c || c.kind === 'pop') return { ok: false };
    var d = CONFIG.classic.points[c.kind];
    s.cells[i] = { kind: 'pop', ttl: CONFIG.popTicks, label: popLabel(d), good: d > 0 };
    if (c.kind === 'pink') s.hearts++; else if (c.kind === 'gold') { s.hearts++; s.golds++; } else s.brokenHit++;
    s.score = Math.max(0, s.score + d);
    if (!s.goalMet && s.score >= s.cfg.target) { s.goalMet = true; s.events.push({ type: 'goal' }); }
    s.events.push({ type: 'collect', index: i, kind: c.kind, points: d });
    return { ok: true, kind: c.kind, points: d };
  }

  function calcStars(score, target) {
    var r = CONFIG.classic.starRatios;
    return score >= target * r[2] ? 3 : score >= target * r[1] ? 2 : score >= target * r[0] ? 1 : 0;
  }

  /* =====================================================================
     INFINITY mode
     ===================================================================== */
  function tierIndexFor(score) {
    var t = CONFIG.infinity.tiers, k = 0;
    for (var i = 0; i < t.length; i++) if (score >= t[i].from) k = i;
    return k;
  }
  function rankIndexFor(score) {
    var t = CONFIG.infinity.ranks, k = 0;
    for (var i = 0; i < t.length; i++) if (score >= t[i].from) k = i;
    return k;
  }
  /* spawn chance + lifetime for a score, linearly interpolated along cfg.ramp */
  function paramsFor(score) {
    var r = CONFIG.infinity.ramp, a = r[0];
    if (score <= r[0][0]) return { spawn: r[0][1], ttl: r[0][2] };
    for (var i = 1; i < r.length; i++) {
      var b = r[i];
      if (score <= b[0]) {
        var t = (score - a[0]) / (b[0] - a[0]);
        return { spawn: a[1] + (b[1] - a[1]) * t, ttl: a[2] + (b[2] - a[2]) * t };
      }
      a = b;
    }
    return { spawn: a[1], ttl: a[2] };
  }

  function createInfinity(opts) {
    opts = opts || {};
    return {
      mode: 'infinity', rng: opts.rng || Math.random,
      tick: 0, over: false, cells: newCells(), nextId: 1,
      score: 0, strikes: 0, combo: 0, bestCombo: 0, comboAwarded: -1,
      hearts: 0, golds: 0, rainbows: 0, brokenHit: 0, bombsHit: 0, shieldBlocks: 0, powersUsed: 0,
      tierIndex: 0, maxTierIndex: 0, rankIndex: 0, maxRankIndex: 0,
      lastBombTick: -1e9,
      shield: false, doubleLeft: 0, magnetLeft: 0, slowLeft: 0,
      events: []
    };
  }

  function addScore(s, d) {
    var cfg = CONFIG.infinity;
    var n = s.score + (isFinite(d) ? d : 0);
    if (!isFinite(n)) n = s.score;
    s.score = Math.max(0, Math.min(cfg.maxScore, Math.floor(n)));
    s.tierIndex = tierIndexFor(s.score);
    s.rankIndex = rankIndexFor(s.score);
    if (s.tierIndex > s.maxTierIndex) {
      s.maxTierIndex = s.tierIndex;
      s.events.push({ type: 'difficulty', name: cfg.tiers[s.tierIndex].name });
    }
    if (s.rankIndex > s.maxRankIndex) {
      s.maxRankIndex = s.rankIndex;
      s.events.push({ type: 'rank', name: cfg.ranks[s.rankIndex].name });
    }
  }

  function resetCombo(s) { s.combo = 0; s.comboAwarded = -1; }

  function comboStep(s) {
    var ms = CONFIG.infinity.combo.milestones;
    s.combo++;
    if (s.combo > s.bestCombo) s.bestCombo = s.combo;
    for (var k = 0; k < ms.length; k++) {
      if (s.combo === ms[k].at && k > s.comboAwarded) {   /* once per streak */
        s.comboAwarded = k;
        if (ms[k].bonus) addScore(s, ms[k].bonus);        /* never doubled */
        s.events.push({ type: 'combo', msg: ms[k].msg, bonus: ms[k].bonus, at: ms[k].at });
      }
    }
  }

  function pickWeighted(rng, weights) {
    var sum = 0, k;
    for (k in weights) sum += weights[k];
    var r = rng() * sum;
    for (k in weights) { r -= weights[k]; if (r < 0) return k; }
    return 'pink';
  }

  function count(cells, kind) { var n = 0; for (var i = 0; i < cells.length; i++) if (cells[i] && cells[i].kind === kind) n++; return n; }

  function pickKind(s, tier) {
    var cfg = CONFIG.infinity, w = {}, k;
    for (k in tier.weights) w[k] = tier.weights[k];
    /* disable bombs when it would be unfair */
    var bombBlocked = s.tick < cfg.graceTicks || (s.tick - s.lastBombTick) < tier.bombGap || count(s.cells, 'bomb') >= tier.maxBombs;
    if (bombBlocked) delete w.bomb;
    /* power hearts: only if at least one power is enabled, and never two on the board */
    var pw = cfg.powers, anyPower = false;
    for (k in pw.enabled) if (pw.enabled[k]) anyPower = true;
    if (!anyPower || count(s.cells, 'power') >= 1) delete w.power;
    return pickWeighted(s.rng, w);
  }

  function spawnInfinity(s) {
    var cfg = CONFIG.infinity, p = paramsFor(s.score), tier = cfg.tiers[tierIndexFor(s.score)];
    var live = 0, i;
    for (i = 0; i < s.cells.length; i++) if (s.cells[i] && s.cells[i].kind !== 'pop') live++;
    if (live >= cfg.maxOnBoard) return;
    if (s.rng() >= p.spawn) return;
    var empty = emptyIndexes(s.cells);          /* never overwrite an existing collectible */
    if (!empty.length) return;
    var kind = pickKind(s, tier);
    var idx = empty[Math.floor(s.rng() * empty.length)];
    var ttl = kind === 'bomb' ? tier.bombTtl : Math.max(cfg.minTtl, Math.round(p.ttl * (cfg.ttlFactor[kind] || 1)));
    if (kind === 'bomb') s.lastBombTick = s.tick;
    s.cells[idx] = { kind: kind, ttl: ttl, id: s.nextId++ };
  }

  function activatePower(s) {
    var pw = CONFIG.infinity.powers, w = {}, k, any = false;
    for (k in pw.weights) {
      if (!pw.enabled[k]) continue;
      if (k === 'shield' && s.shield) continue;       /* max one shield */
      w[k] = pw.weights[k]; any = true;
    }
    if (!any) return { name: null, label: '' };
    var name = pickWeighted(s.rng, w);
    if (name === 'shield') s.shield = true;
    else if (name === 'double') s.doubleLeft = secToTicks(pw.doubleSec);   /* refresh, not add */
    else if (name === 'magnet') s.magnetLeft = secToTicks(pw.magnetSec);
    else if (name === 'slow') s.slowLeft = secToTicks(pw.slowSec);
    s.powersUsed++;
    s.events.push({ type: 'power', name: name });
    return { name: name, label: { shield: 'SHLD', double: 'x2', magnet: 'MAG', slow: 'SLOW' }[name] };
  }

  /* The ONE place where a heart is consumed and scored. Both taps and the magnet use it. */
  function consume(s, i) {
    var cfg = CONFIG.infinity, c = s.cells[i];
    if (s.over || !c || c.kind === 'pop') return null;
    var kind = c.kind, label = '', good = true, pts = 0;
    switch (kind) {
      case 'pink': case 'gold': case 'rainbow':
        pts = cfg.points[kind] * (s.doubleLeft > 0 ? 2 : 1);
        s.hearts++; if (kind === 'gold') s.golds++; if (kind === 'rainbow') s.rainbows++;
        addScore(s, pts); comboStep(s); label = popLabel(pts);
        break;
      case 'broken':
        pts = cfg.points.broken; good = false; s.brokenHit++;
        resetCombo(s); addScore(s, pts); label = popLabel(pts);
        break;
      case 'bomb':
        if (s.shield) {
          s.shield = false; s.shieldBlocks++; label = 'SAFE';
          s.events.push({ type: 'shieldBlock' });
        } else {
          s.strikes++; s.bombsHit++; good = false; label = 'BOOM'; resetCombo(s);
          s.events.push({ type: 'strike', n: s.strikes });
          if (s.strikes >= cfg.strikesToEnd) { s.over = true; s.events.push({ type: 'over' }); }
        }
        break;
      case 'power':
        label = activatePower(s).label;
        break;
    }
    s.cells[i] = { kind: 'pop', ttl: CONFIG.popTicks, label: label, good: good };
    s.events.push({ type: 'collect', index: i, kind: kind, points: pts });
    return kind;
  }

  function infinityTap(s, i) {
    if (s.over || !isInt(i) || i < 0 || i >= s.cells.length) return { ok: false };
    var kind = consume(s, i);
    return kind ? { ok: true, kind: kind } : { ok: false };
  }

  function magnetCollect(s) {
    var best = -1, bestTtl = 1e9;
    for (var i = 0; i < s.cells.length; i++) {
      var c = s.cells[i];
      if (c && (c.kind === 'pink' || c.kind === 'gold' || c.kind === 'rainbow') && c.ttl < bestTtl) { best = i; bestTtl = c.ttl; }
    }
    if (best >= 0) consume(s, best);   /* the heart closest to vanishing */
  }

  function infinityTick(s) {
    if (s.over) return;
    var cfg = CONFIG.infinity, pw = cfg.powers, i;
    s.tick++;
    var ageHearts = !(s.slowLeft > 0 && s.tick % pw.slowFactor !== 0);
    for (i = 0; i < s.cells.length; i++) {
      var c = s.cells[i]; if (!c) continue;
      if (c.kind === 'pop') { c.ttl--; if (c.ttl <= 0) s.cells[i] = null; }
      else if (ageHearts) { c.ttl--; if (c.ttl <= 0) { s.cells[i] = null; s.events.push({ type: 'expire', kind: c.kind }); } }
    }
    if (s.magnetLeft > 0 && s.tick % pw.magnetEvery === 0) magnetCollect(s);
    if (s.over) return;
    spawnInfinity(s);
    if (s.doubleLeft > 0) { s.doubleLeft--; if (!s.doubleLeft) s.events.push({ type: 'powerEnd', name: 'double' }); }
    if (s.magnetLeft > 0) { s.magnetLeft--; if (!s.magnetLeft) s.events.push({ type: 'powerEnd', name: 'magnet' }); }
    if (s.slowLeft > 0) { s.slowLeft--; if (!s.slowLeft) s.events.push({ type: 'powerEnd', name: 'slow' }); }
  }

  function drain(s) { var e = s.events; s.events = []; return e; }

  /* =====================================================================
     Leaderboard helpers (shared by local storage and display code)
     ===================================================================== */
  var NAME_MAX = 12, BOARD_SIZE = 10;

  /* letters, digits, space, _ . -   (same rule the server enforces) */
  function sanitizeName(raw) {
    var s = String(raw == null ? '' : raw)
      .replace(/[^A-Za-z0-9 _.\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
    return s || 'PLAYER';
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function validEntry(e) {
    if (!e || typeof e !== 'object') return null;
    if (typeof e.name !== 'string') return null;
    if (!isInt(e.score) || e.score < 0 || e.score > CONFIG.infinity.maxScore) return null;
    if (!isInt(e.combo) || e.combo < 0 || e.combo > 9999) return null;
    if (typeof e.date !== 'number' || !isFinite(e.date) || e.date < 0) return null;
    return { name: sanitizeName(e.name), score: e.score, combo: e.combo, date: Math.floor(e.date) };
  }

  function compareEntries(a, b) {
    return (b.score - a.score) || (b.combo - a.combo) || (a.date - b.date) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }

  /* validate + sort + keep top 10; anything invalid is silently dropped */
  function normalizeBoard(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length; i++) { var v = validEntry(raw[i]); if (v) out.push(v); }
    out.sort(compareEntries);
    return out.slice(0, BOARD_SIZE);
  }

  function addToBoard(board, entry) {
    var v = validEntry(entry);
    if (!v) return normalizeBoard(board);
    return normalizeBoard((Array.isArray(board) ? board : []).concat([v]));
  }

  function formatDate(ms) {
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  return {
    CONFIG: CONFIG, secToTicks: secToTicks, mulberry32: mulberry32, isInt: isInt,
    createClassic: createClassic, classicTick: classicTick, classicTap: classicTap, calcStars: calcStars,
    createInfinity: createInfinity, infinityTick: infinityTick, infinityTap: infinityTap,
    tierIndexFor: tierIndexFor, rankIndexFor: rankIndexFor, paramsFor: paramsFor, drain: drain,
    NAME_MAX: NAME_MAX, BOARD_SIZE: BOARD_SIZE,
    sanitizeName: sanitizeName, escapeHtml: escapeHtml, validEntry: validEntry,
    normalizeBoard: normalizeBoard, addToBoard: addToBoard, compareEntries: compareEntries, formatDate: formatDate
  };
});
