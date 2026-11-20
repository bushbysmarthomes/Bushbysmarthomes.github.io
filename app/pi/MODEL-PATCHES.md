# Model patches every home.html needs

The four .js files in this folder are generic: copy them next to a home's `home.html` in `/config/www/bushby-<random 12>/`.
Nothing in them is home-specific. `bushby-home.js` loads `home.html`, then `bushby-automations.js`, which loads
`bushby-quick.js` (Quick access) and then `bushby-menu.js` (phone menu).

Each home's own `home.html` (its 3D model) must also contain the block below, placed straight after the renderer line:

```js
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance"});
{/* Android throws away the pixels of drawing canvases while the app is in the background, so textures made from
   them (brick, render, glass, floors) come back black. Once a canvas texture has stopped changing, swap its canvas
   for a PNG copy: the browser can always re-decode an image. Textures that keep being redrawn are left as canvases. */
 const KEYS=["map","emissiveMap","alphaMap","bumpMap","normalMap","roughnessMap","aoMap"],seen=new Map();
 const freeze=()=>{try{scene.traverse(o=>{[].concat(o.material||[]).forEach(m=>{KEYS.forEach(k=>{const t=m&&m[k];if(!t)return;
   const im=t.image,u=t.userData||(t.userData={});
   if(u.bzFrozen){if(t.version!==u.bzVer&&u.bzCanvas){t.image=u.bzCanvas;u.bzFrozen=false;u.bzSkip=true;t.needsUpdate=true;}return;} // code redrew it: give it its canvas back for good
   if(u.bzSkip||!(im instanceof HTMLCanvasElement)||!im.width)return;
   const v=seen.get(t);seen.set(t,t.version);if(v===undefined||v!==t.version)return; // wait until it has been stable for one round
   let url;try{url=im.toDataURL("image/png");}catch(e){u.bzSkip=true;return;}
   const img=new Image();img.onload=()=>{if(u.bzSkip)return;u.bzCanvas=im;t.image=img;t.needsUpdate=true;u.bzVer=t.version;u.bzFrozen=true;};img.src=url;});});});}catch(e){}};
 setTimeout(freeze,2500);setTimeout(freeze,5500);setInterval(freeze,8000);}
{const refresh=()=>{try{scene.traverse(o=>{[].concat(o.material||[]).forEach(m=>{["map","emissiveMap","alphaMap","bumpMap","normalMap","roughnessMap","aoMap"].forEach(k=>{if(m[k]&&m[k].image){m[k].needsUpdate=true;const u=m[k].userData;if(u&&u.bzFrozen)u.bzVer=m[k].version;}});m.needsUpdate=true;});});}catch(e){}};
 renderer.domElement.addEventListener("webglcontextrestored",refresh,false);
 document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refresh();}
```

Why: Android throws away the pixels of the model's drawing canvases while the app is in the background, and can
drop the WebGL context. Without this block the brick, walls and floors come back black. It swaps each stable canvas
texture for a PNG copy (which the browser can always re-decode) and refreshes textures when the page is shown again.
Tested 14 Nov 2026 by clearing every canvas and forcing a context loss and restore.

Header rules (14 Nov 2026): logo and clock have no box, no background and no glow, and are drawn heavy
(thickened logo PNG, 1.6 px text stroke on the clock). The live status is plain small text with a coloured dot.

## 2026-11-17 design review fixes (home.html)
- Night look: dim only the header buttons; logo, clock and the "Live from Home Assistant" line get a light backing so they stay readable.
- Pins: 44px hit area (`.dev::before`), soft offset shadow instead of a coloured glow, focus rings on buttons, chips and pins.
- Room chips: right-edge fade, no bare counts (count moves to aria-label).
- Climate: "now" uses the live sensor, printer sensors filtered out, no "readings" headline.
- Electricity: unit on the button ("kr/kWh"), plain wording, a "Try again" state after 15 s with no prices.
- Esc closes any open panel. Plain-English pin states ("Online", "No movement").

## 2026-11-17/18 look and movement (home.html)
- Colour textures: set `texture.encoding = THREE.sRGBEncoding` on every canvas colour texture (floorboards, brick). Without it the wood and brick look washed out. No ACES tone mapping.
- Evening light: one low warm `SpotLight` with shadows from a corner of the home, plus a cool fill from the two point lights above; sky light cut back as evening comes in. Lit lamps throw a wider pool after dark (range 3.2 m to 5.6 m).
- Baked shading (optional, per home): a Blender ambient-occlusion bake laid on as `aoMap` with a planar `uv2` on each floor (floors `aoMapIntensity` 1.5) and a 5-cells-per-piece atlas on the walls (1.6, applied only if the wall count matches). Each home needs its own bake; never copy another home's pictures.
- Walls: every wall and window piece is two boxes, full height and a low kerb. The join sits where the "near side" line crosses the wall, so a wall opens centimetre by centimetre with a flat top and an upright edge. Fixtures on walls sink as whole pieces. Never slope the tops.
- Phone pins: 20 px pins with a 44 px press area on screens up to 760 px; labels that only say "all normal" (Closed, Docked, Online, No movement, Done) are hidden on a phone; a tap goes to the nearest pin.
- Room names step up or down (0, 18, -18, 34, -34, 50, -50 px) out of the way of pins and their labels, easing so they don't jump. Measured sizes are cached and cleared on resize.
- Price button: wrap the price and unit in one span, or the button's gap splits "kr" and "/kWh".

The cleaned customer starting file (no personal panels, makes or names) is kept on the laptop, not here,
because it still holds a real floor plan: Models\Template - in-home model\home.html with a README of what to set per home.

## 2026-11-20 bulbs with no power (home.html and bushby-quick.js)
- A smart bulb that Home Assistant can't reach has almost always been switched off at the wall. It now shows as **Off**, not Offline. Sensors, plugs and everything else still show Offline.
- 3D model (each home's home.html): the bulb's pin says Off. Its panel shows "Offline · no power. Is the wall switch off? Try switching it on." and hides Turn on and brightness. Apply with `Build scripts\2026-11-20 bulbs no power\bulbs_no_power_patch.py home.html` on the laptop. It writes home.html.new and stops if the lines it changes aren't found exactly once.
- Quick access (bushby-quick.js, generic): the tile says Off with a small "Offline · no power" line. Tapping it gives the wall-switch prompt instead of sending a command. **All on** skips those bulbs and says which ones had no power (the message stays 12 s).
- Also fixed in bushby-quick.js: a successful command used to clear the message line straight away, so "All lights on" and its Undo button vanished at once. The message and Undo now stay for their full time.
