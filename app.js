/* HEART HUNT - UI, input, audio, screens. Game rules live in core.js. */
(function () {
  'use strict';
  var C = window.HHCore, CFG = C.CONFIG, TICK = CFG.tickMs;
  var $ = function (id) { return document.getElementById(id); };
  var reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return !!(reduceMq && reduceMq.matches); }

  /* ================= SAFE STORAGE ================= */
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode / full */ } },
    getItem: function (k) { return store.get(k); },
    setItem: function (k, v) { store.set(k, v); },
    removeItem: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  function readInt(key, max) {
    var n = parseInt(store.get(key), 10);
    return isFinite(n) && n >= 0 && n <= max ? n : 0;
  }
  function readJson(key) { try { return JSON.parse(store.get(key) || 'null'); } catch (e) { return null; } }

  var LEVELS = CFG.classic.levels;
  function loadProgress() {
    var p = { unlocked: 1, stars: {} }, raw = readJson('heartHuntProgress');
    if (raw && typeof raw === 'object') {
      var u = parseInt(raw.unlocked, 10);
      if (u >= 1 && u <= LEVELS.length) p.unlocked = u;
      if (raw.stars && typeof raw.stars === 'object') {
        for (var i = 1; i <= LEVELS.length; i++) { var s = parseInt(raw.stars[i], 10); if (s >= 1 && s <= 3) p.stars[i] = s; }
      }
    }
    return p;
  }
  var progress = loadProgress();
  var classicBest = readInt('heartHuntBest', CFG.infinity.maxScore);          /* existing key kept */
  var infBest = readInt('heartHuntInfinityBest', CFG.infinity.maxScore);      /* separate from classic */
  var infBoard = C.normalizeBoard(readJson('heartHuntInfinityBoard'));
  var nick = C.sanitizeName(store.get('heartHuntNick'));
  var online = window.HHOnline ? window.HHOnline.create({ config: window.HEART_HUNT_SUPABASE, storage: store, fetch: window.fetch ? window.fetch.bind(window) : null }) : null;
  function onlineOn() { return !!(online && online.isConfigured()); }

  /* ================= PIXEL ART ================= */
  function pix(rows, pal) {
    var out = '', w = rows[0].length;
    rows.forEach(function (r, y) {
      var x = 0;
      while (x < w) {
        var ch = r.charAt(x);
        if (ch === '.') { x++; continue; }
        var s = x; while (x < w && r.charAt(x) === ch) x++;
        out += '<rect x="' + s + '" y="' + y + '" width="' + (x - s) + '" height="1" fill="' + pal[ch] + '"/>';
      }
    });
    return '<svg viewBox="0 0 ' + w + ' ' + rows.length + '" shape-rendering="crispEdges" aria-hidden="true">' + out + '</svg>';
  }
  var HEART = ['.XX...XX.', 'XhXX.XXXX', 'XXhXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....'];
  var BROKEN = ['.XX...XX.', 'XhXX.XXXX', 'XXhXXkXXX', 'XXXXXkXXX', '.XXkXXXX.', '..XkXXX..', '...XXX...', '....X....'];
  var POWER = ['.XX...XX.', 'XhXX.XXXX', 'XXhXwXXXX', 'XXXwwwXXX', '.XXXwXXX.', '..XXXXX..', '...XXX...', '....X....'];
  var BOMB = ['........r..', '.......f...', '......f....', '...ooooo...', '..obbbbbo..', '.obhhbbbbo.', '.obhbbbbbo.', '.obbbbbbbo.', '.obbbbbbbo.', '..obbbbbo..', '...ooooo...'];
  var RB = ['r', 'o', 'y', 'g', 't', 'b', 'p', 'p'];
  var RAINBOW = HEART.map(function (row, i) { return row.replace(/X/g, RB[i]); });
  var CREAM = '#fff1d6';
  var ART = {
    pink: pix(HEART, { X: '#ff3d7f', h: CREAM }),
    gold: pix(HEART, { X: '#ffd23f', h: CREAM }),
    broken: pix(BROKEN, { X: '#7a5cc4', h: CREAM, k: '#1b1035' }),
    rainbow: pix(RAINBOW, { r: '#ff3d3d', o: '#ff9a2e', y: '#ffe23f', g: '#4be36b', t: '#2ee6c5', b: '#4d8dff', p: '#b45cff', h: CREAM }),
    power: pix(POWER, { X: '#2ee6c5', h: CREAM, w: CREAM }),
    bomb: pix(BOMB, { o: CREAM, b: '#1a1a2e', h: '#7b7bab', f: '#ffd23f', r: '#ff4b4b' })
  };
  var LABELS = {
    pink: 'Heart, plus 1', gold: 'Golden heart, plus 5', broken: 'Broken heart, minus 3',
    rainbow: 'Rainbow heart, plus 10', bomb: 'Bomb! Tapping it adds a strike', power: 'Power heart, gives a power-up'
  };
  function starSvg(on) {
    return pix(['..X..', '.XXX.', 'XXXXX', '.XXX.', '.X.X.'], { X: on ? '#ffd23f' : '#4a2f8a' });
  }
  function starsHtml(n) { return starSvg(n >= 1) + starSvg(n >= 2) + starSvg(n >= 3); }

  /* ================= AUDIO (Web Audio, generated; starts only after a click) ================= */
  var ctx = null, master = null, muted = store.get('heartHuntMuted') === '1', musicTimer = null, nextT = 0, step = 0;
  var STEP = 60 / 140 / 2;
  var LEAD = [69, 0, 72, 0, 76, 0, 72, 0, 74, 0, 77, 0, 81, 0, 77, 0, 76, 0, 72, 0, 69, 0, 72, 0, 71, 74, 76, 74, 71, 0, 69, 0];
  var BASS = [45, 45, 41, 41, 48, 48, 43, 43];
  function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function initAudio() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC(); } catch (e) { ctx = null; return; }
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.14; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } }
  }
  function tone(type, freq, t, dur, vol) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function sweep(type, f0, f1, t, dur, vol) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(t, dur, vol) {
    var n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(g); g.connect(master); src.start(t);
  }
  var SFX = {
    pink: { w: 'square', n: [[988, 0, .08], [1319, .07, .1]] },
    gold: { w: 'square', n: [[784, 0, .1], [988, .06, .1], [1175, .12, .1], [1568, .18, .1]] },
    rainbow: { w: 'square', n: [[659, 0, .08], [784, .06, .08], [988, .12, .08], [1175, .18, .08], [1568, .24, .14], [2093, .32, .18]] },
    broken: { sw: ['sawtooth', 330, 70, .28] },
    strike: { sw: ['sawtooth', 220, 60, .35] },
    danger: { w: 'square', n: [[196, 0, .14], [147, .18, .14], [196, .36, .14], [147, .54, .2]] },
    boom: { sw: ['sawtooth', 160, 30, .7], noise: .7 },
    power: { w: 'square', n: [[523, 0, .08], [784, .07, .08], [1047, .14, .12]] },
    shield: { w: 'triangle', n: [[1319, 0, .1], [1760, .08, .2]] },
    combo: { w: 'square', n: [[880, 0, .07], [1175, .07, .07], [1568, .14, .12]] },
    rank: { w: 'square', n: [[523, 0, .1], [659, .1, .1], [784, .2, .1], [1047, .3, .25]] },
    pb: { w: 'square', n: [[523, 0, .1], [659, .1, .1], [784, .2, .1], [1047, .3, .1], [784, .4, .1], [1047, .5, .1], [1319, .6, .3]] },
    over: { w: 'square', n: [[659, 0, .2], [523, .16, .2], [440, .32, .2], [330, .48, .2]] },
    goal: { w: 'square', n: [[659, 0, .12], [880, .08, .12], [1175, .16, .12]] },
    clear: { w: 'square', n: [[523, 0, .16], [659, .11, .16], [784, .22, .16], [1047, .33, .16], [784, .44, .16], [1047, .55, .16], [1319, .66, .16]] }
  };
  function sfx(name) {
    if (!ctx || muted) return;
    var d = SFX[name]; if (!d) return;
    var t = ctx.currentTime;
    if (d.n) d.n.forEach(function (x) { tone(d.w, x[0], t + x[1], x[2], 0.6); });
    if (d.sw) sweep(d.sw[0], d.sw[1], d.sw[2], t, d.sw[3], 0.6);
    if (d.noise) noise(t, d.noise, 0.5);
  }
  function scheduleStep(i, t) {
    var n = LEAD[i % LEAD.length];
    if (n) tone('square', hz(n), t, STEP * 1.7, 0.5);
    if (i % 4 === 0) tone('triangle', hz(BASS[(i / 4) % BASS.length]), t, STEP * 3.4, 0.9);
    if (i % 2 === 0) tone('square', 8000, t, 0.02, 0.05);
  }
  function pump() { while (nextT < ctx.currentTime + 0.2) { scheduleStep(step, nextT); nextT += STEP; step++; } }
  function startMusic() { if (!ctx) return; stopMusic(); step = 0; nextT = ctx.currentTime + 0.08; pump(); musicTimer = setInterval(pump, 40); }
  function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }
  var muteBtn = $('mute');
  function paintMute() { muteBtn.textContent = 'MUSIC: ' + (muted ? 'OFF' : 'ON'); muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false'); }
  muteBtn.addEventListener('click', function () {
    muted = !muted; store.set('heartHuntMuted', muted ? '1' : '0');
    initAudio(); if (master) master.gain.value = muted ? 0 : 0.14; paintMute();
  });
  paintMute();

  /* ================= STATE MACHINE =================
     MENU -> PLAYING_CLASSIC | PLAYING_INFINITY <-> PAUSED -> GAME_OVER -> MENU / new run */
  var state = 'MENU', pausedFrom = null, mode = 'classic', engine = null;
  var level = Math.min(progress.unlocked, LEVELS.length);
  var finalized = false, run = null, overTimer = 0;
  function isPlaying() { return state === 'PLAYING_CLASSIC' || state === 'PLAYING_INFINITY'; }

  /* ================= ONE game loop (requestAnimationFrame + accumulator) ================= */
  var rafId = 0, lastT = 0, acc = 0;
  function stopLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }
  function startLoop() { stopLoop(); lastT = performance.now(); acc = 0; rafId = requestAnimationFrame(frame); }
  function frame(now) {
    rafId = 0;
    if (!isPlaying()) return;
    var dt = now - lastT; lastT = now;
    if (!(dt > 0)) dt = 0;
    acc += Math.min(dt, 500);                 /* a long stall never fast-forwards the game */
    var guard = 0;
    while (acc >= TICK && guard++ < 4 && isPlaying()) { acc -= TICK; step1(); }
    if (acc >= TICK) acc = 0;
    if (isPlaying()) rafId = requestAnimationFrame(frame);
  }
  function step1() {
    if (mode === 'classic') C.classicTick(engine); else C.infinityTick(engine);
    afterEngine();
  }

  /* ================= DOM refs / render ================= */
  var grid = $('grid'), buttons = [];
  var el = {
    score: $('score'), statB: $('statB'), statBLabel: $('statBLabel'), best: $('best'), bar: $('bar'), goalbar: $('goalbar'),
    goaltxt: $('goaltxt'), lvlabel: $('lvlabel'), strikeVal: $('strikeVal'), strikesBox: $('strikesBox'), pips: $('pips'),
    infDiff: $('infDiff'), infRank: $('infRank'), chips: $('chips'), toast: $('toast'), fx: $('fx'), fx2: $('fx2'), game: $('game'), warn: $('warn')
  };
  var cache = {};
  function setText(node, key, v) { v = String(v); if (cache[key] !== v) { cache[key] = v; node.textContent = v; } }
  function setStyle(node, key, prop, v) { var k = key + prop; if (cache[k] !== v) { cache[k] = v; node.style[prop] = v; } }

  var PIPS = '';
  for (var pi = 0; pi < CFG.infinity.strikesToEnd; pi++) PIPS += ART.bomb;
  el.pips.innerHTML = PIPS;

  function cellKey(c) {
    if (!c) return '';
    if (c.kind === 'pop') return 'pop:' + c.label + ':' + (c.good ? 1 : 0);
    return c.kind + (c.ttl <= 3 ? ':f' : '');
  }
  function drawCell(i, c) {
    var b = buttons[i];
    b.className = 'cell' + (c && c.kind === 'bomb' ? ' bomb' : '') + (c && c.kind !== 'pop' && c.ttl <= 3 ? ' fade' : '');
    if (!c) { b.innerHTML = ''; b.setAttribute('aria-label', 'Empty slot'); }
    else if (c.kind === 'pop') {
      b.innerHTML = '<span class="pop" style="color:' + (c.good ? '#2ee6c5' : '#ff4b4b') + '">' + C.escapeHtml(c.label) + '</span>';
      b.setAttribute('aria-label', 'Collected');
    } else { b.innerHTML = ART[c.kind]; b.setAttribute('aria-label', LABELS[c.kind]); }
  }

  function secs(ticks) { return Math.ceil(ticks * TICK / 1000); }
  function render() {
    var e = engine, i;
    if (!e) return;
    for (i = 0; i < buttons.length; i++) {
      var k = cellKey(e.cells[i]);
      if (buttons[i]._k !== k) { buttons[i]._k = k; drawCell(i, e.cells[i]); }
    }
    setText(el.score, 'score', e.score);
    if (mode === 'classic') {
      var L = e.cfg;
      setText(el.statB, 'statB', e.time);
      setText(el.best, 'best', classicBest);
      setStyle(el.bar, 'bar', 'width', Math.max(0, e.time / L.time * 100) + '%');
      setStyle(el.bar, 'barc', 'background', e.time <= 5 && state !== 'MENU' ? '#ff3d7f' : '#2ee6c5');
      setStyle(el.goalbar, 'goal', 'width', Math.min(100, e.score / L.target * 100) + '%');
      setText(el.lvlabel, 'lv', 'LEVEL ' + level);
      setText(el.goaltxt, 'gt', e.score >= L.target ? 'GOAL MET!' : 'GOAL ' + L.target);
      setStyle(el.goaltxt, 'gtc', 'color', e.score >= L.target ? '#2ee6c5' : '');
    } else {
      var max = CFG.infinity.strikesToEnd;
      setText(el.statB, 'statB', e.combo);
      setText(el.best, 'best', infBest);
      setText(el.strikeVal, 'sv', e.strikes + '/' + max);
      el.strikesBox.classList.toggle('hot', e.strikes >= max - 1);
      var pips = el.pips.children;
      for (i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < e.strikes);
      setText(el.infDiff, 'diff', CFG.infinity.tiers[e.tierIndex].name);
      setText(el.infRank, 'rank', CFG.infinity.ranks[e.rankIndex].name);
      var chips = [];
      if (e.shield) chips.push('<span class="chip shield">SHIELD READY</span>');
      if (e.doubleLeft > 0) chips.push('<span class="chip">DOUBLE x2 ' + secs(e.doubleLeft) + 'S</span>');
      if (e.magnetLeft > 0) chips.push('<span class="chip">MAGNET ' + secs(e.magnetLeft) + 'S</span>');
      if (e.slowLeft > 0) chips.push('<span class="chip">SLOW ' + secs(e.slowLeft) + 'S</span>');
      var html = chips.join('');
      if (cache.chips !== html) { cache.chips = html; el.chips.innerHTML = html; }
      grid.classList.toggle('shielded', !!e.shield);
    }
  }

  function setHud(m) {
    $('classicInfo').hidden = m !== 'classic';
    $('infinityInfo').hidden = m !== 'infinity';
    el.statBLabel.textContent = m === 'classic' ? 'TIME' : 'COMBO';
    cache = {}; grid.classList.remove('shielded');
    buttons.forEach(function (b) { b._k = null; });
    var lg = [['pink', '+1'], ['gold', '+5'], ['broken', '-3']];
    if (m === 'infinity') lg = [['pink', '+1'], ['gold', '+5'], ['rainbow', '+10'], ['broken', '-3'], ['bomb', 'STRIKE'], ['power', 'POWER']];
    $('legend').innerHTML = lg.map(function (x) { return '<div>' + ART[x[0]] + x[1] + '</div>'; }).join('');
  }

  /* ================= TOASTS, FLASHES, PARTICLES ================= */
  var toastTimer = 0, toastPrio = 0, toastUntil = 0;
  function toast(msg, cls, ms, prio) {
    var now = Date.now();
    prio = prio || 1;
    if (now < toastUntil && prio < toastPrio) return;
    toastPrio = prio; toastUntil = now + (ms || 1200);
    el.toast.textContent = msg; el.toast.className = 'toast show ' + (cls || ''); el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; toastPrio = 0; }, ms || 1200);
  }
  function clearToast() { clearTimeout(toastTimer); el.toast.hidden = true; toastPrio = 0; toastUntil = 0; }
  function restartAnim(node, cls, ms) {
    if (reduced()) return;
    node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls);
    setTimeout(function () { node.classList.remove(cls); }, ms);
  }
  function burst(layer, n, colors) {
    if (reduced()) return;
    n = Math.min(n, 36);
    for (var i = 0; i < n && layer.childElementCount < 48; i++) {
      var p = document.createElement('i'), a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 120;
      p.className = 'px'; p.style.background = colors[i % colors.length];
      p.style.setProperty('--dx', Math.round(Math.cos(a) * d) + 'px'); p.style.setProperty('--dy', Math.round(Math.sin(a) * d) + 'px');
      layer.appendChild(p);
      (function (node) { setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 760); })(p);
    }
  }
  function clearFx() { el.fx.innerHTML = ''; el.fx2.innerHTML = ''; }

  /* ================= ENGINE EVENTS ================= */
  var COLORS_BOOM = ['#ff4b4b', '#ff9a2e', '#ffd23f', '#fff1d6'];
  var POWER_TOAST = { shield: 'SHIELD READY! BLOCKS 1 BOMB', double: 'DOUBLE SCORE!', magnet: 'HEART MAGNET!', slow: 'SLOW HEARTS!' };
  function handleEvents(list) {
    for (var i = 0; i < list.length; i++) {
      var ev = list[i];
      switch (ev.type) {
        case 'collect':
          if (ev.kind === 'power') break;       /* the 'power' event plays its own sound */
          if (ev.kind === 'bomb') break;         /* 'strike' / 'shieldBlock' play their own */
          sfx(ev.kind); break;
        case 'goal': sfx('goal'); restartAnim(el.game, 'flash', 500); break;
        case 'strike':
          if (ev.n === 1) { toast('FIRST STRIKE!', 'red', 1400, 5); sfx('strike'); restartAnim(el.game, 'shake', 360); restartAnim(el.warn, 'on', 520); }
          else if (ev.n === 2) { toast('DANGER! ONE STRIKE LEFT!', 'red', 1700, 5); sfx('danger'); restartAnim(el.game, 'shake2', 520); el.warn.classList.add('strong'); restartAnim(el.warn, 'on', 720); }
          else { toast('BOOM! GAME OVER!', 'red', 2000, 9); sfx('boom'); burst(el.fx, 32, COLORS_BOOM); restartAnim(el.game, 'shake2', 520); }
          break;
        case 'shieldBlock': toast('SHIELD BLOCKED THE BOMB!', 'teal', 1500, 6); sfx('shield'); break;
        case 'power': toast(POWER_TOAST[ev.name] || 'POWER-UP!', 'teal', 1400, 4); sfx(ev.name === 'shield' ? 'shield' : 'power'); break;
        case 'combo': toast(ev.msg + (ev.bonus ? '  +' + ev.bonus : ''), 'pink', 1100, 3); sfx('combo'); break;
        case 'difficulty': toast('DIFFICULTY: ' + ev.name, 'gold', 1500, 4); sfx('rank'); restartAnim(el.infDiff, 'pulse', 600); break;
        case 'rank': toast('RANK UP: ' + ev.name, 'gold', 1700, 4); sfx('rank'); restartAnim(el.infRank, 'pulse', 600); break;
        default: break;
      }
    }
  }
  function afterEngine() {
    handleEvents(C.drain(engine));
    if (engine.over) { if (mode === 'classic') finishClassic(); else finishInfinity(); }
    else render();
  }

  /* ================= INPUT ================= */
  function hit(i) {
    if (!isPlaying() || !engine) return;
    var r = mode === 'classic' ? C.classicTap(engine, i) : C.infinityTap(engine, i);
    if (!r.ok) return;
    afterEngine();
  }
  for (var bi = 0; bi < CFG.cells; bi++) {
    (function (i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'cell'; b.setAttribute('aria-label', 'Empty slot');
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); hit(i); });
      b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) hit(i); } });
      grid.appendChild(b); buttons.push(b);
    })(bi);
  }
  var KEYMAP = '1234qwerasdfzxcv';
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    var k = String(e.key).toLowerCase();
    if (k === 'p' || k === 'escape') { if (isPlaying()) { e.preventDefault(); pauseGame(); } else if (state === 'PAUSED' && k === 'p') resumeGame(); return; }
    if (isPlaying() && !e.repeat) { var idx = KEYMAP.indexOf(k); if (k.length === 1 && idx >= 0) { e.preventDefault(); hit(idx); } }
  });

  /* ================= SCREENS ================= */
  var overlays = { menu: $('menu'), levels: $('levels'), cover: $('cover'), paused: $('paused') };
  var sections = { play: $('play'), infOver: $('infOver'), lb: $('lb') };
  function showOverlay(name) {
    for (var k in overlays) overlays[k].hidden = (k !== name);
    $('board').classList.toggle('screen', !!name);                       /* a screen replaces the board - nothing is covered */
    var bare = name === 'menu' || name === 'levels';                      /* menu: no score/timer bars behind it */
    $('hud').hidden = bare; $('legend').hidden = bare;
  }
  function showSection(name) { for (var k in sections) sections[k].hidden = (k !== name); }
  function focusSoon(node) { setTimeout(function () { try { node.focus(); } catch (e) { /* ignore */ } }, 0); }

  function resetFeedback() {
    clearTimeout(overTimer); overTimer = 0; clearToast(); clearFx();
    el.warn.className = 'strikeflash'; el.game.classList.remove('shake', 'shake2', 'flash');
  }
  function stopAll() { stopLoop(); stopMusic(); resetFeedback(); }

  function paintMenu() {
    $('mClassic').textContent = 'CLASSIC LV ' + level;
    $('menuBest').textContent = 'BEST  CLASSIC: ' + classicBest + '   INFINITY: ' + infBest;
    $('nick').value = nick;
  }
  function goMenu() {
    stopAll(); state = 'MENU'; engine = null; finalized = true;
    mode = 'classic'; level = Math.min(Math.max(level, 1), progress.unlocked);
    engine = C.createClassic(level - 1);           /* idle board behind the menu */
    setHud('classic'); render(); paintMenu();
    showSection('play'); showOverlay('menu'); focusSoon($('mClassic'));
  }

  /* ---------- CLASSIC ---------- */
  function startClassic() {
    initAudio(); stopAll();
    mode = 'classic'; engine = C.createClassic(level - 1); finalized = false;
    state = 'PLAYING_CLASSIC';
    setHud('classic'); showSection('play'); showOverlay(null); render();
    startMusic(); startLoop();
  }
  function finishClassic() {
    if (finalized) return; finalized = true;
    stopLoop(); stopMusic(); state = 'GAME_OVER';
    var e = engine, L = e.cfg, stars = C.calcStars(e.score, L.target), cleared = stars >= 1, note = [];
    if (e.score > classicBest) { classicBest = e.score; store.set('heartHuntBest', String(classicBest)); note.push('NEW HIGH SCORE!'); }
    if (cleared) {
      if (stars > (progress.stars[level] || 0)) progress.stars[level] = stars;
      if (level < LEVELS.length && progress.unlocked < level + 1) { progress.unlocked = level + 1; note.push('LEVEL ' + (level + 1) + ' UNLOCKED!'); }
      if (level === LEVELS.length) note.push('ALL LEVELS CLEARED!');
      store.set('heartHuntProgress', JSON.stringify(progress));
    }
    $('overTitle').textContent = cleared ? 'LEVEL CLEAR!' : 'TIME UP';
    $('overTitle').style.color = cleared ? '#2ee6c5' : '#ff3d7f';
    $('overLevel').textContent = 'LEVEL ' + level;
    $('final').textContent = e.score;
    $('overGoal').textContent = 'GOAL ' + L.target + (cleared ? '' : '  - ' + (L.target - e.score) + ' TO GO');
    $('overStars').innerHTML = starsHtml(stars);
    $('overNote').innerHTML = note.map(C.escapeHtml).join('<br>');
    $('again').textContent = cleared ? 'REPLAY' : 'RETRY';
    $('next').hidden = !(cleared && level < LEVELS.length);
    render(); showOverlay('cover'); sfx(cleared ? 'clear' : 'over');
    focusSoon($('next').hidden ? $('again') : $('next'));
  }

  /* ---------- INFINITY ---------- */
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach(function (_, i) { b[i] = Math.floor(Math.random() * 256); });
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function startInfinity() {
    initAudio(); stopAll();
    nick = C.sanitizeName($('nick').value || nick); store.set('heartHuntNick', nick);
    mode = 'infinity'; engine = C.createInfinity(); finalized = false;
    run = { id: uuid(), status: 'idle', rank: 0, err: '', prevBest: infBest, isPB: false, result: null };
    state = 'PLAYING_INFINITY';
    setHud('infinity'); showSection('play'); showOverlay(null); render();
    startMusic(); startLoop();
  }
  function finishInfinity() {
    if (finalized) return; finalized = true;                     /* result is saved exactly once */
    stopLoop(); stopMusic(); state = 'GAME_OVER';
    var e = engine;
    run.result = {
      score: e.score, combo: e.bestCombo, hearts: e.hearts, golds: e.golds, bombs: e.bombsHit,
      diff: CFG.infinity.tiers[e.maxTierIndex].name, durationMs: e.tick * TICK
    };
    run.isPB = e.score > infBest;
    if (run.isPB) { infBest = e.score; store.set('heartHuntInfinityBest', String(infBest)); }
    if (e.score > 0) {
      infBoard = C.addToBoard(infBoard, { name: nick, score: e.score, combo: e.bestCombo, date: Date.now() });
      store.set('heartHuntInfinityBoard', JSON.stringify(infBoard));
    }
    render();
    submitRun();
    overTimer = setTimeout(function () { overTimer = 0; showInfOver(); }, reduced() ? 150 : 1100);
  }
  function showInfOver() {
    if (state !== 'GAME_OVER' || mode !== 'infinity') return;
    var r = run.result;
    $('rScore').textContent = r.score;
    $('rBest').textContent = infBest;
    $('rCombo').textContent = r.combo;
    $('rHearts').textContent = r.hearts;
    $('rGolds').textContent = r.golds;
    $('rBombs').textContent = r.bombs;
    $('rDiff').textContent = r.diff;
    $('pbNote').textContent = run.isPB ? 'NEW PERSONAL BEST!' : '';
    showSection('infOver'); paintSubmit();
    if (run.isPB) { sfx('pb'); burst(el.fx2, 30, ['#ffd23f', '#ff3d7f', '#2ee6c5', '#fff1d6']); }
    else sfx('over');
    focusSoon($('iAgain'));
  }
  function paintSubmit() {
    if (!run || !run.result) return;
    var rank = $('rRank'), msg = $('submitMsg'), retry = $('iRetry');
    retry.hidden = true; retry.disabled = false; msg.className = 'small status';
    if (run.result.score <= 0) { rank.textContent = '-'; msg.textContent = 'SCORE 0 IS NOT SUBMITTED.'; return; }
    if (!onlineOn()) { rank.textContent = 'NOT SET UP'; msg.textContent = 'SAVED ON THIS DEVICE. ONLINE LEADERBOARD IS NOT SET UP.'; return; }
    if (run.status === 'pending') { rank.textContent = 'SUBMITTING...'; msg.textContent = ''; }
    else if (run.status === 'ok') { rank.textContent = run.rank ? '#' + run.rank : '-'; msg.textContent = 'SCORE SUBMITTED ONLINE.'; }
    else if (run.status === 'failed') {
      rank.textContent = 'OFFLINE'; msg.className = 'small status err';
      msg.textContent = 'COULD NOT SUBMIT (' + run.err + '). YOUR SCORE IS SAVED ON THIS DEVICE.'; retry.hidden = false;
    }
  }
  function submitRun() {
    var r = run.result;
    if (!r || r.score <= 0 || !onlineOn() || run.status === 'pending' || run.status === 'ok') return;
    run.status = 'pending'; run.err = ''; paintSubmit();
    var mine = run;                                              /* ignore replies that belong to an older run */
    online.submit({ runId: mine.id, name: nick, score: r.score, combo: r.combo, hearts: r.hearts, durationMs: r.durationMs })
      .then(function (res) { mine.status = 'ok'; mine.rank = res.rank; },
            function (err) { mine.status = 'failed'; mine.err = String(err && err.message || 'ERROR'); })
      .then(function () { if (run === mine) paintSubmit(); });
  }

  /* ---------- pause / resume ---------- */
  function pauseGame() {
    if (!isPlaying()) return;
    pausedFrom = state; state = 'PAUSED'; stopLoop(); stopMusic();
    showOverlay('paused'); focusSoon($('resume'));
  }
  function resumeGame() {
    if (state !== 'PAUSED') return;
    state = pausedFrom; showOverlay(null); startMusic(); startLoop();     /* startLoop resets the clock: no catch-up */
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) pauseGame(); });
  window.addEventListener('blur', pauseGame);

  /* ---------- level select ---------- */
  function buildLevelGrid() {
    var g = $('lvgrid'); g.innerHTML = '';
    LEVELS.forEach(function (_, k) {
      var n = k + 1, open = n <= progress.unlocked, b = document.createElement('button');
      b.type = 'button'; b.className = 'lv' + (n === level ? ' cur' : ''); b.disabled = !open;
      b.setAttribute('aria-label', 'Level ' + n + (open ? ', ' + (progress.stars[n] || 0) + ' of 3 stars' : ', locked'));
      b.innerHTML = '<span>' + (open ? n : '--') + '</span><span class="stars">' + starsHtml(open ? (progress.stars[n] || 0) : 0) + '</span>';
      b.addEventListener('click', function () { level = n; goMenu(); });
      g.appendChild(b);
    });
  }

  /* ================= LEADERBOARD SCREEN ================= */
  var lbTab = 'global', lbReq = 0, lbBusy = false;
  var $head = $('lbHead'), $body = $('lbBody'), $status = $('lbStatus');
  function setStatus(msg, cls) { $status.textContent = msg; $status.className = 'status' + (cls ? ' ' + cls : ''); }
  function setHead(cols) {
    $head.innerHTML = '';
    var tr = document.createElement('tr');
    cols.forEach(function (c, i) { var th = document.createElement('th'); th.textContent = c; if (i >= 2 || cols.length === 3 && i >= 1) th.className = 'num'; tr.appendChild(th); });
    $head.appendChild(tr);
  }
  function td(text, cls) { var c = document.createElement('td'); c.textContent = text; if (cls) c.className = cls; return c; }
  function fillRows(rows) {                                      /* textContent only: player names can never inject HTML */
    $body.innerHTML = '';
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      if (r.rank >= 1 && r.rank <= 3) tr.className = 'r' + r.rank;
      if (r.mine) tr.className += ' mine';
      tr.appendChild(td('#' + r.rank));
      var p = document.createElement('td'); p.textContent = r.name;
      if (r.date) { var s = document.createElement('small'); s.textContent = C.formatDate(r.date); p.appendChild(s); }
      tr.appendChild(p); tr.appendChild(td(String(r.score), 'num')); tr.appendChild(td(String(r.combo), 'num'));
      $body.appendChild(tr);
    });
  }
  function setRecent(rows) {
    var wrap = $('recentWrap'), body = $('recentBody'); body.innerHTML = '';
    wrap.hidden = !rows || !rows.length;
    (rows || []).forEach(function (r) {
      var tr = document.createElement('tr'); tr.appendChild(td(r.name)); tr.appendChild(td(String(r.score), 'num')); tr.appendChild(td(String(r.combo), 'num')); body.appendChild(tr);
    });
  }
  function openLeaderboard(tab) {
    stopAll(); if (isPlaying() || state === 'PAUSED') state = 'MENU';
    showSection('lb'); setTab(tab || lbTab);
  }
  function setTab(t) {
    lbTab = t;
    document.querySelectorAll('.tab').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === t ? 'true' : 'false'); });
    renderLb();
  }
  function renderLb() {
    lbReq++; $('lbMine').textContent = ''; setRecent(null); $body.innerHTML = '';
    if (lbTab === 'global') return loadGlobal();
    $('lbRefresh').disabled = false;
    if (lbTab === 'infinity') {
      $('lbScope').textContent = 'LOCAL - SAVED ON THIS DEVICE ONLY. NOT A GLOBAL RANKING.';
      setHead(['RANK', 'PLAYER', 'SCORE', 'BEST COMBO']);
      infBoard = C.normalizeBoard(infBoard);
      var rows = infBoard.map(function (e, i) { return { rank: i + 1, name: e.name, score: e.score, combo: e.combo, date: e.date, mine: e.name === nick }; });
      fillRows(rows);
      $('lbMine').textContent = 'PERSONAL BEST: ' + infBest + '   PLAYING AS: ' + nick;
      setStatus(rows.length ? 'TOP ' + rows.length + ' ON THIS DEVICE' : 'NO LOCAL SCORES YET. PLAY INFINITY MODE!', rows.length ? '' : 'warn');
    } else {
      $('lbScope').textContent = 'LOCAL - CLASSIC LEVELS ON THIS DEVICE. NO ONLINE CLASSIC BOARD.';
      setHead(['LEVEL', 'GOAL', 'STARS']);
      $body.innerHTML = '';
      LEVELS.forEach(function (L, i) {
        var n = i + 1, open = n <= progress.unlocked, tr = document.createElement('tr');
        tr.appendChild(td(String(n))); tr.appendChild(td(String(L.target) + ' PTS', 'num')); tr.appendChild(td(open ? (progress.stars[n] || 0) + '/3' : 'LOCKED', 'num'));
        $body.appendChild(tr);
      });
      $('lbMine').textContent = 'BEST CLASSIC SCORE: ' + classicBest;
      setStatus('');
    }
  }
  function loadGlobal() {
    $('lbScope').textContent = 'GLOBAL - ONLINE TOP 100 (BEST RUN PER PLAYER).';
    setHead(['RANK', 'PLAYER', 'SCORE', 'BEST COMBO']);
    var btn = $('lbRefresh');
    if (!onlineOn()) { btn.disabled = false; setStatus('ONLINE LEADERBOARD IS NOT SET UP. ADD YOUR SUPABASE URL AND KEY IN CONFIG.JS (SEE README). USE THE INFINITY TAB FOR LOCAL SCORES.', 'warn'); return; }
    if (navigator.onLine === false) { btn.disabled = false; setStatus('YOU ARE OFFLINE. THE GAME STILL WORKS - SEE THE INFINITY TAB FOR LOCAL SCORES.', 'warn'); return; }
    var req = lbReq; setStatus('LOADING...'); btn.disabled = true;
    Promise.all([online.fetchTop(100), online.fetchRecent(10).catch(function () { return []; }), online.fetchMine().catch(function () { return null; })])
      .then(function (res) {
        if (req !== lbReq) return;
        var top = res[0];
        fillRows(top); setRecent(res[1]);
        if (res[2]) $('lbMine').textContent = 'YOUR BEST: ' + res[2].best + '   YOUR RANK: #' + res[2].rank;
        else $('lbMine').textContent = 'PLAY AND SUBMIT A SCORE TO GET A RANK.   PLAYING AS: ' + nick;
        setStatus(top.length ? 'UPDATED ' + new Date().toLocaleTimeString() : 'NO ONLINE SCORES YET. BE THE FIRST!', top.length ? '' : 'warn');
        btn.disabled = false;
      })
      .catch(function (err) {
        if (req !== lbReq) return;
        setStatus('COULD NOT LOAD SCORES: ' + (err && err.message || 'ERROR') + '. PRESS REFRESH TO TRY AGAIN.', 'err');
        btn.disabled = false;
      });
  }

  /* ================= WIRING ================= */
  $('mClassic').addEventListener('click', startClassic);
  $('mInfinity').addEventListener('click', startInfinity);
  $('mLevels').addEventListener('click', function () { buildLevelGrid(); showOverlay('levels'); var c = document.querySelector('.lv.cur'); if (c) focusSoon(c); });
  $('mBoard').addEventListener('click', function () { openLeaderboard('global'); });
  $('backFromLevels').addEventListener('click', function () { showOverlay('menu'); focusSoon($('mClassic')); });
  $('again').addEventListener('click', startClassic);
  $('next').addEventListener('click', function () { level = Math.min(level + 1, LEVELS.length); startClassic(); });
  $('toLevels').addEventListener('click', function () { goMenu(); buildLevelGrid(); showOverlay('levels'); });
  $('cMenu').addEventListener('click', goMenu);
  $('resume').addEventListener('click', resumeGame);
  $('pMenu').addEventListener('click', goMenu);
  $('iAgain').addEventListener('click', startInfinity);
  $('iBoard').addEventListener('click', function () { openLeaderboard('global'); });
  $('iMenu').addEventListener('click', goMenu);
  $('iRetry').addEventListener('click', function () { if (run && run.status === 'failed') { $('iRetry').disabled = true; submitRun(); } });
  $('lbBack').addEventListener('click', goMenu);
  $('lbRefresh').addEventListener('click', renderLb);
  document.querySelectorAll('.tab').forEach(function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); }); });
  window.addEventListener('online', function () { if (!$('lb').hidden && lbTab === 'global') renderLb(); });
  window.addEventListener('offline', function () { if (!$('lb').hidden && lbTab === 'global') renderLb(); });
  var nickEl = $('nick');
  function commitNick() { nick = C.sanitizeName(nickEl.value); nickEl.value = nick; store.set('heartHuntNick', nick); }
  nickEl.addEventListener('change', commitNick); nickEl.addEventListener('blur', commitNick);

  /* test hooks, only with ?debug=1 */
  if (/[?&]debug=1/.test(location.search)) {
    window.HHDebug = {
      state: function () { return state; }, engine: function () { return engine; }, mode: function () { return mode; },
      loops: function () { return rafId ? 1 : 0; }, musicTimers: function () { return musicTimer ? 1 : 0; },
      put: function (i, kind, ttl) { engine.cells[i] = { kind: kind, ttl: ttl || 40, id: 9000 + i }; render(); },
      set: function (k, v) { engine[k] = v; }, run: function () { return run; }, board: function () { return infBoard; }
    };
  }

  goMenu();
})();
