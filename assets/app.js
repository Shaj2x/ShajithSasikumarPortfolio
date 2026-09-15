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
var headOut = document.getElementById('head');
var headIn  = document.getElementById('head-core');
var bandEls = [].slice.call(document.querySelectorAll('.band'));

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

var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
var smoothstep = function (p, e0, e1) {
  var t = clamp((p - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ---------- band model ---------- */
var bands = bandEls.map(function (el) {
  var r = (el.dataset.range || '0,1').split(',');
  return { el: el, a: parseFloat(r[0]), b: parseFloat(r[1]),
           ramp: el.dataset.ramp ? parseFloat(el.dataset.ramp) : null,
           op: -1, k: -1 };
});

/* ---------- seeded split, identical on every load ---------- */
function rng(seed) {
  var s = seed >>> 0;
  return function () { return (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };
}

function splitText(el, entrance) {
  if (el.dataset.split) return;
  el.dataset.split = '1';
  var text = el.textContent;
  var words = text.split(' ');
  var rand = rng(text.length * 7919 + words.length);
  var spread = parseFloat(el.dataset.spread || '0.5');

  var hidden = document.createElement('span');
  hidden.className = 'vh';
  hidden.textContent = text;

  var visual = document.createElement('span');
  visual.setAttribute('aria-hidden', 'true');
  visual.className = 'e-' + entrance;

  words.forEach(function (word, i) {
    var w = document.createElement('span');
    w.className = 'w';
    w.textContent = word + (i < words.length - 1 ? ' ' : '');
    w.style.setProperty('--th', (i / Math.max(1, words.length) * spread + rand() * 0.05).toFixed(3));
    visual.appendChild(w);
  });

  el.textContent = '';
  el.appendChild(hidden);
  el.appendChild(visual);
}

bandEls.forEach(function (el) {
  var target = el.querySelector('.split');
  if (target) splitText(target, el.dataset.entrance || 'rise');
});

/* ---------- the mark: measure once, then only write on change ---------- */
var lens = [], total = 0, samples = [];
var SAMPLES = 640;   /* points cached per stroke; ~0.2 units of error at hero size */

/* the mark's viewBox, shared by .hero-mark, .head-layer and the canvas field.
   All three must agree or the head drifts off the line. */
var VB = { x: 292, y: 256, w: 426, h: 496 };

/* The draw is a two stroke signature, not one continuous line. Between them
   the pen lifts: the head keeps moving, dimmed, along a short arc to where
   the second stroke begins, instead of teleporting across the mark. LIFT is
   the share of the draw window that travel occupies. */
var LIFT = 0.07;
var plan = [];        /* [{i, a, b}] scroll sub-windows, one per stroke */
var liftA = 0, liftB = 0;

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

  /* Each stroke gets a share of the window proportional to its own length, so
     the head writes at one speed across both. The lift sits between them. */
  plan = [];
  var cursor = 0, gaps = marks.length - 1, span = 1 - LIFT * gaps;
  for (var k = 0; k < marks.length; k++) {
    var share = total ? (lens[k] / total) * span : span;
    plan.push({ i: k, a: cursor, b: cursor + share });
    cursor += share;
    if (k < gaps) { liftA = cursor; cursor += LIFT; liftB = cursor; }
  }
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
var headSpeed = 0, HEAD_R = 24, CORE_R = 6.5;

/* A pen does not move at one speed. It slows into the end of a stroke and
   picks up again out of the next one. Blending a little smootherstep into
   the linear map gives that cadence without ever reversing, so the draw
   still tracks the scroll one to one. */
function penEase(t) {
  var s = t * t * t * (t * (t * 6 - 15) + 10);
  return t * 0.56 + s * 0.44;
}

/* the lift arc, bowed off the chord so it reads as the pen leaving the page */
function liftPoint(from, to, t) {
  var dx = to.x - from.x, dy = to.y - from.y;
  var bow = Math.sqrt(dx * dx + dy * dy) * 0.17 * Math.sin(Math.PI * t);
  var len = Math.hypot(dx, dy) || 1;
  return { x: from.x + dx * t - (dy / len) * bow,
           y: from.y + dy * t + (dx / len) * bow };
}

function drawMark(p, dt) {
  if (!total || !plan.length) return null;
  /* the mark finishes a little before the scroll does, so the settle has a
     beat of stillness with the whole logo lit before the buttons arrive */
  var q = clamp(p / 0.88, 0, 1);
  var hx = null, hy = null, headOp = 0;

  for (var i = 0; i < plan.length; i++) {
    var s = plan[i], len = lens[s.i];
    var local = clamp((q - s.a) / (s.b - s.a), 0, 1);
    var drawn = penEase(local) * len;
    var off = len - drawn;

    if (lastOff[s.i] === undefined || Math.abs(off - lastOff[s.i]) > 0.1) {
      lastOff[s.i] = off;
      marks[s.i].style.strokeDashoffset = off.toFixed(2);
    }
    /* the head belongs to whichever stroke is mid write */
    if (local > 0 && local < 1) {
      var pt = pointAt(s.i, drawn);
      if (pt) { hx = pt.x; hy = pt.y; headOp = 1; }
    }
  }

  /* between the strokes the head travels instead of teleporting */
  if (hx === null && plan.length > 1 && q > liftA && q < liftB) {
    var from = pointAt(plan[0].i, lens[plan[0].i]);
    var to   = pointAt(plan[1].i, 0);
    if (from && to) {
      var t = (q - liftA) / (liftB - liftA);
      var lp = liftPoint(from, to, t);
      hx = lp.x; hy = lp.y;
      /* the nib is off the page, so the light dims, but it dims across the
         lift rather than stepping: a hard 1 to 0.3 is a flicker, not a lift */
      var fade = smoothstep(t, 0, 0.3) * (1 - smoothstep(t, 0.7, 1));
      headOp = 1 - 0.72 * fade;
    }
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
      headSpeed += (v - headSpeed) * Math.min(1, dt * 9);
    }
    var grow = 1 + clamp(headSpeed / 900, 0, 1) * 0.5;
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

/* ---------- captions, written only on change ---------- */
var loadK = 0, loadStart = 0;

function updateCaptions(p) {
  for (var i = 0; i < bands.length; i++) {
    var b = bands[i];
    var f = Math.min(0.02, (b.b - b.a) / 3);
    var easeIn  = (i === 0) ? 1 : smoothstep(p, b.a, b.a + f);
    var easeOut = (i === bands.length - 1) ? 1 : (1 - smoothstep(p, b.b - f, b.b));
    var op = easeIn * easeOut;

    var ramp = b.ramp || Math.min(0.025, (b.b - b.a) * 0.35);
    var k = clamp((p - b.a) / ramp, 0, 1);
    if (i === 0) k = Math.max(k, loadK);

    if (Math.abs(op - b.op) > 0.004) { b.op = op; b.el.style.opacity = op.toFixed(3); }
    if (Math.abs(k - b.k) > 0.008)  { b.k = k;  b.el.style.setProperty('--k', k.toFixed(3)); }
  }
}

/* ---------- progress through the pinned hero ---------- */
function heroProgress() {
  if (!hero) return 0;
  var rect = hero.getBoundingClientRect();
  var range = hero.offsetHeight - window.innerHeight;
  if (range <= 0) return 0;
  return clamp(-rect.top / range, 0, 1);
}

/* ---------- the rAF loop that rests ---------- */
var target = 0, shown = 0, vel = 0, rafId = null, lastTick = 0, heroOnScreen = true;

/* A spring, not eased interpolation. Exponential smoothing always trails the
   scroll and crawls to a stop, which reads as lag. A spring carries velocity,
   so reversing the scroll mid-stroke turns the line around with its own
   momentum instead of snapping direction.
   damping / (2 * sqrt(stiffness)) = 37 / 36.88 = 1.003, so it is critically
   damped: no overshoot. A logo that sprang past itself and un-drew would be
   a bug, not a flourish. */
var K = 340, C = 37;

function tick(now) {
  var dt = Math.min(64, now - (lastTick || now)) / 1000;   /* seconds, clamped */
  lastTick = now;

  /* substep so a long frame cannot make the spring explode */
  var steps = Math.max(1, Math.ceil(dt / 0.0084));
  var h = dt / steps;
  for (var st = 0; st < steps; st++) {
    vel += (-K * (shown - target) - C * vel) * h;
    shown += vel * h;
  }

  if (loadK < 1 && loadStart) loadK = clamp((now - loadStart) / 900, 0, 1);

  var settled = Math.abs(target - shown) < 0.0002 && Math.abs(vel) < 0.002 && loadK >= 1;
  if (settled) { shown = target; vel = 0; rafId = null; lastTick = 0; }
  else { rafId = requestAnimationFrame(tick); }

  var head = drawMark(shown, dt);
  updateCaptions(shown);
  if (window.__fieldFocus) window.__fieldFocus(head, shown);
}

function onScroll() {
  target = heroProgress();
  if (rafId === null && heroOnScreen) { lastTick = 0; rafId = requestAnimationFrame(tick); }
}

if (hero && 'IntersectionObserver' in window) {
  new IntersectionObserver(function (es) {
    heroOnScreen = es[0].isIntersecting;
    if (heroOnScreen && rafId === null) { lastTick = 0; rafId = requestAnimationFrame(tick); }
  }, { rootMargin: '10% 0px' }).observe(hero);
}

/* ---------- arm and disarm, live on all five gates ---------- */
var heroArmed = false, scrubOn = false;

function initHeroOnce() {
  if (heroArmed) return;
  heroArmed = true;
  measureMark();
  loadStart = performance.now();
  if (rafId === null) rafId = requestAnimationFrame(tick);
}

function enableScrub() {
  if (scrubOn) return;
  scrubOn = true;
  initHeroOnce();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', measureMark);
  bands.forEach(function (b) { b.op = -1; b.k = -1; });
  lastOff = []; lastHeadOp = -1; lastHeadX = -1; lastHeadR = -1; headSpeed = 0;
  updateCaptions(heroProgress());
  onScroll();
}

function disableScrub() {
  if (!scrubOn) return;
  scrubOn = false;
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', measureMark);
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}

var MQLS = GATES.map(function (q) { return matchMedia(q); });
function applyHeroMode() {
  if (MQLS.some(function (m) { return m.matches; })) disableScrub();
  else enableScrub();
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
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = c.offsetWidth; h = c.offsetHeight;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = Math.min(90, Math.round(w * h / 22000));
    dots = [];
    for (var i = 0; i < n; i++) {
      dots.push({ x: Math.random() * w, y: Math.random() * h, z: Math.random() * 0.8 + 0.2,
                  r: Math.random() * 1.4 + 0.3, s: Math.random() * 0.14 + 0.03,
                  o: Math.random() * 0.3 + 0.05 });
    }
  }

  /* the hero engine hands us the head position in the mark's own coordinates */
  window.__fieldFocus = function (head) {
    if (!head) { focus.a += (0 - focus.a) * 0.08; return; }
    var wrap = document.querySelector('.mark-wrap');
    if (!wrap) return;
    var r = wrap.getBoundingClientRect(), sr = c.getBoundingClientRect();
    focus.x = r.left - sr.left + ((head.x - VB.x) / VB.w) * r.width;
    focus.y = r.top - sr.top + ((head.y - VB.y) / VB.h) * r.height;
    focus.a += (1 - focus.a) * 0.12;
  };

  function draw() {
    ctx.clearRect(0, 0, w, h);

    if (focus.a > 0.01 && focus.x > -1) {
      var g = ctx.createRadialGradient(focus.x, focus.y, 0, focus.x, focus.y, Math.max(w, h) * 0.34);
      g.addColorStop(0, 'rgba(159,216,255,' + (0.13 * focus.a).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(159,216,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];
      d.y -= d.s * d.z;
      if (d.y < -4) { d.y = h + 4; d.x = Math.random() * w; }
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * d.z, 0, 6.2832);
      ctx.fillStyle = 'rgba(159,216,255,' + (d.o * d.z).toFixed(3) + ')';
      ctx.fill();
    }
    raf = requestAnimationFrame(draw);
  }

  size();
  window.addEventListener('resize', size);
  draw();
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = null; }
    else if (raf === null) draw();
  });
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

  function paint() {
    stage.style.setProperty('--hold', v.toFixed(3));
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
    var y = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: y, behavior: 'instant' });
    /* the hero is behind us now, so settle it rather than let the spring
       animate through the whole mark while nobody is looking */
    if (typeof target !== 'undefined') {
      target = shown = heroProgress(); vel = 0;
      drawMark(shown); updateCaptions(shown);
    }
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
  var panels = { pong: document.getElementById('panel-pong'), snake: document.getElementById('panel-snake') };
  if (!tabs.length) return;

  var mark = new Image();
  mark.src = 'assets/ss-mark.png';
  var markReady = false;
  mark.onload = function () { markReady = true; sprites = {}; };

  /* The mark is a white glyph on a black field. Drawn straight onto a near
     black board it all but vanished, which is most of why Pong played badly:
     you could not see the ball. So the piece is built once instead, as a lit
     disc with the monogram knocked out of it. Still the logo, now readable
     at speed. Cached per size and colour; both games share it. */
  var sprites = {};
  function sprite(size, colour) {
    if (!markReady) return null;
    var s = Math.max(12, Math.ceil(size)), key = s + '|' + colour;
    if (key in sprites) return sprites[key];

    var c = document.createElement('canvas'); c.width = c.height = s;
    var x = c.getContext('2d');
    x.fillStyle = colour;
    x.beginPath(); x.arc(s / 2, s / 2, s / 2, 0, 6.2832); x.fill();

    try {
      /* the glyph's own brightness becomes the eraser's alpha */
      var m = document.createElement('canvas'); m.width = m.height = s;
      var mx = m.getContext('2d');
      mx.drawImage(mark, 0, 0, s, s);
      var img = mx.getImageData(0, 0, s, s), d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
        d[i] = d[i + 1] = d[i + 2] = 0;
        d[i + 3] = Math.round(Math.min(1, lum * 1.3) * 255);
      }
      mx.putImageData(img, 0, 0);
      x.globalCompositeOperation = 'destination-out';
      x.drawImage(m, 0, 0);
      x.globalCompositeOperation = 'source-over';
    } catch (e) { /* a plain disc still plays perfectly well */ }

    sprites[key] = c;
    return c;
  }

  function paintTokens() {
    var cs = getComputedStyle(document.documentElement);
    var v = function (n, f) { return (cs.getPropertyValue(n) || '').trim() || f; };
    return { ground: v('--canvas', '#0B0D10'), line: v('--line', '#1E242C'),
             dim: v('--text-dim', '#5D6773'), mark: v('--accent', '#9FD8FF'),
             font: "'Sora', system-ui, sans-serif" };
  }

  /* Whichever game is on screen and running. Everything that can take the
     player's attention away, switching tabs, scrolling past, hiding the
     window, goes through pause() so a game is never simulating, and never
     swallowing arrow keys, while nobody is looking at it. */
  var live = null;
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
    var W = 600, H = 400, PW = 12, PH = 76, R = 13, INSET = 12, WIN = 5;
    var PADDLE_V = 470, CPU_V = 300, SERVE_V = 330, MAX_V = 640, STEP = 1 / 120;

    var over    = document.getElementById('pong-over'),
        result  = document.getElementById('pong-result'),
        scoreEl = document.getElementById('pong-score'),
        startBtn= document.getElementById('pong-start');

    var g = null, raf = null, keys = {}, acc = 0, last = 0, state = 'idle';
    var pointerY = null;

    function fresh() {
      return { py: H / 2 - PH / 2, cy: H / 2 - PH / 2, ps: 0, cs: 0,
               bx: W / 2, by: H / 2, vx: 0, vy: 0, wait: 0, rally: 0, bias: 0 };
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
      var ball = sprite(R * 2 * 3, t.mark);       /* 3x, so it stays crisp */
      ctx.save();
      ctx.shadowColor = t.mark; ctx.shadowBlur = 18;
      if (ball) ctx.drawImage(ball, g.bx - R, g.by - R, R * 2, R * 2);
      else { ctx.fillStyle = t.mark; ctx.beginPath(); ctx.arc(g.bx, g.by, R, 0, 6.2832); ctx.fill(); }
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

      var pellet = sprite(CELL * 3, t.mark);
      ctx.save();
      ctx.shadowColor = t.mark; ctx.shadowBlur = 14;
      if (pellet) ctx.drawImage(pellet, s.food.x * CELL, s.food.y * CELL, CELL, CELL);
      else { ctx.fillStyle = t.mark; ctx.fillRect(s.food.x * CELL, s.food.y * CELL, CELL, CELL); }
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
