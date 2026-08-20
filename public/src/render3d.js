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
let curWorld = null;

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
  curWorld = world;
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
  for (const b of world.boxes) {
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

  scene.add(levelGroup);
}

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
export function render(t, world, cats, playerX, playerY) {
  if (!renderer) return;

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
      slot.mesh.material.opacity = c.opts.alpha ?? 1;
    } else slot.mesh.visible = false;
  });

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

export function setVisible(v) {
  if (renderer) renderer.domElement.style.visibility = v ? 'visible' : 'hidden';
}
