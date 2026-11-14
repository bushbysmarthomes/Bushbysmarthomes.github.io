// Bushby Smart Homes: Automations page.
// Adds an "Automations" button to the 3D home. "Mine" lists the home's automations (switch on/off, run now,
// last run, details). "Add new" offers ready-made automations to set up with a few taps.
// Colours: Bushby light scheme (dark teal #08807C, light teal #4FD1C0, navy #0B1F33 on a light background).
// Uses the signed-in person's own Home Assistant connection; creating or deleting needs an admin login.
const B = window.__bushby;
const hass = () => B.hass();
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nameOf = (id) => { const s = hass().states[id]; return (s && s.attributes.friendly_name) || id; };
const dc = (id) => String((hass().states[id] || {}).attributes?.device_class || "");
const ents = (pred) => Object.keys(hass().states).filter(pred).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
const ago = (iso) => {
  if (!iso) return "Never run";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "Ran just now";
  if (m < 60) return `Ran ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `Ran ${h} h ago`;
  const d = new Date(iso);
  return "Ran " + d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " + d.toTimeString().slice(0, 5);
};

// ---------- who to notify ----------
let notifyCache = null;
async function notifyTargets() {
  if (notifyCache) return notifyCache;
  let svc = hass().services;
  if (!svc || !svc.notify) { try { svc = await hass().callWS({ type: "get_services" }); } catch (e) { svc = {}; } }
  const list = Object.keys((svc && svc.notify) || {}).filter((s) => s.startsWith("mobile_app_"));
  notifyCache = list.map((s) => ({ id: s, label: s.replace(/^mobile_app_/, "").replace(/_/g, " ") + " (phone)" }));
  return notifyCache;
}

// ---------- ready-made automations ----------
const isDomain = (...d) => (id) => d.includes(id.split(".")[0]);
const LIGHTS = (id) => isDomain("light")(id) || (isDomain("switch")(id) && ["outlet", ""].includes(dc(id)) && !/dishwasher|power|silence|vario|hygiene|half load|intensive/i.test(nameOf(id)));
const MOTION = (id) => isDomain("binary_sensor")(id) && ["motion", "occupancy", "presence"].includes(dc(id));
const DOORS = (id) => isDomain("binary_sensor")(id) && ["door", "window", "opening", "garage_door"].includes(dc(id));
const LEAKS = (id) => isDomain("binary_sensor")(id) && dc(id) === "moisture";
const BATT = (id) => isDomain("sensor")(id) && dc(id) === "battery";
const DEVICES = (id) => isDomain("sensor", "binary_sensor", "light", "switch")(id) && !/^sensor\.(sun|date|time)/.test(id);
const notifyField = { id: "notify", label: "Send the alert to", type: "notify" };
const mins = (n) => ({ hours: Math.floor(n / 60), minutes: n % 60, seconds: 0 });
const turn = (on, ids) => ({ action: on ? "homeassistant.turn_on" : "homeassistant.turn_off", target: { entity_id: ids } });
const notifyAction = (f, title, message) => ({ action: "notify." + f.notify, data: { title, message } });

const TEMPLATES = [
  {
    key: "away_off", icon: "🚪", title: "Lights off when everyone leaves",
    desc: "When nobody is home for a while, every light switches off. Uses the phones signed in to Home Assistant to know who is home.",
    needs: () => !!hass().states["zone.home"],
    fields: [{ id: "mins", label: "Once everyone has been out for", type: "number", unit: "minutes", def: 10, min: 1, max: 240 }],
    build: (f) => ({ triggers: [{ trigger: "numeric_state", entity_id: "zone.home", below: 1, for: mins(+f.mins) }], conditions: [], actions: [{ action: "light.turn_off", target: { entity_id: "all" } }], mode: "single" }),
  },
  {
    key: "night_off", icon: "🌙", title: "All lights off at bedtime",
    desc: "Every light in the home switches off at the time you choose, every night.",
    fields: [{ id: "time", label: "Time", type: "time", def: "23:30" }],
    build: (f) => ({ triggers: [{ trigger: "time", at: f.time + ":00" }], conditions: [], actions: [{ action: "light.turn_off", target: { entity_id: "all" } }], mode: "single" }),
  },
  {
    key: "sunset_on", icon: "🌇", title: "Lights on at sunset",
    desc: "The lights you pick come on when the sun goes down, every day of the year.",
    fields: [
      { id: "lights", label: "Lights", type: "entities", filter: LIGHTS, min: 1 },
      { id: "offset", label: "Minutes before (−) or after (+) sunset", type: "number", unit: "minutes", def: -15, min: -120, max: 120 },
    ],
    build: (f) => {
      const o = +f.offset, a = Math.abs(o);
      return { triggers: [{ trigger: "sun", event: "sunset", offset: (o < 0 ? "-" : "") + `${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}:00` }], conditions: [], actions: [turn(true, f.lights)], mode: "single" };
    },
  },
  {
    key: "motion_light", icon: "🚶", title: "Light on with movement",
    desc: "A light comes on when someone walks in, and goes off again when the room has been empty for a while.",
    fields: [
      { id: "sensor", label: "Motion sensor", type: "entity", filter: MOTION },
      { id: "lights", label: "Lights", type: "entities", filter: LIGHTS, min: 1 },
      { id: "mins", label: "Switch off after no movement for", type: "number", unit: "minutes", def: 2, min: 1, max: 120 },
      { id: "dark", label: "Only when it's dark outside", type: "check", def: true },
    ],
    build: (f) => ({
      triggers: [{ trigger: "state", entity_id: f.sensor, to: "on" }],
      conditions: f.dark ? [{ condition: "state", entity_id: "sun.sun", state: "below_horizon" }] : [],
      actions: [turn(true, f.lights), { wait_for_trigger: [{ trigger: "state", entity_id: f.sensor, to: "off", for: mins(+f.mins) }] }, turn(false, f.lights)],
      mode: "restart",
    }),
  },
  {
    key: "leak_alert", icon: "💧", title: "Water leak alert",
    desc: "Your phone gets an alert the moment a leak sensor detects water.",
    fields: [{ id: "sensors", label: "Leak sensors", type: "entities", filter: LEAKS, min: 1, all: true }, notifyField],
    build: (f) => ({ triggers: [{ trigger: "state", entity_id: f.sensors, to: "on" }], conditions: [], actions: [notifyAction(f, "Water leak!", "{{ trigger.to_state.name }} has detected water.")], mode: "queued" }),
  },
  {
    key: "door_open", icon: "🔓", title: "Door left open alert",
    desc: "Your phone gets an alert if a door or window stays open too long.",
    fields: [
      { id: "doors", label: "Doors and windows", type: "entities", filter: DOORS, min: 1, all: true },
      { id: "mins", label: "Alert after it's been open for", type: "number", unit: "minutes", def: 10, min: 1, max: 240 },
      notifyField,
    ],
    build: (f) => ({ triggers: [{ trigger: "state", entity_id: f.doors, to: "on", for: mins(+f.mins) }], conditions: [], actions: [notifyAction(f, "Left open", `{{ trigger.to_state.name }} has been open for ${+f.mins} minutes.`)], mode: "queued" }),
  },
  {
    key: "low_battery", icon: "🔋", title: "Low battery alert",
    desc: "Your phone gets an alert when a sensor's battery runs low, so it never goes quiet without warning.",
    fields: [
      { id: "sensors", label: "Batteries to watch", type: "entities", filter: BATT, min: 1, all: true },
      { id: "level", label: "Alert below", type: "number", unit: "%", def: 15, min: 5, max: 50 },
      notifyField,
    ],
    build: (f) => ({ triggers: [{ trigger: "numeric_state", entity_id: f.sensors, below: +f.level }], conditions: [], actions: [notifyAction(f, "Battery low", "{{ trigger.to_state.name }} is at {{ trigger.to_state.state }}%.")], mode: "queued" }),
  },
  {
    key: "offline_alert", icon: "📡", title: "Device offline alert",
    desc: "Your phone gets an alert when a device stops answering, so you know before it matters.",
    fields: [
      { id: "devices", label: "Devices to watch", type: "entities", filter: DEVICES, min: 1 },
      { id: "mins", label: "Alert after it's been offline for", type: "number", unit: "minutes", def: 60, min: 5, max: 1440 },
      notifyField,
    ],
    build: (f) => ({ triggers: [{ trigger: "state", entity_id: f.devices, to: "unavailable", for: mins(+f.mins) }], conditions: [], actions: [notifyAction(f, "Device offline", `{{ trigger.to_state.name }} has been offline for ${+f.mins} minutes.`)], mode: "queued" }),
  },
];

// ---------- page ----------
const STYLE = `
.ba-open{font:inherit}
.ba-sheet{position:fixed;inset:0;z-index:50;background:rgba(11,31,51,.45);display:flex;justify-content:center}
.ba-card{width:100%;max-width:640px;height:100%;display:flex;flex-direction:column;background:#FBFDFC;color:#0B1F33;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-sizing:border-box;padding:calc(env(safe-area-inset-top,0px) + 14px) 16px calc(env(safe-area-inset-bottom,0px) + 12px)}
.ba-head{display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:12px;border-bottom:3px solid #4FD1C0}
.ba-head h2{flex:1;margin:0;font-size:22px}
.ba-back{border:1.5px solid #B9D3CE;background:#fff;color:#0B1F33;border-radius:10px;height:42px;padding:0 14px;font:700 15px system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.ba-x{border:1.5px solid #CFE3DF;background:#FFFFFF;color:#0B1F33;border-radius:12px;width:42px;height:42px;font-size:20px;cursor:pointer}
.ba-tabs{display:flex;gap:8px;margin-bottom:12px}
.ba-tab{flex:1;padding:10px;border-radius:12px;border:1px solid #CFE3DF;background:#FFFFFF;color:#5A6B78;font:600 15px system-ui,sans-serif;cursor:pointer}
.ba-tab[aria-selected=true]{background:#08807C;color:#fff;border-color:#08807C}
.ba-search{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:12px;border:1px solid #CFE3DF;background:#FFFFFF;color:#0B1F33;font:inherit;margin-bottom:10px;outline:none}
.ba-list{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;display:grid;gap:8px;align-content:start;padding-bottom:8px}
.ba-item{background:#FFFFFF;border:1px solid #CFE3DF;border-radius:14px;padding:12px}
.ba-row{display:flex;align-items:center;gap:10px}
.ba-name{flex:1;min-width:0}
.ba-name b{display:block;font-weight:650;overflow:hidden;text-overflow:ellipsis}
.ba-name small{color:#5A6B78}
.ba-sw{position:relative;width:50px;height:30px;flex:none;border-radius:15px;border:0;background:#B7C5CC;cursor:pointer;transition:background .2s}
.ba-sw::after{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;transition:left .2s}
.ba-sw[aria-checked=true]{background:#08807C}.ba-sw[aria-checked=true]::after{left:23px}
.ba-btn{border:1px solid #CFE3DF;background:transparent;color:#0B1F33;border-radius:10px;padding:7px 11px;font:600 13px system-ui,sans-serif;cursor:pointer}
.ba-btn.go{background:#08807C;color:#fff;border-color:#08807C;padding:12px;font-size:15px;width:100%}
.ba-btn.del{color:#A3261C;border-color:rgba(163,38,28,.4)}
.ba-more{margin-top:10px;color:#5A6B78;font-size:14px;display:grid;gap:8px}
.ba-tpl{display:flex;gap:12px;align-items:flex-start;cursor:pointer;text-align:left;width:100%;background:#FFFFFF;border:1px solid #CFE3DF;border-radius:14px;padding:12px;color:inherit;font:inherit}
.ba-ico{font-size:26px;line-height:1}
.ba-tpl p{margin:2px 0 0;color:#5A6B78;font-size:13.5px}
.ba-form{display:grid;gap:14px}
.ba-form label{display:grid;gap:6px;font-weight:600;font-size:14px}
.ba-form input[type=number],.ba-form input[type=time],.ba-form input[type=text],.ba-form select{padding:11px 12px;border-radius:12px;border:1px solid #CFE3DF;background:#FFFFFF;color:#0B1F33;font:inherit}
.ba-picks{display:grid;gap:4px;max-height:220px;overflow:auto;background:#FFFFFF;border:1px solid #CFE3DF;border-radius:12px;padding:6px}
.ba-picks label{display:flex;gap:10px;align-items:center;font-weight:500;padding:6px}
.ba-picks input{width:20px;height:20px;accent-color:#08807C}
.ba-note{color:#5A6B78;font-size:13px}
.ba-form label.ba-row{display:flex}
.ba-err{color:#A3261C;font-size:14px}
.ba-ok{color:#08807C;font-size:14px}
.ba-empty{color:#5A6B78;text-align:center;padding:30px 10px}`;

let sheet = null, tab = "mine", query = "", openId = null, unsub = null;

function open(t) {
  tab = t || tab;
  if (!sheet) {
    sheet = document.createElement("div");
    sheet.className = "ba-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-label", "Automations");
    document.body.appendChild(sheet);
    unsub = B.onHass(() => { if (tab === "mine" && !sheet.querySelector(":focus")) renderMine(true); });
  }
  render();
}
function close() { if (unsub) unsub(); unsub = null; if (sheet) sheet.remove(); sheet = null; openId = null; window.__bushbyBack = null; }

function frame(body) {
  sheet.innerHTML = `<div class="ba-card">
    <div class="ba-head">${window.__bushbyBack ? `<button class="ba-back" type="button">‹ Menu</button>` : ""}<h2>Automations</h2><button class="ba-x" type="button" aria-label="Close">✕</button></div>
    <div class="ba-tabs" role="tablist">
      <button class="ba-tab" role="tab" data-t="mine" aria-selected="${tab === "mine"}">My automations</button>
      <button class="ba-tab" role="tab" data-t="add" aria-selected="${tab === "add"}">Add new</button>
    </div>${body}</div>`;
  sheet.querySelector(".ba-x").onclick = close;
  const bk = sheet.querySelector(".ba-back");
  if (bk) bk.onclick = () => { const back = window.__bushbyBack; close(); if (back) back(); };
  sheet.querySelectorAll(".ba-tab").forEach((b) => (b.onclick = () => { tab = b.dataset.t; openId = null; render(); }));
}
function render() { tab === "mine" ? renderMine() : renderAdd(); }

// ---- My automations ----
function renderMine(refreshOnly) {
  const list = ents((id) => id.startsWith("automation.")).filter((id) => !query || nameOf(id).toLowerCase().includes(query.toLowerCase()));
  const items = list.map((id) => {
    const s = hass().states[id], on = s.state === "on", mine = String(s.attributes.id || "").startsWith("bushby_");
    return `<div class="ba-item" data-id="${esc(id)}">
      <div class="ba-row">
        <div class="ba-name" data-more><b>${esc(nameOf(id))}</b><small>${s.state === "unavailable" ? "Unavailable" : esc(ago(s.attributes.last_triggered))}${mine ? " · made in Bushby" : ""}</small></div>
        <button class="ba-sw" type="button" role="switch" aria-checked="${on}" aria-label="${on ? "Switch off" : "Switch on"} ${esc(nameOf(id))}"></button>
      </div>
      ${openId === id ? `<div class="ba-more"><div class="ba-desc">Loading…</div><div class="ba-row" style="gap:8px"><button class="ba-btn" data-run type="button">▶ Run now</button>${mine ? `<button class="ba-btn del" data-del type="button">Delete</button>` : ""}</div></div>` : ""}
    </div>`;
  }).join("");
  if (refreshOnly && sheet.querySelector(".ba-list")) {
    sheet.querySelector(".ba-list").innerHTML = items || `<div class="ba-empty">No automations yet. Tap <b>Add new</b> to set one up.</div>`;
  } else {
    frame(`<input class="ba-search" type="search" placeholder="Search automations" value="${esc(query)}"><div class="ba-list">${items || `<div class="ba-empty">No automations yet. Tap <b>Add new</b> to set one up.</div>`}</div>`);
    const q = sheet.querySelector(".ba-search");
    q.oninput = () => { query = q.value; renderMine(true); wire(); };
  }
  wire();
  if (openId) loadDesc(openId);
}
function wire() {
  sheet.querySelectorAll(".ba-item").forEach((it) => {
    const id = it.dataset.id;
    it.querySelector(".ba-sw").onclick = async (e) => {
      const b = e.currentTarget, on = b.getAttribute("aria-checked") === "true";
      b.setAttribute("aria-checked", String(!on));
      try { await hass().callService("automation", on ? "turn_off" : "turn_on", { entity_id: id }); }
      catch (err) { b.setAttribute("aria-checked", String(on)); alertIn(it, "Couldn't change it: " + (err.message || err)); }
    };
    it.querySelector("[data-more]").onclick = () => { openId = openId === id ? null : id; renderMine(true); };
    const run = it.querySelector("[data-run]");
    if (run) run.onclick = async () => {
      try { await hass().callService("automation", "trigger", { entity_id: id }); alertIn(it, "Done: it ran just now.", true); }
      catch (err) { alertIn(it, "Couldn't run it: " + (err.message || err)); }
    };
    const del = it.querySelector("[data-del]");
    if (del) del.onclick = async () => {
      if (!confirm(`Delete "${nameOf(id)}"? This can't be undone.`)) return;
      try { await hass().callApi("DELETE", "config/automation/config/" + hass().states[id].attributes.id); openId = null; setTimeout(() => renderMine(true), 800); }
      catch (err) { alertIn(it, adminMsg(err, "delete")); }
    };
  });
}
function alertIn(it, msg, ok) {
  let el = it.querySelector(".ba-msg");
  if (!el) { el = document.createElement("div"); el.className = "ba-msg"; it.appendChild(el); }
  el.className = "ba-msg " + (ok ? "ba-ok" : "ba-err"); el.textContent = msg;
}
const descCache = {};
async function loadDesc(id) {
  const show = (t) => { const el = sheet && sheet.querySelector(`.ba-item[data-id="${CSS_ESC(id)}"] .ba-desc`); if (el) el.textContent = t; };
  if (descCache[id] != null) return show(descCache[id]);
  try {
    const r = await hass().callWS({ type: "automation/config", entity_id: id });
    descCache[id] = (r && r.config && r.config.description) || "No description.";
  } catch (e) { descCache[id] = "Details are only visible to admin users."; }
  show(descCache[id]);
}
const CSS_ESC = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"'));
const adminMsg = (err, what) => /401|403|unauthor|admin/i.test(String(err && (err.message || err.body || err.status_code || err)))
  ? `Only a Home Assistant admin can ${what} automations. Ask Bushby Smart Homes, or sign in as an admin.`
  : `Couldn't ${what} it: ${(err && err.message) || err}`;

// ---- Add new ----
function renderAdd() {
  const made = new Set(ents((id) => id.startsWith("automation.")).map((id) => String(hass().states[id].attributes.id || "")).filter((x) => x.startsWith("bushby_")).map((x) => x.split("_").slice(1, -1).join("_")));
  frame(`<div class="ba-list">${TEMPLATES.map((t, i) => `<button class="ba-tpl" type="button" data-i="${i}"><span class="ba-ico">${t.icon}</span><span><b>${esc(t.title)}</b>${made.has(t.key) ? ` <small class="ba-ok">· set up</small>` : ""}<p>${esc(t.desc)}</p></span></button>`).join("")}</div>`);
  sheet.querySelectorAll(".ba-tpl").forEach((b) => (b.onclick = () => renderForm(TEMPLATES[+b.dataset.i])));
}
async function renderForm(t) {
  const targets = t.fields.some((f) => f.type === "notify") ? await notifyTargets() : [];
  const field = (f) => {
    if (f.type === "number") return `<label>${esc(f.label)}<span class="ba-row"><input type="number" name="${f.id}" value="${f.def}" min="${f.min}" max="${f.max}" step="1" style="flex:1"> <span class="ba-note">${esc(f.unit || "")}</span></span></label>`;
    if (f.type === "time") return `<label>${esc(f.label)}<input type="time" name="${f.id}" value="${f.def}"></label>`;
    if (f.type === "check") return `<label class="ba-row" style="font-weight:500"><input type="checkbox" name="${f.id}" ${f.def ? "checked" : ""} style="width:20px;height:20px;accent-color:#08807C"> ${esc(f.label)}</label>`;
    if (f.type === "notify") return targets.length
      ? `<label>${esc(f.label)}<select name="${f.id}">${targets.map((x) => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join("")}</select></label>`
      : `<div class="ba-err">No phone is set up for alerts yet. Install the Home Assistant app on a phone and sign in, then try again.</div>`;
    const list = ents(f.filter);
    if (!list.length) return `<div class="ba-err">${esc(f.label)}: none found in this home yet.</div>`;
    if (f.type === "entity") return `<label>${esc(f.label)}<select name="${f.id}">${list.map((id) => `<option value="${esc(id)}">${esc(nameOf(id))}</option>`).join("")}</select></label>`;
    return `<div><div style="font-weight:600;font-size:14px;margin-bottom:6px">${esc(f.label)}</div><div class="ba-picks" data-f="${f.id}">${list.map((id) => `<label><input type="checkbox" value="${esc(id)}" ${f.all ? "checked" : ""}> ${esc(nameOf(id))}</label>`).join("")}</div></div>`;
  };
  const ready = !(t.needs && !t.needs());
  frame(`<div class="ba-list"><div class="ba-form">
    <button class="ba-btn" type="button" data-back style="justify-self:start">‹ Back</button>
    <div class="ba-row" style="align-items:flex-start"><span class="ba-ico">${t.icon}</span><div><b style="font-size:17px">${esc(t.title)}</b><p class="ba-note" style="margin:4px 0 0">${esc(t.desc)}</p></div></div>
    ${ready ? t.fields.map(field).join("") : `<div class="ba-err">This home doesn't know who is in yet. Sign in to the Home Assistant app on each phone first.</div>`}
    <label>Name<input type="text" name="__name" value="${esc(t.title)}" maxlength="80"></label>
    <div class="ba-msg"></div>
    <button class="ba-btn go" type="button" data-save ${ready ? "" : "disabled"}>Switch it on</button>
  </div></div>`);
  sheet.querySelector("[data-back]").onclick = () => renderAdd();
  sheet.querySelector("[data-save]").onclick = async () => {
    const msg = sheet.querySelector(".ba-msg"), vals = {};
    for (const f of t.fields) {
      if (f.type === "entities") {
        vals[f.id] = [...sheet.querySelectorAll(`.ba-picks[data-f="${f.id}"] input:checked`)].map((x) => x.value);
        if (vals[f.id].length < (f.min || 0)) { msg.className = "ba-msg ba-err"; msg.textContent = `Pick at least one: ${f.label}.`; return; }
      } else if (f.type === "check") vals[f.id] = sheet.querySelector(`[name="${f.id}"]`).checked;
      else {
        const el = sheet.querySelector(`[name="${f.id}"]`);
        if (!el || el.value === "") { msg.className = "ba-msg ba-err"; msg.textContent = `Fill in: ${f.label}.`; return; }
        vals[f.id] = el.value;
        if (f.type === "number" && (+el.value < f.min || +el.value > f.max)) { msg.className = "ba-msg ba-err"; msg.textContent = `${f.label}: choose between ${f.min} and ${f.max}.`; return; }
      }
    }
    const name = sheet.querySelector('[name="__name"]').value.trim() || t.title;
    const id = "bushby_" + t.key + "_" + Date.now().toString(36);
    const cfg = { id, alias: name, description: "Made in the Bushby app: " + t.desc, ...t.build(vals) };
    const btn = sheet.querySelector("[data-save]");
    btn.disabled = true; btn.textContent = "Setting up…";
    try {
      await hass().callApi("POST", "config/automation/config/" + id, cfg);
      msg.className = "ba-msg ba-ok"; msg.textContent = "Done. It's switched on and listed under My automations.";
      setTimeout(() => { tab = "mine"; query = ""; render(); }, 1400);
    } catch (err) {
      btn.disabled = false; btn.textContent = "Switch it on";
      msg.className = "ba-msg ba-err"; msg.textContent = adminMsg(err, "add");
    }
  };
}

// ---------- the button on the 3D home ----------
export function install() {
  const st = document.createElement("style"); st.textContent = STYLE; document.head.appendChild(st);
  const bar = document.querySelector("header.bar") || document.querySelector(".bar");
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "btn ba-open"; btn.textContent = "Automations";
  btn.setAttribute("aria-label", "Automations");
  btn.onclick = () => open("mine");
  const anchor = [...document.querySelectorAll("button")].find((b) => /^\s*Climate\s*$/.test(b.textContent));
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor);
  else if (bar) bar.appendChild(btn);
  else { btn.style.cssText = "position:fixed;z-index:20;right:16px;bottom:120px"; document.body.appendChild(btn); }
  window.__bushbyAutomations = { open, close, TEMPLATES };
  // Quick access page (lights, plugs, hoover) lives in its own file beside this one,
  // then the phone menu, which tidies the top buttons (it needs the Quick and Automations buttons to exist first)
  import(new URL("./bushby-quick.js?t=" + Date.now(), import.meta.url).href).then((m) => m.install()).catch(() => {})
    .then(() => import(new URL("./bushby-menu.js?t=" + Date.now(), import.meta.url).href)).then((m) => m.install()).catch(() => {});
}
export { TEMPLATES };
