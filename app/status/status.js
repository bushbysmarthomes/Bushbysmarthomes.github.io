/* Bushby Status: reads every home's check from Healthchecks.io and shows it as one board.
   Keys are typed into this page and kept in this browser only (localStorage). Nothing else is stored.
   No third-party scripts. All text from the API is shown with textContent, never as HTML. */
(function () {
  "use strict";

  var API = "https://healthchecks.io/api/v3";
  var STORE_KEYS = "bushby-status:keys";
  var REFRESH_MS = 60 * 1000;
  var DEMO = /[?&]demo\b/.test(location.search);

  var ORDER = { offline: 0, attention: 1, late: 2, idle: 3, ok: 4 };
  var STATE_LABEL = { offline: "Hub offline", attention: "Needs attention", late: "Late", ok: "All good", idle: "Not reporting" };
  var ICON = {
    offline: "M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 12.86a10 10 0 0 1 5.17-2.69M19 12.86a10 10 0 0 0-2.01-1.55M2 8.82a15 15 0 0 1 4.17-2.65M22 8.82a15 15 0 0 0-11.29-3.76M12 20h.01",
    attention: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01",
    late: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
    idle: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12h8"
  };

  var state = { keys: [], homes: [], loadedAt: null, failedAt: null, loading: false, errors: [], project: "all", mapView: null };
  var mapHomes = [];
  var bodies = {};          // uuid -> { n, text }  (full keys only)
  var bodyRequests = {};    // uuid -> promise
  var lastHeadline = "";

  /* ---------- storage (wrapped: it can be missing or full) ---------- */
  function load(name, fallback) {
    try { var v = localStorage.getItem(name); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(name, value) {
    try { localStorage.setItem(name, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function forget(name) { try { localStorage.removeItem(name); } catch (e) { /* ignore */ } }

  /* ---------- small DOM helpers ---------- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") n.textContent = v;
      else if (k === "class") n.className = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function icon(d) {
    var ns = "http://www.w3.org/2000/svg";
    var s = document.createElementNS(ns, "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true");
    var p = document.createElementNS(ns, "path"); p.setAttribute("d", d); s.appendChild(p);
    return s;
  }
  function $(id) { return document.getElementById(id); }

  /* ---------- time ---------- */
  function ago(iso, now) {
    if (!iso) return "never";
    var s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
    if (s < 60) return "just now";
    var m = Math.floor(s / 60);
    if (m < 60) return m + " min ago";
    var h = Math.floor(m / 60), rm = m % 60;
    if (h < 24) return h + " h" + (rm ? " " + rm + " min" : "") + " ago";
    var d = Math.floor(h / 24);
    return d + (d === 1 ? " day ago" : " days ago");
  }
  function clock(t) { return new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); }
  function stamp(t) {
    if (!t) return "";
    var d = new Date(t), today = new Date();
    var same = d.toDateString() === today.toDateString();
    return (same ? "today" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })) + " at " + clock(d);
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* ---------- status of one home ---------- */
  function period(c) { return Number(c.timeout) || 900; }
  function grace(c) { return Number(c.grace) || 2700; }
  function classify(c, now) {
    if (c.status === "up") return "ok";
    if (c.status === "grace") return "late";
    if (c.status === "new" || c.status === "paused") return "idle";
    if (c.status === "down") {
      var age = c.last_ping ? (now - Date.parse(c.last_ping)) / 1000 : Infinity;
      return age <= period(c) + grace(c) ? "attention" : "offline";
    }
    return "idle";
  }

  /* ---------- the hub's message: "Devices offline (2): a, b" etc. ---------- */
  function parseBody(text) {
    var out = { version: "", offline: null, batteries: null, backup: "", unknown: [] };
    String(text || "").split(/\r?\n/).forEach(function (line) {
      var t = line.trim(), m;
      if (!t) return;
      if ((m = /^Home Assistant\s*(.*)$/i.exec(t))) { out.version = m[1]; return; }
      if ((m = /^Devices offline \((\d+)\):\s*(.*)$/i.exec(t))) { out.offline = { n: +m[1], list: listOf(m[2]) }; return; }
      if ((m = /^Batteries under [^(]*\((\d+)\):\s*(.*)$/i.exec(t))) { out.batteries = { n: +m[1], list: listOf(m[2]) }; return; }
      if ((m = /^Backup:\s*(.*)$/i.exec(t))) { out.backup = m[1]; return; }
      out.unknown.push(t);
    });
    out.known = out.offline !== null || out.batteries !== null || out.backup !== "";
    out.backupOk = !out.backup || out.backup.toUpperCase() === "OK";
    return out;
  }
  function listOf(s) {
    s = (s || "").trim();
    return !s || s.toLowerCase() === "none" ? [] : s.split(/,\s*/);
  }

  /* What is wrong (one line) and what to do (one line) for a home. */
  function explain(h, p, now) {
    var c = h.check, k = h.kind;
    if (k === "offline") return {
      issue: "Not heard from since " + stamp(c.last_ping) + ".",
      next: "Usually power or the internet at the home. Ask someone there to check the hub is plugged in and the router is on."
    };
    if (k === "late") return {
      issue: "Check-in overdue.",
      next: "Usually a slow connection and it clears itself. It turns red at " + clock(Date.parse(c.last_ping) + (period(c) + grace(c)) * 1000) + " if nothing arrives."
    };
    if (k === "idle") return {
      issue: c.status === "paused" ? "Paused in Healthchecks.io." : "Waiting for the first check-in.",
      next: ""
    };
    if (k === "ok") return { issue: "", next: "" };
    // attention
    if (h.readOnly) return { issue: "The hub reported a problem.", next: "Add this project's full key in Settings to see what it is." };
    if (!p) return { issue: "The hub reported a problem.", next: "Loading its report…" };
    if (!p.known) return { issue: "The hub reported a problem.", next: "Its report is shown below." };
    var bits = [], todo = [];
    if (p.offline && p.offline.n) {
      bits.push(plural(p.offline.n, "device offline", "devices offline"));
      todo.push("check the offline " + (p.offline.n === 1 ? "device's" : "devices'") + " battery and that " + (p.offline.n === 1 ? "it is" : "they are") + " in range of the hub");
    }
    if (p.batteries && p.batteries.n) {
      bits.push(plural(p.batteries.n, "low battery", "low batteries"));
      todo.push("ask for " + (p.batteries.n === 1 ? "the battery" : "the batteries") + " to be replaced");
    }
    if (!p.backupOk) {
      bits.push("backup missed");
      todo.push("check Settings > System > Backups on the hub");
    }
    return {
      issue: bits.length ? cap(bits.join(", ")) + "." : "The hub reported a problem.",
      next: todo.length ? cap(todo.join("; ")) + "." : ""
    };
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---------- Healthchecks API ---------- */
  function api(key, path, asText) {
    return fetch(API + path, { headers: { "X-Api-Key": key }, cache: "no-store", referrerPolicy: "no-referrer" })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error("key");
        if (!r.ok) throw new Error("http " + r.status);
        return asText ? r.text() : r.json();
      });
  }

  function fetchAll() {
    if (DEMO) return Promise.resolve(demoData());
    var errors = [];
    return Promise.all(state.keys.map(function (k) {
      return api(k.key, "/checks/").then(function (j) {
        var checks = (j && j.checks) || [];
        var readOnly = checks.length ? !("ping_url" in checks[0]) : !!k.readOnly;
        if (k.readOnly !== readOnly) { k.readOnly = readOnly; save(STORE_KEYS, state.keys); }
        return checks.map(function (c) { return { check: c, project: k.label, readOnly: readOnly, key: k.key }; });
      }).catch(function (e) {
        errors.push(e.message === "key"
          ? "Healthchecks didn't accept the key for “" + k.label + "”. Check it in Settings."
          : "Couldn't reach Healthchecks.io for “" + k.label + "”.");
        return null;
      });
    })).then(function (lists) { return { lists: lists, errors: errors }; });
  }

  function cachedBody(h) {
    var b = h.check.uuid && bodies[h.check.uuid];
    return b && b.n === h.check.n_pings ? b.text : null;
  }
  function loadBody(h) {
    var c = h.check;
    if (h.readOnly || !c.uuid || !c.n_pings) return Promise.resolve(null);
    var cached = cachedBody(h);
    if (cached !== null) return Promise.resolve(cached);
    if (bodyRequests[c.uuid]) return bodyRequests[c.uuid];
    var p = DEMO ? Promise.resolve(DEMO_BODIES[c.name] || "") :
      api(h.key, "/checks/" + encodeURIComponent(c.uuid) + "/pings/" + c.n_pings + "/body", true);
    bodyRequests[c.uuid] = p.then(function (t) {
      bodies[c.uuid] = { n: c.n_pings, text: t || "" };
      return t || "";
    }, function () {
      bodies[c.uuid] = { n: c.n_pings, text: "", failed: true };
      return "";
    }).then(function (t) { delete bodyRequests[c.uuid]; return t; });
    return bodyRequests[c.uuid];
  }

  /* ---------- refresh ---------- */
  function refresh() {
    if (state.loading) return;
    if (!DEMO && !state.keys.length) { render(); return; }
    state.loading = true;
    $("refresh").classList.add("spin");
    $("refresh").setAttribute("aria-busy", "true");
    fetchAll().then(function (res) {
      var now = Date.now();
      state.errors = res.errors;
      if (res.lists.some(function (l) { return l !== null; })) {
        var homes = [];
        res.lists.forEach(function (l) { (l || []).forEach(function (h) { homes.push(h); }); });
        homes.forEach(function (h) { h.kind = classify(h.check, now); });
        state.homes = homes;
        state.loadedAt = now;
        state.failedAt = res.errors.length ? now : null;
      } else {
        state.failedAt = now;
      }
      render();
      var todo = state.homes.filter(function (h) { return !h.readOnly && h.kind !== "ok" && h.kind !== "idle"; });
      return runLimited(todo, 4, function (h) { return loadBody(h).then(function () { renderHome(h); }); });
    }).catch(function () {
      state.failedAt = Date.now();
      state.errors = ["Something went wrong loading the board."];
      render();
    }).then(function () {
      state.loading = false;
      $("refresh").classList.remove("spin");
      $("refresh").removeAttribute("aria-busy");
    });
  }
  function runLimited(items, n, fn) {
    var i = 0;
    function next() { if (i >= items.length) return Promise.resolve(); var it = items[i++]; return fn(it).then(next, next); }
    var workers = [];
    for (var w = 0; w < Math.min(n, items.length); w++) workers.push(next());
    return Promise.all(workers);
  }

  /* ---------- rendering ---------- */
  function homeId(h) { return "home-" + (h.project + "-" + (h.check.uuid || h.check.unique_key || h.check.name)).replace(/[^A-Za-z0-9_-]/g, "_"); }
  function tagsOf(h) { return String(h.check.tags || "").split(/\s+/).filter(Boolean); }
  function byStatusThenName(a, b) {
    return (ORDER[a.kind] - ORDER[b.kind]) || String(a.check.name).localeCompare(String(b.check.name), "en", { numeric: true });
  }

  function render() {
    var hasKeys = DEMO || state.keys.length > 0;
    $("empty").hidden = hasKeys;
    $("summary").hidden = !hasKeys;
    if (!hasKeys) {
      ["filters", "map", "notice", "fine-group", "idle-group"].forEach(function (id) { $(id).hidden = true; });
      $("problems").textContent = "";
      return;
    }

    // Projects (only shown when there is more than one)
    var projects = [];
    state.homes.forEach(function (h) { if (projects.indexOf(h.project) < 0) projects.push(h.project); });
    if (state.project !== "all" && projects.indexOf(state.project) < 0) state.project = "all";
    var homes = state.homes.filter(function (h) { return state.project === "all" || h.project === state.project; });

    var n = { offline: 0, attention: 0, late: 0, ok: 0, idle: 0 };
    homes.forEach(function (h) { n[h.kind]++; });

    // Headline: what needs Matt, in plain words
    var parts = [];
    if (n.offline) parts.push(plural(n.offline, "hub offline", "hubs offline"));
    if (n.attention) parts.push(plural(n.attention, "home needs", "homes need") + " attention");
    if (n.late) parts.push(n.late + " late");
    var headline = !state.loadedAt ? "Loading…" :
      !homes.length ? "No homes on the board yet" :
      parts.length ? cap(parts.join(", ")) :
      (n.ok === 1 ? "The home is fine" : "All " + n.ok + " homes are fine");
    if (headline !== lastHeadline) { $("headline").textContent = headline; lastHeadline = headline; }

    var sub = $("subline");
    if (state.failedAt && state.loadedAt && state.failedAt > state.loadedAt) {
      sub.textContent = "Couldn't refresh at " + clock(state.failedAt) + ". Showing the board from " + clock(state.loadedAt) + ".";
      sub.className = "subline stale";
    } else {
      sub.textContent = state.loadedAt ? "Checked at " + clock(state.loadedAt) + " · updates every minute while open" : "";
      sub.className = "subline";
    }

    // Project chips
    var filters = $("filters");
    filters.hidden = projects.length < 2;
    filters.textContent = "";
    if (projects.length > 1) {
      [["all", "All homes", state.homes.length]].concat(projects.map(function (p) {
        return [p, p, state.homes.filter(function (h) { return h.project === p; }).length];
      })).forEach(function (o) {
        filters.appendChild(el("button", {
          class: "chip", type: "button", "aria-pressed": String(state.project === o[0]),
          onclick: function () { state.project = o[0]; state.mapView = null; render(); }
        }, [o[1], el("span", { class: "n", text: String(o[2]) })]));
      });
    }

    renderMap(homes);

    // Notices
    var notes = state.errors.slice();
    if (DEMO) notes.unshift("Demo: these are made-up homes, to show how the board looks.");
    if (!DEMO && homes.some(function (h) { return h.readOnly && h.kind === "attention"; }))
      notes.push("Some homes use a read-only key, which shows status only. Add the project's full key to see what's wrong.");
    $("notice").hidden = !notes.length;
    $("notice").textContent = notes.join(" ");

    // Problem cards
    var box = $("problems");
    box.textContent = "";
    homes.filter(function (h) { return h.kind === "offline" || h.kind === "attention" || h.kind === "late"; })
      .sort(byStatusThenName).forEach(function (h) { box.appendChild(buildHome(h)); });

    // Folded groups
    fillGroup("fine", homes.filter(function (h) { return h.kind === "ok"; }), n.ok === 1 ? "1 home is fine" : n.ok + " homes are fine");
    fillGroup("idle", homes.filter(function (h) { return h.kind === "idle"; }), plural(n.idle, "home", "homes") + " not reporting yet");
  }

  function fillGroup(name, list, title) {
    var group = $(name + "-group");
    group.hidden = !list.length;
    $(name + "-title").textContent = title;
    var ul = $(name + "-list");
    ul.textContent = "";
    var now = Date.now();
    list.sort(byStatusThenName).forEach(function (h) {
      var c = h.check;
      ul.appendChild(el("li", { id: homeId(h), tabindex: "-1" }, [
        el("span", { class: "name", text: c.name || "(unnamed)" }),
        el("span", { class: "ago", text: c.last_ping ? ago(c.last_ping, now) : (c.status === "paused" ? "paused" : "no check-ins") }),
        el("span", { class: "sub" }, metaBits(h, false))
      ]));
    });
  }

  function metaBits(h, withLink) {
    var bits = [];
    var tags = tagsOf(h);
    if (state.keys.length > 1 || DEMO) { if (!sameWord(tags, h.project)) tags.unshift(h.project); }
    if (tags.length) bits.push(el("span", { class: "tags" }, tags.map(function (t) { return el("span", { class: "tag", text: t }); })));
    if (withLink && h.check.uuid && !DEMO) bits.push(el("a", {
      class: "out", href: "https://healthchecks.io/checks/" + encodeURIComponent(h.check.uuid) + "/details/",
      target: "_blank", rel: "noopener noreferrer", text: "Open in Healthchecks.io"
    }));
    return bits;
  }
  function sameWord(list, word) {
    var w = String(word).toLowerCase().replace(/s$/, "");
    return list.some(function (t) { return t.toLowerCase().replace(/s$/, "") === w; });
  }

  function renderHome(h) {
    var old = document.getElementById(homeId(h));
    if (old) old.replaceWith(buildHome(h));
    else if (h.kind !== "ok" && h.kind !== "idle") render();
  }

  function buildHome(h) {
    var c = h.check, now = Date.now();
    var body = cachedBody(h);
    var p = body !== null ? parseBody(body) : null;
    var x = explain(h, p, now);

    var whenText = h.kind === "offline" ? " · last seen " + ago(c.last_ping, now) : " · " + ago(c.last_ping, now);
    var head = el("div", { class: "home-head" }, [
      el("div", { class: "badge " + h.kind }, [icon(ICON[h.kind])]),
      el("div", null, [
        el("h3", { text: c.name || "(unnamed)" }),
        el("p", { class: "state " + h.kind }, [STATE_LABEL[h.kind], el("span", { class: "when", text: whenText })])
      ])
    ]);

    var kids = [head];
    if (x.issue) kids.push(el("p", { class: "issue", text: x.issue }));
    if (x.next) kids.push(el("p", { class: "next", text: x.next }));
    var rep = buildReport(h, p, body);
    if (rep) kids.push(rep);
    var foot = metaBits(h, true);
    if (foot.length) kids.push(el("div", { class: "home-foot" }, foot));
    return el("article", { class: "home " + h.kind, id: homeId(h) }, kids);
  }

  function buildReport(h, p, body) {
    if (h.readOnly) return null;
    var c = h.check;
    var title = h.kind === "offline" ? "Its last report, " + stamp(c.last_ping) : "What the hub reported";
    var rows = [el("p", { class: "report-title", text: title })];
    function row(label, value, cls) { rows.push(el("dl", { class: "row" }, [el("dt", { text: label }), el("dd", { class: cls || null }, [value])])); }
    function list(items) { return el("ul", null, items.map(function (t) { return el("li", { text: t }); })); }

    if (body === null) {
      if (!c.n_pings) return null;
      rows.push(el("p", { class: "muted-note", text: "Loading…" }));
    } else if (p && p.known) {
      var offl = p.offline && p.offline.list.length, bat = p.batteries && p.batteries.list.length;
      row("Devices offline", offl ? list(p.offline.list) : document.createTextNode("None"), offl ? "badtext" : "good");
      row("Low batteries", bat ? list(p.batteries.list) : document.createTextNode("None"), bat ? "badtext" : "good");
      row("Backup", document.createTextNode(p.backup || "Not reported"), p.backupOk ? "good" : "badtext");
      if (p.version) row("Home Assistant", document.createTextNode(p.version));
      if (p.unknown.length) rows.push(el("pre", { class: "raw", text: p.unknown.join("\n") }));
    } else if (String(body).trim()) {
      rows.push(el("pre", { class: "raw", text: String(body) }));
    } else {
      var b = bodies[c.uuid];
      if (h.kind !== "attention" && !(b && b.failed)) return null;
      rows.push(el("p", { class: "muted-note", text: b && b.failed ? "Couldn't load the report. It will try again on the next refresh." : "That check-in had no report attached." }));
      if (b && b.failed) delete bodies[c.uuid];
    }
    return el("div", { class: "report" }, rows);
  }

  /* ---------- map ---------- */
  var MAP_DEFAULT = { x: -1900, y: -1750, w: 3700, h: 3300 }; // most of Europe, in projected km
  var MAP_WORST = { down: 0, warn: 1, idle: 2, ok: 3 };
  var MAP_WORD = { down: "hub offline", warn: "needs attention or late", idle: "not reporting", ok: "all good" };
  var measureCtx = null;
  function textWidth(t) {
    try {
      measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
      measureCtx.font = "800 13px \"Nunito Sans\", system-ui, sans-serif";
      return measureCtx.measureText(t).width;
    } catch (e) { return t.length * 7.6; }
  }

  function parseLoc(desc) {
    var m = /\bloc\s*[:=]?\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/i.exec(String(desc || ""));
    if (!m) return null;
    var lat = +m[1], lon = +m[2];
    return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? [lat, lon] : null;
  }
  function project(lat, lon) { // Lambert azimuthal equal-area, same as europe.js
    var c = window.BUSHBY_EUROPE.center, R = 6371, rad = Math.PI / 180;
    var l = lon * rad, p = lat * rad, l0 = c[0] * rad, p0 = c[1] * rad;
    var k = Math.sqrt(2 / (1 + Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l - l0)));
    return [R * k * Math.cos(p) * Math.sin(l - l0), -R * k * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l - l0))];
  }
  function mapStatus(kind) { return kind === "offline" ? "down" : kind === "attention" || kind === "late" ? "warn" : kind === "idle" ? "idle" : "ok"; }
  function fitBox(b, W, H) {
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2, w = b.w, h = b.h;
    if (w / h < W / H) w = h * W / H; else h = w * H / W;
    return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
  }
  function boxAround(points, pad, minSpan) {
    var xs = points.map(function (p) { return p.x; }), ys = points.map(function (p) { return p.y; });
    var x0 = Math.min.apply(null, xs) - pad, x1 = Math.max.apply(null, xs) + pad;
    var y0 = Math.min.apply(null, ys) - pad, y1 = Math.max.apply(null, ys) + pad;
    if (x1 - x0 < minSpan) { var cx = (x0 + x1) / 2; x0 = cx - minSpan / 2; x1 = cx + minSpan / 2; }
    if (y1 - y0 < minSpan) { var cy = (y0 + y1) / 2; y0 = cy - minSpan / 2; y1 = cy + minSpan / 2; }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function renderMap(homes) {
    var section = $("map");
    mapHomes = homes;
    if (!window.BUSHBY_EUROPE || !homes.length) { section.hidden = true; return; }
    section.hidden = false;
    var land = $("map-land");
    if (!land.getAttribute("d")) land.setAttribute("d", window.BUSHBY_EUROPE.path);

    var frame = $("map-frame"), W = frame.clientWidth || 360, H = frame.clientHeight || W * 0.75;
    var pts = [], missing = 0;
    homes.forEach(function (h) {
      var loc = parseLoc(h.check.desc);
      if (!loc) { missing++; return; }
      var xy = project(loc[0], loc[1]);
      pts.push({ h: h, x: xy[0], y: xy[1], s: mapStatus(h.kind) });
    });

    var view = fitBox(state.mapView || (pts.length ? boxAround(pts, 320, 1100) : MAP_DEFAULT), W, H);
    $("map-svg").setAttribute("viewBox", [view.x, view.y, view.w, view.h].map(Math.round).join(" "));
    var reset = $("map-reset");
    reset.hidden = !state.mapView;
    if (state.mapView) {
      var away = pts.filter(function (p) {
        return p.s !== "ok" && (p.x < view.x || p.x > view.x + view.w || p.y < view.y || p.y > view.y + view.h);
      });
      var awayDown = away.filter(function (p) { return p.s === "down"; }).length;
      reset.textContent = !away.length ? "Show all homes" :
        "Show all \u00b7 " + (awayDown ? awayDown + " offline" : away.length + " need you") + " elsewhere";
    }

    // Group dots that would overlap on screen; the group takes its worst status.
    var groups = [];
    pts.forEach(function (p) {
      p.px = (p.x - view.x) / view.w * W; p.py = (p.y - view.y) / view.h * H;
      if (p.px < -10 || p.px > W + 10 || p.py < -10 || p.py > H + 10) return;
      var g = null;
      for (var i = 0; i < groups.length && !g; i++) {
        var q = groups[i];
        if (Math.abs(q.px - p.px) < 26 && Math.abs(q.py - p.py) < 26) g = q;
      }
      if (g) { g.items.push(p); if (MAP_WORST[p.s] < MAP_WORST[g.s]) g.s = p.s; }
      else groups.push({ px: p.px, py: p.py, s: p.s, items: [p] });
    });
    groups.sort(function (a, b) { return MAP_WORST[a.s] - MAP_WORST[b.s]; }); // worst first in tab order; z-index puts it on top

    // Place name labels beside problem dots without covering another dot or label.
    var placed = [];
    function hits(r) {
      if (r.x0 < 2 || r.x1 > W - 2 || r.y0 < 2 || r.y1 > H - 2) return true;
      if (state.mapView && r.x1 > W - 270 && r.y1 > H - 64) return true; // keep clear of the "Show all" button
      return groups.some(function (q) { return q.px + 13 > r.x0 && q.px - 13 < r.x1 && q.py + 13 > r.y0 && q.py - 13 < r.y1 && q !== r.g; }) ||
        placed.some(function (o) { return o.x0 < r.x1 && o.x1 > r.x0 && o.y0 < r.y1 && o.y1 > r.y0; });
    }
    groups.slice().sort(function (a, b) { return MAP_WORST[a.s] - MAP_WORST[b.s]; }).forEach(function (g) {
      if (g.s === "ok") return;
      var names = g.items.map(function (p) { return p.h.check.name || "Home"; });
      g.text = names.length === 1 ? names[0] : names.length === 2 && (names[0] + ", " + names[1]).length <= 26 ? names[0] + ", " + names[1] : names.length + " homes";
      var w = textWidth(g.text) + 20, half = 12, gap = g.items.length === 1 ? (g.s === "down" ? 15 : 12) : 17;
      var right = { g: g, x0: g.px + gap, x1: g.px + gap + w, y0: g.py - half, y1: g.py + half };
      var left = { g: g, x0: g.px - gap - w, x1: g.px - gap, y0: g.py - half, y1: g.py + half };
      if (!hits(right)) { g.side = "right"; placed.push(right); }
      else if (!hits(left)) { g.side = "left"; placed.push(left); }
    });

    var box = $("markers");
    box.textContent = "";
    groups.forEach(function (g, idx) {
      var single = g.items.length === 1, h = g.items[0].h;
      var counts = {};
      g.items.forEach(function (p) { counts[p.s] = (counts[p.s] || 0) + 1; });
      var label = single
        ? (h.check.name || "Home") + ": " + STATE_LABEL[h.kind] + ". Show this home."
        : g.items.length + " homes here: " + ["down", "warn", "idle", "ok"].filter(function (k) { return counts[k]; })
            .map(function (k) { return counts[k] + " " + MAP_WORD[k]; }).join(", ") + ". Zoom in.";
      var kids = [el("span", { class: "dot " + g.s, text: single ? "" : String(g.items.length) })];
      if (g.side) kids.push(el("span", { class: "label", "aria-hidden": "true", text: g.text }));
      var b = el("button", {
        class: "marker" + (single ? "" : " cluster") + (single && g.s === "down" ? " single-down" : "") + (g.side === "left" ? " flip" : ""),
        type: "button", "aria-label": label,
        onclick: function () {
          if (single) { focusHome(h); return; }
          state.mapView = boxAround(g.items, 150, 500);
          renderMap(mapHomes);
          $("map-live").textContent = "Zoomed in to " + g.items.length + " homes.";
          $("map-reset").focus();
        }
      }, kids);
      b.style.zIndex = String(groups.length - idx);
      b.style.left = (g.px / W * 100) + "%";
      b.style.top = (g.py / H * 100) + "%";
      box.appendChild(b);
    });

    var hint = $("map-hint");
    hint.hidden = !missing;
    hint.textContent = "";
    if (missing) {
      hint.appendChild(document.createTextNode((missing === 1 ? "1 home isn't" : missing + " homes aren't") + " on the map yet. In Healthchecks.io, add its town's position to the check's description, like "));
      hint.appendChild(el("code", { text: "loc 55.7,12.5" }));
      hint.appendChild(document.createTextNode(" (latitude, longitude, one decimal)."));
    }
  }

  function focusHome(h) {
    var target = document.getElementById(homeId(h));
    if (!target) return;
    var group = target.closest("details");
    if (group) group.open = true;
    target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    target.classList.remove("flash"); void target.offsetWidth; target.classList.add("flash");
  }

  /* ---------- settings ---------- */
  function armed(btn, label, armedLabel, action) {
    // Two-tap confirm: first tap arms the button for 4 seconds, second tap acts.
    var timer = null;
    btn.addEventListener("click", function () {
      if (btn.classList.contains("armed")) { clearTimeout(timer); btn.classList.remove("armed"); btn.textContent = label; action(); return; }
      btn.classList.add("armed"); btn.textContent = armedLabel;
      timer = setTimeout(function () { btn.classList.remove("armed"); btn.textContent = label; }, 4000);
    });
  }

  function renderKeys() {
    var ul = $("keys");
    ul.textContent = "";
    if (!state.keys.length) { ul.appendChild(el("li", null, [el("span", { class: "muted-note", text: "No keys yet." })])); return; }
    state.keys.forEach(function (k, i) {
      var rm = el("button", { class: "btn quiet danger", type: "button", text: "Remove", "aria-label": "Remove the key for " + k.label });
      armed(rm, "Remove", "Tap to remove", function () {
        state.keys.splice(i, 1); save(STORE_KEYS, state.keys);
        state.homes = state.homes.filter(function (h) { return h.key !== k.key; });
        if (!state.keys.length) { state.loadedAt = null; lastHeadline = ""; }
        renderKeys(); render(); refresh();
      });
      ul.appendChild(el("li", null, [
        el("div", null, [document.createTextNode(k.label), el("small", { text: (k.readOnly ? "Read-only key" : "Full key") + " ending …" + k.key.slice(-4) })]),
        rm
      ]));
    });
  }

  function addKey(ev) {
    ev.preventDefault();
    var label = $("key-label").value.trim() || "Project " + (state.keys.length + 1);
    var key = $("key-value").value.trim();
    var err = $("key-error"), btn = $("key-add");
    err.hidden = true;
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(key)) { err.textContent = "That doesn't look like a Healthchecks API key. Copy it again from API Access."; err.hidden = false; return; }
    if (state.keys.some(function (k) { return k.key === key; })) { err.textContent = "That key is already added."; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = "Checking with Healthchecks…";
    api(key, "/checks/").then(function (j) {
      var checks = (j && j.checks) || [];
      state.keys.push({ label: label, key: key, readOnly: checks.length ? !("ping_url" in checks[0]) : false });
      if (!save(STORE_KEYS, state.keys)) { err.textContent = "Added for now, but this browser won't keep it after you close the page."; err.hidden = false; }
      $("key-label").value = ""; $("key-value").value = "";
      renderKeys(); render(); refresh();
    }).catch(function (e) {
      err.textContent = e.message === "key" ? "Healthchecks didn't accept that key. Check you copied all of it." : "Couldn't reach Healthchecks.io. Check the connection and try again.";
      err.hidden = false;
    }).then(function () { btn.disabled = false; btn.textContent = "Check and add"; });
  }

  function openSettings() { renderKeys(); $("key-error").hidden = true; $("settings").showModal(); }

  /* ---------- demo data (only with ?demo) ---------- */
  var DEMO_BODIES = {
    "bsh-demo1": "Home Assistant 2026.11.1\nDevices offline (2): Outdoor temp, Bedroom 3 Temp\nBatteries under 20% (0): none\nBackup: OK",
    "bsh-demo2": "Home Assistant 2026.11.1\nDevices offline (0): none\nBatteries under 20% (1): Kitchen leak sensor battery (12%)\nBackup: Last backup 61 hours ago",
    "bsh-demo3": "Home Assistant 2026.11.0\nDevices offline (0): none\nBatteries under 20% (0): none\nBackup: OK"
  };
  var DEMO_LOC = {
    "bsh-demo1": "loc 53.5,-2.2", "bsh-demo2": "loc 51.5,-2.6", "bsh-demo3": "loc 45.8,4.8",
    "bsh-demo4": "loc 53.6,10.0", "bsh-demo5": "loc 39.5,-0.4", "bsh-demo6": "loc 59.9,10.7",
    "Copenhagen": "loc 55.7,12.5", "Worthing": "loc 50.8,-0.4"
  };
  function demoData() {
    var now = Date.now(), iso = function (minAgo) { return new Date(now - minAgo * 60000).toISOString(); };
    var mk = function (name, status, lastMin, tags, n) {
      return { check: { name: name, tags: tags, desc: DEMO_LOC[name] || "", status: status, last_ping: lastMin === null ? null : iso(lastMin), timeout: 900, grace: 2700, n_pings: n, uuid: "demo-" + name },
        project: tags.indexOf("Own") >= 0 ? "Own" : "Customers", readOnly: false, key: "demo" };
    };
    return { errors: [], lists: [[
      mk("bsh-demo1", "down", 4, "Customer Ring1", 210),
      mk("bsh-demo2", "down", 9, "Customer Ring2", 95),
      mk("bsh-demo3", "down", 190, "Customer Ring2", 400),
      mk("bsh-demo4", "up", 6, "Customer Ring1", 77),
      mk("bsh-demo5", "grace", 22, "Customer Ring2", 50),
      mk("bsh-demo6", "up", 11, "Customer Ring2", 64),
      mk("Copenhagen", "up", 2, "Own", 30),
      mk("Worthing", "new", null, "Own", 0)
    ]] };
  }

  /* ---------- start ---------- */
  function start() {
    state.keys = (load(STORE_KEYS, []) || []).filter(function (k) { return k && typeof k.key === "string"; });
    forget("bushby-status:filter"); // older versions remembered a filter; it could hide homes
    $("refresh").addEventListener("click", refresh);
    $("open-settings").addEventListener("click", openSettings);
    $("empty-add").addEventListener("click", openSettings);
    $("close-settings").addEventListener("click", function () { $("settings").close(); });
    $("settings-form").addEventListener("submit", addKey);
    $("map-reset").addEventListener("click", function () {
      state.mapView = null; renderMap(mapHomes);
      $("map-live").textContent = "Showing all homes.";
      var first = document.querySelector(".marker");
      (first || $("map-frame")).focus();
    });
    if (window.ResizeObserver) {
      var lastW = 0;
      new ResizeObserver(function () {
        var w = $("map-frame").clientWidth;
        if (w && w !== lastW) { lastW = w; renderMap(mapHomes); }
      }).observe($("map-frame"));
    }
    armed($("forget-all"), "Forget all keys on this device", "Tap again to forget every key", function () {
      state.keys = []; state.homes = []; state.loadedAt = null; bodies = {}; lastHeadline = ""; forget(STORE_KEYS);
      renderKeys(); render();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      if (state.mapView) { state.mapView = null; renderMap(mapHomes); }
      if (!state.loadedAt || Date.now() - state.loadedAt > 30000) refresh();
    });
    setInterval(function () { if (document.visibilityState === "visible") refresh(); }, REFRESH_MS);
    render();
    refresh();
  }
  start();
})();
