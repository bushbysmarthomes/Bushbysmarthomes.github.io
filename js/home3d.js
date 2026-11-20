/* Bushby Smart Homes home page: steers the 3D house in the stage frame (model/index.html) from the scroll position.
   The house is the real Bushby model, shown with no address, place name or device makes. */
(function () {
  'use strict';
  var stage = document.getElementById('stage');
  var frame = document.getElementById('model');
  if (!stage || !frame) return;
  var steps = [].slice.call(document.querySelectorAll('.step'));
  var cards = steps.map(function (s) { return s.querySelector('.card'); });
  var topBar = document.querySelector('header.top'), cyCur = null;
  var toast = document.getElementById('toast');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  var fail = function () { root.classList.add('no3d'); root.classList.remove('has3d'); };
  var gl = null;
  try { var cv = document.createElement('canvas'); gl = cv.getContext('webgl') || cv.getContext('experimental-webgl'); } catch (e) { }
  if (!gl) return fail();
  frame.src = frame.getAttribute('data-src');

  // one pose per step: target x,y,z · azimuth° (0 = from the front) · elevation° · distance m · floor (0 ground, 2 both)
  var POSE = [
    [0, 1.6, -1.5, 38, 30, 31, 2],     // 0 hero: whole house
    [0, 0, -0.5, -32, 50, 25, 0],      // 1 the model: ground floor opens up
    [-0.6, 0, 1.2, -22, 54, 17, 0],    // 2 heating
    [0, 0, 0, 14, 68, 25, 0],          // 3 away
    [2.4, 0.3, -2.6, -18, 62, 9.5, 0], // 4 leak, kitchen sink (higher, so the stairs don't fill a phone screen)
    [-0.1, 1.9, 4.8, 14, 17, 14, 2],    // 5 front door: walls up, the whole house from the street, the door swings open (a little higher, so the whole porch and hall show on a phone)
    [-0.4, 0, 0.4, 26, 52, 23, 0],     // 6 lights: ground floor at dusk
    [0, 1.6, -1, 42, 24, 31, 2],       // 7 night
    [0, 0, 2.2, -52, 40, 19, 0],       // 8 hosts
    [0, 0, 0, 30, 46, 25, 0]           // 9 try it
  ];
  var cur = POSE[0].slice(0, 6), azDrag = 0, centres = [];
  function measure() { centres = steps.map(function (s) { var r = s.getBoundingClientRect(); return r.top + window.pageYOffset + r.height / 2; }); }
  function scrollS() {
    var y = window.pageYOffset + window.innerHeight / 2, n = centres.length;
    if (!n || y <= centres[0]) return 0;
    for (var i = 0; i < n - 1; i++) if (y < centres[i + 1]) return i + (y - centres[i]) / (centres[i + 1] - centres[i]);
    return n - 1;
  }
  var ease = function (t) { return t * t * (3 - 2 * t); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  function wOf(s, i) { return ease(clamp(1.35 - Math.abs(s - i) * 1.7, 0, 1)); }

  var manual = { heat: 0, away: 0, leak: 0, up: 0, night: 0, lights: 0 }, mv = { heat: 0, away: 0, leak: 0, night: 0, lights: 0 };
  var toggles = [].slice.call(document.querySelectorAll('[data-toggle]'));
  toggles.forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-toggle'); manual[k] = manual[k] ? 0 : 1;
      if (k === 'heat' && manual.heat) manual.away = 0; if (k === 'away' && manual.away) manual.heat = 0;
      toggles.forEach(function (o) { o.setAttribute('aria-pressed', manual[o.getAttribute('data-toggle')] ? 'true' : 'false'); });
    });
  });

  // drag sideways to turn the house (up and down still scrolls the page)
  var dragging = false, lastX = 0;
  stage.addEventListener('pointerdown', function (e) { dragging = true; lastX = e.clientX; stage.classList.add('grab'); });
  window.addEventListener('pointermove', function (e) { if (!dragging) return; azDrag += (e.clientX - lastX) * 0.35; lastX = e.clientX; });
  var up = function () { dragging = false; stage.classList.remove('grab'); };
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);

  var TOAST = {
    heat: ['Heating', 'Living room and kitchen warm. Other rooms resting.'],
    away: ['Away mode on', 'Every room frost-safe. The home is watching itself.'],
    leak: ['Leak detected', 'Under the kitchen sink · just now'],
    leakUp: ['Leak detected', 'Under the bathroom basin · just now'],
    door: ['Front door opened', 'While you are away · just now'],
    lights: ['Lights on', 'Hall, living room and kitchen · dimmed to 60%'],
    lightsUp: ['Lights on', 'Landing and bedrooms too · dimmed to 60%'],
    night: ['Evening lights', 'On at dusk, off at bedtime.'],
    guest: ['Guests have arrived', 'Front door · heating up for their stay']
  };
  var toastKey = '';
  function setToast(k) {
    if (k === toastKey) return; toastKey = k;
    if (!k) { toast.classList.remove('on'); return; }
    toast.className = 'toast on t-' + k;
    toast.querySelector('b').textContent = TOAST[k][0]; toast.querySelector('span').textContent = TOAST[k][1];
  }

  var ALL = ['secure', 'water', 'climate', 'hub', 'outdoor'];
  var t0 = null, visible = true, ready = false, shown = false, state = { p: [0, 0, 0], t: [0, 0, 0], cats: ALL };
  var failTimer = setTimeout(function () { if (!ready) fail(); }, 20000);
  function frameTick(now) {
    requestAnimationFrame(frameTick);
    var win = frame.contentWindow, drive = null;
    try { drive = win && win.__drive; } catch (e) { clearTimeout(failTimer); return fail(); }
    if (!drive) return;
    if (!ready) { ready = true; clearTimeout(failTimer); root.classList.add('has3d'); t0 = now; measure(); }
    if (!visible) return;
    var time = (now - t0) / 1000, intro = 1;   // no opening swing: the live model fades in over the still picture of the same view
    if (!shown && time > 0.25) { shown = true; stage.classList.add('live'); }

    var S = scrollS(), i0 = Math.floor(S), i1 = Math.min(i0 + 1, POSE.length - 1), f = ease(S - i0);
    var play = wOf(S, 9) > 0.5 ? 1 : 0;
    for (var key in mv) mv[key] += (manual[key] * play - mv[key]) * 0.08;
    var guest = wOf(S, 8);
    var heat = Math.max(wOf(S, 2), mv.heat, 0.8 * guest);
    var away = Math.max(wOf(S, 3), mv.away);
    var leak = Math.max(wOf(S, 4), mv.leak);
    var door = wOf(S, 5);
    var lights = Math.max(wOf(S, 6), mv.lights);
    var night = Math.max(wOf(S, 7), mv.night);

    for (var c = 0; c < 6; c++) { var want = lerp(POSE[i0][c], POSE[i1][c], f); cur[c] += (want - cur[c]) * (reduce ? 1 : 0.09); if (Math.abs(want - cur[c]) < 1e-4) cur[c] = want; }
    azDrag *= dragging ? 1 : 0.985; if (!dragging && Math.abs(azDrag) < 0.01) azDrag = 0;
    var W = stage.clientWidth, H = stage.clientHeight, portrait = W < H;
    var az = (cur[3] + azDrag + (1 - intro) * -70) * Math.PI / 180;   // no idle sway: the house stands still unless you scroll or drag (19 Nov 2026)
    var el = (cur[4] + (1 - intro) * 28) * Math.PI / 180;
    var dist = cur[5] * (portrait ? 1.3 : clamp(1.75 / (W / H), 1, 1.5)) * (1 + (1 - intro) * 0.9);
    state.t = [cur[0], cur[1], cur[2]];
    state.p = [cur[0] + dist * Math.cos(el) * Math.sin(az), cur[1] + dist * Math.sin(el), cur[2] + dist * Math.cos(el) * Math.cos(az)];
    var fl = POSE[Math.round(S)][6]; if (play && manual.up) fl = 1;
    state.floor = fl; state.heat = heat; state.away = away; state.leak = leak; state.night = night; state.lights = lights; state.door = door; state.wallsUp = door > 0.35 ? 1 : 0;
    state.cats = leak > 0.5 ? ['water'] : door > 0.5 ? ['secure'] : lights > 0.5 && night < 0.5 ? ['lights'] : (heat > 0.5 || away > 0.5) && guest < 0.5 ? ['climate'] : night > 0.5 ? ['outdoor'] : guest > 0.5 ? ['secure', 'climate'] : ALL;
    // narrow screens (phone, fold, tablet): the house sits in the middle of the free space between the notification and the card
    if (W < 900) {
      var hb = topBar ? topBar.getBoundingClientRect().bottom : 0, tr = toast.getBoundingClientRect(), freeTop = Math.max(hb, hb + 8 + tr.height + 8);
      var cc = cards[Math.max(0, Math.min(cards.length - 1, Math.round(S)))], ch = cc ? cc.offsetHeight : 0, rest = H - (W < 560 ? 14 : 22) - ch;
      var want = clamp(((freeTop + rest) / 2) / H, 0.25, 0.6); cyCur = cyCur === null ? want : cyCur + (want - cyCur) * 0.08;
      state.cy = cyCur;
    } else state.cy = 0;
    try { drive(state); } catch (e) { }
    stage.classList.toggle('dark', night > 0.5);

    var best = '', bv = 0.55;
    [['leak', leak], ['door', door], ['guest', guest], ['away', away], ['lights', lights], ['night', night], ['heat', heat * (guest > 0.5 ? 0 : 1)]].forEach(function (a) { if (a[1] > bv) { bv = a[1]; best = a[0]; } });
    if (best === 'lights' && fl !== 0) best = 'lightsUp';
    if (best === 'leak' && fl === 1) best = 'leakUp';
    setToast(time > 2.4 ? best : '');
    // phone: a card fades as it slides up under the notification, so the two never sit on top of each other
    if (W < 900) {
      var tb = toast.classList.contains('on') ? toast.getBoundingClientRect().bottom + 8 : 0;
      for (var q = 0; q < cards.length; q++) { var rc = cards[q].getBoundingClientRect(), o = clamp((rc.top - tb) / 70, 0, 1); if (cards[q].__o !== o) { cards[q].__o = o; cards[q].style.opacity = o; } }
    }
  }

  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }, { rootMargin: '100px' }).observe(stage);
  measure(); setTimeout(measure, 400);
  requestAnimationFrame(frameTick);
})();
