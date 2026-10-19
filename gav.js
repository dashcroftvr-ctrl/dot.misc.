import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* =========================================================================
   Gav — life-size animated character for Quest, with an in-headset
   animation picker. Works with any Meshy/Mixamo-rigged GLB: change MODEL.
   ========================================================================= */

const MODEL = 'models/gav.glb';
const HOME = new THREE.Vector3(0, 0, -1.8);     // 1.8 m in front of you
const ROAM_RADIUS = 1.5;                         // how far he may wander when "On the spot" is off
const LOCO = [[/run|jog/i, 1.8], [/look_around|slow/i, 0.6], [/excited/i, 1.3], [/walk/i, 1.1]]; // roaming speeds

// friendly names for the buttons (anything not listed is tidied up automatically)
const NAMES = {
  Running: 'Run', Walking: 'Walk', All_Night_Dance: 'All-Night Dance', Angry_Ground_Stomp_2: 'Angry Stomp',
  Climb_Attempt_and_Fall_1: 'Climb & Fall', Excited_Walk_M: 'Excited Walk', Handstand_Flip: 'Handstand Flip',
  Hip_Hop_Dance_2: 'Hip Hop', Lie_Down_Hands_Spread: 'Lie Down', OMG_Groove: 'OMG Groove', Punch_Pose: 'Punch Pose',
  Seated_Fist_Pump: 'Seated Fist Pump', Show_Both_Arm_Muscles: 'Show Muscles', Sit_to_standTransition_Female_2: 'Sit to Stand',
  Sleep_Normally: 'Sleep', Walk_Slowly_and_Look_Around: 'Look Around', Wave_for_Help_1: 'Quick Wave',
  Wave_for_Help_3: 'Wave for Help', kettlebell_swing: 'Kettlebell', ymca_dance: 'YMCA',
};
const pretty = (n) => NAMES[n] || n.replace(/_/g, ' ').replace(/\b(\d+|M|F)\b/g, '').replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());

const TEST = new URLSearchParams(location.search).has('test');
const $ = (id) => document.getElementById(id);
const setStatus = (t) => { $('status').textContent = t; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const UP = new THREE.Vector3(0, 1, 0);

/* ---------------- renderer / scene ---------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: TEST });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const DESK_BG = new THREE.Color(0x2b3035), VR_BG = new THREE.Color(0x16191c);
scene.background = DESK_BG;
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.75;
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6157, 0.7));
const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(1.5, 3, 1.2); scene.add(sun);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.03, 60);
camera.position.set(0.6, 1.6, 1.2);
scene.add(camera);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, -1.8); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.55; controls.update();

const world = new THREE.Group(); scene.add(world);           // moved by "Bring here" in XR
const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 64), new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 1 }));
floor.rotation.x = -Math.PI / 2; world.add(floor);
const grid = new THREE.GridHelper(14, 28, 0x50575e, 0x444a50); grid.position.y = 0.002; world.add(grid);

addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

function radialTex(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: radialTex('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = 1; world.add(shadow);

/* ---------------- Gav ---------------- */
const gav = { root: new THREE.Group(), yaw: 0, actions: [], cur: -1, speed: 1, onSpot: true };
world.add(gav.root);
gav.root.position.copy(HOME);

function setupModel(gltf) {
  const model = gltf.scene;
  model.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  gav.root.add(model);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  model.position.y = -box.min.y;
  gav.height = box.max.y - box.min.y;
  gav.model = model;
  gav.hips = model.getObjectByName('mixamorigHips') || model.getObjectByProperty('isBone', true);
  gav.head = model.getObjectByName('mixamorigHead') || gav.hips;
  gav.mixer = new THREE.AnimationMixer(model);

  // armature space -> character space, to measure how far each clip travels
  const pq = gav.hips.parent.getWorldQuaternion(new THREE.Quaternion());
  const ps = gav.hips.parent.getWorldScale(new THREE.Vector3()).x;
  for (const clip of gltf.animations) {
    let vel = new THREE.Vector3();
    const tr = clip.tracks.find((t) => /Hips\.position$/.test(t.name));
    if (tr) {
      const v = tr.values, n = v.length / 3, tt = tr.times, span = (tt[n - 1] - tt[0]) || 1;
      const dx = v[(n - 1) * 3] - v[0], dz = v[(n - 1) * 3 + 2] - v[2];
      vel = new THREE.Vector3(dx, 0, dz).applyQuaternion(pq).multiplyScalar(ps / clip.duration);
      vel.y = 0;
      // remove the net drift (keeps the natural sway) so the loop doesn't snap back
      for (let i = 0; i < n; i++) { const f = (tt[i] - tt[0]) / span; v[i * 3] -= dx * f; v[i * 3 + 2] -= dz * f; }
    }
    // Meshy's walk/run clips are "on the spot", so give them a forward speed for roaming (metres/second)
    const locomotion = LOCO.find(([re]) => re.test(clip.name));
    if (locomotion && vel.length() < 0.15) vel = new THREE.Vector3(0, 0, locomotion[1]);
    const action = gav.mixer.clipAction(clip);
    gav.actions.push({ name: clip.name, label: pretty(clip.name), action, vel, travels: !!locomotion });
  }
  gav.actions.sort((a, b) => a.label.localeCompare(b.label));
}

function play(i) {
  if (!gav.actions.length) return;
  i = (i + gav.actions.length) % gav.actions.length;
  const next = gav.actions[i].action, prev = gav.cur >= 0 ? gav.actions[gav.cur].action : null;
  next.reset(); next.setLoop(THREE.LoopRepeat, Infinity); next.setEffectiveWeight(1); next.play();
  if (prev && prev !== next) prev.crossFadeTo(next, 0.35, false);
  gav.cur = i;
  refreshLabels();
  setStatus('Now playing: ' + gav.actions[i].label);
}

/* ---------------- HTML controls (PC / phone preview) ---------------- */
function buildHtmlList() {
  const wrap = $('anims'); wrap.innerHTML = '';
  gav.actions.forEach((a, i) => {
    const b = document.createElement('button'); b.textContent = a.label; b.onclick = () => play(i); wrap.appendChild(b);
  });
}
document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => command(b.dataset.cmd)));

/* ---------------- floating XR menu ---------------- */
const panel = new THREE.Group(); panel.visible = false; scene.add(panel);
const buttons = [];
const BW = 0.096, BH = 0.04, GAP = 0.008, COLS = 4;
function makeButton(label, cmd, col, row, opts = {}) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 108;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  const b = { mesh, label, cmd, canvas: c, tex, hot: false, hover: false, latch: false, cd: 0, ...opts };
  mesh.userData.btn = b; panel.add(mesh); buttons.push(b);
  b.col = col; b.row = row;
  return b;
}
function drawButton(b) {
  const g = b.canvas.getContext('2d'); g.clearRect(0, 0, 256, 108);
  const active = b.anim !== undefined && b.anim === gav.cur;
  g.fillStyle = b.hot ? '#ffd400' : active ? '#4a3f00' : b.hover ? '#3a3f45' : '#24282c';
  g.beginPath(); g.roundRect(4, 4, 248, 100, 22); g.fill();
  g.strokeStyle = active || b.hot ? '#ffd400' : b.ctrl ? '#8a9096' : '#50575e'; g.lineWidth = active ? 7 : 4; g.stroke();
  let size = 34; g.font = `700 ${size}px "Segoe UI", Roboto, sans-serif`;
  const text = typeof b.label === 'function' ? b.label() : b.label;
  while (g.measureText(text).width > 228 && size > 20) { size -= 2; g.font = `700 ${size}px "Segoe UI", Roboto, sans-serif`; }
  g.fillStyle = b.hot ? '#141618' : '#f3f0e8'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 56);
  b.tex.needsUpdate = true;
}
function buildPanel() {
  const rowsA = Math.ceil(gav.actions.length / COLS);
  gav.actions.forEach((a, i) => makeButton(a.label, 'anim', i % COLS, Math.floor(i / COLS), { anim: i }));
  const r = rowsA + 0.35; // small gap before the control rows
  const ctrl = [
    ['◀ Prev', 'prev'], ['Next ▶', 'next'], ['Bring here', 'comehere'], ['Turn 45°', 'turn'],
    [() => 'Spot: ' + (gav.onSpot ? 'on' : 'off'), 'spot'], [() => 'Speed ' + gav.speed + '×', 'speed'], ['Hide menu', 'hide'], ['Exit', 'exit'],
  ];
  ctrl.forEach(([l, c], i) => makeButton(l, c, i % COLS, r + Math.floor(i / COLS), { ctrl: true }));
  const rows = r + 2;
  const W = COLS * BW + (COLS - 1) * GAP, H = rows * BH + (rows - 1) * GAP;
  for (const b of buttons) b.mesh.position.set(-W / 2 + BW / 2 + b.col * (BW + GAP), H / 2 - BH / 2 - b.row * (BH + GAP), 0.003);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.03, H + 0.06), new THREE.MeshBasicMaterial({ color: 0x141618, transparent: true, opacity: 0.8 }));
  plate.position.y = 0.012; panel.add(plate);
  // title strip
  const tc = document.createElement('canvas'); tc.width = 512; tc.height = 64;
  const tg = tc.getContext('2d'); tg.fillStyle = '#ffd400'; tg.font = '700 40px "Segoe UI", Roboto, sans-serif'; tg.textBaseline = 'middle'; tg.fillText('Gav — pick a move', 8, 34);
  const tt = new THREE.CanvasTexture(tc); tt.colorSpace = THREE.SRGBColorSpace;
  const title = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.025), new THREE.MeshBasicMaterial({ map: tt, transparent: true }));
  title.position.set(-W / 2 + 0.1, H / 2 + 0.022, 0.003); panel.add(title);
  buttons.forEach(drawButton);
}
function refreshLabels() { buttons.forEach(drawButton); document.querySelectorAll('#anims button').forEach((b, i) => b.classList.toggle('on', i === gav.cur)); }
function pressButton(b) {
  const t = clock.elapsedTime; if (t < b.cd) return; b.cd = t + 0.6;
  b.hot = true; drawButton(b); setTimeout(() => { b.hot = false; drawButton(b); }, 220);
  if (b.cmd === 'anim') play(b.anim); else command(b.cmd);
}
function placePanel(headW, yaw) {
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const left = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
  panel.position.copy(headW).addScaledVector(fwd, 0.42).addScaledVector(left, 0.3);
  panel.position.y = clamp(headW.y - 0.38, 0.75, 1.6);
  panel.lookAt(headW);
}

/* ---------------- commands ---------------- */
let needRecenter = false, currentSession = null;
function command(cmd) {
  if (cmd === 'next') play(gav.cur + 1);
  else if (cmd === 'prev') play(gav.cur - 1);
  else if (cmd === 'turn') gav.yaw += Math.PI / 4;
  else if (cmd === 'spot') { gav.onSpot = !gav.onSpot; if (gav.onSpot) gav.root.position.copy(HOME); $('spotBtn').textContent = 'On the spot: ' + (gav.onSpot ? 'on' : 'off'); refreshLabels(); }
  else if (cmd === 'speed') { gav.speed = gav.speed === 1 ? 1.5 : gav.speed === 1.5 ? 0.5 : 1; gav.mixer.timeScale = gav.speed; $('speedBtn').textContent = 'Speed: ' + gav.speed + '×'; refreshLabels(); }
  else if (cmd === 'comehere') { if (renderer.xr.isPresenting) needRecenter = true; else { gav.root.position.copy(HOME); gav.yaw = 0; } }
  else if (cmd === 'hide') panel.visible = false;
  else if (cmd === 'exit') currentSession?.end();
}

function recenter(headW, gazeW) {
  const yaw = Math.atan2(-gazeW.x, -gazeW.z);
  world.position.set(headW.x, 0, headW.z); world.rotation.y = yaw; world.updateMatrixWorld(true);
  gav.root.position.copy(HOME); gav.yaw = 0;
  placePanel(headW, yaw); panel.visible = true;
}

/* ---------------- XR input ---------------- */
const inputs = [0, 1].map((i) => {
  const ctrl = renderer.xr.getController(i), hand = renderer.xr.getHand(i);
  scene.add(ctrl); scene.add(hand);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.6 }));
  line.scale.z = 3; line.visible = false; ctrl.add(line);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd400 }));
  tip.visible = false; scene.add(tip);
  const inp = { ctrl, hand, line, tip, src: null, isHand: false, stickLatch: false };
  ctrl.addEventListener('connected', (e) => { inp.src = e.data; inp.isHand = !!e.data.hand; line.visible = true; });
  ctrl.addEventListener('disconnected', () => { inp.src = null; line.visible = false; tip.visible = false; });
  ctrl.addEventListener('select', () => rayPress(inp));
  ctrl.addEventListener('squeeze', () => { panel.visible = !panel.visible; });
  return inp;
});
const rc = new THREE.Raycaster();
function rayFrom(inp) { rc.setFromXRController(inp.ctrl); return rc; }
function rayPress(inp) {
  const r = rayFrom(inp);
  if (panel.visible) { const hit = r.intersectObjects(buttons.map((b) => b.mesh), false)[0]; if (hit) { pressButton(hit.object.userData.btn); return; } }
  if (rayHitsGav(r.ray)) play(gav.cur + 1);
}
function rayHitsGav(ray) {
  if (!gav.hips) return false;
  const a = gav.root.getWorldPosition(new THREE.Vector3()).setY(0.1);
  const b = gav.head.getWorldPosition(new THREE.Vector3());
  return ray.distanceSqToSegment(a, b) < 0.3 * 0.3;
}

// desktop: click Gav for the next move
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  rc.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  if (rayHitsGav(rc.ray)) play(gav.cur + 1);
});
addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') play(gav.cur + 1); if (e.key === 'ArrowLeft') play(gav.cur - 1); });

function xrInputFrame() {
  // hover highlight from rays
  const hovered = new Set();
  for (const inp of inputs) {
    if (!inp.src) continue;
    // thumbstick left/right flicks through animations
    const gp = inp.src.gamepad;
    if (gp && gp.axes.length >= 4) {
      const x = gp.axes[2];
      if (Math.abs(x) > 0.7 && !inp.stickLatch) { inp.stickLatch = true; play(gav.cur + (x > 0 ? 1 : -1)); }
      if (Math.abs(x) < 0.3) inp.stickLatch = false;
    }
    if (panel.visible) {
      const hit = rayFrom(inp).intersectObjects(buttons.map((b) => b.mesh), false)[0];
      if (hit) { hovered.add(hit.object.userData.btn); inp.line.scale.z = hit.distance; } else inp.line.scale.z = 3;
    }
    // fingertip presses
    if (inp.isHand) {
      const j = inp.hand.joints || {}, tipJ = j['index-finger-tip'];
      if (tipJ && tipJ.visible) {
        const p = tipJ.getWorldPosition(new THREE.Vector3());
        inp.tip.position.copy(p); inp.tip.visible = true;
        if (panel.visible) for (const b of buttons) {
          const lp = b.mesh.worldToLocal(p.clone());
          const inside = Math.abs(lp.x) < BW / 2 && Math.abs(lp.y) < BH / 2 && lp.z < 0.012 && lp.z > -0.04;
          if (inside && !b.latch) { b.latch = true; pressButton(b); }
          if (!inside && (lp.z > 0.02 || Math.abs(lp.x) > BW / 2 + 0.005 || Math.abs(lp.y) > BH / 2 + 0.005)) b.latch = false;
          if (Math.abs(lp.x) < BW / 2 && Math.abs(lp.y) < BH / 2 && lp.z < 0.05 && lp.z > -0.04) hovered.add(b);
        }
      } else inp.tip.visible = false;
    }
  }
  for (const b of buttons) { const h = hovered.has(b); if (h !== b.hover) { b.hover = h; drawButton(b); } }
}

/* ---------------- main loop ---------------- */
const clock = new THREE.Clock();
const headW = new THREE.Vector3(), gazeW = new THREE.Vector3();
let ready = false;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const presenting = renderer.xr.isPresenting;
  if (!presenting) controls.update();
  const cam = presenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(headW); cam.getWorldDirection(gazeW);
  if (ready) {
    if (presenting && needRecenter && headW.y > 0.4) { needRecenter = false; recenter(headW, gazeW); }
    if (presenting) xrInputFrame();
    // roaming: carry him along with walking/running moves, turning back before he leaves the area
    const a = gav.actions[gav.cur];
    if (!gav.onSpot && a && a.travels) {
      const p = gav.root.position;
      const off = p.clone().sub(HOME); off.y = 0;
      const me = world.worldToLocal(headW.clone()); me.y = 0;
      const toMe = me.clone().sub(p); toMe.y = 0;
      const heading = gav.yaw + Math.atan2(a.vel.x, a.vel.z);
      let steer = null;
      // don't walk into the viewer: turn away if heading towards them and within 1.3 m
      if (toMe.length() < 1.3 && Math.cos(Math.atan2(toMe.x, toMe.z) - heading) > 0.2) steer = Math.atan2(-toMe.x, -toMe.z);
      else if (off.length() > ROAM_RADIUS * 0.75) steer = Math.atan2(-off.x, -off.z); // head back towards the middle
      if (steer !== null) gav.yaw += clamp(wrapAngle(steer - heading), -2.2 * dt, 2.2 * dt);
      gav.root.position.add(a.vel.clone().applyAxisAngle(UP, gav.yaw).multiplyScalar(dt * gav.speed));
    }
    gav.root.rotation.y = gav.yaw;
    gav.mixer.update(dt);
    const hp = world.worldToLocal(gav.hips.getWorldPosition(new THREE.Vector3()));
    shadow.position.set(hp.x, 0.004, hp.z);
    const lift = clamp(hp.y - gav.height * 0.53, 0, 1);
    shadow.material.opacity = clamp(0.9 - lift * 1.5, 0.15, 0.9);
    shadow.scale.setScalar(1 + lift * 0.6);
  }
  renderer.render(scene, camera);
});

/* ---------------- XR session ---------------- */
async function startXR(mode) {
  try {
    const s = await navigator.xr.requestSession(mode, { optionalFeatures: ['local-floor', 'hand-tracking'] });
    const ar = mode === 'immersive-ar';
    scene.background = ar ? null : VR_BG; floor.visible = grid.visible = !ar;
    await renderer.xr.setSession(s); currentSession = s;
    needRecenter = true;
    s.addEventListener('end', () => {
      currentSession = null; scene.background = DESK_BG; floor.visible = grid.visible = true; panel.visible = false;
      world.position.set(0, 0, 0); world.rotation.set(0, 0, 0); gav.root.position.copy(HOME); gav.yaw = 0;
    });
  } catch (e) { setStatus('Could not start: ' + e.message); }
}
$('btnAR').onclick = () => startXR('immersive-ar');
$('btnVR').onclick = () => startXR('immersive-vr');
if (navigator.xr) {
  Promise.all([navigator.xr.isSessionSupported('immersive-ar'), navigator.xr.isSessionSupported('immersive-vr')]).then(([ar, vr]) => {
    $('btnAR').disabled = !ar; $('btnVR').disabled = !vr;
    if (!ar && !vr) setStatus(isSecureContext ? 'Preview mode — open this page in the Quest browser to step in.' : 'Needs an https:// link to enter VR — see README.');
  });
} else setStatus(isSecureContext ? 'Preview mode — open this page in the Quest browser to step in.' : 'Needs an https:// link to enter VR — see README.');

/* ---------------- load ---------------- */
new GLTFLoader().loadAsync(MODEL).then((gltf) => {
  setupModel(gltf); buildHtmlList(); buildPanel();
  const start = gav.actions.findIndex((a) => /idle|look_around|breath/i.test(a.name));
  play(start >= 0 ? start : 0);
  ready = true; $('loading').remove();
}).catch((e) => { $('loading').textContent = 'Could not load Gav: ' + (e.message || e); console.error(e); });

if (TEST) window.APP = { gav, play, command, camera, controls, panel, buttons, THREE, get ready() { return ready; },
  showPanel() { placePanel(new THREE.Vector3(0, 1.6, 0), 0); panel.visible = true; } };
