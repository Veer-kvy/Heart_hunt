# HEART HUNT

Retro 8-bit heart collecting game. Plain HTML/CSS/JavaScript - no build step.

## Run locally
Open `index.html` in a browser (double-click works), or serve the folder:

    python3 -m http.server 8000     # then open http://localhost:8000

## Host on GitHub Pages
Upload **all files in this folder** (`index.html`, `app.js`, `core.js`, `online.js`, `config.js`) to a public repo, then Settings > Pages > Deploy from branch > `main` / root.

## Modes
- **CLASSIC** - 10 levels. Reach the goal score before the timer ends. 1-3 stars per level.
- **INFINITY** - no timer. The run ends on the **3rd bomb strike**. Difficulty rises with your score.

### Infinity rules
| Heart | Effect |
|---|---|
| Pink | +1 |
| Gold | +5 |
| Rainbow | +10 (rare) |
| Broken | -3 (score never below 0), resets combo |
| Bomb (dark round bomb) | tapping = 1 strike, no points, resets combo. Ignoring it is free. |
| Power (teal heart with a +) | grants one random power: Shield, Double, Magnet or Slow |

- **Shield** - the next bomb tap is blocked (shows "SAFE", shield is used up). Combo is kept.
- **Double** - pink/gold/rainbow points x2 for 8 s. Combo bonuses and penalties are not doubled.
- **Magnet** - every 3 ticks auto-collects the pink/gold/rainbow heart closest to vanishing, for 6 s.
- **Slow** - hearts age at half speed for 8 s (the spawn rate is unchanged).
- Collecting the same power again **refreshes** it; it never stacks. Max one shield.
- **Combo** - +1 per pink/gold/rainbow. Milestones (3, 5, 10, 20, 35) pay a one-time bonus per streak.
- **Difficulty** (by score): EASY 0, NORMAL 50, HARD 100, EXTREME 200, INSANE 350. Spawn rate and heart lifetime ramp smoothly between tiers.
- **Ranks**: HEART NOVICE 0, HEART HUNTER 50, HEART MASTER 100, INFINITY CHAMPION 200, INFINITY LEGEND 350.
- Bomb fairness: none in the first 3 s, minimum gap between bombs, at most 1-2 on the board, and every bomb stays visible for 2-3 s.

All numbers live in `CONFIG` at the top of `core.js`.

### Controls
Tap / click a heart, or use the keyboard: keys `1 2 3 4 / Q W E R / A S D F / Z X C V` map to the 4x4 grid. `P` or `Esc` pauses. The game pauses automatically when the tab is hidden.

## Leaderboards
- **INFINITY tab (LOCAL)** - top 10 on *this device*, stored in `localStorage`.
- **GLOBAL tab (ONLINE)** - top 100 from Supabase. Disabled until you configure it (below). The game is fully playable without it.

## Enable the global leaderboard (Supabase)
1. Create a free project at <https://supabase.com>.
2. **Authentication > Sign In / Providers**: enable **Allow anonymous sign-ins**.
   (Players get a persistent anonymous user id - no account or email. If they clear browser data they become a new player.)
3. **SQL Editor**: paste and run `supabase/schema.sql`.
4. **Project Settings > API**: copy the **Project URL** and the **anon / publishable key** into `config.js`:

       window.HEART_HUNT_SUPABASE = { url: 'https://YOUR-PROJECT.supabase.co', anonKey: 'YOUR-ANON-KEY' };

   The anon key is meant to be public. **Never** put the `service_role` / secret key in this folder.
5. Optional but recommended against bots: Authentication > Attack Protection > enable CAPTCHA (Cloudflare Turnstile / hCaptcha) for anonymous sign-ins.

### How it is protected
- Row Level Security is on and the table has **no client policies** - browsers cannot read or write it directly.
- Scores go through `submit_infinity_score()` which checks: authenticated user, nickname pattern/length, numeric ranges, run plausibility, **1 submission / 20 s and 100 / day per player**, and idempotency by `run_id` (retries never create duplicates).
- `created_at` is server time; the client cannot set it.
- Nicknames are limited to `A-Z a-z 0-9 space _ . -` (max 12) on the client **and** in the database, and are always rendered with `textContent`.

### Honest limits (read this)
**A browser-reported score can never be proven correct.** The checks above stop casual spam and absurd numbers, but a determined cheater can still send a plausible fake score. A stronger design, which this code is prepared for:
1. `core.js` is pure and takes a seedable RNG (`mulberry32`).
2. Add `start_run()` (RPC/Edge Function) that issues a random seed + run id and stores the start time.
3. The client plays using that seed and records the list of `(tick, cellIndex)` taps.
4. A Supabase Edge Function (Deno) imports the same `core.js`, replays the taps against the seed, and only inserts the score the **replay** produces (and rejects runs whose real elapsed time is too short).
Replay validation makes cheating much harder but still cannot stop an automation bot that plays legitimately fast; rate limits and CAPTCHA help there.

## Tests
    node tests/core.test.js
    node tests/online.test.js
