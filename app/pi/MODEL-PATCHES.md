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
