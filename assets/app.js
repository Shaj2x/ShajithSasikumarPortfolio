/* ============================================================
   Shajith Sasikumar, scroll scrubbed hero and page motion
   Plain JavaScript, no dependencies.
   ============================================================ */
(function () {
'use strict';

/* ---------- elements ---------- */
var stage   = document.getElementById('stage');
var hero    = document.querySelector('.hero');
var nav     = document.querySelector('.nav');
var markSvg = document.querySelector('.hero-mark');
var marks   = [].slice.call(document.querySelectorAll('.hero-mark .mk'));
var halo    = document.getElementById('mark-halo');
var headOut = document.getElementById('head');
var headIn  = document.getElementById('head-core');

/* ---------- the five static hero gates ----------
   Duplicated character for character in style.css. Change one, change both. */
var GATES = [
  '(max-width: 720px)',
  '(orientation: portrait) and (max-width: 1024px)',
  '(orientation: portrait) and (pointer: coarse)',
  '(orientation: landscape) and (pointer: coarse) and (max-height: 560px)',
  '(prefers-reduced-motion: reduce)'
];
var reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- theme ----------
   The stylesheet owns the palette. Anything drawn on a canvas cannot read a
   CSS variable directly, so the values are mirrored here once and re-read
   whenever the theme changes, and every canvas repaints off the same source.
   glow is the theme's bloom budget: a luminous line on near black becomes
   ink on paper, where the same halo would look like a printing fault. */
var theme = { accent: '159,216,255', ink: '238,242,246', glow: 1, dust: 1 };
var themeWatchers = [];

function readTheme() {
  var cs = getComputedStyle(document.documentElement);
  var g = function (n, f) { return (cs.getPropertyValue(n) || '').trim() || f; };
  theme.accent = g('--accent-rgb', '159,216,255');
  theme.ink    = g('--ink-rgb', '238,242,246');
  theme.glow   = parseFloat(g('--glow', '1'));
  if (!(theme.glow > 0)) theme.glow = 1;
  /* drifting dust is a dark room effect; on paper it reads as dirt */
  theme.dust = 0.25 + 0.75 * theme.glow;
}

function onTheme(fn) { themeWatchers.push(fn); }
function themeChanged() {
  readTheme();
  for (var i = 0; i < themeWatchers.length; i++) themeWatchers[i]();
}
readTheme();

var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
var smoothstep = function (p, e0, e1) {
  var t = clamp((p - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ---------- the mark: measure once, then only write on change ---------- */
var lens = [], total = 0, samples = [];
var BUILD = '20260916g';
var SAMPLES = 640;   /* points cached per stroke; ~0.2 units of error at hero size */

/* the mark's viewBox, shared by .hero-mark, .head-layer and the canvas field.
   All three must agree or the head drifts off the line. */
var VB = { x: 292, y: 256, w: 426, h: 496 };

/* The draw is a two stroke signature, not one continuous line. Between them
   the pen lifts: the head keeps moving, dimmed, along a short arc to where
   the second stroke begins, instead of teleporting across the mark.

   The plan below is measured in units of distance, not in shares of the
   clock, so that the writing holds one speed throughout: a second of time
   always buys the same amount of line, and no stroke runs faster or slower
   than any other.

   The lift is the exception, and it has to be. Stroke one ends at the bottom
   left of the upper S and stroke two begins at the top right of the lower
   one: 400 units apart, an arc almost half the length of a stroke. Charged
   at the writing rate that traverse cost 476ms of a 2300ms animation, a
   fifth of the whole thing, with nothing being drawn and only a dimmed nib
   sliding through empty space. That gap sits immediately before the second
   S, which is exactly where the draw has always been reported to slow down:
   not a timing fault at all, but a fifth of a second in which the animation
   has nothing to show.

   So the lift is charged at LIFT_RATE times the writing speed, which is also
   what a hand does. Pen down is a controlled stroke; pen up is a throw, and
   in handwriting the in air move runs two to three times the speed of the
   line it joins. Each segment therefore carries a cost in timeline units as
   well as a len in geometry units, and only the lift has the two differ. */
var LIFT_RATE = 3.4;
var plan = [];        /* [{kind, at, len, cost, ...}] one pass, in travel order */
var runTotal = 0;

function measureMark() {
  lens = marks.map(function (m) { return m.getTotalLength(); });
  total = lens.reduce(function (a, b) { return a + b; }, 0);

  /* getPointAtLength is a synchronous geometry call. Doing it per frame is
     the kind of thing that shows up as micro stutter under load, so the
     path is sampled once here and the head just reads the table after. */
  samples = marks.map(function (m, i) {
    var len = lens[i], out = new Float32Array((SAMPLES + 1) * 2);
    for (var j = 0; j <= SAMPLES; j++) {
      var pt = m.getPointAtLength(len * j / SAMPLES);
      out[j * 2] = pt.x; out[j * 2 + 1] = pt.y;
    }
    return out;
  });

  marks.forEach(function (m, i) {
    m.style.strokeDasharray = lens[i].toFixed(2);
    m.style.strokeDashoffset = lens[i].toFixed(2);
  });

  /* Stroke, lift, stroke, laid end to end as one continuous run of travel. */
  plan = []; runTotal = 0;
  for (var k = 0; k < marks.length; k++) {
    plan.push({ kind: 'draw', i: k, at: runTotal, len: lens[k], cost: lens[k], rate: 1 });
    runTotal += lens[k];
    if (k < marks.length - 1) {
      var from = pointAt(k, lens[k]), to = pointAt(k + 1, 0);
      if (from && to) {
        var curve = liftCurve(from, to, edgeDir(k, lens[k], true), edgeDir(k + 1, 0, false));
        var tbl = liftTable(curve);
        var cost = tbl.len / LIFT_RATE;
        plan.push({ kind: 'lift', tbl: tbl, at: runTotal,
                    len: tbl.len, cost: cost, rate: LIFT_RATE });
        runTotal += cost;
      }
    }
  }
}

/* The lift arc, sampled into an arc length table.

   liftPoint's parameter is a fraction of the chord, not of the arc, and the
   bow is a sine, so the curve covers ground fastest at both ends and slowest
   in the middle. Advancing that parameter at a steady rate therefore made the
   nib run about 13% fast leaving the first stroke, sag through the middle of
   the travel, and arrive fast at the top of the second stroke, where it then
   dropped to the writing speed. That handoff was the visible slowdown. The
   table below is indexed by distance instead, so the travel is as even as
   the strokes on either side of it. */
function liftTable(curve) {
  var n = 128, pts = [liftPoint(curve, 0)], cum = [0];
  for (var i = 1; i <= n; i++) {
    var q = liftPoint(curve, i / n);
    cum.push(cum[i - 1] + Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y));
    pts.push(q);
  }
  return { pts: pts, cum: cum, len: cum[n] };
}

/* the point s units along that arc */
function liftAt(tbl, s) {
  var cum = tbl.cum, lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) {
    var mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  var span = cum[hi] - cum[lo];
  var f = span > 1e-6 ? (s - cum[lo]) / span : 0;
  var a = tbl.pts[lo], b = tbl.pts[hi];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

function pointAt(i, drawn) {
  var tbl = samples[i];
  if (!tbl) return null;
  var f = clamp(drawn / lens[i], 0, 1) * SAMPLES;
  var a = Math.floor(f), t = f - a;
  if (a >= SAMPLES) { a = SAMPLES - 1; t = 1; }
  var x0 = tbl[a * 2], y0 = tbl[a * 2 + 1], x1 = tbl[a * 2 + 2], y1 = tbl[a * 2 + 3];
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
}

var lastOff = [], lastHeadX = -1, lastHeadY = -1, lastHeadOp = -1, lastHeadR = -1;
var headSpeed = 0, HEAD_R = 30, CORE_R = 6.5, lastGlow = '';

/* The travel between the two strokes, as a cubic that leaves along the
   direction the first stroke was going and arrives along the direction the
   second one sets off in. A symmetric bow off the chord met both strokes at
   a corner, and a corner costs visible distance in the frame that crosses
   it: the nib appeared to hesitate at the top of the second stroke. Matching
   the tangents removes the corner, so the pen carries its own momentum
   through the lift the way a hand does. */
function liftCurve(from, to, t1, t2) {
  var chord = Math.hypot(to.x - from.x, to.y - from.y);
  /* Asymmetric on purpose. Arrival is what needed fixing, so the nib comes
     into the second stroke fully aligned with it. Departure gets a short
     handle only: the first stroke ends heading away from where the travel is
     going, and matching that tangent hard made the pen loop backwards out of
     the mark before turning around, which is both longer and not what a hand
     does. A hand lifts and goes. */
  var d1 = chord * 0.10, d2 = chord * 0.38;
  return [from,
          { x: from.x + t1[0] * d1, y: from.y + t1[1] * d1 },
          { x: to.x   - t2[0] * d2, y: to.y   - t2[1] * d2 },
          to];
}

function liftPoint(c, t) {
  var u = 1 - t, a = u * u * u, b = 3 * u * u * t, e = 3 * u * t * t, f = t * t * t;
  return { x: a * c[0].x + b * c[1].x + e * c[2].x + f * c[3].x,
           y: a * c[0].y + b * c[1].y + e * c[2].y + f * c[3].y };
}

/* unit direction of a stroke at one of its ends */
function edgeDir(i, at, back) {
  var a = pointAt(i, clamp(at - (back ? 14 : 0), 0, lens[i]));
  var b = pointAt(i, clamp(at + (back ? 0 : 14), 0, lens[i]));
  if (!a || !b) return [1, 0];
  var dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  return L > 1e-6 ? [dx / L, dy / L] : [1, 0];
}

function drawMark(p, dt) {
  if (!runTotal || !plan.length) return null;
  /* The draw owns the whole timeline. It used to stop at 88%, then 93%, and
     hold a still frame for the rest, which is what made the ending look like
     it was slowing: the line ran at full speed, then sat motionless for nine
     frames while the page was still held. Nothing is reserved now. */
  var q = clamp(p, 0, 1);
  var run = q * runTotal;          /* units travelled: linear in time, always */
  var hx = null, hy = null, headOp = 0;

  for (var s = 0; s < plan.length; s++) {
    var seg = plan[s];
    var local = clamp(run - seg.at, 0, seg.cost);   /* timeline units */

    if (seg.kind === 'draw') {
      var off = seg.len - local;
      /* The delta gate saves a style write per frame, but it must never eat
         the last one: a stroke left sitting at 0.1 has not finished, and the
         whole point of the run is that it lands exactly complete. */
      if (lastOff[seg.i] === undefined || Math.abs(off - lastOff[seg.i]) > 0.1
          || (off === 0 && lastOff[seg.i] !== 0)) {
        lastOff[seg.i] = off;
        marks[seg.i].style.strokeDashoffset = off.toFixed(2);
      }
      /* The head belongs to whichever stroke is mid write. Later segments
         overwrite earlier ones, so the nib always sits on the newest work. */
      if (local > 0) {
        var pt = pointAt(seg.i, local);
        if (pt) { hx = pt.x; hy = pt.y; headOp = 1; }
      }
    } else if (run > seg.at && run < seg.at + seg.cost) {
      /* off the page now and moving quickly, the nib lightening across the
         travel rather than stepping. It only lightens so far: the nib is the
         one thing moving while the lift is on, and fading the only moving
         thing is what made the crossing read as a stall. */
      var t = local / seg.cost;
      var lp = liftAt(seg.tbl, local * seg.rate);   /* back to geometry units */
      hx = lp.x; hy = lp.y;
      var fade = smoothstep(t, 0, 0.3) * (1 - smoothstep(t, 0.7, 1));
      headOp = 1 - 0.24 * fade;
    }
  }

  /* The nib's own fade out is handed to CSS once the draw is over, so it can
     happen after the page has been given back rather than inside the hold.
     Dimming it while it is still travelling reads as deceleration however
     constant the speed underneath it is. */

  /* the ambient bloom rises as the mark fills in. One opacity write on a
     promoted layer: no raster work, whatever the glow looks like. */
  if (halo) {
    var glow = (0.22 + 0.78 * q).toFixed(3);
    if (glow !== lastGlow) { lastGlow = glow; halo.style.opacity = glow; }
  }

  if (Math.abs(headOp - lastHeadOp) > 0.004) {
    lastHeadOp = headOp;
    markSvg.parentNode.style.setProperty('--head', headOp.toFixed(3));
  }

  if (hx !== null) {
    /* the light swells with how fast it is being driven, the way a nib
       spreads under speed. One pole smoothed so it never flickers. */
    if (lastHeadX >= 0 && dt > 0) {
      var v = Math.hypot(hx - lastHeadX, hy - lastHeadY) / dt;   /* units per second */
      headSpeed += (v - headSpeed) * Math.min(1, dt * 16);
    }
    /* Scaled against the lift's speed, not the writing's. Against the old
       divisor the writing already pinned this at the top of its range, so
       the nib was one fixed size and the swell did nothing. Now the writing
       sits low in the range and the lift reaches the top, which is the whole
       point of it: the crossing has to read as a hand throwing the pen
       across, and a nib that streaks says that where a dimming dot does not. */
    var grow = 1 + clamp(headSpeed / 2600, 0, 1) * 0.5;
    var r = HEAD_R * grow;
    if (Math.abs(r - lastHeadR) > 0.2) {
      lastHeadR = r;
      headOut.setAttribute('r', r.toFixed(2));
      headIn.setAttribute('r', (CORE_R * (1 + (grow - 1) * 0.45)).toFixed(2));
    }
    if (Math.abs(hx - lastHeadX) > 0.12 || Math.abs(hy - lastHeadY) > 0.12) {
      lastHeadX = hx; lastHeadY = hy;
      headOut.setAttribute('cx', hx.toFixed(2)); headOut.setAttribute('cy', hy.toFixed(2));
      headIn.setAttribute('cx', hx.toFixed(2));  headIn.setAttribute('cy', hy.toFixed(2));
    }
  } else {
    headSpeed = 0;
  }
  return hx === null ? null : { x: hx, y: hy };
}

/* ---------- the intro: one played transition ----------
   The hero used to be 540vh of scrub, with the mark's progress tied to the
   scroll position, so getting past the intro meant scrolling five and a half
   screens. It is one screen now and the draw is a timeline that scroll
   triggers rather than drives: scroll once and the whole thing plays.

   It never traps anyone. The page is held only for the length of the play,
   any further input runs the remainder at speed rather than cutting it off
   mid stroke, and anyone who lands partway down the page gets the finished
   state with no hold at all. */
var DRAW_MS  = 2300;
var heroCopy = document.getElementById('hero-copy');
var heroCue  = document.getElementById('hero-cue');

var intro = 'idle';                 /* idle | playing | done */
/* True only while the intro is playing. The page is held for those two and a
   bit seconds and the draw is the whole point of them, so nothing else gets
   to take frames off it, or the eye off it. */
var introHolds = false;
var elapsed = 0, lit = false;
var rafId = null, lastTick = 0;

/* A dropped frame is not this animation's fault. Turning it into a jump is.

   Advancing the draw by the full wall clock means a 67ms stall on the
   viewer's machine moves the line four frames' worth of distance in one
   step, and that leap is precisely what reads as a hitch: the frame rate
   was already lost, but the amplifying was ours. Measured on the machine
   this is watched on, the median frame is a clean 16.7ms and the worst is
   66.7ms, so the problem there is not how much work a frame costs, it is
   the handful that stall.

   So a frame advances by at most two frames' worth however long it really
   took. A stall becomes a small even slowdown instead of a leap, and the
   draw finishes a fraction of a second later than it otherwise would. The
   stretch is capped in total, so a struggling machine cannot drag the hold
   out indefinitely; past that the old behaviour returns and it catches up.

   The cap is two frames of whatever this screen is actually doing, measured
   rather than assumed. A fixed 34ms was right only for a 60Hz display: on a
   screen capped at 30, which is what a battery saver or Low Power Mode does,
   every ordinary 33.3ms frame sits on the wrong side of it and the whole
   draw would crawl. One dropped frame is allowed through at any refresh
   rate; only a real stall gets held back. */
var STRETCH_CAP = 500, stretched = 0, beats = [], tickMs = 16.667;

function frame(now) {
  var ms = now - (lastTick || now);
  lastTick = now;

  if (ms > 4 && ms < 200) {
    beats.push(ms); if (beats.length > 40) beats.shift();
    if (beats.length >= 12) {
      var sorted = beats.slice().sort(function (a, b) { return a - b; });
      tickMs = sorted[Math.floor(sorted.length * 0.15)];   /* robust minimum */
    }
  }
  var cap = tickMs * 2.2;

  if (ms > cap && stretched < STRETCH_CAP) {
    stretched += Math.min(ms - cap, STRETCH_CAP - stretched);
    ms = cap;
  } else if (ms > 64) {
    ms = 64;
  }
  var dt = ms / 1000;
  elapsed += ms;

  var raw = clamp(elapsed / DRAW_MS, 0, 1);
  var head = drawMark(raw, dt);
  if (window.__fieldFocus) window.__fieldFocus(head, raw);

  /* the words arrive while the line is still moving, not after it stops */
  if (!lit && raw > 0.34 && heroCopy) { lit = true; heroCopy.classList.add('lit'); }

  if (raw < 1) { rafId = requestAnimationFrame(frame); return; }
  rafId = null; lastTick = 0;
  endIntro();
}

/* The hold. Only ever for the length of the play, and only from the top. */
function hold(on) {
  document.documentElement.style.overflow = on ? 'hidden' : '';
  document.body.style.overflow = on ? 'hidden' : '';
}
function swallow(e) { if (e.cancelable) e.preventDefault(); }

function startIntro() {
  if (intro !== 'idle') return;
  /* Checked again here, not just when arming: a hash landing scrolls after
     this script runs, so a page that looked like the top a moment ago may
     already be somewhere else. Holding it then would freeze a visitor for
     an intro they cannot even see. */
  if (window.scrollY > 40) { settleIntro(); return; }
  intro = 'playing';
  introHolds = true;
  if (heroCue) heroCue.classList.add('gone');
  hold(true);
  window.addEventListener('touchmove', swallow, { passive: false });
  elapsed = 0; lit = false; lastTick = 0; stretched = 0; beats.length = 0;
  if (rafId === null) rafId = requestAnimationFrame(frame);
}

function endIntro() {
  if (intro === 'done') return;
  intro = 'done';
  introHolds = false;
  hold(false);
  /* arm the transition first, then let the nib go on the next frame, so the
     fade actually animates instead of snapping */
  var wrap = markSvg && markSvg.parentNode;
  if (wrap) {
    wrap.classList.add('drawn');
    requestAnimationFrame(function () { wrap.style.setProperty('--head', '0'); });
  }
  window.removeEventListener('touchmove', swallow);
  window.removeEventListener('scroll', onIdleScroll);
  releaseIntent();
  if (heroCue) heroCue.classList.add('gone');
  if (heroCopy) {
    heroCopy.classList.add('lit');
    setTimeout(function () { heroCopy.classList.add('done'); }, 700);
  }
}

/* straight to the end, no play: a mid page landing, or a resize after */
function settleIntro() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  elapsed = DRAW_MS;
  drawMark(1, 0);
  endIntro();
}

/* The first scroll sets it off. After that it plays at its own pace: more
   scrolling is swallowed rather than used to rush the draw, because a
   transition that speeds up under an impatient thumb is not a transition.
   Escape is the way out, and so is any link in the nav. */
function onIntent(e) {
  if (intro === 'idle') { swallow(e); startIntro(); }
  else if (intro === 'playing') swallow(e);
}
var KEYS = { ' ': 1, PageDown: 1, ArrowDown: 1, End: 1, Enter: 1 };
function onKey(e) {
  if (intro === 'done') return;
  if (e.key === 'Escape') { settleIntro(); return; }
  if (KEYS[e.key]) onIntent(e);
}
function captureIntent() {
  window.addEventListener('wheel', onIntent, { passive: false });
  window.addEventListener('touchmove', onIntent, { passive: false });
  window.addEventListener('keydown', onKey);
}
function releaseIntent() {
  window.removeEventListener('wheel', onIntent);
  window.removeEventListener('touchmove', onIntent);
  window.removeEventListener('keydown', onKey);
}

/* ---------- arm and disarm, live on all five gates ---------- */
var heroArmed = false, armed = false;

function initHeroOnce() {
  if (heroArmed) return;
  heroArmed = true;
  measureMark();
}

function armIntro() {
  if (armed) return;
  armed = true;
  initHeroOnce();
  window.addEventListener('resize', onResize);

  /* someone who arrives partway down the page, from a hash link or a
     restored scroll position, has already missed the moment: give them the
     finished mark rather than holding them still for it */
  if (window.scrollY > 40) { settleIntro(); return; }

  drawMark(0, 0);
  captureIntent();
  window.addEventListener('scroll', onIdleScroll, { passive: true });
  /* the hash jump lands after this frame, so look again once it has */
  requestAnimationFrame(onIdleScroll);
  /* Nothing starts it but the visitor. The hero holds as a title card, with
     its cue, until the first scroll: that way the scroll is what sets it
     off, rather than a timer that may already have fired before they looked. */
}

/* Anything that moves the page while the intro is still waiting, a hash
   landing or a restored scroll position, means the moment has passed. */
function onIdleScroll() {
  if (intro === 'idle' && window.scrollY > 40) settleIntro();
}

function onResize() {
  measureMark();
  if (intro === 'done') drawMark(1, 0);
}

function disarmIntro() {
  if (!armed) return;
  armed = false;
  /* If the viewport becomes a phone mid play the intro never reaches its own
     end, and anything waiting on that flag would wait forever. */
  introHolds = false;
  releaseIntent();
  window.removeEventListener('scroll', onIdleScroll);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('touchmove', swallow);
  hold(false);
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}

var MQLS = GATES.map(function (q) { return matchMedia(q); });
function applyHeroMode() {
  if (MQLS.some(function (m) { return m.matches; })) disarmIntro();
  else armIntro();
}
MQLS.forEach(function (m) {
  if (m.addEventListener) m.addEventListener('change', applyHeroMode);
  else m.addListener(applyHeroMode);
});
applyHeroMode();

/* ---------- reduced motion, live, in both directions ---------- */
function pinToFinalStates() {
  document.querySelectorAll('.rev,.stagger,.rule,.steps').forEach(function (el) {
    el.classList.add('in', 'done');
  });
  document.querySelectorAll('[data-count]').forEach(function (el) {
    el.textContent = el.dataset.count;
  });
}
reduceMQ.addEventListener('change', function (e) {
  if (e.matches) pinToFinalStates();
  else applyHeroMode();
});

/* ---------- the vector field behind the mark ----------
   Slow drifting motes plus a soft glow that follows the drawing head, so the
   background is part of the same event instead of wallpaper. */
(function field() {
  var c = document.getElementById('field');
  if (!c || reduceMQ.matches) return;
  var ctx = c.getContext('2d'), dots = [], raf = null, w = 0, h = 0, dpr = 1;
  var focus = { x: -1, y: -1, a: 0 };

  function size() {
    /* One device pixel per CSS pixel, deliberately, even on a retina screen.
       All this canvas carries is drifting dust a pixel or two across; at dpr 2
       its backing store is 2880x1800 on a laptop, and every frame that store
       is re-uploaded to the compositor. That upload, not the clear and not the
       arcs, was the whole remaining cost: under a 4x CPU throttle the intro
       ran at 33.3ms a frame with it and 16.7ms without, and dropping to dpr 1
       is worth exactly as much as deleting the layer outright. */
    dpr = 1;
    map = null;                       /* the mark has moved; measure it again */
    w = c.offsetWidth; h = c.offsetHeight;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = Math.min(90, Math.round(w * h / 22000));
    dots = [];
    for (var i = 0; i < n; i++) {
      dots.push({ x: Math.random() * w, y: Math.random() * h, z: Math.random() * 0.8 + 0.2,
                  r: Math.random() * 1.4 + 0.3, s: Math.random() * 0.14 + 0.03,
                  o: Math.random() * 0.3 + 0.05, fill: '' });
    }
    recolour();
    sizeGlow();
  }

  /* Every dot's colour is fixed until the theme changes, but it used to be
     rebuilt and reparsed on every one of them on every frame: ninety string
     concatenations and ninety CSS colour parses a frame, for ninety values
     that never moved. */
  function recolour() {
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];
      d.fill = 'rgba(' + theme.accent + ',' + (d.o * d.z * theme.dust).toFixed(3) + ')';
    }
  }

  /* The glow that follows the nib lives on its own composited layer now,
     not in this canvas. Drawing it here meant rasterising a gradient the size
     of the hero on every single frame; the only thing that actually changes
     about it is where it is and how bright it is. */
  var glowEl = document.getElementById('field-glow'), glowR = 0, lastT = '', lastO = '';
  function sizeGlow() {
    glowR = Math.max(w, h) * 0.34;
    if (glowEl) { glowEl.style.width = glowEl.style.height = (glowR * 2) + 'px'; }
  }

  /* Where the mark sits inside this canvas, in canvas pixels.

     This is fixed until the window resizes, but it used to be recomputed on
     every frame: a querySelector plus two getBoundingClientRect calls, run
     from inside the intro's own rAF, immediately after that frame had
     written new dash offsets, a custom property on a parent, and the nib's
     geometry. Reading layout straight after writing style forces a
     synchronous recalc and layout of the whole document, every frame, during
     the single most expensive animation on the page.

     Measured under a 4x CPU throttle it cost the intro two thirds of its
     frame rate on its own: 49.9ms per frame with it, 16.7ms without. Neither
     the drop-shadows, the head blur, the motes, nor the field's own gradient
     made any measurable difference next to it. It is measured once now, and
     thrown away by size() when the window changes. */
  var wrapEl = null, map = null;
  function remap() {
    if (!wrapEl) wrapEl = document.querySelector('.mark-wrap');
    if (!wrapEl) return;
    var r = wrapEl.getBoundingClientRect(), sr = c.getBoundingClientRect();
    map = { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height };
  }

  /* the hero engine hands us the head position in the mark's own coordinates */
  window.__fieldFocus = function (head) {
    if (!head) { focus.a += (0 - focus.a) * 0.08; return; }
    if (!map) remap();
    if (!map) return;
    focus.x = map.x + ((head.x - VB.x) / VB.w) * map.w;
    focus.y = map.y + ((head.y - VB.y) / VB.h) * map.h;
    focus.a += (1 - focus.a) * 0.12;
  };

  /* The dust drifts at a tenth of a pixel per frame. Clearing a canvas the
     size of the hero and handing the compositor a fresh copy of it sixty
     times a second to move it that far was the last real cost in the intro,
     and a quarter of a pixel at 24fps is still sub-pixel: there is nothing
     to see at the higher rate. The glow is not throttled with it, because
     that is two compositor writes and it follows the nib, which is quick. */
  var DUST_MS = 1000 / 24, lastDust = 0;

  function draw(now) {
    if (now === undefined) now = performance.now();
    raf = requestAnimationFrame(draw);

    /* two compositor properties, gated so an unchanged frame writes nothing */
    if (glowEl) {
      var o = (focus.x > -1 ? 0.13 * focus.a * theme.glow : 0).toFixed(3);
      if (o !== lastO) { lastO = o; glowEl.style.opacity = o; }
      if (o !== '0.000') {
        var t = 'translate3d(' + (focus.x - glowR).toFixed(1) + 'px,' +
                                 (focus.y - glowR).toFixed(1) + 'px,0)';
        if (t !== lastT) { lastT = t; glowEl.style.transform = t; }
      }
    }

    if (now - lastDust < DUST_MS) return;
    /* drift by elapsed time, so throttling the repaint does not slow the
       dust down; capped so a backgrounded tab does not jump it on return */
    var k = lastDust ? Math.min(6, (now - lastDust) / 16.667) : 1;
    lastDust = now;

    ctx.clearRect(0, 0, w, h);
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];
      d.y -= d.s * d.z * k;
      if (d.y < -4) { d.y = h + 4; d.x = Math.random() * w; }
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * d.z, 0, 6.2832);
      ctx.fillStyle = d.fill;
      ctx.fill();
    }
  }

  size();
  window.addEventListener('resize', size);
  onTheme(recolour);

  /* It used to drift on for the entire page. Nothing it draws is visible once
     the hero has scrolled away, so it rests instead of competing with
     whatever the reader has actually scrolled to. */
  var awake = true;
  function wake(on) {
    awake = on;
    if (!on) { if (raf) cancelAnimationFrame(raf); raf = null; }
    else if (raf === null && !document.hidden) draw();
  }
  if ('IntersectionObserver' in window) {
    var hero = document.getElementById('stage') || c;
    new IntersectionObserver(function (e) { wake(e[0].isIntersecting); },
                             { rootMargin: '120px' }).observe(hero);
  }
  draw();
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = null; }
    else if (raf === null && awake) draw();
  });
})();

/* ---------- the fps readout: what this machine actually did ----------
   Three rounds of this went the same way: I measure on my own machine,
   report a number, and it still stutters on the machine it is watched on.
   This reports from there instead.

   Two ways in, because the first one did not survive contact with reality:
   ?fps or #fps on the URL, or just type the letters f p s anywhere on the
   page that is not a form field. A query string does not always reach the
   page it is addressed to; a keypress always does.

   Off until asked for, so no visitor sees it. All it costs when off is one
   keydown listener. */
(function fpsProbe() {
  var box = null, live = [], run = null, frozen = null, last = 0, on = false;

  function panel() {
    var b = document.createElement('div');
    b.id = 'fps-probe';
    b.setAttribute('aria-hidden', 'true');
    b.style.cssText =
      'position:fixed;left:12px;bottom:12px;z-index:2147483647;pointer-events:none;' +
      'font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;' +
      'padding:11px 14px;border-radius:10px;color:#EEF2F6;' +
      'background:rgba(8,10,13,.9);border:1px solid rgba(255,255,255,.18);' +
      'box-shadow:0 10px 34px rgba(0,0,0,.5)';
    (document.body || document.documentElement).appendChild(b);
    return b;
  }

  /* What the display is actually doing, taken as the fastest cadence it
     sustains rather than an assumed 60Hz. A browser in a battery saver, a
     Mac in Low Power Mode and a 30Hz external display all cap this, and
     against a 60Hz yardstick a perfectly smooth 30Hz reads as every single
     frame missing its budget, which is nonsense and sent me looking in the
     wrong place. */
  function refresh(a) {
    if (a.length < 12) return 16.667;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var fast = s[Math.floor(s.length * 0.1)];          /* robust minimum */
    var hz = [8.333, 11.111, 16.667, 20, 33.333, 41.667], best = 16.667, d = 1e9, i;
    for (i = 0; i < hz.length; i++) {
      var g = Math.abs(fast - hz[i]);
      if (g < d) { d = g; best = hz[i]; }
    }
    return d < 4 ? best : fast;
  }

  function stats(a) {
    var s = a.slice().sort(function (x, y) { return x - y; });
    var tick = refresh(a), late = 0, i;
    for (i = 0; i < a.length; i++) if (a[i] > tick * 1.5) late++;
    return { p50: s[s.length >> 1], worst: s[s.length - 1], tick: tick,
             missed: 100 * late / a.length, n: a.length };
  }

  function show() {
    if (!box) return;
    var dpr = window.devicePixelRatio || 1;
    var t = 'build ' + BUILD + '\n' +
            Math.round(innerWidth) + 'x' + Math.round(innerHeight) + ' at ' + dpr + 'x' +
            '  (' + Math.round(innerWidth * dpr) + 'x' + Math.round(innerHeight * dpr) + ' real)\n';

    if (frozen) {
      var cap = (1000 / frozen.tick).toFixed(0);
      t += '\nthis screen runs at ' + cap + 'fps\n' +
           '\nTHE INTRO, ON THIS MACHINE\n' +
           '  frames    ' + frozen.n + '\n' +
           '  typical   ' + frozen.p50.toFixed(1) + 'ms  (' + (1000 / frozen.p50).toFixed(0) + 'fps)\n' +
           '  worst     ' + frozen.worst.toFixed(1) + 'ms\n' +
           '  stalls    ' + frozen.missed.toFixed(0) + '% of frames\n' +
           (cap < 50 ? '\nNOTE: the screen itself is capped at ' + cap + 'fps.\n' +
                       'Check Low Power Mode, a battery saver,\n' +
                       'or an external display refresh rate.\n' : '') +
           '\nscreenshot this\n';
    } else if (run) {
      t += '\nplaying the intro...  ' + run.length + ' frames\n';
    } else if (intro !== 'done') {
      t += '\nscroll once to play the intro\n';
    }

    if (live.length > 20) {
      var s = stats(live);
      t += '\nright now   ' + (1000 / s.p50).toFixed(0) + 'fps of a possible ' +
           (1000 / s.tick).toFixed(0) + ', ' + s.missed.toFixed(0) + '% stalling';
    }
    box.textContent = t;
  }

  var wasIntro = 'idle', frames = 0;
  function tick(now) {
    if (!on) return;
    if (last) {
      var dt = now - last;
      live.push(dt); if (live.length > 110) live.shift();
      if (run) run.push(dt);
    }
    last = now;

    /* catch the intro wherever it is in its life */
    if (intro === 'playing' && !run && !frozen) { run = []; }
    if (wasIntro !== 'done' && intro === 'done' && run && run.length > 10) {
      frozen = stats(run); run = null; show();
    }
    wasIntro = intro;

    /* count frames, not the length of a buffer that stops growing: once live
       was capped the modulo never came back round and the panel sat frozen on
       whatever it had last printed */
    if (++frames % 8 === 0) show();
    requestAnimationFrame(tick);
  }

  function open() {
    if (on) return;
    on = true; box = panel(); last = 0; live = [];
    show(); requestAnimationFrame(tick);
  }
  function close() {
    on = false;
    if (box && box.parentNode) box.parentNode.removeChild(box);
    box = null;
  }

  if (/[?&#]fps\b/.test(location.search + location.hash)) open();

  var typed = '';
  window.addEventListener('keydown', function (e) {
    var el = e.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (!e.key || e.key.length !== 1) return;
    typed = (typed + e.key.toLowerCase()).slice(-3);
    if (typed === 'fps') { typed = ''; if (on) close(); else open(); }
  }, true);
})();

/* ---------- page entrances ---------- */
if ('IntersectionObserver' in window) {
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      io.unobserve(en.target);
      if (en.target.classList.contains('stagger')) {
        setTimeout(function () { en.target.classList.add('done'); }, 1400);
      }
      var counter = en.target.querySelector ? en.target.querySelector('[data-count]') : null;
      if (counter) countUp(counter);
    });
  }, { rootMargin: '0px 0px -12%' });
  document.querySelectorAll('.rev,.stagger,.rule,.steps').forEach(function (el) { io.observe(el); });
} else {
  pinToFinalStates();
}

function countUp(el) {
  if (el.dataset.done) return;
  el.dataset.done = '1';
  var to = parseInt(el.dataset.count, 10), t0 = 0, last = '';
  if (reduceMQ.matches) { el.textContent = to; return; }
  function step(now) {
    if (!t0) t0 = now;
    var p = clamp((now - t0) / 1100, 0, 1);
    var s = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
    if (s !== last) { last = s; el.textContent = s; }
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ---------- nav ---------- */
var navSolid = false;
window.addEventListener('scroll', function () {
  var want = window.scrollY > 40;
  if (want !== navSolid) { navSolid = want; nav.classList.toggle('solid', want); }
}, { passive: true });

/* pause every CSS loop on a hidden tab */
document.addEventListener('visibilitychange', function () {
  document.body.classList.toggle('paused', document.hidden);
});

/* ---------- the one interactive moment: hold to join the line ---------- */
(function holdLine() {
  var btn   = document.getElementById('hold');
  var draw  = document.getElementById('line-draw');
  var steps = document.getElementById('line-steps');
  if (!btn || !draw || !steps) return;

  var items = [].slice.call(steps.children);
  var stage = btn.closest('.line-stage');
  var len = draw.getTotalLength();
  stage.style.setProperty('--len', len.toFixed(1));

  var held = false, v = 0, raf = null, lastLit = -1, done = false;

  function finish() {
    if (done) return;
    done = true;
    btn.classList.add('done');
    btn.querySelector('.hold-label').textContent = 'The line is joined';
  }

  var lastBusy = null;
  function paint() {
    stage.style.setProperty('--hold', v.toFixed(3));
    /* the idle pulse steps aside the moment the real line starts drawing */
    var busy = v > 0.002;
    if (busy !== lastBusy) { lastBusy = busy; stage.classList.toggle('busy', busy); }
    var lit = Math.floor(v * items.length + 0.0001);
    if (lit !== lastLit) {                       /* only touch the DOM on change */
      lastLit = lit;
      items.forEach(function (li, i) { li.classList.toggle('lit', i < lit); });
    }
    if (v >= 1) finish();
  }

  function loop(now) {
    var step = held ? 0.0095 : -0.017;           /* ~1.8s to join; releasing eases back, never snaps */
    v = clamp(v + step, 0, 1);
    paint();
    if ((held && v < 1) || (!held && v > 0)) raf = requestAnimationFrame(loop);
    else raf = null;
  }

  function start(e) {
    if (e.cancelable) e.preventDefault();
    held = true;
    if (raf === null) raf = requestAnimationFrame(loop);
  }
  function stop() { held = false; if (raf === null) raf = requestAnimationFrame(loop); }

  btn.addEventListener('pointerdown', start);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
  btn.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); start(e); }
  });
  btn.addEventListener('keyup', stop);

  /* reduced motion gets the finished state with no hold required */
  function pinLine() {
    v = 1; paint(); finish();
    if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
  }
  if (reduceMQ.matches) pinLine();
  reduceMQ.addEventListener('change', function (e) { if (e.matches) pinLine(); });
})();

/* ---------- the appearance control ----------
   Mode is three-state: whatever the system says, until the visitor says
   otherwise, and then that choice sticks. Accent is one of five. Both are
   attributes on the root element, so the stylesheet does the work and this
   only has to remember the decision and tell the canvases to repaint. */
(function theming() {
  var root = document.documentElement;
  var modeBtn = document.getElementById('mode');
  var sws = [].slice.call(document.querySelectorAll('.sw'));
  var sysLight = matchMedia('(prefers-color-scheme: light)');
  var GROUND = { dark: '#0B0D10', light: '#F5F6F9' };

  function stored(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* what is actually on screen right now, whatever the reason */
  function liveMode() {
    var set = root.getAttribute('data-theme');
    if (set === 'light' || set === 'dark') return set;
    return sysLight.matches ? 'light' : 'dark';
  }

  function paint() {
    var mode = liveMode();
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', GROUND[mode]);
    if (modeBtn) {
      modeBtn.setAttribute('aria-label',
        mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    }
    var accent = root.getAttribute('data-accent') || 'signal';
    sws.forEach(function (s) {
      s.setAttribute('aria-checked', s.dataset.accent === accent ? 'true' : 'false');
    });
    themeChanged();
  }

  if (modeBtn) modeBtn.addEventListener('click', function () {
    var next = liveMode() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    store('ss-mode', next);
    paint();
  });

  sws.forEach(function (s) {
    s.addEventListener('click', function () {
      var a = s.dataset.accent;
      if (a === 'signal') root.removeAttribute('data-accent');
      else root.setAttribute('data-accent', a);
      store('ss-accent', a);
      paint();
    });
  });

  /* follow the system only while the visitor has not chosen for themselves */
  sysLight.addEventListener('change', function () {
    if (!root.getAttribute('data-theme')) paint();
  });

  paint();
})();

/* ---------- the cursor streak ----------
   Ink, not a tail. The first attempt was a chain of points each chasing the
   one ahead, and a chain has a fixed length and straightens out the moment
   you move quickly, so it read as a rigid stick being dragged around. This
   keeps the path the pointer actually travelled and lets each sample fade
   out with age, which is what makes a line look drawn: it curves where you
   curved, it runs long when you move fast and stays short when you do not,
   and it tapers to nothing at both ends instead of stopping dead.

   Three things keep it honest. It only exists on a fine pointer that can
   hover, because a finger has no cursor to trail. Reduced motion switches it
   off in CSS, and the module never starts. And the loop stops as soon as the
   last sample has aged out, so an idle page runs no animation frames. */
(function streak() {
  var cv = document.getElementById('streak');
  if (!cv || !cv.getContext) return;

  var fine  = matchMedia('(hover: hover) and (pointer: fine)');
  var still = matchMedia('(prefers-reduced-motion: reduce)');
  var ctx = cv.getContext('2d');

  var LIFE = 0.46;        /* seconds a sample survives: the length of the stroke */
  var WIDE = 5.0;         /* widest the nib ever gets */
  var MINSTEP = 0.7;      /* px between samples, so a still pointer records nothing */

  var pts = [];           /* {x, y, t} along the path actually travelled */
  var mx = 0, my = 0, lx = 0, ly = 0;
  var armed = false, raf = null, last = 0, dpr = 1;
  /* one shared source for the palette; this used to parse --accent as hex,
     which stopped being a hex the moment the themes arrived */
  var rgb = theme.accent;

  /* This canvas used to be the whole viewport, fixed on top of the page, and
     that was the cost: not the clearing and not the drawing, which measure at
     nothing, but compositing a full screen translucent layer over everything
     else on every frame the pointer moved. On a 1710x1107 retina screen it
     blew the frame budget on a fifth to a quarter of the intro's frames, and
     it never appeared in a single measurement I took because a parked pointer
     leaves this module asleep and every test I wrote parked the pointer.
     Proof it is the compositing: at opacity 0, still drawing every frame, the
     cost vanishes; at one device pixel per CSS pixel, still visible, it does
     not move at all.

     So the canvas is only as big as the ribbon now, and it is moved to wherever
     the ribbon is. Its size is quantised so that it is not reallocated every
     frame, and page coordinates still work inside it because the offset is
     folded into the context transform. */
  var G = 128;                       /* the grid the window snaps to */
  var box = null;

  function place(b) {
    var x = Math.max(0, Math.floor(b.x / G) * G);
    var y = Math.max(0, Math.floor(b.y / G) * G);
    var w = Math.min(innerWidth  - x, Math.ceil((b.x + b.w - x) / G) * G);
    var h = Math.min(innerHeight - y, Math.ceil((b.y + b.h - y) / G) * G);
    w = Math.max(G, w); h = Math.max(G, h);
    if (!box || box.x !== x || box.y !== y || box.w !== w || box.h !== h) {
      box = { x: x, y: y, w: w, h: h };
      cv.style.width  = w + 'px';
      cv.style.height = h + 'px';
      cv.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      cv.width  = Math.round(w * dpr);          /* this also blanks the buffer */
      cv.height = Math.round(h * dpr);
    }
    /* page coordinates in, window pixels out */
    ctx.setTransform(dpr, 0, 0, dpr, -box.x * dpr, -box.y * dpr);
    cv.classList.remove('rest');
  }

  /* Dropping the layer is enough to make it invisible, but the buffer keeps
     whatever was last drawn into it. Clear it too, so "resting" means empty
     rather than merely hidden. */
  function hide() {
    if (box) ctx.clearRect(box.x, box.y, box.w, box.h);
    cv.classList.add('rest');
    box = null;
  }

  function size() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    box = null;                        /* remeasure against the new viewport */
    hide();
  }

  /* Catmull-Rom through the recorded samples. Raw pointer events arrive at
     uneven spacing and a polyline through them shows every one of its corners;
     interpolating turns the same samples into a curve. */
  function spline(p0, p1, p2, p3, u) {
    var u2 = u * u, u3 = u2 * u;
    return [
      0.5 * ((2 * p1.x) + (-p0.x + p2.x) * u +
             (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 +
             (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3),
      0.5 * ((2 * p1.y) + (-p0.y + p2.y) * u +
             (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 +
             (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3)
    ];
  }

  function build(now) {
    var n = pts.length, out = [];
    if (n < 2) return out;
    for (var i = 0; i < n - 1; i++) {
      var p0 = pts[i > 0 ? i - 1 : 0], p1 = pts[i], p2 = pts[i + 1];
      var p3 = pts[i + 2 < n ? i + 2 : n - 1];
      var seg = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      var steps = Math.max(1, Math.min(8, Math.round(seg / 3)));
      for (var s = 0; s < steps; s++) {
        var u = s / steps;
        var q = spline(p0, p1, p2, p3, u);
        var t = p1.t + (p2.t - p1.t) * u;
        out.push({ x: q[0], y: q[1],
                   a: Math.min(1, Math.max(0, (now - t) / LIFE)),   /* 0 nib, 1 gone */
                   v: seg / Math.max(1e-3, p2.t - p1.t) });
      }
    }
    out.push({ x: pts[n - 1].x, y: pts[n - 1].y, a: 0, v: out.length ? out[out.length - 1].v : 0 });
    return out;
  }

  function draw(now) {
    var P = build(now);
    var n = P.length;
    if (n < 3) { hide(); return; }

    /* Width: widest at the nib, to nothing at the tail, and thinner the
       faster it was travelling, the way a real stroke lays down less ink
       when it is moving. The last few samples ease down too, so the head
       reads as a nib rather than a cut end. */
    var W = new Array(n);
    for (var i = 0; i < n; i++) {
      var age = 1 - P[i].a;
      var fast = 1 / (1 + P[i].v / 1400);
      var cap  = Math.min(1, (n - 1 - i) / 3 * 0.55 + 0.45);
      W[i] = WIDE * Math.pow(age, 0.7) * (0.55 + 0.45 * fast) * cap;
    }

    /* the ribbon's own box, plus its widest half-width and the nib's shadow */
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (i = 0; i < n; i++) {
      var m = W[i] + 16;
      if (P[i].x - m < x0) x0 = P[i].x - m;
      if (P[i].x + m > x1) x1 = P[i].x + m;
      if (P[i].y - m < y0) y0 = P[i].y - m;
      if (P[i].y + m > y1) y1 = P[i].y + m;
    }
    place({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    ctx.clearRect(box.x, box.y, box.w, box.h);

    ctx.beginPath();
    for (i = 0; i < n; i++) {                       /* down one edge */
      var d = norm(P, i);
      var x = P[i].x + d[0] * W[i], y = P[i].y + d[1] * W[i];
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (i = n - 1; i >= 0; i--) {                  /* and back up the other */
      var e = norm(P, i);
      ctx.lineTo(P[i].x - e[0] * W[i], P[i].y - e[1] * W[i]);
    }
    ctx.closePath();

    /* white at the nib, cooling to the accent and out: the same language as
       the drawing head on the mark */
    var g = ctx.createLinearGradient(P[n - 1].x, P[n - 1].y, P[0].x, P[0].y);
    g.addColorStop(0,    'rgba(' + theme.ink + ',0.92)');
    g.addColorStop(0.22, 'rgba(' + rgb + ',0.66)');
    g.addColorStop(1,    'rgba(' + rgb + ',0)');
    ctx.fillStyle = g;
    ctx.fill();

    /* the nib itself, rounding off the leading end */
    ctx.shadowColor = 'rgba(' + rgb + ',0.85)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(' + theme.ink + ',0.92)';
    ctx.beginPath();
    ctx.arc(P[n - 1].x, P[n - 1].y, Math.max(1.1, W[n - 1] * 0.92), 0, 6.2832);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  /* unit normal at i, from the direction of its neighbours */
  function norm(P, i) {
    var a = P[i > 0 ? i - 1 : 0], b = P[i + 1 < P.length ? i + 1 : P.length - 1];
    var dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    if (L < 1e-4) return [0, 0];
    return [-dy / L, dx / L];
  }

  function tick(ms) {
    var now = ms / 1000;
    var dt = Math.min(0.064, now - (last || now));
    last = now;

    /* a lead point eases toward the cursor before anything is recorded, so
       the jitter in raw pointer samples never reaches the line */
    var k = 1 - Math.pow(1 - 0.5, dt * 60);
    lx += (mx - lx) * k;
    ly += (my - ly) * k;

    var tip = pts[pts.length - 1];
    if (!tip || Math.hypot(lx - tip.x, ly - tip.y) >= MINSTEP) pts.push({ x: lx, y: ly, t: now });

    while (pts.length && now - pts[0].t > LIFE) pts.shift();   /* ink dries from the tail */

    draw(now);

    /* Rest only once the ink has fully dried AND the lead has caught the
       cursor. Testing pts.length alone stopped the loop on its very first
       frame, when the history held a single sample and had not had a chance
       to grow. */
    var live = !introHolds && (pts.length > 0 || Math.hypot(mx - lx, my - ly) > 0.5);
    if (!live) {
      hide(); raf = null; last = 0;
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function onMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    /* the intro owns the screen while it plays: it is two seconds, the page is
       held, and a second moving line is both a cost and a distraction */
    if (introHolds) { mx = e.clientX; my = e.clientY; armed = false; return; }
    /* a live game board owns the pointer, and the ball is the thing to watch */
    if (e.target && e.target.closest && e.target.closest('.game-frame')) return;
    mx = e.clientX; my = e.clientY;
    if (!armed) { armed = true; lx = mx; ly = my; }
    if (raf === null) { last = 0; raf = requestAnimationFrame(tick); }
  }

  function start() {
    if (!fine.matches || still.matches) return;
    rgb = theme.accent; size();
    addEventListener('pointermove', onMove, { passive: true });
    addEventListener('resize', size);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && raf !== null) {
        cancelAnimationFrame(raf); raf = null; pts.length = 0;
        hide();
      }
    });
  }

  start();
  fine.addEventListener('change', function () { if (fine.matches) start(); });
  onTheme(function () { rgb = theme.accent; });
})();

/* ---------- the work list ----------
   The cards are real markup in index.html, not something JavaScript has to
   build. The old version fetched first and rendered second, which meant a
   rate limited GitHub, an offline visitor, or any page that blocks the API
   got an apology card where the work should be. Now the work is always
   there and the fetch only refreshes what genuinely goes stale: the date,
   the language, the star count. If it fails, nothing changes.            */
(function repos() {
  var host = document.getElementById('repos');
  if (!host) return;

  var cards = {};
  [].forEach.call(host.querySelectorAll('.repo'), function (el) {
    cards[el.dataset.repo] = el;
  });
  if (!Object.keys(cards).length) return;

  function set(el, field, text, show) {
    var node = el.querySelector('[data-f="' + field + '"]');
    if (!node) return;
    if (!show) { node.hidden = true; return; }
    node.textContent = text;
    node.hidden = false;
  }

  fetch('https://api.github.com/users/Shaj2x/repos?per_page=100')
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      data.forEach(function (r) {
        var el = cards[r.name];
        if (!el) return;
        var when = new Date(r.pushed_at || r.updated_at)
          .toLocaleDateString('en-CA', { year: 'numeric', month: 'short' });
        set(el, 'when', when, true);
        set(el, 'lang', r.language || '', !!r.language);
        set(el, 'stars', r.stargazers_count + (r.stargazers_count === 1 ? ' star' : ' stars'),
            r.stargazers_count > 0);
      });
    })
    .catch(function () { /* the page already says the truth without this */ });
})();

/* ---------- FAQ: an accordion that does not snap ----------
   <details> toggles instantly by default, which is the most obviously
   unfinished moment on the page. Height is measured in JS rather than
   animated to auto, and kept short because it costs layout every frame. */
(function faq() {
  var items = [].slice.call(document.querySelectorAll('.faq details'));
  if (!items.length) return;
  var DUR = 200;

  items.forEach(function (d) {
    var ans = d.querySelector('.ans');
    var inner = d.querySelector('.ans-in');
    if (!ans || !inner) return;
    var busy = false;

    function setH(v) { ans.style.height = v; }

    d.addEventListener('toggle', function () {
      /* keep the DOM state and the animation in step if something else
         toggles it (a hash link, find-in-page opening a match) */
      if (busy) return;
      setH(d.open ? inner.offsetHeight + 'px' : '0px');
      if (d.open) setTimeout(function () { if (d.open) setH('auto'); }, DUR);
    });

    d.querySelector('summary').addEventListener('click', function (e) {
      e.preventDefault();
      if (busy) return;
      busy = true;

      if (reduceMQ.matches) {            /* gentler: no height animation */
        d.open = !d.open;
        setH(d.open ? 'auto' : '0px');
        busy = false;
        return;
      }

      if (!d.open) {
        d.open = true;
        setH('0px');
        requestAnimationFrame(function () { setH(inner.offsetHeight + 'px'); });
        setTimeout(function () { setH('auto'); busy = false; }, DUR);
      } else {
        setH(inner.offsetHeight + 'px');
        requestAnimationFrame(function () { setH('0px'); });
        setTimeout(function () { d.open = false; busy = false; }, DUR);
      }
    });
  });
})();

/* ---------- the form ----------
   Static site, so there is no backend. This opens the visitor's own email
   app with the message ready to send, and the note under the button says so. */
(function form() {
  var f = document.getElementById('form');
  if (!f) return;

  var done = document.createElement('div');
  done.className = 'form-done';
  done.innerHTML = '<p><strong>Your email app should be open.</strong></p>' +
    '<p style="margin-top:8px;color:var(--text-secondary);font-size:.92rem">' +
    'If nothing happened, write to ' +
    '<a href="mailto:shajithskumar@gmail.com" style="color:var(--accent)">shajithskumar@gmail.com</a> directly.</p>';
  f.appendChild(done);

  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = f.querySelector('#f-name').value.trim();
    var email = f.querySelector('#f-email').value.trim();
    var msg = f.querySelector('#f-msg').value.trim();
    var body = 'From: ' + name + ' (' + email + ')\n\n' + msg;
    window.location.href = 'mailto:shajithskumar@gmail.com' +
      '?subject=' + encodeURIComponent('Website enquiry from ' + name) +
      '&body=' + encodeURIComponent(body);
    f.classList.add('sent');
  });
})();


/* ---------- scroll progress ----------
   Purpose: state indication. It is the only readout of how far through a very
   tall page you are, and it is cheap: one transform write, throttled. */
(function progress() {
  var bar = document.getElementById('prog');
  if (!bar) return;
  var last = -1, queued = false;
  function paint() {
    queued = false;
    var h = document.documentElement.scrollHeight - window.innerHeight;
    var p = h > 0 ? clamp(window.scrollY / h, 0, 1) : 0;
    if (Math.abs(p - last) < 0.002) return;
    last = p;
    bar.style.setProperty('--p', p.toFixed(4));
  }
  window.addEventListener('scroll', function () {
    if (!queued) { queued = true; requestAnimationFrame(paint); }
  }, { passive: true });
  window.addEventListener('resize', paint);
  paint();
})();

/* ---------- in-page navigation ----------
   Jumping from the hero to a section below it used to skip the entire draw in
   one frame, which read as the page breaking. A wipe covers the jump so it
   lands as a deliberate cut. Purpose: preventing a jarring change. */
(function wipeNav() {
  var wipe = document.getElementById('wipe');
  if (!wipe) return;
  var busy = false;

  function jump(el) {
    /* Settle first, then move. The intro holds the page while it plays, so
       jumping before releasing that hold would scroll nothing at all, and
       it also leaves the mark finished rather than stranded half drawn
       above a visitor who has moved on. */
    if (typeof settleIntro === 'function') settleIntro();
    var y = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: y, behavior: 'instant' });
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href').slice(1);
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) return;

    e.preventDefault();
    if (history.replaceState) history.replaceState(null, '', '#' + id);

    if (reduceMQ.matches) { jump(el); el.focus && el.focus({ preventScroll: true }); return; }
    if (busy) return;
    busy = true;

    wipe.classList.remove('out');
    wipe.classList.add('in');
    setTimeout(function () {
      jump(el);
      requestAnimationFrame(function () {
        wipe.classList.remove('in');
        wipe.classList.add('out');
        setTimeout(function () { wipe.classList.remove('out'); busy = false; }, 430);
      });
    }, 290);
  });
})();

/* ---------- the games ----------
   Ported from the previous site. Same rules, same speeds, same win condition,
   now without a framework. Both idle until asked: no loop runs before the
   first press, and both stop the moment the tab is hidden. */
(function games() {
  var tabs   = [].slice.call(document.querySelectorAll('.game-tab'));
  var panels = { pong:  document.getElementById('panel-pong'),
                 snake: document.getElementById('panel-snake'),
                 time:  document.getElementById('panel-time'),
                 lift:  document.getElementById('panel-lift') };
  if (!tabs.length) return;

  function paintTokens() {
    var cs = getComputedStyle(document.documentElement);
    var v = function (n, f) { return (cs.getPropertyValue(n) || '').trim() || f; };
    return { ground: v('--canvas', '#0B0D10'), line: v('--line', '#1E242C'),
             bright: v('--line-bright', '#2E3742'), text: v('--text-primary', '#EEF2F6'),
             dim: v('--text-dim', '#5D6773'), mark: v('--accent', '#9FD8FF'),
             font: "'Sora', system-ui, sans-serif" };
  }

  /* The ball is the mark itself, drawn as vector rather than blitted from
     the PNG. The PNG is a white glyph on black and 96% of it is black, so
     painted onto a near black board the ball all but vanished: most of why
     the game felt broken. Drawing the paths lets the stroke be set heavy
     enough to read at 26px, which a scaled down bitmap never could. */
  var MARK_VB = { x: 292, y: 256, w: 426, h: 496 };
  var markPaths = null;
  function markGeometry() {
    if (markPaths !== null) return markPaths;
    markPaths = [];
    if (typeof Path2D === 'function') {
      var src = document.querySelector('.hero-mark, .static-mark');
      if (src) [].forEach.call(src.querySelectorAll('path'), function (p) {
        try { markPaths.push(new Path2D(p.getAttribute('d'))); } catch (e) {}
      });
    }
    return markPaths;
  }

  /* Draws the monogram centred on x,y, sized to fit r, at the given angle. */
  function drawMark(ctx, x, y, r, colour, spin, weight) {
    var g = markGeometry();
    var span = Math.max(MARK_VB.w, MARK_VB.h);
    if (!g.length) {                                   /* no Path2D: a disc still plays */
      ctx.fillStyle = colour;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    if (spin) ctx.rotate(spin);
    ctx.scale(r * 2 / span, r * 2 / span);
    ctx.translate(-(MARK_VB.x + MARK_VB.w / 2), -(MARK_VB.y + MARK_VB.h / 2));
    ctx.strokeStyle = colour;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = weight || 70;                      /* heavy, so it reads small */
    for (var i = 0; i < g.length; i++) ctx.stroke(g[i]);
    ctx.restore();
  }

  /* Whichever game is on screen and running. Everything that can take the
     player's attention away, switching tabs, scrolling past, hiding the
     window, goes through pause() so a game is never simulating, and never
     swallowing arrow keys, while nobody is looking at it. */
  var live = null, repaint = [];
  function claim(g) { if (live && live !== g) live.pause(); live = g; }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && live) live.pause();
  });

  /* ---- Pong ----
     Everything below is in pixels per second and stepped at a fixed 120Hz,
     so the game plays identically on a 60Hz laptop and a 120Hz phone. The
     old build moved the ball a fixed amount per frame, which made it run at
     double speed on a high refresh display. */
  (function pong() {
    var cv = document.getElementById('pong'); if (!cv) return;
    var ctx = cv.getContext('2d');
    var W = 600, H = 400, PW = 12, PH = 76, R = 15, INSET = 12, WIN = 5;
    var PADDLE_V = 470, CPU_V = 300, SERVE_V = 330, MAX_V = 640, STEP = 1 / 120;

    var over    = document.getElementById('pong-over'),
        result  = document.getElementById('pong-result'),
        scoreEl = document.getElementById('pong-score'),
        startBtn= document.getElementById('pong-start');

    var g = null, raf = null, keys = {}, acc = 0, last = 0, state = 'idle';
    var pointerY = null;

    function fresh() {
      return { py: H / 2 - PH / 2, cy: H / 2 - PH / 2, ps: 0, cs: 0,
               bx: W / 2, by: H / 2, vx: 0, vy: 0, wait: 0, rally: 0, bias: 0, spin: 0 };
    }

    function serve(toward) {
      g.bx = W / 2; g.by = H / 2;
      var ang = (Math.random() - 0.5) * 0.7;          /* never a flat serve */
      g.vx = Math.cos(ang) * SERVE_V * toward;
      g.vy = Math.sin(ang) * SERVE_V;
      g.wait = 0.85;                                   /* a beat before it moves */
      g.rally = 0;
      g.bias = (Math.random() - 0.5) * 96;             /* this rally's CPU error */
    }

    function score() { scoreEl.textContent = 'You ' + g.ps + ' · CPU ' + g.cs; }

    /* one 1/120s slice of physics */
    function step(dt) {
      var held = g.wait > 0;                 /* the ball waits, the paddles do not */
      if (held) g.wait -= dt;

      /* --- player paddle: pointer wins if the pointer is on the board --- */
      var want = null;
      if (pointerY !== null) want = pointerY - PH / 2;
      else {
        var dir = (keys.up ? -1 : 0) + (keys.down ? 1 : 0);
        if (dir) want = g.py + dir * PADDLE_V * dt;
      }
      if (want !== null) {
        /* capped, so a flicked mouse cannot teleport the paddle onto the ball */
        var limit = PADDLE_V * dt;
        g.py += clamp(want - g.py, -limit, limit);
        g.py = clamp(g.py, 0, H - PH);
      }

      /* --- CPU: it does not read the ball until the ball has crossed into
             its half, it aims at a point offset by this rally's error, and it
             is a shade slower than the player. Beatable if you move, punishing
             if you do not. --- */
      var reading = g.vx > 0 && g.bx > W * 0.42;
      var aim = reading ? g.by + g.bias : H / 2;
      var d = aim - (g.cy + PH / 2);
      if (Math.abs(d) > 14) g.cy += clamp(d, -CPU_V * dt, CPU_V * dt);
      g.cy = clamp(g.cy, 0, H - PH);

      /* --- ball --- */
      if (held) return;
      g.spin += g.vx * dt * 0.0035;        /* rolls the way it travels */
      g.bx += g.vx * dt;
      g.by += g.vy * dt;

      if (g.by - R < 0)     { g.by = R;     g.vy = Math.abs(g.vy); }
      if (g.by + R > H)     { g.by = H - R; g.vy = -Math.abs(g.vy); }

      hit(INSET + PW, g.py, 1);        /* player face, ball must be moving left */
      hit(W - INSET - PW, g.cy, -1);   /* cpu face */

      if (g.bx + R < 0)      { g.cs++; score(); if (g.cs >= WIN) return finish('CPU wins'); serve(1); }
      else if (g.bx - R > W) { g.ps++; score(); if (g.ps >= WIN) return finish('You win'); serve(-1); }
    }

    /* Resolves against a paddle face and pushes the ball clear, so it can
       never end a step inside the paddle and rattle there. */
    function hit(faceX, top, side) {
      if (side > 0) { if (g.vx >= 0 || g.bx - R > faceX) return; }
      else          { if (g.vx <= 0 || g.bx + R < faceX) return; }
      if (side > 0 && g.bx + R < faceX - PW) return;
      if (side < 0 && g.bx - R > faceX + PW) return;
      if (g.by + R < top || g.by - R > top + PH) return;

      g.bx = faceX + side * R;
      g.rally++;
      /* where it lands on the paddle sets the angle, the way real Pong does */
      var rel = clamp((g.by - (top + PH / 2)) / (PH / 2), -1, 1);
      var ang = rel * 0.95;                                /* up to ~54 degrees */
      var sp  = Math.min(MAX_V, Math.hypot(g.vx, g.vy) * 1.045 + 8);
      g.vx = Math.cos(ang) * sp * side;
      g.vy = Math.sin(ang) * sp;
      if (side > 0) g.bias = (Math.random() - 0.5) * Math.max(46, 96 - g.rally * 5);
    }

    function draw() {
      var t = paintTokens();
      ctx.fillStyle = t.ground; ctx.fillRect(0, 0, W, H);
      ctx.setLineDash([8, 8]); ctx.strokeStyle = t.line; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke(); ctx.setLineDash([]);

      ctx.fillStyle = t.dim; ctx.font = 'bold 48px ' + t.font; ctx.textAlign = 'center';
      ctx.fillText(String(g.ps), W / 4, 62); ctx.fillText(String(g.cs), 3 * W / 4, 62);

      ctx.fillStyle = t.mark;
      round(INSET, g.py, PW, PH); round(W - INSET - PW, g.cy, PW, PH);

      /* the ball dims while it waits to be served, so the pause reads as one */
      ctx.globalAlpha = g.wait > 0 ? 0.5 : 1;
      ctx.save();
      ctx.shadowColor = t.mark; ctx.shadowBlur = 24 * theme.glow;
      drawMark(ctx, g.bx, g.by, R, t.mark, g.spin);
      ctx.shadowBlur = 0;
      drawMark(ctx, g.bx, g.by, R, t.mark, g.spin);   /* twice: the glow, then the line */
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    function round(x, y, w, h) {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, 6); else ctx.rect(x, y, w, h);
      ctx.fill();
    }

    function frame(now) {
      if (state !== 'running') { raf = null; return; }
      var dt = Math.min(0.1, (now - (last || now)) / 1000);
      last = now;
      acc += dt;
      var budget = 30;                     /* never let a stalled tab fast forward */
      while (acc >= STEP && budget-- > 0) { acc -= STEP; step(STEP); if (state !== 'running') break; }
      if (acc > STEP) acc = 0;
      draw();
      raf = (state === 'running') ? requestAnimationFrame(frame) : null;
    }

    function run() {
      state = 'running'; claim(api);
      over.hidden = true;
      cv.classList.add('playing');
      last = 0; acc = 0;
      if (raf === null) raf = requestAnimationFrame(frame);
    }

    function halt() {
      state = 'idle';
      if (raf) cancelAnimationFrame(raf);
      raf = null; keys = {};
      if (live === api) live = null;
      cv.classList.remove('playing');
    }

    function finish(msg) {
      halt();
      result.textContent = msg;
      startBtn.textContent = 'Play again';
      over.hidden = false;
      draw();
    }

    var api = {
      pause: function () {
        if (state !== 'running') return;
        halt();
        state = 'paused';
        result.textContent = 'Paused';
        startBtn.textContent = 'Resume';
        over.hidden = false;
        draw();
      }
    };

    startBtn.addEventListener('click', function () {
      if (state === 'paused') { run(); return; }   /* resume keeps the score */
      g = fresh(); score(); serve(Math.random() > 0.5 ? 1 : -1);
      result.textContent = '';
      run();
    });

    /* --- pointer: the natural way to play Pong, and the only way on a phone --- */
    function toBoard(e) {
      var r = cv.getBoundingClientRect();
      return (e.clientY - r.top) * (H / r.height);
    }
    cv.addEventListener('pointerdown', function (e) {
      if (state !== 'running') return;
      cv.setPointerCapture(e.pointerId); pointerY = clamp(toBoard(e), 0, H); e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      if (state !== 'running') return;
      pointerY = clamp(toBoard(e), 0, H);
      if (e.pointerType !== 'mouse') e.preventDefault();
    });
    /* A finger stops existing the moment it lifts, and the browser fires
       pointerleave with it. Clearing the target there would park the paddle
       after every tap, so only a mouse actually leaving the board hands
       control back to the keyboard. */
    cv.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'mouse') pointerY = null;
    });
    cv.addEventListener('pointercancel', function (e) {
      if (e.pointerType === 'mouse') pointerY = null;
    });

    /* --- keyboard: only claims the arrow keys while it is actually running,
           so the rest of the page can still be scrolled with them --- */
    var K = { ArrowUp: 'up', ArrowDown: 'down', w: 'up', s: 'down', W: 'up', S: 'down' };
    window.addEventListener('keydown', function (e) {
      if (state !== 'running') return;
      var k = K[e.key]; if (!k) return;
      e.preventDefault(); keys[k] = true; pointerY = null;
    });
    window.addEventListener('keyup', function (e) {
      var k = K[e.key]; if (k) keys[k] = false;
    });

    g = fresh(); score(); draw();
    repaint.push(draw);
  })();

  /* ---- Snake ---- */
  (function snake() {
    var cv = document.getElementById('snake'); if (!cv) return;
    var ctx = cv.getContext('2d');
    var W = 600, H = 400, CELL = 20, COLS = W / CELL, ROWS = H / CELL, TICK = 120;
    var over = document.getElementById('snake-over'), result = document.getElementById('snake-result'),
        scoreEl = document.getElementById('snake-score'), startBtn = document.getElementById('snake-start');
    var s, timer = null, best = 0, running = false, api;

    function food(body) {
      var pt;
      do { pt = { x: (Math.random() * COLS) | 0, y: (Math.random() * ROWS) | 0 }; }
      while (body.some(function (b) { return b.x === pt.x && b.y === pt.y; }));
      return pt;
    }

    function draw() {
      var t = paintTokens();
      ctx.fillStyle = t.ground; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = t.line;
      for (var x = 0; x < COLS; x++) for (var y = 0; y < ROWS; y++)
        ctx.fillRect(x * CELL + CELL / 2, y * CELL + CELL / 2, 1, 1);

      ctx.save();
      ctx.shadowColor = t.mark; ctx.shadowBlur = 14 * theme.glow;
      drawMark(ctx, s.food.x * CELL + CELL / 2, s.food.y * CELL + CELL / 2, CELL / 2, t.mark, 0);
      ctx.restore();

      s.body.forEach(function (seg, i) {
        ctx.globalAlpha = 1 - (i / s.body.length) * 0.6;
        ctx.fillStyle = t.mark;
        var pad = i === 0 ? 0 : 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(seg.x * CELL + pad, seg.y * CELL + pad, CELL - pad * 2, CELL - pad * 2, 4);
        else ctx.rect(seg.x * CELL + pad, seg.y * CELL + pad, CELL - pad * 2, CELL - pad * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    function stop(msg) {
      running = false;
      clearInterval(timer); timer = null;
      if (live === api) live = null;
      best = Math.max(best, s.score);
      scoreEl.textContent = 'Score ' + s.score + ' · Best ' + best;
      result.textContent = msg || '';
      over.hidden = false;
      startBtn.textContent = msg ? 'Play again' : 'Start game';
    }

    function tick() {
      s.dir = s.next;
      var head = { x: s.body[0].x, y: s.body[0].y };
      if (s.dir === 'UP') head.y--; else if (s.dir === 'DOWN') head.y++;
      else if (s.dir === 'LEFT') head.x--; else head.x++;

      if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS ||
          s.body.some(function (b) { return b.x === head.x && b.y === head.y; })) {
        draw(); return stop('Game over');
      }
      s.body.unshift(head);
      if (head.x === s.food.x && head.y === s.food.y) {
        s.score++; s.food = food(s.body);
        scoreEl.textContent = 'Score ' + s.score + ' · Best ' + Math.max(best, s.score);
      } else s.body.pop();
      draw();
    }

    function start() {
      s = { body: [{ x: 5, y: ROWS >> 1 }], dir: 'RIGHT', next: 'RIGHT',
            food: { x: 15, y: ROWS >> 1 }, score: 0 };
      scoreEl.textContent = 'Score 0 · Best ' + best;
      over.hidden = true; running = true; claim(api);
      clearInterval(timer); timer = setInterval(tick, TICK);
      draw();
    }

    var MAP = { ArrowUp: 'UP', w: 'UP', ArrowDown: 'DOWN', s: 'DOWN',
                ArrowLeft: 'LEFT', a: 'LEFT', ArrowRight: 'RIGHT', d: 'RIGHT' };
    var OPP = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };

    startBtn.addEventListener('click', start);
    window.addEventListener('keydown', function (e) {
      if (!running) return;
      var dir = MAP[e.key];
      if (!dir) return;
      e.preventDefault();
      if (dir !== OPP[s.dir]) s.next = dir;
    });
    api = { pause: function () { if (running) stop('Paused'); } };
    s = { body: [{ x: 5, y: ROWS >> 1 }], dir: 'RIGHT', next: 'RIGHT', food: { x: 15, y: ROWS >> 1 }, score: 0 };
    draw();
    repaint.push(draw);
  })();

  /* ---- Updraft ----
     One button, and the mark is the thing you are flying: it tilts with its
     own velocity, so the glyph reads as nose up under lift and nose down in
     a dive. Two more uses, both behind the play rather than over it: huge
     faint marks drift past as the landscape, and a small one sits centred in
     every gap, which turns the logo into the thing you aim through instead
     of decoration laid on top. The gates themselves are plain rounded bars,
     because an obstacle has to be read instantly and a logo shaped one
     cannot be. */
  (function updraft() {
    var cv = document.getElementById('lift'); if (!cv) return;
    var ctx = cv.getContext('2d');
    var W = 600, H = 400, STEP = 1 / 120;
    var R = 15, PX = 150;                    /* the flyer's radius and fixed x */
    var GRAV = 1250, FLAP = -392, MAXFALL = 620;
    var BARW = 46;
    var SKYGAP = 560;                        /* one background mark on screen at a time */
    var over = document.getElementById('lift-over'),
        result = document.getElementById('lift-result'),
        startBtn = document.getElementById('lift-start'),
        scoreEl = document.getElementById('lift-score');
    var KEY = 'ss-updraft-best';

    var g = null, raf = null, acc = 0, last = 0, state = 'idle';
    var best = load();

    function load() {
      try { var v = parseInt(localStorage.getItem(KEY), 10); return v > 0 ? v : 0; }
      catch (e) { return 0; }
    }
    function save(v) { try { localStorage.setItem(KEY, String(v)); } catch (e) {} }

    /* difficulty: the gap closes and the world speeds up, both to a floor */
    function gap(n)   { return Math.max(112, 152 - n * 2.2); }
    function speed(n) { return Math.min(268, 156 + n * 3.4); }
    function spacing(n) { return Math.max(196, 236 - n * 1.6); }

    /* The landscape is the mark itself, upright and far away. Two of them,
       spaced wider than the board, so one stands clear at a time: rotated
       and overlapping they stop reading as a letter and become scribble. */
    function fresh() {
      var sky = [{ x: 300, y: skyY(), r: skyR() },
                 { x: 300 + SKYGAP, y: skyY(), r: skyR() }];
      return { y: H / 2, vy: 0, score: 0, gates: [], trail: [], sky: sky, dead: 0 };
    }
    function skyY() { return 150 + Math.random() * 110; }
    function skyR() { return 78 + Math.random() * 26; }

    function addGate(at) {
      var gp = gap(g.score);
      var top = 42 + Math.random() * (H - gp - 104);
      g.gates.push({ x: at == null ? W + BARW : at, top: top, gap: gp, passed: false });
    }

    function flap() {
      if (state === 'idle') { start(); return; }
      if (state !== 'running') return;
      g.vy = FLAP;
    }

    function step(dt) {
      g.vy = Math.min(MAXFALL, g.vy + GRAV * dt);
      g.y += g.vy * dt;

      var v = speed(g.score);
      for (var i = g.gates.length - 1; i >= 0; i--) {
        var q = g.gates[i];
        q.x -= v * dt;
        if (!q.passed && q.x + BARW < PX - R) { q.passed = true; g.score++; score(); }
        if (q.x + BARW < -20) g.gates.splice(i, 1);
      }
      for (i = 0; i < g.sky.length; i++) {
        g.sky[i].x -= v * 0.22 * dt;
        if (g.sky[i].x < -200) {
          var far = Math.max(g.sky[0].x, g.sky[1].x);
          g.sky[i].x = far + SKYGAP; g.sky[i].y = skyY(); g.sky[i].r = skyR();
        }
      }
      var lastGate = g.gates[g.gates.length - 1];
      if (!lastGate || lastGate.x < W - spacing(g.score)) addGate();

      g.trail.push({ x: PX, y: g.y });
      if (g.trail.length > 46) g.trail.shift();
      for (i = 0; i < g.trail.length; i++) g.trail[i].x -= v * dt;

      /* the ceiling is a wall you slide along, the floor is the end */
      if (g.y < R) { g.y = R; g.vy = 0; }
      if (g.y > H - R) { g.y = H - R; return die(); }
      if (hitGate()) return die();
    }

    /* circle against the two bars: forgiving, and forgiving is correct here
       because the flyer is drawn as a glyph rather than a solid disc */
    function hitGate() {
      for (var i = 0; i < g.gates.length; i++) {
        var q = g.gates[i];
        if (PX + R < q.x || PX - R > q.x + BARW) continue;
        var nx = Math.max(q.x, Math.min(PX, q.x + BARW));
        if (near(nx, Math.max(0, Math.min(g.y, q.top)))) return true;
        if (near(nx, Math.max(q.top + q.gap, Math.min(g.y, H)))) return true;
      }
      return false;
    }
    function near(x, y) {
      var dx = PX - x, dy = g.y - y;
      return dx * dx + dy * dy < R * R * 0.72;          /* a shade inside the glyph */
    }

    function score() {
      scoreEl.textContent = 'Score ' + g.score + ' \u00b7 Best ' + Math.max(best, g.score);
    }

    function draw() {
      var t = paintTokens();
      ctx.fillStyle = t.ground; ctx.fillRect(0, 0, W, H);

      /* the landscape: the mark, vast and nearly gone */
      ctx.globalAlpha = 0.055;
      for (var i = 0; i < g.sky.length; i++) {
        var s = g.sky[i];
        drawMark(ctx, s.x, s.y, s.r, t.text, 0, 40);
      }
      ctx.globalAlpha = 1;

      /* the gates */
      for (i = 0; i < g.gates.length; i++) {
        var q = g.gates[i];
        ctx.fillStyle = t.bright;
        bar(q.x, -30, BARW, q.top + 30);
        bar(q.x, q.top + q.gap, BARW, H - q.top - q.gap + 30);
        /* the gap's own rims, so the opening reads before the bars do */
        ctx.fillStyle = t.mark;
        bar(q.x, q.top - 4, BARW, 4);
        bar(q.x, q.top + q.gap, BARW, 4);
        /* and the mark you are aiming through, which fades out as the gate
           arrives: a sight at distance, out of the way once you are in it */
        ctx.globalAlpha = 0.15 * Math.max(0, Math.min(1, (q.x - PX) / 190));
        drawMark(ctx, q.x + BARW / 2, q.top + q.gap / 2, Math.min(26, q.gap * 0.3), t.mark, 0, 40);
        ctx.globalAlpha = 1;
      }

      /* the trail it leaves */
      if (g.trail.length > 2) {
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (i = 1; i < g.trail.length; i++) {
          var k = i / g.trail.length;
          ctx.globalAlpha = k * k * 0.5;
          ctx.strokeStyle = t.mark;
          ctx.lineWidth = 0.8 + k * 3.2;
          ctx.beginPath();
          ctx.moveTo(g.trail[i - 1].x, g.trail[i - 1].y);
          ctx.lineTo(g.trail[i].x, g.trail[i].y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      /* the flyer: the mark, tilted by what it is doing */
      var tilt = Math.max(-0.32, Math.min(0.62, g.vy / 780));
      ctx.save();
      ctx.shadowColor = t.mark; ctx.shadowBlur = 11 * theme.glow;
      ctx.globalAlpha = g.dead ? Math.max(0, 1 - g.dead * 2.4) : 1;
      drawMark(ctx, PX, g.y, R, t.mark, tilt, 54);
      ctx.restore();
      ctx.globalAlpha = 1;

      ctx.fillStyle = t.dim; ctx.font = 'bold 44px ' + t.font; ctx.textAlign = 'center';
      ctx.fillText(String(g.score), W / 2, 62);
    }

    function bar(x, y, w, h) {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, 7); else ctx.rect(x, y, w, h);
      ctx.fill();
    }

    function frame(now) {
      if (state !== 'running' && state !== 'dying') { raf = null; return; }
      var dt = Math.min(0.1, (now - (last || now)) / 1000);
      last = now;
      acc += dt;
      var budget = 30;
      while (acc >= STEP && budget-- > 0) {
        acc -= STEP;
        if (state === 'running') step(STEP);
        else { g.dead += STEP; if (g.dead > 0.42) { finish(); break; } }
        if (state === 'idle') break;
      }
      if (acc > STEP) acc = 0;
      draw();
      raf = (state === 'running' || state === 'dying') ? requestAnimationFrame(frame) : null;
    }

    function die() { if (state === 'running') { state = 'dying'; g.dead = 0; } }

    /* a run counts the moment it stops, however it stopped: walking away
       from a good run should not quietly throw the best away */
    function bank() {
      state = 'idle';
      if (raf) cancelAnimationFrame(raf); raf = null;
      if (live === api) live = null;
      cv.classList.remove('playing');
      var beat = g && g.score > best;
      if (beat) { best = g.score; save(best); }
      score();
      over.hidden = false;
      return beat;
    }

    function finish() {
      var beat = bank();
      result.textContent = beat ? 'New best, ' + g.score : (g.score ? g.score + ' through' : 'No gates');
      startBtn.textContent = 'Play again';
      draw();
    }

    function start() {
      g = fresh(); score();
      state = 'running'; claim(api);
      over.hidden = true; result.textContent = '';
      cv.classList.add('playing');
      last = 0; acc = 0;
      addGate(430);            /* close enough to be a runway, not a wait */
      if (raf === null) raf = requestAnimationFrame(frame);
    }

    var api = {
      pause: function () {
        if (state !== 'running' && state !== 'dying') return;
        var beat = bank();
        result.textContent = beat ? 'Paused, new best ' + g.score
                                  : (g.score ? 'Paused at ' + g.score : 'Paused');
        startBtn.textContent = 'Start game';
      }
    };

    startBtn.addEventListener('click', function () { start(); });
    cv.addEventListener('pointerdown', function (e) { e.preventDefault(); flap(); });

    /* Space only while this panel is the visible one, so it goes straight
       back to the page the moment you switch tabs. */
    var LIFT = { ' ': 1, Spacebar: 1, ArrowUp: 1, w: 1, W: 1 };
    window.addEventListener('keydown', function (e) {
      if (stagePanel().hidden || e.repeat || !LIFT[e.key]) return;
      if (state !== 'running' && state !== 'idle') return;
      e.preventDefault();
      flap();
    });
    function stagePanel() { return document.getElementById('panel-lift'); }

    repaint.push(function () { if (g) draw(); });
    /* the still board behind the start button is a real frame of the game,
       gate and all, so it reads as something to play rather than a blank */
    g = fresh(); addGate(430); score(); draw();
  })();

  /* ---- Time it ----
     A round is two presses. Between them nothing on screen moves, because
     anything that did would be the answer: no bar, no ticking readout, no
     pulse to count. The mark is the button you press, and afterwards it is
     the scoreboard, drawing itself as far as the round earned. */
  (function timeIt() {
    var stage = document.getElementById('panel-time'); if (!stage) return;
    var frame = stage.querySelector('.time-frame');
    var btn   = document.getElementById('time-btn');
    var label = document.getElementById('time-label');
    var targetEl = document.getElementById('t-target');
    var read  = document.getElementById('time-read');
    var A = document.getElementById('t-a'), B = document.getElementById('t-b'),
        C = document.getElementById('t-c'), V = document.getElementById('t-verdict');
    var scoreEl = document.getElementById('time-score');
    var markLive = stage.querySelector('.tmark-live'),
        ghost = stage.querySelector('.tmark-ghost');
    var stillMQ = matchMedia('(prefers-reduced-motion: reduce)');

    /* Targets land on quarter seconds. An arbitrary 7.42 is not really a
       timing test, it is a guess at the second decimal; 7.25 is something a
       person can actually aim at and feel. */
    var MIN = 0.25, MAX = 15, STEP = 0.25;
    var STEPS = Math.round((MAX - MIN) / STEP) + 1;
    /* the error at which the mark is left completely undrawn */
    var MISS = 1.2;
    var KEY = 'ss-timeit-best';

    var target = 0, t0 = 0, state = 'idle', rounds = 0, sessionBest = Infinity;
    var allTime = load();

    function load() {
      try { var v = parseFloat(localStorage.getItem(KEY)); return v > 0 ? v : Infinity; }
      catch (e) { return Infinity; }
    }
    function save(v) { try { localStorage.setItem(KEY, v.toFixed(4)); } catch (e) {} }

    /* how much of the mark a round earns: dead on fills it, MISS empties it */
    function earned(diff) {
      var f = 1 - diff / MISS;
      return f <= 0 ? 0 : (f >= 1 ? 1 : f * f * (3 - 2 * f));   /* eased, so near misses still read */
    }

    function paint(svg, fill) {
      [].forEach.call(svg.querySelectorAll('path'), function (p) {
        var len = p.getTotalLength();
        p.style.setProperty('--len', len.toFixed(1));
        p.style.setProperty('--off', (len * (1 - fill)).toFixed(1));
      });
    }

    function verdict(d) {
      if (d < 0.03) return 'Dead on.';
      if (d < 0.10) return 'Uncanny.';
      if (d < 0.25) return 'Sharp.';
      if (d < 0.50) return 'Close.';
      if (d < 1.00) return 'In the region.';
      if (d < 2.00) return 'Wide.';
      return 'Somewhere else entirely.';
    }

    function fmt(s) { return s.toFixed(2) + 's'; }

    function score() {
      var bits = [];
      bits.push(rounds ? 'Best this session ' + fmt(sessionBest) + ' off' : 'No rounds yet');
      if (allTime < Infinity) bits.push('All time ' + fmt(allTime) + ' off');
      scoreEl.textContent = bits.join(' \u00b7 ');
    }

    function arm() {
      state = 'idle';
      target = MIN + Math.floor(Math.random() * STEPS) * STEP;
      targetEl.firstChild.nodeValue = target.toFixed(2);
      label.textContent = 'Start timer';
      /* a beat on the number itself, so a new target is noticed rather than
         quietly swapped in under the same layout */
      targetEl.classList.remove('fresh');
      void targetEl.offsetWidth;
      targetEl.classList.add('fresh');
      frame.classList.remove('running');
      read.hidden = true; V.textContent = '';
      paint(markLive, 0);
    }

    function begin() {
      state = 'running';
      claim(api);
      label.textContent = 'Stop';
      frame.classList.add('running');
      read.hidden = true; V.textContent = '';
      paint(markLive, 0);
      t0 = performance.now();                 /* the clock starts on the press */
    }

    function stop() {
      if (state !== 'running') return;
      var actual = (performance.now() - t0) / 1000;
      state = 'done';
      var diff = Math.abs(actual - target);
      rounds++;
      if (diff < sessionBest) sessionBest = diff;
      if (diff < allTime) { allTime = diff; save(diff); paint(ghost, earned(diff)); }

      A.textContent = fmt(target);
      B.textContent = fmt(actual);
      C.textContent = (actual > target ? '+' : '\u2212') + fmt(diff).replace('s', '') + 's';
      V.textContent = verdict(diff);
      read.hidden = false;
      label.textContent = 'New target';
      frame.classList.remove('running');
      score();

      var f = earned(diff);
      if (stillMQ.matches) paint(markLive, f);
      else requestAnimationFrame(function () { paint(markLive, f); });
    }

    /* Three states, never two things in one press. Ending a round only
       draws the next target; starting the clock is a separate, deliberate
       press. Before, "Again" armed a new target and started timing in the
       same gesture, so every round after the first was timed against a
       number the player had not had a chance to read. */
    function press() {
      if (state === 'running') { stop(); return; }
      if (state === 'done')    { arm();  return; }
      begin();
    }

    var api = {
      /* switching away mid round cannot pause a clock meaningfully, so the
         round is abandoned rather than frozen */
      pause: function () {
        if (state !== 'running') return;
        state = 'done'; arm();
        V.textContent = 'Round abandoned.';
      }
    };

    btn.addEventListener('click', press);

    /* Space and Enter, but only while this panel is the one on screen, so the
       keys never get taken away from the rest of the page. */
    window.addEventListener('keydown', function (e) {
      if (stage.hidden || e.repeat) return;
      if (e.key !== ' ' && e.key !== 'Enter' && e.key !== 'Spacebar') return;
      if (document.activeElement && document.activeElement !== document.body
          && document.activeElement !== btn) return;
      e.preventDefault();
      press();
    });

    paint(ghost, allTime < Infinity ? earned(allTime) : 0);
    arm(); score();
  })();

  /* ---- tabs ----
     Switching away pauses whatever was running. The old build only hid the
     panel, so the other game kept simulating out of sight and kept hold of
     the arrow keys for the rest of the page. */
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      if (live) live.pause();
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        panels[t.dataset.game].hidden = !on;
      });
    });
  });

  /* An idle board is a still image: nothing is animating it, so a theme
     change has to ask for the repaint explicitly. */
  onTheme(function () { repaint.forEach(function (fn) { fn(); }); });

  /* scrolling the board out of view pauses too */
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting && live) live.pause();
    }, { threshold: 0.25 });
    var stage = document.querySelector('.game-stage');
    if (stage) io.observe(stage);
  }
})();

})();
