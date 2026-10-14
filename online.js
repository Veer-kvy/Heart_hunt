/* HEART HUNT - online leaderboard client (Supabase REST, no library).
   Gameplay never depends on this file: every call can fail and the game keeps working. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HHOnline = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SESSION_KEY = 'heartHuntSbSession';
  var TIMEOUT_MS = 8000;

  /* env is injectable so the client can be tested without a browser */
  function create(env) {
    env = env || {};
    var cfg = env.config || {};
    var fetchFn = env.fetch || (typeof fetch === 'function' ? fetch.bind(typeof globalThis !== 'undefined' ? globalThis : undefined) : null);
    var storage = env.storage || null;
    var now = env.now || function () { return Date.now(); };
    var base = String(cfg.url || '').replace(/\/+$/, '');
    var key = String(cfg.anonKey || '');
    var configured = /^https:\/\/[^\s/]+$/.test(base) && key.length > 20;

    function load() { try { var r = JSON.parse(storage && storage.getItem(SESSION_KEY) || 'null'); return r && typeof r === 'object' ? r : null; } catch (e) { return null; } }
    function save(s) { try { if (storage) storage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
    function drop() { try { if (storage) storage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } }

    function http(path, opts) {
      if (!fetchFn) return Promise.reject(new Error('NETWORK UNAVAILABLE'));
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
      var headers = { apikey: key, 'Content-Type': 'application/json' };
      if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
      return fetchFn(base + path, { method: 'POST', headers: headers, body: JSON.stringify(opts.body || {}), signal: ctrl ? ctrl.signal : undefined })
        .then(function (res) {
          return res.text().then(function (txt) {
            var data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { /* non-JSON */ }
            if (!res.ok) {
              var msg = data && (data.message || data.msg || data.error_description || data.error) || ('HTTP ' + res.status);
              var err = new Error(String(msg).slice(0, 160)); err.status = res.status; throw err;
            }
            return data;
          });
        })
        .catch(function (e) {
          if (e && e.name === 'AbortError') throw new Error('REQUEST TIMED OUT');
          if (e && e.status) throw e;
          throw new Error('NETWORK ERROR');
        })
        .then(function (v) { if (timer) clearTimeout(timer); return v; },
              function (e) { if (timer) clearTimeout(timer); throw e; });
    }

    function adopt(data) {
      if (!data || typeof data.access_token !== 'string' || !data.user || typeof data.user.id !== 'string') throw new Error('SIGN-IN FAILED');
      var s = {
        access_token: data.access_token, refresh_token: data.refresh_token || '',
        expires_at: (typeof data.expires_at === 'number' ? data.expires_at * 1000 : now() + (data.expires_in || 3600) * 1000),
        user_id: data.user.id
      };
      save(s); return s;
    }

    /* anonymous identity: Supabase "anonymous sign-ins" create a real user id that the
       browser keeps (refresh token) - no account or email needed */
    function ensureSession() {
      var s = load();
      if (s && s.access_token && s.expires_at - 30000 > now()) return Promise.resolve(s);
      if (s && s.refresh_token) {
        return http('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: s.refresh_token } })
          .then(adopt, function () { drop(); return http('/auth/v1/signup', { body: { data: {} } }).then(adopt); });
      }
      return http('/auth/v1/signup', { body: { data: {} } }).then(adopt);
    }

    /* reads work even if sign-in is unavailable (falls back to the anon key) */
    function rpc(name, args, needAuth) {
      if (!configured) return Promise.reject(new Error('NOT CONFIGURED'));
      var sess = ensureSession().then(function (s) { return s.access_token; },
        function (e) { if (needAuth) throw e; return null; });
      return sess.then(function (token) { return http('/rest/v1/rpc/' + name, { body: args, token: token || key }); });
    }

    function rows(v) { return Array.isArray(v) ? v : []; }

    function cleanRow(r) {
      if (!r || typeof r.player_name !== 'string') return null;
      var score = Number(r.score), combo = Number(r.highest_combo);
      if (!Number.isInteger(score) || score < 0 || !Number.isInteger(combo) || combo < 0) return null;
      var t = Date.parse(r.created_at);
      return { name: r.player_name, score: score, combo: combo, date: isNaN(t) ? 0 : t, rank: Number(r.rank) || 0, mine: r.is_mine === true };
    }

    return {
      isConfigured: function () { return configured; },
      fetchTop: function (limit) {
        return rpc('get_infinity_leaderboard', { p_limit: limit || 100 }, false)
          .then(function (v) { return rows(v).map(cleanRow).filter(Boolean); });
      },
      fetchRecent: function (limit) {
        return rpc('get_recent_infinity', { p_limit: limit || 10 }, false)
          .then(function (v) { return rows(v).map(cleanRow).filter(Boolean); });
      },
      fetchMine: function () {
        return rpc('get_my_infinity_stats', {}, true).then(function (v) {
          var r = rows(v)[0];
          if (!r) return null;
          var best = Number(r.best), rank = Number(r.rank);
          return Number.isInteger(best) ? { best: best, rank: Number.isInteger(rank) ? rank : 0, runs: Number(r.runs) || 0 } : null;
        });
      },
      submit: function (run) {
        return rpc('submit_infinity_score', {
          p_run_id: run.runId, p_name: run.name, p_score: run.score, p_combo: run.combo,
          p_hearts: run.hearts, p_duration_ms: run.durationMs
        }, true).then(function (v) {
          if (!v || v.accepted !== true) throw new Error('SCORE NOT ACCEPTED');
          return { rank: Number(v.rank) || 0 };
        });
      },
      userId: function () { var s = load(); return s ? s.user_id : null; }
    };
  }

  return { create: create, SESSION_KEY: SESSION_KEY };
});
