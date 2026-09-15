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
var lens = [], total = 0;
function measureMark() {
  lens = marks.map(function (m) { return m.getTotalLength(); });
  total = lens.reduce(function (a, b) { return a + b; }, 0);
  marks.forEach(function (m, i) {
    m.style.setProperty('--len', lens[i].toFixed(1));
    m.style.setProperty('--off', lens[i].toFixed(1));
  });
}

var lastOff = [], lastHeadX = -1, lastHeadY = -1, lastHeadOp = -1;

function drawMark(p) {
  if (!total) return;
  /* the mark finishes a little before the scroll does, so the settle has a
     beat of stillness with the whole logo lit before the buttons arrive */
  var drawnTotal = clamp(p / 0.88, 0, 1) * total;
  var acc = 0, hx = null, hy = null;

  for (var i = 0; i < marks.length; i++) {
    var len = lens[i];
    var drawn = clamp(drawnTotal - acc, 0, len);
    var off = len - drawn;
    if (lastOff[i] === undefined || Math.abs(off - lastOff[i]) > 0.4) {
      lastOff[i] = off;
      marks[i].style.setProperty('--off', off.toFixed(1));
    }
    if (drawn > 0.5 && drawn < len - 0.5) {
      var pt = marks[i].getPointAtLength(drawn);
      hx = pt.x; hy = pt.y;
    }
    acc += len;
  }

  /* the head only exists while something is being written */
  var headOp = (hx === null) ? 0 : 1;
  if (headOp !== lastHeadOp) {
    lastHeadOp = headOp;
    markSvg.parentNode.style.setProperty('--head', headOp);
  }
  if (hx !== null && (Math.abs(hx - lastHeadX) > 0.5 || Math.abs(hy - lastHeadY) > 0.5)) {
    lastHeadX = hx; lastHeadY = hy;
    headOut.setAttribute('cx', hx.toFixed(1)); headOut.setAttribute('cy', hy.toFixed(1));
    headIn.setAttribute('cx', hx.toFixed(1));  headIn.setAttribute('cy', hy.toFixed(1));
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
var target = 0, shown = 0, rafId = null, lastTick = 0, heroOnScreen = true;

function tick(now) {
  var dt = Math.min(100, now - (lastTick || now));
  lastTick = now;
  /* frame rate independent easing: a 120Hz screen converges at the same
     speed as a 60Hz one, so the feel does not change per machine */
  shown += (target - shown) * (1 - Math.pow(1 - 0.18, dt / 16.667));

  if (loadK < 1 && loadStart) loadK = clamp((now - loadStart) / 900, 0, 1);

  var settled = Math.abs(target - shown) < 0.0004 && loadK >= 1;
  if (settled) { shown = target; rafId = null; lastTick = 0; }
  else { rafId = requestAnimationFrame(tick); }

  var head = drawMark(shown);
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
  lastOff = []; lastHeadOp = -1;
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
  document.querySelectorAll('.rev,.stagger,.rule').forEach(function (el) {
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
    focus.x = r.left - sr.left + ((head.x - 286) / 438) * r.width;
    focus.y = r.top - sr.top + ((head.y - 250) / 508) * r.height;
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
  document.querySelectorAll('.rev,.stagger,.rule').forEach(function (el) { io.observe(el); });
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

/* ---------- the live GitHub feed ---------- */
(function repos() {
  var host = document.getElementById('repos');
  if (!host) return;

  var NOTES = {
    Mercatus: 'A strategy game that teaches stocks, crypto and market timing through simulated trades.',
    StatStack: 'A statistics tool for stacking and comparing data sets in the browser.'
  };
  var DEMOS = {
    'Raptors-Slot-Machine': 'https://shaj2x.github.io/Raptors-Slot-Machine/',
    'Raptors-BlackJack': 'https://shaj2x.github.io/Raptors-BlackJack/',
    StatStack: 'https://shaj2x.github.io/StatStack/',
    Mercatus: 'https://shaj2x.github.io/Mercatus/'
  };
  var WIP = ['MarkWise', 'HarmonAI'];

  function pretty(n) { return n.replace(/---.*$/, '').replace(/[-_]+/g, ' ').trim(); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  fetch('https://api.github.com/users/Shaj2x/repos?sort=updated&per_page=10')
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      var list = data.filter(function (r) {
        return r.name !== 'Shaj2x' && r.name !== 'Shaj2x.github.io';
      }).slice(0, 6);

      if (!list.length) { host.innerHTML = '<div class="repo-err"><p>No public repositories right now.</p></div>'; return; }

      host.innerHTML = list.map(function (r) {
        var demo = DEMOS[r.name];
        var when = new Date(r.updated_at).toLocaleDateString('en-CA', { year: 'numeric', month: 'short' });
        return '<article class="repo">' +
          '<h3><a href="' + esc(r.html_url) + '" target="_blank" rel="noopener noreferrer">' + esc(pretty(r.name)) + '</a></h3>' +
          '<p>' + esc(NOTES[r.name] || r.description || 'No description yet.') + '</p>' +
          '<p class="meta">' +
            '<span>' + esc(when) + '</span>' +
            (r.language ? '<span>' + esc(r.language) + '</span>' : '') +
            (WIP.indexOf(r.name) > -1 ? '<span>In progress</span>' : '') +
            (demo ? '<a class="live" href="' + esc(demo) + '" target="_blank" rel="noopener noreferrer">Live demo</a>' : '') +
          '</p></article>';
      }).join('');
      host.setAttribute('aria-busy', 'false');
    })
    .catch(function () {
      host.setAttribute('aria-busy', 'false');
      host.innerHTML = '<div class="repo-err"><p>GitHub did not answer, which is usually a rate limit. ' +
        '<a class="more" href="https://github.com/Shaj2x?tab=repositories" target="_blank" rel="noopener noreferrer">Browse the repositories directly</a></p></div>';
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

})();
