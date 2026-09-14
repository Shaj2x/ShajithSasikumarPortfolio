/* ============================================================
   Shajith Sasikumar, scroll scrubbed hero and page motion
   Plain JavaScript, no dependencies.
   ============================================================ */
(function () {
'use strict';

/* ---------- elements ---------- */
var stage   = document.getElementById('stage');
var video   = document.getElementById('hero-video');
var poster  = document.getElementById('poster');
var ring    = document.getElementById('ring');
var hero    = document.querySelector('.hero');
var nav     = document.querySelector('.nav');
var bandEls = [].slice.call(document.querySelectorAll('.band'));

var VIDEO_URL   = 'assets/hero-scrub.mp4';
var POSTER_URL  = 'assets/hero-poster.jpg';
var VIDEO_BYTES = 5200000;   /* real byte size, patched at build time */

/* ---------- the five static hero gates ----------
   These strings are duplicated character for character in style.css.
   Change one, change both, or one side loads what the other hides. */
var GATES = [
  '(max-width: 720px)',
  '(orientation: portrait) and (max-width: 1024px)',
  '(orientation: portrait) and (pointer: coarse)',
  '(orientation: landscape) and (pointer: coarse) and (max-height: 560px)',
  '(prefers-reduced-motion: reduce)'
];

var reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- band model ---------- */
var bands = bandEls.map(function (el) {
  var r = (el.dataset.range || '0,1').split(',');
  return {
    el: el,
    a: parseFloat(r[0]),
    b: parseFloat(r[1]),
    ramp: el.dataset.ramp ? parseFloat(el.dataset.ramp) : null,
    op: -1,     /* cached opacity, so we only touch the DOM on change */
    k: -1
  };
});

var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
var smoothstep = function (p, e0, e1) {
  var t = clamp((p - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ---------- seeded split, so "random" is identical every load ---------- */
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
  var entrance = el.dataset.entrance || 'rise';
  var target = el.querySelector('.split');
  if (target) splitText(target, entrance);
});

/* ---------- scroll progress through the pinned hero ---------- */
function heroProgress() {
  if (!hero) return 0;
  var rect = hero.getBoundingClientRect();
  var range = hero.offsetHeight - window.innerHeight;
  if (range <= 0) return 0;
  return clamp(-rect.top / range, 0, 1);
}

/* ---------- gated seeks, deadlock safe ---------- */
var seekBusy = false;
var pendingTime = null;

function requestSeek(t) {
  if (!video.duration || isNaN(t)) return;
  if (seekBusy) { pendingTime = t; return; }
  seekBusy = true;
  try { video.currentTime = t; } catch (e) { seekBusy = false; }
}

video.addEventListener('seeked', function () {
  seekBusy = false;
  if (pendingTime !== null) { var t = pendingTime; pendingTime = null; requestSeek(t); }
});
video.addEventListener('error', function () {   /* the deadlock escape */
  seekBusy = false; pendingTime = null; failVideo();
});

/* ---------- captions, written only on change ---------- */
var loadK = 0;          /* band one's one time assembly on load */
var loadStart = 0;

function updateCaptions(p) {
  for (var i = 0; i < bands.length; i++) {
    var b = bands[i];
    var f = Math.min(0.02, (b.b - b.a) / 3);
    var easeIn  = (i === 0) ? 1 : smoothstep(p, b.a, b.a + f);
    var easeOut = (i === bands.length - 1) ? 1 : (1 - smoothstep(p, b.b - f, b.b));
    var op = easeIn * easeOut;

    var ramp = b.ramp || Math.min(0.025, (b.b - b.a) * 0.35);
    var k = clamp((p - b.a) / ramp, 0, 1);
    if (i === 0) k = Math.max(k, loadK);   /* band one opens already assembled */

    if (Math.abs(op - b.op) > 0.004) { b.op = op; b.el.style.opacity = op.toFixed(3); }
    if (Math.abs(k - b.k) > 0.008)  { b.k = k;  b.el.style.setProperty('--k', k.toFixed(3)); }
  }
}

/* ---------- the rAF loop that rests ---------- */
var target = 0, shown = 0, rafId = null, lastTick = 0, heroOnScreen = true;

function tick(now) {
  var dt = Math.min(100, now - (lastTick || now));
  lastTick = now;
  var k = 0.16;
  shown += (target - shown) * (1 - Math.pow(1 - k, dt / 16.667));

  if (loadK < 1 && loadStart) {
    loadK = clamp((now - loadStart) / 900, 0, 1);
  }

  var settled = Math.abs(target - shown) < 0.0005 && loadK >= 1;
  if (settled) { shown = target; rafId = null; lastTick = 0; }
  else { rafId = requestAnimationFrame(tick); }

  if (video.duration) requestSeek(shown * video.duration);
  updateCaptions(shown);
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

/* ---------- the streamed blob, behind an honest ring ---------- */
var heroStarted = false;

function failVideo() {
  if (stage) stage.classList.add('video-failed');
}

function initHeroOnce() {
  if (heroStarted) return;
  heroStarted = true;

  poster.style.backgroundImage = "url('" + POSTER_URL + "')";
  loadStart = performance.now();
  if (rafId === null) rafId = requestAnimationFrame(tick);

  var started = false;
  function startBlobFetch() {
    if (started) return;
    started = true;
    loadHeroBlob().catch(failVideo);
  }
  var img = new Image();
  img.onload = startBlobFetch;
  img.onerror = startBlobFetch;
  img.src = POSTER_URL;
  setTimeout(startBlobFetch, 4000);   /* a hung poster never blocks the video */
}

function loadHeroBlob() {
  var ctrl = new AbortController();
  var watchdog = setTimeout(function () { ctrl.abort(); }, 20000);

  return fetch(VIDEO_URL, { priority: 'low', signal: ctrl.signal }).then(function (res) {
    if (!res.ok || !res.body) throw new Error('video ' + res.status);
    var total = Number(res.headers.get('Content-Length')) || VIDEO_BYTES;
    var reader = res.body.getReader();
    var chunks = [], got = 0, lastRing = 0;

    return (function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        clearTimeout(watchdog);
        watchdog = setTimeout(function () { ctrl.abort(); }, 20000);
        chunks.push(r.value);
        got += r.value.length;
        var frac = Math.min(1, got / total);
        var now = performance.now();
        if (now - lastRing > 100 || frac === 1) {
          lastRing = now;
          ring.style.setProperty('--ld', Math.round(126 * (1 - frac)));
        }
        return pump();
      });
    })().then(function () {
      clearTimeout(watchdog);
      ring.style.setProperty('--ld', 0);
      video.src = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
      video.load();
      video.addEventListener('canplay', function () {
        requestSeek(heroProgress() * video.duration);
        stage.classList.add('video-ready');
      }, { once: true });
    });
  });
}

/* ---------- arm and disarm the scrub, live ---------- */
var scrubOn = false;

function enableScrub() {
  if (scrubOn) return;
  scrubOn = true;
  initHeroOnce();
  window.addEventListener('scroll', onScroll, { passive: true });
  bands.forEach(function (b) { b.op = -1; b.k = -1; });
  updateCaptions(heroProgress());
  onScroll();
}

function disableScrub() {
  if (!scrubOn) return;
  scrubOn = false;
  window.removeEventListener('scroll', onScroll);
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
  document.querySelectorAll('.rev,.stagger').forEach(function (el) {
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
  document.querySelectorAll('.rev,.stagger').forEach(function (el) { io.observe(el); });
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
    var v = Math.round(to * (1 - Math.pow(1 - p, 3)));
    var s = String(v);
    if (s !== last) { last = s; el.textContent = s; }   /* only write on change */
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

/* ---------- the environment layer: whisper level motes ---------- */
(function motes() {
  var c = document.getElementById('motes');
  if (!c || reduceMQ.matches) return;
  var ctx = c.getContext('2d'), dots = [], raf = null, w = 0, h = 0;

  function size() {
    w = c.width = c.offsetWidth; h = c.height = c.offsetHeight;
    var n = Math.min(70, Math.round(w * h / 26000));
    dots = [];
    for (var i = 0; i < n; i++) {
      dots.push({ x: Math.random() * w, y: Math.random() * h,
                  r: Math.random() * 1.3 + 0.3, s: Math.random() * 0.16 + 0.04,
                  o: Math.random() * 0.35 + 0.08 });
    }
  }
  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];
      d.y -= d.s;
      if (d.y < -4) { d.y = h + 4; d.x = Math.random() * w; }
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, 6.2832);
      ctx.fillStyle = 'rgba(159,216,255,' + d.o + ')';
      ctx.fill();
    }
    raf = requestAnimationFrame(draw);
  }
  size();
  window.addEventListener('resize', size);
  draw();
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { cancelAnimationFrame(raf); raf = null; }
    else if (raf === null) draw();
  });
})();

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
    var step = held ? 0.016 : -0.024;            /* releasing eases back, never snaps */
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
