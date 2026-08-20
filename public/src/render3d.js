// WebGL presentation layer (three.js + bloom). The simulation never lives
// here — this only *shows* world/actor state, so determinism is untouched.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TILE, COLS, ROWS } from './levels.js';
import { drawCat } from './actors.js';

const W = 960, H = 540;
const LETTER_COLORS = { a: 0x6ee7ff, b: 0xffb347, c: 0xff7ac8 };

let renderer, scene, camera, composer, bloom;
let levelGroup = null;
let doorMeshes = [], plateMeshes = [], plateLights = [], boxMeshes = [], exitPulse = [];
let catPool = [];            // billboard cat sprites {canvas, tex, mesh, ctx}
let dust, dustVel = [];
let sparks, sparkData = [];  // burst particle pool
let threads = [];
let shakeMag = 0;
let bloomBoost = 0;
let loomGroup = null, loomRings = [], loomCore = null, loomLight = null;
let loomState = 0, loomT = 0;   // 0 idle, 1 breaking, 2 stay
let menuLoom = null;
const fogBanks = [];
let beamPool = [];
let avatar = null;

function silhouetteTexture(tint, alpha) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 576;
  const g = c.getContext('2d');
  g.fillStyle = tint;
  g.globalAlpha = alpha;
  // broken pillars
  for (let i = 0; i < 5; i++) {
    const x = (i / 5) * 1024 + Math.random() * 120;
    const w = 26 + Math.random() * 46;
    const h = 150 + Math.random() * 260;
    g.beginPath();
    g.moveTo(x, 576);
    g.lineTo(x, 576 - h);
    // jagged broken top
    for (let j = 0; j <= 4; j++) g.lineTo(x + (w * j) / 4, 576 - h + (j % 2 ? 14 : -6) * Math.random());
    g.lineTo(x + w, 576);
    g.closePath();
    g.fill();
    // arch: connect some pillars with a semicircle span
    if (i % 3 === 1) {
      const r = 60 + Math.random() * 40;
      g.beginPath();
      g.arc(x + w + r, 576 - h + 30, r, Math.PI, 0);
      g.lineWidth = 9 + Math.random() * 7;
      g.strokeStyle = tint;
      g.stroke();
    }
  }
  // hanging roots from the ceiling
  g.lineWidth = 3;
  g.strokeStyle = tint;
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * 1024;
    const len = 60 + Math.random() * 160;
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x - 15, len * 0.4, x + 18, len * 0.7, x + Math.random() * 24 - 12, len);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function fogTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 256, y = Math.random() * 96, r = 24 + Math.random() * 44;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(140,175,220,0.10)');
    grad.addColorStop(1, 'rgba(140,175,220,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 96);
  }
  // fade the whole sheet toward its edges so plane borders never show
  g.globalCompositeOperation = 'destination-in';
  const mask = g.createRadialGradient(128, 48, 10, 128, 48, 130);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = mask;
  g.fillRect(0, 0, 256, 96);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const sx = x => x - W / 2;
const sy = y => H / 2 - y;

export function init(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(W, H, false);
  renderer.setPixelRatio(1);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  scene.fog = new THREE.Fog(0x05070d, 700, 1400);

  camera = new THREE.PerspectiveCamera(42, W / H, 1, 2000);
  camera.position.set(0, 0, 703);

  scene.add(new THREE.AmbientLight(0x8ab4ff, 0.62));
  const dir = new THREE.DirectionalLight(0xbfdcff, 0.85);
  dir.position.set(-200, 300, 500);
  scene.add(dir);

  // background gradient plane
  const bgTex = gradientTexture();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2400, 1400), new THREE.MeshBasicMaterial({ map: bgTex, fog: false }));
  bg.position.z = -260;
  scene.add(bg);

  // parallax silhouette layers — ruined arches, pillars, hanging roots
  for (const [z, tint, alpha] of [[-230, '#121d33', 0.7], [-170, '#0d1626', 0.75], [-120, '#0a101d', 0.85]]) {
    const tex = silhouetteTexture(tint, alpha);
    const pl = new THREE.Mesh(
      new THREE.PlaneGeometry(1900, 1069),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, depthWrite: false }));
    pl.position.z = z;
    scene.add(pl);
  }
  // drifting fog banks
  for (let i = 0; i < 3; i++) {
    const fogMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 320),
      new THREE.MeshBasicMaterial({ map: fogTexture(), transparent: true, opacity: 0.11, fog: false, depthWrite: false }));
    fogMesh.position.set((i - 1) * 500, -80 + i * 90, -100 - i * 30);
    fogMesh.userData.drift = 0.06 + i * 0.03;
    fogBanks.push(fogMesh);
    scene.add(fogMesh);
  }

  // loom threads — swaying filaments behind the play field
  for (let i = 0; i < 7; i++) {
    const pts = [];
    for (let s = 0; s <= 24; s++) pts.push(new THREE.Vector3(0, H / 2 - (s / 24) * H * 1.4 + 100, 0));
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x6ec0ff, transparent: true, opacity: 0.05 }));
    line.position.z = -80 - (i % 3) * 40;
    line.userData.seed = i * 2.1;
    threads.push(line);
    scene.add(line);
  }

  // ambient dust
  {
    const n = 130;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * W * 1.2;
      pos[i * 3 + 1] = (Math.random() - 0.5) * H * 1.2;
      pos[i * 3 + 2] = -60 + Math.random() * 100;
      dustVel.push(0.05 + Math.random() * 0.2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xbfe3ff, size: 1.6, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(dust);
  }

  // spark pool for bursts
  {
    const n = 400;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3 + 1] = -9999; sparkData.push({ life: 0 }); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    sparks = new THREE.Points(g, new THREE.PointsMaterial({ size: 3, vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    sparks.frustumCulled = false;
    scene.add(sparks);
  }

  // ambient Loom shown behind menu screens
  menuLoom = new THREE.Group();
  const mcolors = [0x6ee7ff, 0xff7ac8, 0xffb347];
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(70 + i * 30, 2.4, 10, 70),
      new THREE.MeshStandardMaterial({ color: mcolors[i], emissive: mcolors[i], emissiveIntensity: 0.55, roughness: 0.35, transparent: true, opacity: 0.85 }));
    ring.userData.axis = new THREE.Vector3(Math.sin(i * 2.1), Math.cos(i * 1.3), 0.7).normalize();
    ring.userData.speed = 0.004 + i * 0.003;
    menuLoom.add(ring);
  }
  const mcore = new THREE.Mesh(
    new THREE.IcosahedronGeometry(17, 1),
    new THREE.MeshStandardMaterial({ color: 0xeaffff, emissive: 0xbfe8ff, emissiveIntensity: 0.8, roughness: 0.2 }));
  menuLoom.add(mcore);
  const mlight = new THREE.PointLight(0x9fd8ff, 6500, 500);
  mlight.position.z = 70;
  menuLoom.add(mlight);
  menuLoom.position.set(0, 30, -60);
  scene.add(menuLoom);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.75, 0.5, 0.62);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}

function gradientTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#0b1226');
  grad.addColorStop(0.55, '#070b16');
  grad.addColorStop(1, '#04060c');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,0.55)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const BEAM_TEX = { t: null };

// ---------- level construction ----------

export function buildLevel(world) {
  if (levelGroup) { scene.remove(levelGroup); disposeGroup(levelGroup); }
  levelGroup = new THREE.Group();
  doorMeshes = []; plateMeshes = []; plateLights = []; boxMeshes = []; exitPulse = [];

  // --- tiles (instanced) + exposed-top glow strips ---
  const solids = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (world.solidGrid[r][c]) solids.push([c, r]);

  const tileGeo = new THREE.BoxGeometry(TILE, TILE, 46);
  const tileMat = new THREE.MeshStandardMaterial({ color: 0x1a2740, roughness: 0.82, metalness: 0.2 });
  const tiles = new THREE.InstancedMesh(tileGeo, tileMat, solids.length);
  const m = new THREE.Matrix4();
  solids.forEach(([c, r], i) => {
    m.setPosition(sx(c * TILE + TILE / 2), sy(r * TILE + TILE / 2), 0);
    tiles.setMatrixAt(i, m);
  });
  levelGroup.add(tiles);

  const tops = solids.filter(([c, r]) => r === 0 || !world.solidGrid[r - 1][c]);
  if (tops.length) {
    const topGeo = new THREE.BoxGeometry(TILE, 2.5, 48);
    const topMat = new THREE.MeshStandardMaterial({ color: 0x223752, emissive: 0x6ec0ff, emissiveIntensity: 0.22, roughness: 0.5 });
    const strips = new THREE.InstancedMesh(topGeo, topMat, tops.length);
    tops.forEach(([c, r], i) => {
      m.setPosition(sx(c * TILE + TILE / 2), sy(r * TILE) - 1.2, 2);
      strips.setMatrixAt(i, m);
    });
    levelGroup.add(strips);
  }

  // --- spikes ---
  if (world.spikes.length) {
    const coneGeo = new THREE.ConeGeometry(4.4, 17, 4);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xd8e4f2, emissive: 0x9fb8d0, emissiveIntensity: 0.25, roughness: 0.4 });
    const cones = new THREE.InstancedMesh(coneGeo, coneMat, world.spikes.length * 3);
    let i = 0;
    for (const s of world.spikes)
      for (let k = 0; k < 3; k++) {
        m.setPosition(sx(s.c * TILE + 7.5 + k * 7.5), sy(s.r * TILE + TILE) + 8, 0);
        cones.setMatrixAt(i++, m);
      }
    levelGroup.add(cones);
  }

  // --- plates: emissive slab + light + beam ---
  if (!BEAM_TEX.t) BEAM_TEX.t = beamTexture();
  for (const p of world.plates) {
    const col = LETTER_COLORS[p.letter] ?? 0x6ee7ff;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(TILE - 8, 5, 30),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.2, roughness: 0.3 }));
    slab.position.set(sx(p.c * TILE + TILE / 2), sy(p.r * TILE + TILE - 4), 4);
    levelGroup.add(slab);
    plateMeshes.push(slab);

    const light = new THREE.PointLight(col, 4200, 170);
    light.position.set(slab.position.x, slab.position.y + 22, 30);
    levelGroup.add(light);
    plateLights.push(light);

    const beam = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 92),
      new THREE.MeshBasicMaterial({ map: BEAM_TEX.t, color: col, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.set(slab.position.x, slab.position.y + 48, 3);
    beam.rotation.z = Math.PI;
    levelGroup.add(beam);
    slab.userData.beam = beam;
  }

  // --- doors ---
  for (const d of world.doors) {
    const col = LETTER_COLORS[d.letter] ?? 0x6ee7ff;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(TILE - 8, TILE, 38),
      new THREE.MeshStandardMaterial({ color: 0x16233a, emissive: col, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.3 }));
    mesh.userData.topY = sy(d.r * TILE);
    mesh.position.set(sx(d.c * TILE + TILE / 2), sy(d.r * TILE + TILE / 2), 0);
    levelGroup.add(mesh);
    doorMeshes.push(mesh);
  }

  // --- boxes (crates) ---
  for (let i = 0; i < world.boxes.length; i++) {
    const grp = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(27, 27, 27),
      new THREE.MeshStandardMaterial({ color: 0x2c3d5e, roughness: 0.7, metalness: 0.25 }));
    grp.add(core);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(28, 28, 28)),
      new THREE.LineBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.8 }));
    grp.add(edges);
    levelGroup.add(grp);
    boxMeshes.push(grp);
  }

  // --- exits: glowing arch + light ---
  for (const e of world.exits) {
    const warm = e.kind === 'stay';
    const col = warm ? 0xffc87a : 0xeaffff;
    const grp = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9, roughness: 0.3 });
    const arc = new THREE.Mesh(new THREE.TorusGeometry(10, 1.6, 8, 20, Math.PI), mat);
    arc.position.y = 4;
    grp.add(arc);
    for (const dx of [-10, 10]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 14, 8), mat);
      leg.position.set(dx, -3, 0);
      grp.add(leg);
    }
    const glow = new THREE.PointLight(col, 5000, 200);
    glow.position.z = 26;
    grp.add(glow);
    grp.position.set(sx(e.c * TILE + TILE / 2), sy(e.r * TILE + TILE - 12), 2);
    levelGroup.add(grp);
    exitPulse.push({ grp, mat, glow, warm });
  }

  // husks — petrified cats the Loom collected before you
  for (const [c, r] of (world.def.husks || [])) {
    const cv = document.createElement('canvas');
    cv.width = 96; cv.height = 96;
    const g2 = cv.getContext('2d');
    g2.translate(48, 78);
    g2.rotate(-0.12);
    g2.scale(1.6, 1.5);
    drawCat(g2, 0, 0, Math.random() > 0.5 ? 1 : -1, 0.3, 0, { husk: true, grounded: true });
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(48, 48),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false }));
    mesh.position.set(sx(c * TILE + TILE / 2), sy((r + 1) * TILE) + 15, -6);
    levelGroup.add(mesh);
  }

  // finale: the Loom itself hangs over the chamber
  loomGroup = null; loomRings = []; loomState = 0; loomT = 0;
  avatar = null;
  if (world.def && world.def.finale) {
    loomGroup = new THREE.Group();
    const colors = [0x6ee7ff, 0xff7ac8, 0xffb347];
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(52 + i * 22, 2.2, 10, 60),
        new THREE.MeshStandardMaterial({ color: colors[i], emissive: colors[i], emissiveIntensity: 0.8, roughness: 0.3, transparent: true }));
      ring.userData.axis = new THREE.Vector3(Math.sin(i * 2.1), Math.cos(i * 1.3), 0.6 + i * 0.2).normalize();
      ring.userData.speed = 0.006 + i * 0.004;
      loomGroup.add(ring);
      loomRings.push(ring);
    }
    loomCore = new THREE.Mesh(
      new THREE.IcosahedronGeometry(15, 1),
      new THREE.MeshStandardMaterial({ color: 0xeaffff, emissive: 0xbfe8ff, emissiveIntensity: 1.1, roughness: 0.2, transparent: true }));
    loomGroup.add(loomCore);
    loomLight = new THREE.PointLight(0x9fd8ff, 9000, 460);
    loomLight.position.z = 60;
    loomGroup.add(loomLight);
    loomGroup.position.set(0, 90, -20);
    levelGroup.add(loomGroup);

    // the First Cat — spectral face of the old tales, watching from above
    const av = document.createElement('canvas');
    av.width = 512; av.height = 512;
    const ag = av.getContext('2d');
    ag.translate(256, 420);
    ag.scale(9, 9);
    drawCat(ag, 0, 0, 1, 0.5, 0, { ghost: true, alpha: 1, grounded: true });
    const at = new THREE.CanvasTexture(av);
    at.colorSpace = THREE.SRGBColorSpace;
    avatar = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshBasicMaterial({ map: at, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    avatar.position.set(0, 110, -55);
    levelGroup.add(avatar);

    // beam column pool
    beamPool = [];
    for (let i = 0; i < 6; i++) {
      const bm = new THREE.Mesh(
        new THREE.PlaneGeometry(TILE - 6, H),
        new THREE.MeshBasicMaterial({ color: 0xffc0a8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      bm.position.z = 5;
      bm.visible = false;
      levelGroup.add(bm);
      beamPool.push(bm);
    }
  }

  scene.add(levelGroup);
}

export function loomBreak() { if (loomGroup) { loomState = 1; loomT = 0; } }
export function loomStay() { if (loomGroup) { loomState = 2; loomT = 0; } }

function disposeGroup(g) {
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(mm => { if (mm.map && !Object.values(BEAM_TEX).includes(mm.map)) mm.map.dispose(); mm.dispose(); });
  });
}

// ---------- cat billboards ----------

function makeCatSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 64),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  mesh.visible = false;
  scene.add(mesh);
  return { canvas, ctx: canvas.getContext('2d'), tex, mesh };
}

function drawCatSprite(slot, x, y, face, phase, vy, opts, z = 6) {
  const { ctx, tex, mesh } = slot;
  ctx.clearRect(0, 0, 128, 128);
  ctx.save();
  ctx.translate(64, 96);
  ctx.scale(2, 2);
  drawCat(ctx, 0, 0, face, phase, vy, opts);
  ctx.restore();
  tex.needsUpdate = true;
  mesh.position.set(sx(x), sy(y) + 16, z);
  mesh.visible = true;
}

// ---------- burst particles ----------

export function burst(x, y, hex, n = 14, speed = 3, life = 34) {
  const pos = sparks.geometry.attributes.position.array;
  const col = sparks.geometry.attributes.color.array;
  const c = new THREE.Color(hex);
  let spawned = 0;
  for (let i = 0; i < sparkData.length && spawned < n; i++) {
    const d = sparkData[i];
    if (d.life > 0) continue;
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random() * 0.8);
    d.life = d.max = life * (0.6 + Math.random() * 0.4);
    d.vx = Math.cos(a) * s; d.vy = Math.sin(a) * s; d.vz = (Math.random() - 0.5) * s;
    pos[i * 3] = sx(x); pos[i * 3 + 1] = sy(y); pos[i * 3 + 2] = 8;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    spawned++;
  }
  sparks.geometry.attributes.position.needsUpdate = true;
  sparks.geometry.attributes.color.needsUpdate = true;
}

export function streaks() {
  // fast horizontal rewind streaks
  for (let i = 0; i < 4; i++) burst(Math.random() * W, Math.random() * H, 0x8fe8ff, 2, 14, 12);
}

export function shake(mag) { shakeMag = Math.max(shakeMag, mag); }
export function boostBloom() { bloomBoost = 1; }

// ---------- per-frame render ----------

// cats: [{x,y,face,phase,vy,opts,z}]
export function render(t, world, cats, playerX, playerY, loopTick = -1) {
  if (!renderer) return;
  if (menuLoom) menuLoom.visible = false;
  if (levelGroup) levelGroup.visible = true;
  if (sparks) sparks.visible = true;

  // doors follow sim state
  world.doors.forEach((d, i) => {
    const mm = doorMeshes[i];
    if (!mm) return;
    const h = Math.max(0.02, 1 - d.open);
    mm.scale.y = h;
    mm.position.y = mm.userData.topY - (TILE * h) / 2;
    mm.material.emissiveIntensity = 0.35 + (1 - d.open) * 0.5;
  });
  // plates pulse
  world.plates.forEach((p, i) => {
    const slab = plateMeshes[i];
    if (!slab) return;
    slab.material.emissiveIntensity = 0.7 + p.anim * 1.1 + Math.sin(t * 0.08 + i) * 0.12;
    slab.scale.y = 1 - p.anim * 0.55;
    if (plateLights[i]) plateLights[i].intensity = 3000 + p.anim * 6000;
    if (slab.userData.beam) slab.userData.beam.material.opacity = 0.5 * (1 - p.anim);
  });
  // boxes
  world.boxes.forEach((b, i) => {
    const g = boxMeshes[i];
    if (g) g.position.set(sx(b.x + b.w / 2), sy(b.y + b.h / 2), 0);
  });
  // exits pulse
  exitPulse.forEach(({ mat, glow }, i) => {
    const k = 0.75 + Math.sin(t * 0.06 + i) * 0.25;
    mat.emissiveIntensity = 0.7 + k * 0.5;
    glow.intensity = 3200 + 2600 * k;
  });

  // cats
  while (catPool.length < cats.length) catPool.push(makeCatSprite());
  catPool.forEach((slot, i) => {
    if (i < cats.length) {
      const c = cats[i];
      drawCatSprite(slot, c.x, c.y, c.face, c.phase, c.vy || 0, c.opts, c.z ?? 6);
      slot.mesh.material.opacity = 1;   // alpha already applied inside drawCat
    } else slot.mesh.visible = false;
  });

  for (const f of fogBanks) {
    f.position.x += f.userData.drift;
    if (f.position.x > 1100) f.position.x = -1100;
  }

  // First Cat gaze beams
  if (beamPool.length) {
    let bi = 0;
    let striking = false;
    if (loopTick >= 0 && world.def.beams) {
      for (const ph of world.beamPhase(loopTick)) {
        for (const c of ph.cols) {
          const bm = beamPool[bi++];
          if (!bm) continue;
          bm.visible = true;
          bm.position.x = sx(c * TILE + TILE / 2);
          bm.position.y = 0;
          if (ph.warn) {
            bm.material.opacity = 0.05 + ph.k * 0.10;
            bm.material.color.setHex(0xff9070);
            bm.scale.x = 0.35 + ph.k * 0.3;
          } else {
            striking = true;
            bm.material.opacity = 0.55 * (1 - ph.k * 0.4);
            bm.material.color.setHex(0xfff0e0);
            bm.scale.x = 1;
          }
        }
      }
    }
    for (; bi < beamPool.length; bi++) beamPool[bi].visible = false;
    if (avatar) {
      avatar.material.opacity = (striking ? 0.8 : 0.4) + Math.sin(t * 0.03) * 0.07;
      avatar.position.x = Math.sin(t * 0.006) * 25;
    }
  }

  // the Loom turns
  if (loomGroup) {
    loomT++;
    const spin = loomState === 1 ? 1 + loomT * 0.12 : loomState === 2 ? 0.35 : 1;
    loomRings.forEach(r => { r.rotateOnAxis(r.userData.axis, r.userData.speed * spin); });
    if (loomCore) loomCore.rotation.y += 0.01 * spin;
    if (loomState === 1) {
      // shatter: rings fly apart and fade, core collapses
      const k = Math.min(1, loomT / 90);
      loomRings.forEach((r, i) => {
        r.scale.setScalar(1 + k * (1.5 + i * 0.7));
        r.material.opacity = 1 - k;
        r.material.emissiveIntensity = 0.8 + k * 2.5;
      });
      if (loomCore) { loomCore.scale.setScalar(Math.max(0.05, 1 - k * 1.1)); loomCore.material.emissiveIntensity = 1.1 + k * 4; }
      if (loomLight) loomLight.intensity = 9000 + k * 30000 * (1 - k);
      if (loomT % 6 === 0 && k < 0.9) burst(W / 2 + (Math.random() - 0.5) * 160, 180 + (Math.random() - 0.5) * 120, [0x6ee7ff, 0xff7ac8, 0xffb347][loomT % 3], 10, 4, 40);
      if (loomT === 1) { shakeMag = 14; bloomBoost = 1; }
    } else if (loomState === 2) {
      // warm down: amber calm
      loomRings.forEach(r => { r.material.emissive.lerp(new THREE.Color(0xffc87a), 0.02); });
      if (loomCore) loomCore.material.emissive.lerp(new THREE.Color(0xffd9a0), 0.02);
      if (loomLight) loomLight.color.lerp(new THREE.Color(0xffc87a), 0.02);
    }
  }

  // threads sway
  for (const line of threads) {
    const arr = line.geometry.attributes.position.array;
    const seed = line.userData.seed;
    const bx = sx(((seed * 137) % W + W) % W);
    for (let s = 0; s < arr.length / 3; s++) {
      arr[s * 3] = bx + Math.sin(s * 0.4 + t * 0.012 + seed) * 16;
    }
    line.geometry.attributes.position.needsUpdate = true;
  }

  // dust drift
  {
    const arr = dust.geometry.attributes.position.array;
    for (let i = 0; i < dustVel.length; i++) {
      arr[i * 3 + 1] += dustVel[i];
      arr[i * 3] += Math.sin(t * 0.01 + i) * 0.08;
      if (arr[i * 3 + 1] > H / 2 + 20) arr[i * 3 + 1] = -H / 2 - 20;
    }
    dust.geometry.attributes.position.needsUpdate = true;
  }

  // sparks physics
  {
    const pos = sparks.geometry.attributes.position.array;
    for (let i = 0; i < sparkData.length; i++) {
      const d = sparkData[i];
      if (d.life <= 0) { pos[i * 3 + 1] = -9999; continue; }
      d.life--;
      pos[i * 3] += d.vx; pos[i * 3 + 1] += d.vy; pos[i * 3 + 2] += d.vz;
      d.vy -= 0.06;
    }
    sparks.geometry.attributes.position.needsUpdate = true;
  }

  // camera: gentle parallax toward the player + shake
  const tx = sx(playerX ?? W / 2) * 0.06;
  const ty = sy(playerY ?? H / 2) * 0.05;
  camera.position.x += (tx - camera.position.x) * 0.04;
  camera.position.y += (ty - camera.position.y) * 0.04;
  if (shakeMag > 0.1) {
    camera.position.x += (Math.random() - 0.5) * shakeMag;
    camera.position.y += (Math.random() - 0.5) * shakeMag;
    shakeMag *= 0.88;
  }
  camera.lookAt(camera.position.x * 0.4, camera.position.y * 0.4, 0);

  bloom.strength = 0.75 + bloomBoost * 1.6;
  if (bloomBoost > 0) bloomBoost = Math.max(0, bloomBoost - 0.03);

  composer.render();
}

export function renderMenu(t) {
  if (!renderer) return;
  if (levelGroup) levelGroup.visible = false;
  if (sparks) sparks.visible = false;
  menuLoom.visible = true;
  menuLoom.children.forEach(o => { if (o.userData.axis) o.rotateOnAxis(o.userData.axis, o.userData.speed); });
  menuLoom.rotation.z = Math.sin(t * 0.002) * 0.1;
  for (const f of fogBanks) {
    f.position.x += f.userData.drift;
    if (f.position.x > 1100) f.position.x = -1100;
  }
  // dust + threads still alive
  for (const line of threads) {
    const arr = line.geometry.attributes.position.array;
    const seed = line.userData.seed;
    const bx = sx(((seed * 137) % W + W) % W);
    for (let sI = 0; sI < arr.length / 3; sI++) arr[sI * 3] = bx + Math.sin(sI * 0.4 + t * 0.012 + seed) * 16;
    line.geometry.attributes.position.needsUpdate = true;
  }
  const arr = dust.geometry.attributes.position.array;
  for (let i = 0; i < dustVel.length; i++) {
    arr[i * 3 + 1] += dustVel[i];
    if (arr[i * 3 + 1] > H / 2 + 20) arr[i * 3 + 1] = -H / 2 - 20;
  }
  dust.geometry.attributes.position.needsUpdate = true;
  camera.position.x *= 0.95; camera.position.y *= 0.95;
  camera.lookAt(0, 0, 0);
  bloom.strength = 0.8;
  composer.render();
}

export function setVisible(v) {
  if (renderer) renderer.domElement.style.visibility = v ? 'visible' : 'hidden';
}
