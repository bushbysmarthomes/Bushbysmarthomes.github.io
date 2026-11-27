// Bushby Home app: signs in to the home's own Home Assistant and shows its 3D model.
// Each home has its own folder (e.g. /app/copenhagen/) that sets window.BUSHBY_HOME = {name, key}.
// Nothing here is home-specific or secret: the home's address and sign-in are kept only on this device.
(function () {
  const HOME = window.BUSHBY_HOME || { name: "Bushby Home", key: "home" };
  const K = "bushby:" + HOME.key + ":";
  const store = {
    get(k) { try { return localStorage.getItem(K + k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(K + k) : localStorage.setItem(K + k, v); } catch (e) {} },
  };
  const saveTokens = (t) => store.set("tokens", t ? JSON.stringify(t) : null);
  const loadTokens = async () => { try { return JSON.parse(store.get("tokens") || "null"); } catch (e) { return null; } };

  // ---------- shell screens (sign-in, loading, problems) ----------
  const css = `
  :root{--bg:#08131f;--card:#0f1d2b;--fg:#e8eef4;--muted:#8fa0b0;--teal:#15c7c1;--line:rgba(232,238,244,.12)}
  html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .bh-shell{min-height:100%;display:grid;place-items:center;padding:24px 16px;box-sizing:border-box}
  .bh-card{width:100%;max-width:420px;display:grid;gap:16px;text-align:center}
  .bh-card img{width:96px;height:96px;margin:0 auto;border-radius:22px}
  .bh-card h1{margin:0;font-size:26px;letter-spacing:.01em}
  .bh-card p{margin:0;color:var(--muted)}
  .bh-card label{text-align:left;font-weight:600;font-size:14px;display:grid;gap:6px}
  .bh-card input{font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;outline:none}
  .bh-card input:focus{border-color:var(--teal)}
  .bh-card button{font:inherit;font-weight:700;border:0;border-radius:12px;padding:14px;background:var(--teal);color:#04201f;cursor:pointer}
  .bh-card button.ghost{background:transparent;color:var(--muted);border:1px solid var(--line);font-weight:600}
  .bh-card small{color:var(--muted);font-size:13px}
  .bh-card .err{color:#ff9a8a;font-size:14px;text-align:left}
  .bh-card pre{text-align:left;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px;font-size:12.5px;overflow:auto;margin:0}
  .bh-spin{width:34px;height:34px;border:3px solid var(--line);border-top-color:var(--teal);border-radius:50%;margin:0 auto;animation:bhs 1s linear infinite}
  @keyframes bhs{to{transform:rotate(360deg)}}
  .bh-gear{margin-right:6px}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const ICON = new URL("icons/icon-192-v2.png", document.currentScript ? document.currentScript.src : location.href).href;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function screen(html) {
    let el = document.getElementById("bh-shell");
    if (!el) { el = document.createElement("main"); el.id = "bh-shell"; el.className = "bh-shell"; document.body.appendChild(el); }
    el.innerHTML = `<div class="bh-card"><img src="${ICON}" alt=""><h1>${esc(HOME.name)}</h1>${html}</div>`;
    return el;
  }
  const loading = (msg) => screen(`<div class="bh-spin"></div><p>${esc(msg)}</p>`);

  function normalise(u) {
    u = String(u || "").trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    try { const x = new URL(u); return x.protocol + "//" + x.host; } catch (e) { return ""; }
  }

  function showSetup(problem) {
    const el = screen(`
      <p>Sign in to your home to see it in 3D.</p>
      <label>Your home's address
        <input id="bh-url" type="url" inputmode="url" autocomplete="url" placeholder="https://xxxx.ui.nabu.casa" value="${esc(store.get("url") || "")}">
      </label>
      ${problem ? `<div class="err">${esc(problem)}</div>` : ""}
      <button id="bh-go" type="button">Sign in</button>
      <small>You'll sign in with your own Home Assistant account. Your sign-in stays on this device.</small>`);
    const go = async () => {
      const url = normalise(el.querySelector("#bh-url").value);
      if (!url) return showSetup("That doesn't look like a web address.");
      if (url.startsWith("http://") && location.protocol === "https:")
        return showSetup("Use the secure address that starts with https:// (your Nabu Casa link).");
      store.set("url", url);
      loading("Opening your home's sign-in page…");
      try { await HAWS.getAuth({ hassUrl: url, saveTokens, loadTokens: async () => null }); }
      catch (e) { showSetup("Couldn't reach that address. Check it and try again."); }
    };
    el.querySelector("#bh-go").onclick = go;
    el.querySelector("#bh-url").onkeydown = (e) => { if (e.key === "Enter") go(); };
  }

  function showProblem(title, body, extra, autoRetry) {
    const el = screen(`<p><b>${esc(title)}</b></p><p>${body}</p>${extra || ""}
      <button id="bh-retry" type="button">Try again</button>
      <button id="bh-out" class="ghost" type="button">Change home / sign out</button>`);
    el.querySelector("#bh-retry").onclick = () => location.reload();
    el.querySelector("#bh-out").onclick = signOut;
    if (autoRetry) {
      // Try again by itself when the phone comes back online, when the app is reopened, and every 20 s (up to 15 times).
      let n = 0; try { n = +sessionStorage.getItem(K + "retries") || 0; sessionStorage.setItem(K + "retries", n + 1); } catch (e) {}
      addEventListener("online", () => location.reload(), { once: true });
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") location.reload(); });
      if (n < 15) setTimeout(() => { if (document.visibilityState === "visible") location.reload(); }, 20000);
    }
  }

  function signOut() {
    if (!confirm("Sign out of " + HOME.name + " on this device?")) return;
    saveTokens(null);
    location.replace(location.pathname);
  }

  // ---------- connection check: ping home; no answer in 4 s means the connection is dead, so open a new one ----------
  let liveConn = null, checking = false;
  async function checkConn() {
    const conn = liveConn; if (!conn || checking) return;
    checking = true;
    try { await Promise.race([conn.ping(), new Promise((_, r) => setTimeout(() => r("timeout"), 4000))]); }
    catch (e) { try { conn.reconnect(true); } catch (x) { location.reload(); } }
    finally { checking = false; }
  }

  // ---------- a stand-in for Home Assistant's own frontend object, which the 3D model expects ----------
  async function makeHass(conn, auth, base) {
    const hass = { states: {}, entities: {}, areas: {}, devices: {}, services: {} };
    liveConn = conn;
    // A phone that has been asleep can keep a dead connection that never reports closing: then the model shows old
    // readings and button presses never reach home (27 Nov 2026, Worthing). Give up after 8 s, reconnect, and say so.
    const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("No answer from home. Reconnecting, try again in a few seconds.")), ms))]);
    hass.callService = (d, s, data) => withTimeout(HAWS.callService(conn, d, s, data), 8000).catch((e) => { checkConn(); throw e; });
    hass.callWS = (msg) => conn.sendMessagePromise(msg);
    // Home Assistant's REST API, used e.g. to add or delete automations (admin logins only)
    hass.callApi = async (method, path, body) => {
      if (auth.expired) await auth.refreshAccessToken();
      const r = await fetch(base + "/api/" + path, {
        method,
        headers: { Authorization: "Bearer " + auth.accessToken, "Content-Type": "application/json" },
        body: body == null ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      if (!r.ok) { const e = new Error(r.status + " " + (text || r.statusText)); e.status_code = r.status; throw e; }
      try { return JSON.parse(text); } catch (e) { return text; }
    };
    try { hass.services = await conn.sendMessagePromise({ type: "get_services" }); } catch (e) {}
    const reg = async () => {
      try {
        const r = await conn.sendMessagePromise({ type: "config/entity_registry/list_for_display" });
        const ents = {};
        (r.entities || []).forEach((e) => { ents[e.ei] = { entity_id: e.ei, area_id: e.ai || null, device_id: e.di || null, hidden: !!e.hb, platform: e.pl || null, entity_category: e.ec != null ? ((r.entity_categories || {})[e.ec] || "config") : null /* ec is a number (0 = config, 1 = diagnostic); 0 was read as 'no category' and the model controlled the plug's LED (27 Nov 2026) */ }; });
        hass.entities = ents;
      } catch (e) {}
      try { const a = await conn.sendMessagePromise({ type: "config/area_registry/list" }); hass.areas = Object.fromEntries(a.map((x) => [x.area_id, x])); } catch (e) {}
      try { const d = await conn.sendMessagePromise({ type: "config/device_registry/list" }); hass.devices = Object.fromEntries(d.map((x) => [x.id, { id: x.id, area_id: x.area_id, name: x.name, name_by_user: x.name_by_user }])); } catch (e) {}
    };
    await reg();
    return hass;
  }

  // ---------- reaching the home ----------
  // A home can have more than one secure address (its Home Assistant Cloud link, its own web address).
  // The app remembers the ones the home reports and tries each, retrying a few times, before giving up.
  const alts = () => { try { return JSON.parse(store.get("alts") || "[]"); } catch (e) { return []; } };
  async function connectAny(auth) {
    const first = auth.data.hassUrl;
    const list = [first, store.get("url"), ...alts()].filter((u, i, a) => u && u.startsWith("https://") && a.indexOf(u) === i);
    let last = HAWS.ERR_CANNOT_CONNECT;
    for (const u of list) {
      const a = u === first ? auth : new HAWS.Auth({ ...auth.data, hassUrl: u }, saveTokens);
      try { return { conn: await HAWS.createConnection({ auth: a, setupRetry: 2 }), auth: a }; }
      catch (e) { if (e === HAWS.ERR_INVALID_AUTH) throw e; last = e; }
    }
    throw last;
  }
  async function learnAddresses(conn, base, known) {
    const found = [...(known || [])];
    try { const c = await conn.sendMessagePromise({ type: "cloud/status" }); if (c && c.remote_enabled && c.remote_domain) found.push("https://" + c.remote_domain); } catch (e) {}
    try { const cfg = await HAWS.getConfig(conn); [cfg.external_url, cfg.internal_url].forEach((u) => found.push(normalise(u))); } catch (e) {}
    const keep = [...found, ...alts()].filter((u, i, a) => u && u.startsWith("https://") && u !== base && a.indexOf(u) === i).slice(0, 4);
    store.set("alts", keep.length ? JSON.stringify(keep) : null);
  }

  // ---------- start ----------
  async function start() {
    const url = store.get("url");
    const query = new URLSearchParams(location.search);
    const fromSignIn = query.has("auth_callback");
    if (!fromSignIn && !store.get("tokens")) return showSetup();
    loading(fromSignIn ? "Signing you in…" : "Connecting to your home…");
    let auth;
    try { auth = await HAWS.getAuth({ hassUrl: url || undefined, saveTokens, loadTokens }); }
    catch (e) { saveTokens(null); return showSetup("Sign-in didn't finish. Please try again."); }
    if (fromSignIn) { store.set("url", auth.data.hassUrl); history.replaceState(null, "", location.pathname); }

    let conn;
    const known = [auth.data.hassUrl, store.get("url")];
    try { ({ conn, auth } = await connectAny(auth)); }
    catch (e) {
      if (e === HAWS.ERR_INVALID_AUTH) { saveTokens(null); return showSetup("You've been signed out. Please sign in again."); }
      return showProblem("Can't reach your home", "Your home didn't answer. Check this phone is online, and that the Home Assistant box at home is switched on. The app will keep trying.", "", true);
    }
    try { sessionStorage.removeItem(K + "retries"); } catch (e) {}
    const base = auth.data.hassUrl;
    if (store.get("url") !== base) store.set("url", base);
    learnAddresses(conn, base, known);
    conn.addEventListener("reconnect-error", (c, err) => { if (err === HAWS.ERR_INVALID_AUTH) { saveTokens(null); location.reload(); } });

    // Find the 3D model. Its folder has a hard-to-guess name that only the signed-in home knows (from its 3D Home sidebar page).
    loading("Loading your 3D home…");
    let moduleUrl = null;
    try {
      const panels = await conn.sendMessagePromise({ type: "get_panels" });
      const p = Object.values(panels || {}).find((x) => x && x.component_name === "custom" && x.config && x.config._panel_custom && x.config._panel_custom.name === "bushby-home");
      if (p && p.config._panel_custom.module_url) moduleUrl = new URL(p.config._panel_custom.module_url, base + "/").href;
    } catch (e) {}
    const notInstalled = () => showProblem("Your 3D home isn't installed yet", "Your home is connected, but its 3D model isn't set up in Home Assistant yet. Ask Bushby Smart Homes to install it.");
    if (!moduleUrl) return notInstalled();
    try {
      const r = await fetch(new URL("home.html", moduleUrl).href, { method: "HEAD", cache: "no-cache" });
      if (!r.ok) return notInstalled();
    } catch (e) {
      return showProblem("One setting is missing at home",
        "Home Assistant needs to allow the Bushby app to load your 3D model. In Home Assistant's HTTP settings, add this to the allowed CORS origins (Bushby Smart Homes can do this for you):",
        `<pre>${location.origin}</pre>`);
    }

    const hass = await makeHass(conn, auth, base);
    window.__bushbyTitle = HOME.name;
    try { const u = new URL(moduleUrl); u.searchParams.set("t", Date.now()); await import(u.href); }
    catch (e) { return showProblem("Couldn't load your 3D home", "Something went wrong loading the model. Try again in a minute."); }

    const el = document.createElement("bushby-home");
    window.addEventListener("bushby-ready", () => {
      const shell = document.getElementById("bh-shell"); if (shell) shell.remove();
      const bar = document.querySelector("header.bar");
      if (bar) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "btn bh-gear"; b.textContent = "⚙"; b.title = "Sign out or change home"; b.setAttribute("aria-label", "Sign out or change home");
        b.onclick = signOut; bar.insertBefore(b, bar.firstChild);
      }
    }, { once: true });
    let started = false;
    // keep the connection honest: check it whenever the app comes back to the front, comes back online, and every 30 s
    addEventListener("online", checkConn);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkConn(); });
    setInterval(() => { if (document.visibilityState === "visible") checkConn(); }, 30000);
    HAWS.subscribeEntities(conn, (ents) => {
      hass.states = ents;
      if (!started) { started = true; document.body.appendChild(el); }
      el.hass = { ...hass };
    });
  }

  // Wall screens: hide the phone/tablet bars and keep the screen on
  if (HOME.wall) {
    const full = () => {
      if (document.fullscreenElement || matchMedia("(display-mode: fullscreen)").matches) return;
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    };
    addEventListener("pointerdown", full, { capture: true });
    let lock = null;
    const awake = async () => { try { if (navigator.wakeLock && !lock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => (lock = null)); } } catch (e) {} };
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") awake(); });
    awake();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
