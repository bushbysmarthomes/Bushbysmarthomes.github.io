// Bushby Smart Homes: 3D home panel for Home Assistant.
// Loads home.html (the 3D model) into the panel and gives it a live link to this Home Assistant,
// using the signed-in user's own connection. Nothing goes through Claude or any outside service.
// Install: put this folder in /config/www/<its own random name>/ and add panel_custom to configuration.yaml (see README).
// Everything loads from the folder this file sits in, so the folder can have any (hard-to-guess) name,
// and it works both in the Home Assistant sidebar and in the Bushby app.
const BASE = new URL("./", import.meta.url).href;
const SUFFIX = /^(assist__|ha-mcp-server-tool-search__)/;

let HASS = null;
const hassListeners = new Set();
// Shared with optional add-ons such as the Automations page
window.__bushby = { hass: () => HASS, onHass: (cb) => { hassListeners.add(cb); return () => hassListeners.delete(cb); } };
const live = { listeners: new Set(), timer: null, last: 0, exposed: undefined };

// ---------- live states, in the same text form as Home Assistant's GetLiveContext tool ----------
async function loadExposed() {
  if (live.exposed !== undefined) return;
  try {
    const r = await HASS.callWS({ type: "homeassistant/expose_entity/list" });
    const ex = (r && r.exposed_entities) || {};
    live.exposed = new Set(Object.keys(ex).filter((id) => ex[id] && ex[id].conversation));
  } catch (e) {
    live.exposed = null; // not an admin: show every entity that isn't hidden
  }
}
function areaName(id) {
  const ent = HASS.entities && HASS.entities[id];
  let a = ent && ent.area_id;
  if (!a && ent && ent.device_id && HASS.devices && HASS.devices[ent.device_id]) a = HASS.devices[ent.device_id].area_id;
  return a && HASS.areas && HASS.areas[a] ? HASS.areas[a].name : "";
}
const q = (v) => "'" + String(v).replace(/\n/g, " ").replace(/'/g, "''") + "'";
function liveText() {
  const out = [];
  Object.keys(HASS.states).sort().forEach((id) => {
    if (live.exposed && !live.exposed.has(id)) return;
    const ent = HASS.entities && HASS.entities[id];
    if (!live.exposed && ent && (ent.hidden || ent.hidden_by)) return;
    const st = HASS.states[id];
    const a = st.attributes || {};
    out.push("- names: " + (a.friendly_name || id));
    out.push("  domain: " + id.split(".")[0]);
    out.push("  state: " + q(st.state));
    const ar = areaName(id);
    if (ar) out.push("  areas: " + ar);
    const keys = Object.keys(a).filter((k) => k !== "friendly_name" && /^[a-z_]+$/i.test(k) && a[k] !== null && typeof a[k] !== "object");
    if (keys.length) {
      out.push("  attributes:");
      keys.forEach((k) => out.push("    " + k + ": " + q(a[k])));
    }
  });
  return out.join("\n");
}
const liveResult = () => ({ payload: liveText(), cache: { storedAt: Date.now() } });
function pushLive() {
  if (!live.listeners.size || !HASS) return;
  const now = Date.now();
  const go = () => {
    live.timer = null;
    live.last = Date.now();
    const r = liveResult();
    live.listeners.forEach((cb) => { try { cb({ type: "data", result: r }); } catch (e) {} });
  };
  if (now - live.last > 1500) go();
  else if (!live.timer) live.timer = setTimeout(go, 1500 - (now - live.last));
}

// ---------- actions: the page asks by device name, as Assist does ----------
function err(code, message) { const e = new Error(message); e.code = code; return e; }
function findEntity(args, domains) {
  const name = String(args.name || "").trim().toLowerCase();
  const want = args.domain ? [].concat(args.domain) : domains;
  const ids = Object.keys(HASS.states).filter((id) => !want || want.includes(id.split(".")[0]));
  let hit = ids.filter((id) => String(HASS.states[id].attributes.friendly_name || "").toLowerCase() === name);
  if (!hit.length && name) hit = ids.filter((id) => id.split(".")[1] === name.replace(/[^a-z0-9]+/g, "_"));
  if (!hit.length && args.area) {
    const ar = String(args.area).toLowerCase();
    hit = ids.filter((id) => areaName(id).toLowerCase() === ar);
  }
  if (!hit.length) throw err("tool_error", `No device called "${args.name || args.area || "?"}" in Home Assistant`);
  if (live.exposed && hit.length > 1) { const ex = hit.filter((id) => live.exposed.has(id)); if (ex.length) hit = ex; }
  return hit;
}
async function turn(args, on) {
  const ids = findEntity(args);
  for (const id of ids) {
    const d = id.split(".")[0];
    if (d === "script") await HASS.callService("script", on ? "turn_on" : "turn_off", { entity_id: id });
    else if (d === "scene") { if (on) await HASS.callService("scene", "turn_on", { entity_id: id }); }
    else if (d === "button" || d === "input_button") await HASS.callService(d, "press", { entity_id: id });
    else if (d === "cover") await HASS.callService("cover", on ? "open_cover" : "close_cover", { entity_id: id });
    else if (d === "lock") await HASS.callService("lock", on ? "lock" : "unlock", { entity_id: id });
    else if (d === "vacuum") await HASS.callService("vacuum", on ? "start" : "return_to_base", { entity_id: id });
    else await HASS.callService("homeassistant", on ? "turn_on" : "turn_off", { entity_id: id });
  }
  return { payload: "ok" };
}
async function callTool(server, tool, args) {
  if (!HASS) throw err("server_unavailable", "Home Assistant not ready");
  args = args || {};
  const t = String(tool).replace(SUFFIX, "");
  if (t === "homeassistant__GetLiveContext") { await loadExposed(); return liveResult(); }
  if (t === "intent__HassTurnOn") return turn(args, true);
  if (t === "intent__HassTurnOff") return turn(args, false);
  if (t === "light__HassLightSet") {
    const data = {};
    if (args.brightness != null) data.brightness_pct = +args.brightness;
    if (args.color) data.color_name = args.color;
    if (args.temperature != null) data.color_temp_kelvin = +args.temperature;
    for (const id of findEntity(args, ["light"])) await HASS.callService("light", "turn_on", { entity_id: id, ...data });
    return { payload: "ok" };
  }
  if (t === "vacuum__HassVacuumStart" || t === "vacuum__HassVacuumReturnToBase") {
    for (const id of findEntity(args, ["vacuum"])) await HASS.callService("vacuum", t.endsWith("Start") ? "start" : "return_to_base", { entity_id: id });
    return { payload: "ok" };
  }
  const sc = t.match(/^script__(.+)$/);
  if (sc) { await HASS.callService("script", sc[1], args); return { payload: "ok" }; }
  throw err("tool_error", "This screen can't do " + t + " yet");
}
const mcp = {
  callTool: (s, t, a) => callTool(s, t, a).catch((e) => { throw e.code ? e : err("tool_error", (e && e.message) || String(e)); }),
  watchTool: (s, t, a, cb) => {
    if (String(t).replace(SUFFIX, "") !== "homeassistant__GetLiveContext") return () => {};
    live.listeners.add(cb);
    return () => live.listeners.delete(cb);
  },
  invalidate: async () => {},
};

// ---------- storage: notifications in this user's Home Assistant profile, climate charts from HA's own history ----------
const CLIM_DC = { temperature: "t", humidity: "h", carbon_dioxide: "c" };
const skey = (n) => n.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "sensor";
const pad2 = (n) => String(n).padStart(2, "0");
const dayCache = {};
async function climateDay(day) {
  const [Y, M, D] = day.split("-").map(Number);
  const start = new Date(Y, M - 1, D), end = new Date(Y, M - 1, D + 1);
  const now = Date.now();
  if (start.getTime() > now) return null;
  if (dayCache[day] && (end.getTime() < now || now - dayCache[day].at < 120000)) return dayCache[day].doc;
  await loadExposed();
  const sensors = Object.keys(HASS.states).filter((id) => {
    if (!id.startsWith("sensor.")) return false;
    if (live.exposed && !live.exposed.has(id)) return false;
    return CLIM_DC[String(HASS.states[id].attributes.device_class || "").toLowerCase()];
  });
  if (!sensors.length) return null;
  const hist = await HASS.callWS({
    type: "history/history_during_period", start_time: start.toISOString(), end_time: end.toISOString(),
    entity_ids: sensors, minimal_response: true, no_attributes: true, significant_changes_only: false,
  });
  const n = {}, s = {};
  sensors.forEach((id) => {
    const a = HASS.states[id].attributes, v = CLIM_DC[String(a.device_class).toLowerCase()];
    const base = String(a.friendly_name || id).replace(/\s*(temperature|humidity|carbon dioxide|co2)$/i, "");
    const k = skey(base);
    n[k] = base;
    const pts = (hist[id] || []).map((p) => ({ t: (p.lu || p.lc || 0) * 1000, x: parseFloat(p.s) })).sort((a, b) => a.t - b.t);
    let i = 0, cur = null;
    for (let tt = start.getTime(); tt < Math.min(end.getTime(), now); tt += 300000) {
      while (i < pts.length && pts[i].t <= tt + 299999) { cur = pts[i].x; i++; }
      if (cur == null || !isFinite(cur)) continue;
      const d = new Date(tt), slot = pad2(d.getHours()) + pad2(d.getMinutes());
      ((s[slot] = s[slot] || {})[k] = s[slot][k] || {})[v] = v === "c" ? Math.round(cur) : Math.round(cur * 10) / 10;
    }
  });
  const doc = Object.keys(s).length ? { day, n, s } : null;
  dayCache[day] = { at: now, doc };
  return doc;
}
function docRef(path) {
  const notes = path === "notes/log";
  const clim = path.match(/^climate\/(\d{4}-\d{2}-\d{2})$/);
  return {
    async get() {
      let data = null;
      if (notes) { try { const r = await HASS.callWS({ type: "frontend/get_user_data", key: "bushby_notes" }); data = r && r.value; } catch (e) {} }
      else if (clim) data = await climateDay(clim[1]);
      return { exists: !!data, data: () => data };
    },
    async set(v) { if (notes) await HASS.callWS({ type: "frontend/set_user_data", key: "bushby_notes", value: v }); },
    async update() {}, // Home Assistant records the climate history itself
  };
}
const db = { doc: docRef };

// ---------- the panel element ----------
async function runScript(old) {
  const s = document.createElement("script");
  [...old.attributes].forEach((a) => s.setAttribute(a.name, a.name === "src" && !/^(https?:)?\/\//.test(a.value) ? new URL(a.value, BASE).href : a.value));
  if (old.src) {
    await new Promise((res) => { s.onload = res; s.onerror = res; document.body.appendChild(s); });
  } else {
    s.textContent = old.textContent;
    document.body.appendChild(s);
  }
}
class BushbyHome extends HTMLElement {
  set hass(h) {
    HASS = h;
    pushLive();
    hassListeners.forEach((cb) => { try { cb(h); } catch (e) {} });
    if (!this._booted) { this._booted = true; this._boot(); }
  }
  get hass() { return HASS; }
  set narrow(v) {}
  set panel(v) { this._panel = v; }
  set route(v) {}
  async _boot() {
    window.claude = { use: async (k) => (k === "mcp" ? mcp : k === "db" ? db : null) };
    let html;
    try { html = await (await fetch(BASE + "home.html", { cache: "no-cache" })).text(); } // always checks for a newer model
    catch (e) { this.textContent = "Couldn't load the 3D model (" + e + ")"; return; }
    const doc = new DOMParser().parseFromString(html, "text/html");
    document.title = window.__bushbyTitle || doc.title || "Home";
    for (const n of [...doc.head.childNodes]) {
      if (n.nodeName === "SCRIPT") await runScript(n);
      else if (n.nodeName !== "TITLE") document.head.appendChild(document.importNode(n, true));
    }
    const fix = document.createElement("style");
    fix.textContent = 'a[href*="claude.ai/artifact"]{display:none!important}html,body{margin:0;height:100%;overflow:hidden}';
    document.head.appendChild(fix);
    this.dispatchEvent(new CustomEvent("bushby-loading"));
    document.body.className = doc.body.className;
    for (const n of [...doc.body.childNodes]) {
      if (n.nodeName === "SCRIPT") await runScript(n);
      else document.body.appendChild(document.importNode(n, true));
    }
    window.dispatchEvent(new CustomEvent("bushby-ready"));
    // Optional extra pages that live next to this file
    try { const m = await import(BASE + "bushby-automations.js?t=" + Date.now()); m.install(); } catch (e) { console.warn("Bushby automations page not loaded", e); }
  }
}
customElements.define("bushby-home", BushbyHome);
