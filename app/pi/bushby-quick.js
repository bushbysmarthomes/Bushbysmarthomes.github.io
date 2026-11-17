// Bushby Smart Homes: Quick access page.
// Adds a "Quick" button to the 3D home: big buttons for lights (all on / all off, each one, and a brightness
// slider on lights that can dim),
// plugs, the robot vacuum and an Energy section (every device that measures its own energy use: watts now,
// used today and this month). Works from whatever this home has; nothing here is home-specific.
// Colours: Bushby light scheme (dark teal #08807C, light teal #4FD1C0, navy #0B1F33 on a light background).
const B = window.__bushby;
const hass = () => B.hass();
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const st = (id) => hass().states[id];
const nameOf = (id) => { const s = st(id); return (s && s.attributes.friendly_name) || id; };
const dom = (id) => id.split(".")[0];
const dc = (id) => String((st(id) || {}).attributes?.device_class || "");

// Only show what the home has chosen to share with its assistant (the same list the 3D model uses).
let exposed = null;
async function loadExposed() {
  try {
    const r = await hass().callWS({ type: "homeassistant/expose_entity/list" });
    const ex = (r && r.exposed_entities) || {};
    exposed = new Set(Object.keys(ex).filter((id) => ex[id] && ex[id].conversation));
  } catch (e) { exposed = null; }
}
const reg = (id) => (hass().entities || {})[id] || {};
const visible = (id) => {
  const r = reg(id);
  if (r.hidden || r.hidden_by || r.entity_category) return false;
  return exposed ? exposed.has(id) : true;
};
const areaOf = (id) => {
  const r = reg(id), h = hass();
  const a = r.area_id || ((h.devices || {})[r.device_id] || {}).area_id;
  return a && h.areas && h.areas[a] ? h.areas[a].name : "";
};

// What counts as what
const SETTING = /dishwasher|washer|dryer|oven|hob|fridge|freezer|half load|hygiene|intensive|silence|vario|child lock|do not disturb|led indicator|power.?on behaviou?r/i;
const KEEP_ON = /\b(pi|hub|router|server|modem|nas|fridge|freezer|boiler)\b/i; // never offered as a quick switch
const LAMPISH = /lamp|light|lys|lampe/i;
const isGroup = (id) => Array.isArray((st(id) || {}).attributes?.entity_id);
const isPlug = (id) => dom(id) === "switch" && visible(id) && ["outlet", "switch", ""].includes(dc(id)) && !SETTING.test(nameOf(id)) && !KEEP_ON.test(nameOf(id));
const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));
const all = (pred) => Object.keys(hass().states).filter(pred).sort(byName);
const lights = () => [...all((id) => dom(id) === "light" && visible(id) && !isGroup(id)), ...all((id) => isPlug(id) && LAMPISH.test(nameOf(id)))].sort(byName);
const plugs = () => all((id) => isPlug(id) && !LAMPISH.test(nameOf(id)));
const vacuums = () => all((id) => dom(id) === "vacuum" && visible(id));
// Energy: every sensor that counts energy used (kWh), paired with the same device's live power (W).
// Not filtered by the assistant list, because metering sensors are rarely shared with it. Export/solar meters left out.
const isMeter = (id) => dom(id) === "sensor" && dc(id) === "energy" && !reg(id).hidden && !reg(id).hidden_by && !/export|return|produc|solar|feed.?in|generat/i.test(id + " " + nameOf(id));
const meters = () => all(isMeter);
const devOf = (id) => reg(id).device_id;
const powerFor = (id) => { const d = devOf(id); return d ? Object.keys(hass().states).find((p) => dom(p) === "sensor" && dc(p) === "power" && devOf(p) === d) || null : null; };
const meterName = (id) => nameOf(id).replace(/\s*(total\s*)?energy(\s*(used|consumption|total))?\s*$/i, "").trim() || nameOf(id);
const KWH = { wh: 0.001, kwh: 1, mwh: 1000 };
const toKwh = (v, id) => { const u = String(((st(id) || {}).attributes || {}).unit_of_measurement || "kWh").toLowerCase(); const n = Number(v); return Number.isFinite(n) ? n * (KWH[u] || 1) : null; };
const watts = (id) => { const p = powerFor(id), s = p && st(p); if (!s) return null; const n = Number(s.state); if (!Number.isFinite(n)) return null; const u = String(s.attributes.unit_of_measurement || "W").toLowerCase(); return u === "kw" ? n * 1000 : n; };
const fmtW = (w) => (w == null ? "–" : w >= 1000 ? (w / 1000).toFixed(w >= 10000 ? 0 : 1) + " kW" : (w >= 10 ? Math.round(w) : Math.round(w * 10) / 10) + " W");
const fmtKwh = (k) => (k == null ? "–" : k < 10 ? k.toFixed(2) + " kWh" : k < 100 ? k.toFixed(1) + " kWh" : Math.round(k) + " kWh");
// Electricity price, if the home has a price sensor (anything per kWh)
const priceSensor = () => Object.keys(hass().states).find((id) => dom(id) === "sensor" && /\/\s*kwh$/i.test(String((st(id).attributes || {}).unit_of_measurement || "")) && !offline(id)) || null;
let use = {}, useAt = 0, useTimer = null;
async function loadUse() {
  const out = {};
  await Promise.all(meters().map(async (id) => {
    const r = {};
    for (const p of ["day", "month"]) {
      try { const s = await hass().callWS({ type: "recorder/statistic_during_period", statistic_id: id, calendar: { period: p }, types: ["change"] }); r[p] = s && s.change != null ? toKwh(s.change, id) : null; }
      catch (e) { r[p] = null; }
    }
    out[id] = r;
  }));
  use = out; useAt = Date.now();
  if (sheet) draw(true);
}
const offline = (id) => { const s = st(id); return !s || s.state === "unavailable" || s.state === "unknown"; };
const isOn = (id) => (st(id) || {}).state === "on";

const ICON = {
  light: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/></svg>',
  plug: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/></svg>',
  energy: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  vac: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v2"/></svg>',
};

const STYLE = `
.bq-sheet{position:fixed;inset:0;z-index:50;background:rgba(11,31,51,.45);display:flex;justify-content:center}
.bq-card{width:100%;max-width:1000px;height:100%;display:flex;flex-direction:column;background:#FBFDFC;color:#0B1F33;font:16px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-sizing:border-box;padding:calc(env(safe-area-inset-top,0px) + 14px) 18px calc(env(safe-area-inset-bottom,0px) + 12px)}
.bq-head{display:flex;align-items:center;gap:10px;padding-bottom:12px;border-bottom:3px solid #4FD1C0;margin-bottom:6px}
.bq-head h2{flex:1;margin:0;font-size:24px;font-weight:750;letter-spacing:-.01em}
.bq-back{border:1.5px solid #B9D3CE;background:#fff;color:#0B1F33;border-radius:10px;height:46px;padding:0 14px;font:700 15px system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.bq-x{border:1.5px solid #B9D3CE;background:#fff;color:#0B1F33;border-radius:10px;width:46px;height:46px;font-size:20px;cursor:pointer}
.bq-body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:6px 2px 10px}
.bq-sec{margin-top:18px}
.bq-sech{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}
.bq-sech h3{flex:1;margin:0;font-size:15px;font-weight:700;color:#08807C;min-width:120px}
.bq-sech h3 small{font-weight:500;color:#4A5B68;margin-left:6px}
.bq-all{border-radius:10px;padding:12px 18px;font:700 15px system-ui,sans-serif;cursor:pointer;min-height:46px}
.bq-all.on{background:#08807C;color:#fff;border:1.5px solid #08807C}
.bq-all.off{background:#fff;color:#0B1F33;border:1.5px solid #0B1F33}
.bq-all:disabled{opacity:.4;cursor:default}
.bq-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.bq-tile{display:flex;flex-direction:column;min-height:104px;border-radius:12px;border:1.5px solid #CFE3DF;background:#fff;color:#0B1F33;transition:background .15s,border-color .15s;overflow:hidden}
.bq-tap{flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:8px;text-align:left;padding:14px;border:0;background:none;color:inherit;font:inherit;cursor:pointer;width:100%}
.bq-tile svg{color:#08807C}
.bq-tile b{font-weight:650;font-size:16px;line-height:1.2;overflow-wrap:anywhere}
.bq-tile small{color:#4A5B68;font-size:13.5px}
.bq-tile.on{background:#08807C;border-color:#08807C;color:#fff;box-shadow:inset 0 -5px 0 #4FD1C0}
.bq-tile.on svg{color:#fff}
.bq-tile.on small{color:#FFFFFF}
.bq-tile.dead{opacity:.5;background:#F1F5F4}
.bq-tile.dead .bq-tap{cursor:default}
.bq-bri{display:flex;align-items:center;gap:8px;padding:0 14px 14px}
.bq-bri input{flex:1;min-width:0;height:44px;margin:0;accent-color:#08807C;cursor:pointer;touch-action:pan-y}
.bq-tile.on .bq-bri input{accent-color:#fff}
.bq-bri output{min-width:3.1em;text-align:right;font-size:13.5px;font-weight:650;font-variant-numeric:tabular-nums}
.bq-vac{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px;border-radius:12px;border:1.5px solid #CFE3DF;background:#fff;margin-bottom:10px}
.bq-vac svg{color:#08807C;flex:none}
.bq-vac .bq-vn{flex:1;min-width:120px}
.bq-vac .bq-vn b{display:block;font-size:16px}
.bq-vac .bq-vn small{color:#4A5B68}
.bq-vac .bq-vb{display:flex;gap:8px}
.bq-etile{display:flex;flex-direction:column;gap:6px;min-height:104px;padding:14px;border-radius:12px;border:1.5px solid #CFE3DF;background:#fff;color:#0B1F33}
.bq-etile svg{color:#08807C}
.bq-etile b{font-weight:650;font-size:16px;line-height:1.2;overflow-wrap:anywhere}
.bq-etile .bq-w{font-size:26px;font-weight:750;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.bq-etile .bq-w.live{color:#08807C}
.bq-etile small{color:#4A5B68;font-size:13.5px;font-variant-numeric:tabular-nums}
.bq-etile.dead{opacity:.5;background:#F1F5F4}
.bq-esum{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.bq-esum div{flex:1;min-width:130px;padding:12px 14px;border-radius:12px;background:#E9F6F4;border:1.5px solid #CFE3DF}
.bq-esum span{display:block;font-size:13px;color:#4A5B68}
.bq-esum strong{font-size:20px;font-weight:750;font-variant-numeric:tabular-nums}
.bq-enote{color:#4A5B68;font-size:13px;margin-top:8px}
.bq-msg{margin-top:12px;color:#A3261C;font-size:14px;min-height:18px}
.bq-msg:has(.bq-undo){position:sticky;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:10px;background:#0B1F33;color:#fff;border-radius:12px;padding:10px 12px;box-shadow:0 6px 18px rgba(11,31,51,.3)}
.bq-msg .bq-undo{background:#fff}
.bq-empty{color:#4A5B68;padding:30px 6px;text-align:center}
.bq-undo{margin-left:8px;border:1.5px solid #08807C;background:#fff;color:#08807C;border-radius:8px;padding:4px 12px;font:700 14px system-ui,sans-serif;cursor:pointer}
.bq-back:focus-visible,.bq-undo:focus-visible,.bq-tap:focus-visible,.bq-bri input:focus-visible,.bq-all:focus-visible,.bq-x:focus-visible{outline:3px solid #4FD1C0;outline-offset:2px}`;

let sheet = null, unsub = null, pending = {}, view = "all"; // view: "all" (Quick access) or "energy" (Energy page on its own)

async function call(domain, service, ids) {
  const list = [].concat(ids);
  try { await hass().callService(domain, service, { entity_id: list.length === 1 ? list[0] : list }); say(""); }
  catch (e) { list.forEach((id) => delete pending[id]); draw(true); say("That didn't go through: " + ((e && e.message) || e)); }
}
function say(t) { const el = sheet && sheet.querySelector(".bq-msg"); if (el) el.textContent = t; }

// Show the new state straight away, then let the real state take over when it arrives (or after 6 s).
function expect(ids, on) {
  const until = Date.now() + 6000;
  [].concat(ids).forEach((id) => (pending[id] = { on, until }));
  setTimeout(() => { if (sheet) draw(); }, 6100);
}
function shownOn(id) {
  const p = pending[id];
  if (p && (Date.now() > p.until || isOn(id) === p.on)) delete pending[id];
  return pending[id] ? pending[id].on : isOn(id);
}

const VSTATE = { docked: "On its dock", cleaning: "Cleaning now", returning: "Heading home", paused: "Paused", idle: "Stopped", error: "Needs attention", unavailable: "Offline", unknown: "Offline" };

// Brightness: only for lights that can dim (not on/off-only lights, and not lamps on smart plugs)
const canDim = (id) => {
  if (dom(id) !== "light") return false;
  const a = (st(id) || {}).attributes || {}, m = a.supported_color_modes;
  return Array.isArray(m) ? m.some((x) => x !== "onoff") : a.brightness != null;
};
let briPending = {}, dragging = false;
const briOf = (id) => {
  const p = briPending[id];
  if (p && Date.now() < p.until) return p.pct;
  delete briPending[id];
  const b = ((st(id) || {}).attributes || {}).brightness;
  return isOn(id) && b != null ? Math.max(1, Math.round((b / 255) * 100)) : 0;
};

function tile(id, icon) {
  const off = offline(id), on = !off && shownOn(id);
  const area = areaOf(id), dim = !off && canDim(id), pct = dim ? (on ? briOf(id) || 100 : 0) : 0;
  return `<div class="bq-tile${on ? " on" : ""}${off ? " dead" : ""}" data-id="${esc(id)}">
    <button class="bq-tap" type="button" aria-pressed="${on}" ${off ? "disabled" : ""}>${ICON[icon]}<b>${esc(nameOf(id))}</b><small>${off ? "Offline" : on ? "On" : "Off"}${area ? " · " + esc(area) : ""}</small></button>
    ${dim ? `<label class="bq-bri"><input type="range" min="1" max="100" step="1" value="${pct || 1}" aria-label="Brightness of ${esc(nameOf(id))}"><output>${pct ? pct + "%" : "Off"}</output></label>` : ""}
  </div>`;
}

// Only rebuild when something on this page changed, so a tap is never lost to a redraw.
let lastSig = "", undo = null;
const sig = () => [...lights(), ...plugs(), ...vacuums()].map((id) => id + "=" + ((st(id) || {}).state) + (pending[id] ? "*" + pending[id].on : "") + (canDim(id) ? "~" + briOf(id) : "")).join("|") + "#" + (exposed ? exposed.size : "-")
  + "#" + meters().map((id) => id + "=" + ((st(id) || {}).state) + "/" + watts(id)).join("|") + "@" + useAt;
function draw(force) {
  if (!sheet) return;
  if (dragging && !force) return; // never rebuild under a finger on a slider
  const g = sig();
  if (!force && g === lastSig && sheet.querySelector(".bq-body").children.length) return;
  lastSig = g;
  const body = sheet.querySelector(".bq-body");
  const E = view === "energy", L = E ? [] : lights(), P = E ? [] : plugs(), V = E ? [] : vacuums();
  const nOn = L.filter((id) => !offline(id) && shownOn(id)).length;
  let h = "";
  if (L.length) h += `<section class="bq-sec"><div class="bq-sech"><h3>Lights<small>${nOn ? nOn + " on" : "all off"}</small></h3>
    <button class="bq-all off" type="button" data-all="on">All on</button><button class="bq-all off" type="button" data-all="off">All off</button></div>
    <div class="bq-grid">${L.map((id) => tile(id, "light")).join("")}</div></section>`;
  if (P.length) h += `<section class="bq-sec"><div class="bq-sech"><h3>Plugs</h3></div><div class="bq-grid">${P.map((id) => tile(id, "plug")).join("")}</div></section>`;
  if (V.length) h += `<section class="bq-sec"><div class="bq-sech"><h3>Hoover</h3></div>${V.map((id) => {
    const s = (st(id) || {}).state, off = offline(id);
    return `<div class="bq-vac" data-vac="${esc(id)}">${ICON.vac}<div class="bq-vn"><b>${esc(nameOf(id))}</b><small>${esc(VSTATE[s] || s || "Offline")}</small></div>
      <div class="bq-vb"><button class="bq-all on" type="button" data-v="${s === "cleaning" ? "pause" : "start"}" ${off ? "disabled" : ""}>${s === "cleaning" ? "Pause" : "Start"}</button><button class="bq-all off" type="button" data-v="return_to_base" ${off || s === "docked" ? "disabled" : ""}>Send home</button></div></div>`;
  }).join("")}</section>`;
  const M = meters();
  if (M.length) {
    const ws = M.map(watts), now = ws.reduce((a, w) => a + (w || 0), 0);
    const sum = (p) => { const v = M.map((id) => (use[id] || {})[p]); return v.some((x) => x != null) ? v.reduce((a, x) => a + (x || 0), 0) : null; };
    const ps = priceSensor(), pv = ps ? Number(st(ps).state) : NaN, pu = ps ? String(st(ps).attributes.unit_of_measurement || "") : "";
    const today = sum("day");
    h += `<section class="bq-sec"><div class="bq-sech"><h3>Energy<small>${M.length} device${M.length > 1 ? "s" : ""} measuring</small></h3></div>
      <div class="bq-esum"><div><span>Using now</span><strong>${fmtW(now)}</strong></div><div><span>Today</span><strong>${fmtKwh(today)}</strong></div><div><span>This month</span><strong>${fmtKwh(sum("month"))}</strong></div>${Number.isFinite(pv) ? `<div><span>Price now</span><strong>${/^(dkk|kr)/i.test(pu) ? pv.toFixed(2).replace(".", ",") : pv.toFixed(2)}</strong> <small>${esc(/^(dkk|kr)/i.test(pu) ? "kr/kWh" : pu)}</small></div>` : ""}</div>
      <div class="bq-grid">${M.map((id, i) => {
        const off = offline(id), w = ws[i], u = use[id] || {}, area = areaOf(id);
        return `<div class="bq-etile${off ? " dead" : ""}">${ICON.energy}<b>${esc(meterName(id))}</b><span class="bq-w${w > 1 ? " live" : ""}">${off ? "Offline" : fmtW(w)}</span><small>${u.day == null && u.month == null ? (useAt ? "Measuring started, figures soon" : "Loading…") : `Today ${fmtKwh(u.day)} · Month ${fmtKwh(u.month)}`}${area ? "<br>" + esc(area) : ""}</small></div>`;
      }).join("")}</div>
      <div class="bq-enote">Only devices that measure their own use are shown. Today and month update every 5 minutes.</div></section>`;
  }
  if (!h) h = E ? `<div class="bq-empty">No devices in this home measure their energy use yet. Plugs with energy monitoring will appear here.</div>` : `<div class="bq-empty">No lights, plugs or hoover to control in this home yet.</div>`;
  // keep the scroll position and don't rebuild under someone's finger
  const y = body.scrollTop;
  const undoLive = undo && Date.now() < undo.until;
  body.innerHTML = h + `<div class="bq-msg" role="status">${undoLive ? esc(undo.text) + ` <button class="bq-undo" type="button">Undo</button>` : esc((sheet.querySelector(".bq-msg") || {}).textContent || "")}</div>`;
  const ub = body.querySelector(".bq-undo");
  if (ub) ub.onclick = () => { const u = undo; undo = null; const onIds = u.prev.filter((x) => x.on).map((x) => x.id), offIds = u.prev.filter((x) => !x.on).map((x) => x.id);
    if (onIds.length) { expect(onIds, true); call("homeassistant", "turn_on", onIds); } if (offIds.length) { expect(offIds, false); call("homeassistant", "turn_off", offIds); } draw(true); };
  body.scrollTop = y;

  body.querySelectorAll(".bq-tile").forEach((t) => {
    const id = t.dataset.id;
    const tap = t.querySelector(".bq-tap");
    tap.onclick = () => {
      const on = !shownOn(id);
      expect(id, on); draw();
      call("homeassistant", on ? "turn_on" : "turn_off", id);
    };
    const sl = t.querySelector(".bq-bri input");
    if (!sl) return;
    const out = t.querySelector(".bq-bri output");
    sl.oninput = () => { dragging = true; out.textContent = sl.value + "%"; };
    sl.onchange = async () => {
      const pct = +sl.value;
      dragging = false;
      briPending[id] = { pct, until: Date.now() + 6000 };
      expect(id, true); draw(true);
      try { await hass().callService("light", "turn_on", { entity_id: id, brightness_pct: pct }); say(""); }
      catch (e) { delete briPending[id]; delete pending[id]; draw(true); say("That didn't go through: " + ((e && e.message) || e)); }
    };
    // a drag that ends without a change (finger slid off) must still release the lock
    sl.onpointerup = sl.onpointercancel = () => setTimeout(() => { dragging = false; }, 400);
  });
  body.querySelectorAll("[data-all]").forEach((b) => (b.onclick = () => {
    const on = b.dataset.all === "on", ids = lights().filter((id) => !offline(id));
    if (!ids.length) return;
    undo = { prev: ids.map((id) => ({ id, on: shownOn(id) })), text: on ? "All lights on." : "All lights off.", until: Date.now() + 6000 };
    setTimeout(() => { if (undo && Date.now() >= undo.until) { undo = null; draw(true); } }, 6100);
    expect(ids, on); draw(true);
    call("homeassistant", on ? "turn_on" : "turn_off", ids);
  }));
  body.querySelectorAll(".bq-vac").forEach((row) => row.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => {
    b.disabled = true;
    call("vacuum", b.dataset.v, row.dataset.vac);
    setTimeout(() => draw(true), 4000);
  })));
}

async function open(v) {
  if (sheet) return;
  view = v === "energy" ? "energy" : "all";
  sheet = document.createElement("div");
  sheet.className = "bq-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", view === "energy" ? "Energy" : "Quick access");
  // When opened from the phone menu, window.__bushbyBack is set: show a Back button that returns there.
  const back = window.__bushbyBack;
  sheet.innerHTML = `<div class="bq-card"><div class="bq-head">${back ? `<button class="bq-back" type="button">‹ Menu</button>` : ""}<h2>${view === "energy" ? "Energy" : "Quick access"}</h2><button class="bq-x" type="button" aria-label="Close">✕</button></div><div class="bq-body"></div></div>`;
  document.body.appendChild(sheet);
  sheet.querySelector(".bq-x").onclick = close;
  if (back) sheet.querySelector(".bq-back").onclick = () => { close(); back(); };
  sheet.onclick = (e) => { if (e.target === sheet) close(); };
  draw();
  document.addEventListener("keydown", onKey);
  sheet.querySelector(".bq-x").focus({ preventScroll: true });
  unsub = B.onHass(() => draw());
  loadUse(); useTimer = setInterval(loadUse, 5 * 60 * 1000);
  if (exposed === null) { await loadExposed(); draw(); }
}
function onKey(e) { if (e.key === "Escape" && sheet) close(); }
function close() { document.removeEventListener("keydown", onKey); undo = null; if (unsub) unsub(); unsub = null; if (useTimer) clearInterval(useTimer); useTimer = null; if (sheet) sheet.remove(); sheet = null; pending = {}; briPending = {}; dragging = false; lastSig = ""; window.__bushbyBack = null; }

export function install() {
  if (window.__bushbyQuick) return;
  const s = document.createElement("style"); s.textContent = STYLE; document.head.appendChild(s);
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "btn bq-open"; btn.innerHTML = 'Quick<span class="bq-w2"> access</span>';
  btn.setAttribute("aria-label", "Quick access");
  btn.onclick = () => open();
  const anchor = document.querySelector(".ba-open") || [...document.querySelectorAll("button")].find((b) => /^\s*Climate\s*$/.test(b.textContent));
  const bar = document.querySelector("header.bar") || document.querySelector(".bar");
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor);
  else if (bar) bar.appendChild(btn);
  else { btn.style.cssText = "position:fixed;z-index:20;right:16px;bottom:170px"; document.body.appendChild(btn); }
  // hidden opener for the Energy page, used by the phone menu's Energy tile
  const eb = document.createElement("button");
  eb.type = "button"; eb.className = "bq-energy-open"; eb.style.display = "none"; eb.textContent = "Energy";
  eb.onclick = () => open("energy");
  document.body.appendChild(eb);
  window.__bushbyQuick = { open, close };
  loadExposed();
}
