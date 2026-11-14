// Bushby Smart Homes: phone menu.
// On a phone the 3D home's top buttons wrap onto several rows. This keeps one tidy row (logo, clock, bell, Menu)
// and moves everything else into a Menu screen of big tiles. A tile opens its page full screen with a Back button
// that returns to the Menu, and a Close button that returns to the 3D home. The Top / 3D view switch moves to the bottom-right corner.
// Wide screens (wall tablets) are left as they are. Nothing is home-specific: tiles are built from the buttons the model has.
const PHONE = "(max-width:760px)";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel) => document.querySelector(sel);

// group, button to find, title, small line under it ("live" = the button's own text, e.g. "5°"), and how it opens:
//   panel id  = one of the model's own panels, shown full screen as a page with Back and Close
//   "module"  = a Bushby page with its own Back support (Quick access, Automations)
//   "action"  = just press the button and stay on the menu (Sign out asks first)
const ITEMS = [
  ["Control", ".bq-open", "Quick access", "Lights, plugs and hoover", "module"],
  ["Control", "#vTv", "TV", "Remote control", "sheet"],
  ["Control", "#vMusic", "Music", "Playing now and controls", "music"],
  ["Around the home", "#vWx", "Weather", "live", "wx"],
  ["Around the home", "#vEl", "Electricity price", "live", "el"],
  ["Around the home", "#vClim", "Climate", "Temperature and humidity", "clim"],
  ["Around the home", "#vFly", "Flights", "Next flights", "fly"],
  ["Setup", ".ba-open", "Automations", "Switch on, off or add new", "module"],
  ["Setup", ".bh-gear", "Sign out", "Sign out or change home", "action"],
];

const STYLE = `
header.bar .btn.bm-open,.bm-view{display:none}
@media ${PHONE}{
  header.bar .btn:not(#vNotes):not(.bm-open){display:none!important}
  header.bar .btn.bm-open{display:inline-flex}
  header.bar{flex-wrap:nowrap}
  header.bar h1{display:block!important;flex:1 1 auto;min-width:0}
  header.bar .hlogo{height:36px;max-width:100%;object-fit:contain;object-position:left}
  header.bar .clock{margin:0!important}
  .bm-view{display:inline-flex;position:fixed;z-index:5;right:max(16px,env(safe-area-inset-right,0px));bottom:calc(env(safe-area-inset-bottom,0px) + 118px);border:1px solid #CFE3DF;border-radius:12px;overflow:hidden;background:#fff}
  .bm-view button{height:40px;padding:0 14px;border:0;background:#fff;color:#0B1F33;font:700 14px system-ui,sans-serif;cursor:pointer}
  .bm-view button[aria-pressed=true]{background:#08807C;color:#fff}
}
/* a model panel opened from the menu becomes a full-screen page under a Back / Close header */
body.bm-paged #sheet,body.bm-paged #music,body.bm-paged #wx,body.bm-paged #el,body.bm-paged #fly,body.bm-paged #clim{position:fixed!important;top:0!important;right:0!important;bottom:0!important;left:0!important;width:auto!important;max-width:none!important;max-height:none!important;border:0!important;border-radius:0!important;box-shadow:none!important;z-index:40!important;background:#FBFDFC!important;overflow-y:auto;align-content:start;filter:none!important;
  padding:calc(env(safe-area-inset-top,0px) + 92px) 18px calc(env(safe-area-inset-bottom,0px) + 20px)!important}
body.bm-paged #sheet .x,body.bm-paged #music .x,body.bm-paged .wx .x,body.bm-paged #climX,body.bm-paged #clim .top h2{display:none!important}
body.bm-paged #sheet h2,body.bm-paged .fly h2{padding-right:0}
.bm-pagehead{position:fixed;z-index:41;top:0;left:0;right:0;display:flex;align-items:center;gap:10px;box-sizing:border-box;background:#FBFDFC;color:#0B1F33;font:16px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:calc(env(safe-area-inset-top,0px) + 14px) 18px 15px}
.bm-pagehead::after{content:"";position:absolute;left:18px;right:18px;bottom:0;height:3px;background:#4FD1C0}
.bm-pagehead h2{flex:1;min-width:0;margin:0;font-size:24px;font-weight:750;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bm-back{border:1.5px solid #B9D3CE;background:#fff;color:#0B1F33;border-radius:10px;height:46px;padding:0 14px;font:700 15px system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.bm-sheet{position:fixed;inset:0;z-index:50;background:rgba(11,31,51,.45);display:flex;justify-content:center}
.bm-card{width:100%;max-width:640px;height:100%;display:flex;flex-direction:column;background:#FBFDFC;color:#0B1F33;font:16px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-sizing:border-box;padding:calc(env(safe-area-inset-top,0px) + 14px) 18px calc(env(safe-area-inset-bottom,0px) + 12px)}
.bm-head{display:flex;align-items:center;gap:10px;padding-bottom:12px;border-bottom:3px solid #4FD1C0;margin-bottom:6px}
.bm-head h2{flex:1;margin:0;font-size:24px;font-weight:750;letter-spacing:-.01em}
.bm-x{border:1.5px solid #B9D3CE;background:#fff;color:#0B1F33;border-radius:10px;width:46px;height:46px;font-size:20px;cursor:pointer}
.bm-body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:6px 2px 10px}
.bm-sec h3{margin:18px 0 10px;font-size:15px;font-weight:700;color:#08807C}
.bm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.bm-tile{display:flex;flex-direction:column;justify-content:center;gap:4px;min-height:76px;text-align:left;padding:12px 14px;border-radius:12px;border:1.5px solid #CFE3DF;border-left:6px solid #4FD1C0;background:#fff;color:#0B1F33;font:inherit;cursor:pointer}
.bm-tile b{font-weight:650;font-size:16px;line-height:1.2}
.bm-tile small{color:#5A6B78;font-size:13.5px;line-height:1.3}
.bm-tile:focus-visible,.bm-x:focus-visible{outline:3px solid #4FD1C0;outline-offset:2px}`;

let sheet = null, page = null, watch = null;
function close() { if (sheet) sheet.remove(); sheet = null; }

// ---- a model panel shown as a page ----
const shown = (id) => { const el = document.getElementById(id); return !!el && !el.hidden; };
function endPage() {
  clearInterval(watch); watch = null; page = null;
  document.body.classList.remove("bm-paged");
  const h = $(".bm-pagehead"); if (h) h.remove();
}
function closePanel() {
  if (!page) return;
  const { id, sel } = page;
  if (shown(id)) {
    // use the panel's own way of closing so the model's state stays right
    const own = id === "clim" ? $("#climX") : id === "sheet" ? $("#sheet .x") : $(sel);
    if (own) own.click();
    if (shown(id)) document.getElementById(id).hidden = true;
  }
  endPage();
}
function openPage(sel, title, id) {
  const btn = $(sel);
  if (!btn) return;
  if (!shown(id)) btn.click();
  if (!shown(id)) { // nothing to show (e.g. no music player, or the TV has dropped off): stay on the menu
    if (["wx", "el", "fly", "music"].includes(id)) btn.click(); // these buttons are toggles, so put the toggle back
    return;
  }
  close();
  page = { id, sel };
  document.body.classList.add("bm-paged");
  const h = document.createElement("div");
  h.className = "bm-pagehead";
  h.innerHTML = `<button class="bm-back" type="button">‹ Menu</button><h2>${esc(title)}</h2><button class="bm-x" type="button" aria-label="Close">✕</button>`;
  document.body.appendChild(h);
  h.querySelector(".bm-back").onclick = () => { closePanel(); open(); };
  h.querySelector(".bm-x").onclick = closePanel;
  const el = document.getElementById(id); if (el) el.scrollTop = 0;
  // if the panel closes itself, drop the page header too
  watch = setInterval(() => { if (page && !shown(page.id)) endPage(); }, 300);
}

function open() {
  if (sheet) return;
  if (page) closePanel();
  const groups = [];
  ITEMS.forEach(([g, sel, title, sub, how], i) => {
    const el = $(sel);
    if (!el || el.hidden) return; // the model hides buttons it has nothing to show for
    let line = sub;
    if (sub === "live") line = (el.textContent || "").replace(/\s+/g, " ").trim() || "";
    let grp = groups.find((x) => x.g === g);
    if (!grp) groups.push((grp = { g, tiles: [] }));
    grp.tiles.push(`<button class="bm-tile" type="button" data-i="${i}"><b>${esc(title)}</b>${line ? `<small>${esc(line)}</small>` : ""}</button>`);
  });
  sheet = document.createElement("div");
  sheet.className = "bm-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "Menu");
  sheet.innerHTML = `<div class="bm-card"><div class="bm-head"><h2>Menu</h2><button class="bm-x" type="button" aria-label="Close">✕</button></div>
    <div class="bm-body">${groups.map((x) => `<section class="bm-sec"><h3>${esc(x.g)}</h3><div class="bm-grid">${x.tiles.join("")}</div></section>`).join("")}</div></div>`;
  document.body.appendChild(sheet);
  sheet.querySelector(".bm-x").onclick = close;
  sheet.onclick = (e) => { if (e.target === sheet) close(); };
  sheet.querySelectorAll(".bm-tile").forEach((t) => (t.onclick = () => {
    const [, sel, title, , how] = ITEMS[+t.dataset.i];
    const el = $(sel);
    if (!el) return;
    if (how === "action") return el.click();           // stays on the menu
    if (how === "module") { window.__bushbyBack = open; el.click(); return close(); } // its Back button reopens this menu
    openPage(sel, title, how);
  }));
}

export function install() {
  if (window.__bushbyMenu) return;
  const bar = $("header.bar");
  if (!bar) return;
  const s = document.createElement("style"); s.textContent = STYLE; document.head.appendChild(s);
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "btn bm-open"; btn.textContent = "Menu";
  btn.onclick = open;
  bar.appendChild(btn);
  // Top / 3D switch by the model, mirroring the real buttons
  const top = $("#vTop"), d3 = $("#v3d");
  if (top && d3) {
    const v = document.createElement("div");
    v.className = "bm-view"; v.setAttribute("role", "group"); v.setAttribute("aria-label", "View");
    v.innerHTML = `<button type="button" data-v="top">Top</button><button type="button" data-v="3d">3D</button>`;
    document.body.appendChild(v);
    const [bt, b3] = v.querySelectorAll("button");
    bt.onclick = () => top.click(); b3.onclick = () => d3.click();
    const sync = () => { bt.setAttribute("aria-pressed", top.getAttribute("aria-pressed") === "true"); b3.setAttribute("aria-pressed", d3.getAttribute("aria-pressed") === "true"); };
    new MutationObserver(sync).observe(top, { attributes: true }); new MutationObserver(sync).observe(d3, { attributes: true });
    sync();
  }
  // leaving phone width (rotating a tablet) closes the menu
  matchMedia(PHONE).addEventListener("change", (e) => { if (!e.matches) { close(); if (page) closePanel(); } });
  window.__bushbyMenu = { open, close };
}
