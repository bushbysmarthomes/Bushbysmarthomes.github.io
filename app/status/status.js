/* Bushby Status: reads every home's check from Healthchecks.io and shows it as one board.
   Keys are typed into this page and kept in this browser only (localStorage). Nothing else is stored.
   No third-party scripts. All text from the API is shown with textContent, never as HTML. */
(function () {
  "use strict";

  var API = "https://healthchecks.io/api/v3";
  var STORE_KEYS = "bushby-status:keys";
  var STORE_FILTER = "bushby-status:filter";
  var REFRESH_MS = 60 * 1000;
  var DEMO = /[?&]demo\b/.test(location.search);

  var ORDER = { offline: 0, attention: 1, late: 2, idle: 3, ok: 4 };
  var LABEL = { offline: "Hub offline", attention: "Needs attention", late: "Late", ok: "All good", idle: "Not reporting" };

  var state = { keys: [], homes: [], loadedAt: null, loading: false, errors: [], filter: "all" };
  var bodies = {};          // uuid -> { n, text }  (full keys only)
  var bodyRequests = {};    // uuid -> promise
  var openCards = {};       // card id -> true when expanded

  /* ---------- storage (wrapped: it can be missing or full) ---------- */
  function load(name, fallback) {
    try { var v = localStorage.getItem(name); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(name, value) {
    try { localStorage.setItem(name, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function forget(name) { try { localStorage.removeItem(name); } catch (e) { /* ignore */ } }

  /* ---------- small DOM helper ---------- */
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
  function clock(t) {
    return new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  function stamp(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " + clock(d);
  }

  /* ---------- status of one home ---------- */
  function classify(c, now) {
    var period = Number(c.timeout) || 900, grace = Number(c.grace) || 2700;
    if (c.status === "up") return "ok";
    if (c.status === "grace") return "late";
    if (c.status === "new" || c.status === "paused") return "idle";
    if (c.status === "down") {
      var age = c.last_ping ? (now - Date.parse(c.last_ping)) / 1000 : Infinity;
      return age <= period + grace ? "attention" : "offline";
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
    return out;
  }
  function listOf(s) {
    s = (s || "").trim();
    return !s || s.toLowerCase() === "none" ? [] : s.split(/,\s*/);
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function issueSummary(p) {
    var bits = [];
    if (p.offline && p.offline.n) bits.push(plural(p.offline.n, "device offline", "devices offline"));
    if (p.batteries && p.batteries.n) bits.push(plural(p.batteries.n, "low battery", "low batteries"));
    if (p.backup && p.backup.toUpperCase() !== "OK") bits.push("backup problem");
    return bits;
  }

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
    })).then(function (lists) {
      return { lists: lists, errors: errors };
    });
  }

  function loadBody(home) {
    var c = home.check;
    if (home.readOnly || !c.uuid || !c.n_pings) return Promise.resolve(null);
    var cached = bodies[c.uuid];
    if (cached && cached.n === c.n_pings) return Promise.resolve(cached.text);
    if (bodyRequests[c.uuid]) return bodyRequests[c.uuid];
    var p = DEMO ? Promise.resolve(DEMO_BODIES[c.name] || "") :
      api(home.key, "/checks/" + encodeURIComponent(c.uuid) + "/pings/" + c.n_pings + "/body", true);
    bodyRequests[c.uuid] = p.then(function (t) {
      bodies[c.uuid] = { n: c.n_pings, text: t };
      return t;
    }).catch(function () { return null; }).then(function (t) { delete bodyRequests[c.uuid]; return t; });
    return bodyRequests[c.uuid];
  }

  /* ---------- refresh ---------- */
  function refresh() {
    if (state.loading) return;
    if (!DEMO && !state.keys.length) { render(); return; }
    state.loading = true;
    $("refresh").classList.add("spin");
    fetchAll().then(function (res) {
      var lists = res.lists, now = Date.now();
      state.errors = res.errors;
      var anyOk = lists.some(function (l) { return l !== null; });
      if (anyOk) {
        var homes = [];
        lists.forEach(function (l) { (l || []).forEach(function (h) { homes.push(h); }); });
        homes.forEach(function (h) { h.kind = classify(h.check, now); });
        state.homes = homes;
        state.loadedAt = now;
      }
      render();
      // Fetch what each home reported, problems first; a few at a time.
      var todo = state.homes.filter(function (h) { return !h.readOnly && (h.kind === "attention" || h.kind === "offline" || h.kind === "late" || openCards[cardId(h)]); });
      return runLimited(todo, 4, function (h) { return loadBody(h).then(function () { renderCard(h); }); });
    }).catch(function () {
      state.errors = ["Something went wrong loading the board."];
      render();
    }).then(function () {
      state.loading = false;
      $("refresh").classList.remove("spin");
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
  function cardId(h) { return "home-" + (h.project + "-" + (h.check.uuid || h.check.unique_key || h.check.name)).replace(/[^A-Za-z0-9_-]/g, "_"); }

  function visibleHomes() {
    var f = state.filter;
    return state.homes.filter(function (h) {
      if (f === "all") return true;
      if (f === "problems") return h.kind === "offline" || h.kind === "attention" || h.kind === "late";
      if (f.indexOf("project:") === 0) return h.project === f.slice(8);
      if (f.indexOf("tag:") === 0) return tagsOf(h).indexOf(f.slice(4)) >= 0;
      return true;
    }).sort(function (a, b) {
      return (ORDER[a.kind] - ORDER[b.kind]) || String(a.check.name).localeCompare(String(b.check.name), "en", { numeric: true });
    });
  }
  function sameWord(list, word) {
    var w = String(word).toLowerCase().replace(/s$/, "");
    return list.some(function (t) { return t.toLowerCase().replace(/s$/, "") === w; });
  }
  function tagsOf(h) { return String(h.check.tags || "").split(/\s+/).filter(Boolean); }

  function render() {
    var hasKeys = DEMO || state.keys.length > 0;
    $("empty").hidden = hasKeys;
    $("hero").hidden = !hasKeys;
    $("counts").hidden = !hasKeys;
    $("filters").hidden = !hasKeys;
    $("grid").hidden = !hasKeys;

    var notes = state.errors.slice();
    if (DEMO) notes.unshift("Demo data: these are made-up homes, to show how the board looks.");
    if (state.homes.some(function (h) { return h.readOnly; }) && !DEMO)
      notes.push("A read-only key shows each home's status. Add the project's full key to see which devices are offline.");
    $("notice").hidden = !notes.length;
    $("notice").textContent = notes.join(" ");

    $("updated").textContent = state.loadedAt ? "Updated " + clock(state.loadedAt) : (hasKeys ? "Loading…" : "No keys yet");
    if (!hasKeys) return;

    // Hero
    var n = { offline: 0, attention: 0, late: 0, ok: 0, idle: 0 };
    state.homes.forEach(function (h) { n[h.kind]++; });
    var bad = n.offline + n.attention, total = state.homes.length;
    var hero = $("hero");
    hero.className = "hero " + (bad ? "bad" : n.late ? "warn" : total ? "ok" : "");
    $("hero-title").textContent = !state.loadedAt ? "Loading…" :
      !total ? "No homes on the board yet" :
      bad ? plural(bad, "home needs", "homes need") + " attention" :
      n.late ? plural(n.late, "home is", "homes are") + " late checking in" :
      "All homes are fine";
    $("hero-sub").textContent = state.loadedAt ? plural(total, "home", "homes") + " · checked " + clock(state.loadedAt) + " · refreshes every minute" : "";

    // Counts
    var counts = $("counts");
    counts.textContent = "";
    [["offline", n.offline], ["attention", n.attention], ["late", n.late], ["ok", n.ok], ["idle", n.idle]].forEach(function (p) {
      if (p[0] === "idle" && !p[1]) return;
      counts.appendChild(el("div", { class: "count " + p[0] }, [el("b", { text: String(p[1]) }), el("span", { text: LABEL[p[0]] })]));
    });

    // Filters
    var filters = $("filters"), opts = [["all", "All"], ["problems", "Problems"]];
    var projects = []; state.homes.forEach(function (h) { if (projects.indexOf(h.project) < 0) projects.push(h.project); });
    if (projects.length > 1) projects.forEach(function (p) { opts.push(["project:" + p, p]); });
    var tags = []; state.homes.forEach(function (h) { tagsOf(h).forEach(function (t) { if (tags.indexOf(t) < 0) tags.push(t); }); });
    tags.sort().forEach(function (t) { if (!(projects.length > 1 && sameWord(projects, t))) opts.push(["tag:" + t, t]); });
    if (!opts.some(function (o) { return o[0] === state.filter; })) state.filter = "all";
    filters.textContent = "";
    opts.forEach(function (o) {
      filters.appendChild(el("button", {
        class: "chip", type: "button", "aria-pressed": String(state.filter === o[0]), text: o[1],
        onclick: function () { state.filter = o[0]; save(STORE_FILTER, o[0]); render(); }
      }));
    });

    // Cards
    var grid = $("grid");
    grid.textContent = "";
    var list = visibleHomes();
    if (!list.length && state.loadedAt) grid.appendChild(el("p", { class: "small", text: state.filter === "problems" ? "Nothing needs attention." : "No homes here." }));
    list.forEach(function (h) { grid.appendChild(buildCard(h)); });
  }

  function renderCard(h) {
    var old = document.getElementById(cardId(h));
    if (old) old.replaceWith(buildCard(h));
  }

  function buildCard(h) {
    var c = h.check, now = Date.now(), id = cardId(h);
    var body = bodies[c.uuid] && bodies[c.uuid].n === c.n_pings ? bodies[c.uuid].text : null;
    var parsed = body !== null ? parseBody(body) : null;

    var line;
    if (h.kind === "offline") line = "The hub has stopped checking in.";
    else if (h.kind === "late") line = "Check-in overdue.";
    else if (h.kind === "idle") line = c.status === "paused" ? "Paused on Healthchecks." : "Waiting for the hub's first check-in.";
    else if (h.kind === "attention") {
      if (parsed && parsed.known) line = issueSummary(parsed).join(" · ") || "The hub reported a problem.";
      else if (h.readOnly) line = "The hub reported a problem. A full key shows what.";
      else line = "The hub reported a problem. Loading details…";
    } else line = "Everything reported fine.";

    var tagNames = tagsOf(h);
    if ((state.keys.length > 1 || DEMO) && !sameWord(tagNames, h.project)) tagNames.unshift(h.project);
    var tagEls = tagNames.map(function (t) { return el("span", { class: "tag", text: t }); });

    var summary = el("summary", null, [
      el("div", { class: "card-head" }, [el("h3", { text: c.name || "(unnamed)" }), el("span", { class: "pill " + h.kind, text: LABEL[h.kind] })]),
      el("p", { class: "issue-line" + (h.kind === "ok" ? " none" : ""), text: line }),
      el("div", { class: "meta" }, [
        c.last_ping ? el("span", { text: "Last check-in " + ago(c.last_ping, now) }) : null,
        c.next_ping && h.kind === "ok" ? el("span", { text: "next by " + clock(c.next_ping) }) : null
      ]),
      tagEls.length ? el("div", { class: "tags" }, tagEls) : null
    ]);

    var details = el("details", { class: "card " + h.kind, id: id, open: !!openCards[id] }, [summary, buildDetail(h, parsed, body)]);
    details.addEventListener("toggle", function () {
      openCards[id] = details.open;
      if (details.open && body === null && !h.readOnly) loadBody(h).then(function () { renderCard(h); });
    });
    return details;
  }

  function buildDetail(h, p, body) {
    var c = h.check, rows = [];
    function row(label, value, cls) { rows.push(el("div", { class: "row" }, [el("dt", { text: label }), el("dd", { class: cls || null }, [value])])); }
    function listNode(items) { return el("ul", null, items.map(function (t) { return el("li", { text: t }); })); }

    if (p && p.known) {
      row("Devices offline", p.offline && p.offline.list.length ? listNode(p.offline.list) : document.createTextNode("None"), p.offline && p.offline.list.length ? "badtext" : "good");
      row("Low batteries", p.batteries && p.batteries.list.length ? listNode(p.batteries.list) : document.createTextNode("None"), p.batteries && p.batteries.list.length ? "badtext" : "good");
      row("Backup", document.createTextNode(p.backup || "Not reported"), p.backup && p.backup.toUpperCase() === "OK" ? "good" : "badtext");
      if (p.version) row("Home Assistant", document.createTextNode(p.version));
      if (p.unknown.length) rows.push(el("pre", { class: "raw", text: p.unknown.join("\n") }));
    } else if (body !== null && body !== undefined && String(body).trim()) {
      rows.push(el("pre", { class: "raw", text: String(body) }));
    } else if (h.readOnly) {
      rows.push(el("p", { class: "small", text: "Details need the project's full key (Settings)." }));
    } else if (!c.n_pings) {
      rows.push(el("p", { class: "small", text: "No check-ins yet." }));
    } else {
      rows.push(el("p", { class: "small", text: "Loading what the hub last reported…" }));
    }

    row("Last check-in", document.createTextNode(c.last_ping ? stamp(c.last_ping) : "Never"));
    row("Schedule", document.createTextNode("Every " + mins(c.timeout) + ", alert after " + mins(c.grace) + " more"));
    if (c.uuid && !DEMO) rows.push(el("a", { href: "https://healthchecks.io/checks/" + encodeURIComponent(c.uuid) + "/details/", target: "_blank", rel: "noopener noreferrer", text: "Open in Healthchecks.io →" }));
    return el("div", { class: "detail" }, rows);
  }
  function mins(s) { s = Number(s) || 0; return s >= 3600 && s % 3600 === 0 ? plural(s / 3600, "hour", "hours") : Math.round(s / 60) + " min"; }

  /* ---------- settings ---------- */
  function renderKeys() {
    var ul = $("keys");
    ul.textContent = "";
    if (!state.keys.length) { ul.appendChild(el("li", null, [el("span", { class: "small", text: "No keys yet." })])); return; }
    state.keys.forEach(function (k, i) {
      ul.appendChild(el("li", null, [
        el("div", null, [document.createTextNode(k.label), el("small", { text: (k.readOnly ? "Read-only key" : "Full key") + " ending …" + k.key.slice(-4) })]),
        el("button", { class: "btn ghost danger", type: "button", text: "Remove", onclick: function () {
          state.keys.splice(i, 1); save(STORE_KEYS, state.keys); state.homes = state.homes.filter(function (h) { return h.key !== k.key; });
          renderKeys(); render(); refresh();
        } })
      ]));
    });
  }

  function addKey(ev) {
    ev.preventDefault();
    var label = $("key-label").value.trim() || "Project " + (state.keys.length + 1);
    var key = $("key-value").value.trim();
    var err = $("key-error"), btn = $("key-add");
    err.hidden = true;
    if (!/^[A-Za-z0-9_-]{8,200}$/.test(key)) { err.textContent = "That doesn't look like a Healthchecks API key."; err.hidden = false; return; }
    if (state.keys.some(function (k) { return k.key === key; })) { err.textContent = "That key is already added."; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = "Checking…";
    api(key, "/checks/").then(function (j) {
      var checks = (j && j.checks) || [];
      state.keys.push({ label: label, key: key, readOnly: checks.length ? !("ping_url" in checks[0]) : false });
      if (!save(STORE_KEYS, state.keys)) { err.textContent = "Added for now, but this browser won't keep it after you close the page."; err.hidden = false; }
      $("key-label").value = ""; $("key-value").value = "";
      renderKeys(); render(); refresh();
    }).catch(function (e) {
      err.textContent = e.message === "key" ? "Healthchecks didn't accept that key." : "Couldn't reach Healthchecks.io. Check the connection and try again.";
      err.hidden = false;
    }).then(function () { btn.disabled = false; btn.textContent = "Check and add"; });
  }

  function openSettings() { renderKeys(); $("key-error").hidden = true; $("settings").showModal(); }

  /* ---------- demo data (only with ?demo) ---------- */
  var DEMO_BODIES = {
    "bsh-demo1": "Home Assistant 2026.11.1\nDevices offline (2): Outdoor temp, Bedroom 3 Temp\nBatteries under 20% (0): none\nBackup: OK",
    "bsh-demo2": "Home Assistant 2026.11.1\nDevices offline (0): none\nBatteries under 20% (1): Kitchen leak sensor battery (12%)\nBackup: Last backup 61 hours ago",
    "bsh-demo4": "Home Assistant 2026.11.0\nDevices offline (0): none\nBatteries under 20% (0): none\nBackup: OK"
  };
  function demoData() {
    var now = Date.now(), iso = function (minAgo) { return new Date(now - minAgo * 60000).toISOString(); };
    var mk = function (name, status, lastMin, tags, n) {
      return { check: { name: name, tags: tags, status: status, last_ping: lastMin === null ? null : iso(lastMin), next_ping: lastMin === null ? null : new Date(Date.parse(iso(lastMin)) + 900000).toISOString(), timeout: 900, grace: 2700, n_pings: n, uuid: "demo-" + name },
        project: tags.indexOf("Own") >= 0 ? "Own" : "Customers", readOnly: false, key: "demo" };
    };
    return { errors: [], lists: [[
      mk("bsh-demo1", "down", 4, "Customer Ring1", 210),
      mk("bsh-demo2", "down", 9, "Customer Ring2", 95),
      mk("bsh-demo3", "down", 190, "Customer Ring2", 400),
      mk("bsh-demo4", "up", 6, "Customer Ring1", 77),
      mk("bsh-demo5", "grace", 22, "Customer Ring2", 50),
      mk("Copenhagen", "up", 2, "Own", 30),
      mk("Worthing", "new", null, "Own", 0)
    ]] };
  }

  /* ---------- start ---------- */
  function start() {
    state.keys = (load(STORE_KEYS, []) || []).filter(function (k) { return k && typeof k.key === "string"; });
    state.filter = load(STORE_FILTER, "all") || "all";
    $("refresh").addEventListener("click", refresh);
    $("open-settings").addEventListener("click", openSettings);
    $("empty-add").addEventListener("click", openSettings);
    $("close-settings").addEventListener("click", function () { $("settings").close(); });
    $("settings-form").addEventListener("submit", addKey);
    $("forget-all").addEventListener("click", function () {
      if (!confirm("Remove every key from this device?")) return;
      state.keys = []; state.homes = []; state.loadedAt = null; bodies = {}; forget(STORE_KEYS);
      renderKeys(); render();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && (!state.loadedAt || Date.now() - state.loadedAt > 30000)) refresh();
    });
    setInterval(function () { if (document.visibilityState === "visible") refresh(); }, REFRESH_MS);
    render();
    refresh();
  }
  start();
})();
