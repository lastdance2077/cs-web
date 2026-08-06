import * as THREE from 'three';
import type { CompiledMap } from './maps';
import type { Team } from './config';

export interface HitBox {
  mesh: THREE.Mesh;
  part: 'head' | 'chest' | 'stomach' | 'arm' | 'leg';
  mult: number;
}

// ---------------------------------------------------------------
// Bot / 玩家角色模型（方块人）
// ---------------------------------------------------------------

export interface BotModel {
  group: THREE.Group;
  hitboxes: HitBox[];
  arms: BotArm[];
  legs: THREE.Group[];
  gun: THREE.Group;
  setTeam: (team: Team) => void;
}

export interface BotArm {
  group: THREE.Group; // 肩部枢轴
  upper: THREE.Mesh;  // 上臂
  lower: THREE.Mesh;  // 前臂
  elbow: THREE.Mesh;  // 肘关节球
  hand: THREE.Mesh;   // 手
}

export function createBotModel(team: Team): BotModel {
  const group = new THREE.Group();
  const clothMat = new THREE.MeshLambertMaterial({ color: team === 'T' ? 0xc8a86b : 0x3a6ea5 });
  const darkMat = new THREE.MeshLambertMaterial({ color: team === 'T' ? 0x7a623a : 0x274a75 });
  const skin = 0xd9b38c;
  const hair = 0x2b2118;
  const m = (c: number) => new THREE.MeshLambertMaterial({ color: c });

  // ---- 腿（以髋关节为枢轴，走路时摆动）----
  const legGeo = new THREE.CapsuleGeometry(3.6, 24, 4, 10);
  const mkLeg = (x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 38, 0);
    const mesh = new THREE.Mesh(legGeo, darkMat);
    mesh.position.y = -16;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(4.8, 3, 7.5), m(0x1d1d1d));
    foot.position.set(0, -30, 2);
    pivot.add(mesh, foot);
    group.add(pivot);
    return { pivot, mesh };
  };
  const legL = mkLeg(-7.5);
  const legR = mkLeg(7.5);

  // ---- 躯干：胶囊 + 护甲背心 + 腰带 ----
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(7.8, 15, 4, 12), clothMat);
  torso.position.y = 47;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(17, 13, 10.5), darkMat);
  vest.position.y = 52;
  const belt = new THREE.Mesh(new THREE.BoxGeometry(14, 4, 9), darkMat);
  belt.position.y = 36.5;
  group.add(torso, vest, belt);

  // ---- 肩膀（球体，让肩部圆润）----
  const shoulderGeo = new THREE.SphereGeometry(3.6, 10, 8);
  const shL = new THREE.Mesh(shoulderGeo, darkMat);
  shL.position.set(-9.5, 55.5, 0);
  const shR = new THREE.Mesh(shoulderGeo, darkMat);
  shR.position.set(9.5, 55.5, 0);
  group.add(shL, shR);

  // ---- 两段式手臂（上臂+前臂+肘+手），由 poseArm 摆姿势 ----
  const armGeo = new THREE.CapsuleGeometry(2.6, 14, 4, 10);
  const mkArm = (x: number) => {
    const group = new THREE.Group();
    group.position.set(x, 56, 0);
    const upper = new THREE.Mesh(armGeo, darkMat);
    const lower = new THREE.Mesh(armGeo, darkMat);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(3.4, 8, 8), darkMat);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(2.4, 8, 8), m(skin));
    group.add(upper, lower, elbow, hand);
    group.visible = false; // 由 poseArm 激活并摆好
    return { group, upper, lower, elbow, hand };
  };
  const armL = mkArm(-11);
  const armR = mkArm(11);

  // ---- 脖子 + 头 + 头发 + 眼睛 ----
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 3.5, 8), m(skin));
  neck.position.y = 60.5;
  const head = new THREE.Mesh(new THREE.SphereGeometry(4.8, 14, 12), m(skin));
  head.position.y = 66;
  const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(4.9, 14, 10), m(hair));
  hairMesh.position.y = 67.8;
  hairMesh.scale.y = 0.72;
  const eyeGeo = new THREE.BoxGeometry(1.4, 0.7, 0.5);
  const eyeMat = m(0x1a1a1a);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-1.9, 66.7, 4.2);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(1.9, 66.7, 4.2);
  group.add(neck, head, hairMesh, eyeL, eyeR);

  // ---- 双手持枪（正面，随视线俯仰）----
  const gun = new THREE.Group();
  const gm = (c: number) => m(c);
  const part = (w: number, h: number, d: number, c: number, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), gm(c));
    mesh.position.set(x, y, z);
    gun.add(mesh);
    return mesh;
  };
  part(1.4, 1.4, 9, 0x555555, 0, 0, 14.5); // 枪管
  part(1.8, 1.8, 5, 0x4a4a4a, 0, 0, 10.5); // 护木
  part(2, 2, 6, 0x3a3a3a, 0, 0, 6); // 机匣
  part(1.4, 3.2, 1.6, 0x2e2e2e, 0, -2.4, 7); // 弹匣
  part(1.5, 2.4, 1.6, 0x7a5a34, 0, -1.8, 4.2); // 握把
  part(1.6, 2.2, 3.5, 0x6b4f2a, 0, 0, 1.8); // 枪托
  gun.position.set(0, 52, 10);

  group.add(gun);
  return {
    group,
    hitboxes: [
      { mesh: head, part: 'head', mult: 1 },
      { mesh: torso, part: 'chest', mult: 1 },
      { mesh: vest, part: 'stomach', mult: 1 },
      { mesh: armL.upper, part: 'arm', mult: 0.9 },
      { mesh: armL.lower, part: 'arm', mult: 0.9 },
      { mesh: armR.upper, part: 'arm', mult: 0.9 },
      { mesh: armR.lower, part: 'arm', mult: 0.9 },
      { mesh: legL.mesh, part: 'leg', mult: 0.75 },
      { mesh: legR.mesh, part: 'leg', mult: 0.75 },
    ],
    arms: [armL, armR],
    legs: [legL.pivot, legR.pivot],
    gun,
    setTeam(t: Team) {
      clothMat.color.set(t === 'T' ? 0xc8a86b : 0x3a6ea5);
      darkMat.color.set(t === 'T' ? 0x7a623a : 0x274a75);
    },
  };
}

const _armV1 = new THREE.Vector3();
const _armV2 = new THREE.Vector3();
const _armUp = new THREE.Vector3(0, 1, 0);

/** 把手臂摆到指定手部位置：上臂肩→肘、前臂肘→手，肘部向外侧/下方弯折 */
export function poseArm(arm: BotArm, hand: THREE.Vector3, bend = 0) {
  const s = arm.group.position; // 肩部（模型空间）
  const dir = _armV1.copy(hand).sub(s);
  const len = dir.length();
  if (len < 1) return;
  const mid = _armV2.copy(s).addScaledVector(dir, 0.5);
  const side = Math.sign(s.x) || 1;
  const right = _armV1.set(dir.z, 0, -dir.x).normalize();
  const elbow = mid.clone().addScaledVector(right, 4.5 * side).add(new THREE.Vector3(0, -2.5 - bend * 5, -1.5));
  spanCapsule(arm.upper, s, elbow, 2.6, 14);
  spanCapsule(arm.lower, elbow, hand, 2.6, 14);
  arm.elbow.position.copy(elbow);
  arm.hand.position.copy(hand);
  arm.group.visible = true;
}

function spanCapsule(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius: number, cylLen: number) {
  const d = _armV1.copy(b).sub(a);
  const len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.scale.set(1, Math.max(0.01, (len - radius * 2) / cylLen), 1);
  mesh.quaternion.setFromUnitVectors(_armUp, d.normalize());
}

/** 玩家隐形受击盒（供 Bot 射线检测） */
export function createPlayerHitboxes(): { group: THREE.Group; hitboxes: HitBox[] } {
  const group = new THREE.Group();
  const mk = (w: number, h: number, d: number, y: number, part: HitBox['part']) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
    mesh.position.y = y;
    group.add(mesh);
    return { mesh, part, mult: part === 'leg' ? 0.75 : part === 'arm' ? 0.9 : 1 } as HitBox;
  };
  return {
    group,
    hitboxes: [
      mk(9, 9, 9, 66.5, 'head'),
      mk(22, 20, 10, 52, 'chest'),
      mk(18, 10, 9, 38, 'stomach'),
      mk(12, 32, 12, 16, 'leg'),
    ],
  };
}

// ---------------------------------------------------------------
// 第一人称武器模型（方块拼装）
// ---------------------------------------------------------------

export function createViewmodel(weaponId: string): THREE.Group {
  const g = new THREE.Group();
  const m = (c: number) => new THREE.MeshLambertMaterial({ color: c });
  const box = (w: number, h: number, d: number, c: number, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(c));
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };

  if (weaponId === 'knife') {
    box(0.8, 1.1, 10, 0xb8b8b8, 0, -0.2, -0.9); // 刀刃
    box(1.8, 2.4, 3, 0x6b4a2a, 0, -0.3, 0.5); // 刀柄
  } else if (weaponId === 'usp') {
    box(3.2, 2.8, 8, 0x3a3a3a, 0, 0, -0.8); // 套筒
    box(2.8, 2.4, 4, 0x2c2c2c, 0, -0.4, 0.4); // 握把
    box(2.0, 1.0, 1.4, 0x222222, 0, 0.8, -1.4); // 低矮准星
  } else if (weaponId === 'ak') {
    box(3.0, 3.0, 9, 0x2e2e2e, 0, 0, -0.2); // 机匣
    box(1.5, 1.6, 13, 0x555555, 0, 0.5, -1.4); // 枪管
    box(2.8, 3.2, 8, 0x6b4a2a, 0, -0.2, -1.0); // 护木
    box(2.2, 4.4, 2.4, 0x1f1f1f, 0, -2.6, -0.6); // 弹匣
    box(2.0, 2.8, 5, 0x5a3a1a, 0, -0.3, 1.2); // 枪托
  } else if (weaponId === 'm4') {
    box(3.0, 3.0, 8, 0x333333, 0, 0, -0.2); // 机匣
    box(1.5, 1.6, 13, 0x4a4a4a, 0, 0.5, -1.4); // 枪管
    box(2.8, 3.0, 8, 0x3a3a3a, 0, -0.2, -0.9); // 护木
    box(2.2, 4.2, 2.4, 0x222222, 0, -2.5, -0.6); // 弹匣
    box(2.0, 2.6, 5, 0x2e2e2e, 0, -0.2, 1.2); // 枪托
  } else if (weaponId === 'awp') {
    box(2.6, 3.0, 18, 0x2c6b3f, 0, 0, -0.8); // 枪身
    box(1.3, 1.5, 16, 0x1f1f1f, 0, 0.5, -2.0); // 枪管
    box(2.4, 2.4, 2.4, 0x151515, 0, 0.6, -0.4); // 瞄准镜
    box(2.0, 3.0, 6, 0x1e1e1e, 0, -0.5, 1.2); // 枪托
  }
  return g;
}

export function muzzleOffset(weaponId: string): THREE.Vector3 {
  if (weaponId === 'awp') return new THREE.Vector3(0.5, -0.35, -4.2);
  if (weaponId === 'knife') return new THREE.Vector3(0.42, -0.42, -3.0);
  if (weaponId === 'usp') return new THREE.Vector3(0.48, -0.38, -3.7);
  return new THREE.Vector3(0.5, -0.36, -3.9);
}

// ---------------------------------------------------------------
// 地图场景
// ---------------------------------------------------------------

export function buildWorldScene(map: CompiledMap) {
  const group = new THREE.Group();

  // ---- 共享纹理（程序生成，无需外部资源）----
  const canvasTex = (w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    draw(ctx);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  };

  const theme = map.def.id;
  // 每张图的主题色板
  const pal =
    theme === 'nuke'
      ? { ground: '#70777e', groundDark: '#5d646b', wall: '#868e95', wallLight: '#959da4', wallDark: '#6c737a', crate: '#5b5348', grout: 'rgba(40,44,50,0.4)' }
      : theme === 'mirage'
        ? { ground: '#dccca6', groundDark: '#c8b892', wall: '#d9caa6', wallLight: '#e4d6b4', wallDark: '#c5b68f', crate: '#8a6a3c', grout: 'rgba(120,100,60,0.35)' }
        : { ground: '#c5b387', groundDark: '#b19f74', wall: '#c2b087', wallLight: '#d0bf97', wallDark: '#ab9a72', crate: '#7a5a34', grout: 'rgba(90,75,45,0.35)' };

  // 工具：随机颗粒噪点
  const speckle = (ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number) => {
    for (let i = 0; i < w * h * 0.2; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const v = Math.floor(Math.random() * 255);
      ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
      ctx.fillRect(x, y, 1.3, 1.3);
    }
  };
  // 工具：柔和色斑
  const blotches = (ctx: CanvasRenderingContext2D, w: number, h: number, color: string, count: number, rMin: number, rMax: number, alpha: number) => {
    for (let i = 0; i < count; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = rMin + Math.random() * (rMax - rMin);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  };
  // 工具：裂纹折线
  const cracks = (ctx: CanvasRenderingContext2D, w: number, h: number, color: string, count: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for (let i = 0; i < count; i++) {
      let x = Math.random() * w;
      let y = Math.random() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segs = 3 + Math.floor(Math.random() * 4);
      for (let s = 0; s < segs; s++) {
        x += (Math.random() - 0.5) * 30;
        y += (Math.random() - 0.5) * 30;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  };

  const groundTex = canvasTex(256, 256, (ctx) => {
    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, 0, 256, 256);
    blotches(ctx, 256, 256, pal.groundDark, 12, 30, 95, 0.4);
    blotches(ctx, 256, 256, '#ffffff', 7, 18, 55, 0.07);
    speckle(ctx, 256, 256, 0.45);
    cracks(ctx, 256, 256, 'rgba(40,40,40,0.22)', theme === 'nuke' ? 5 : 3);
    if (theme === 'nuke') {
      // 混凝土伸缩缝
      ctx.strokeStyle = 'rgba(45,50,58,0.4)';
      ctx.lineWidth = 2;
      for (let gx = 0; gx <= 256; gx += 128) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, 256); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, gx); ctx.lineTo(256, gx); ctx.stroke();
      }
    }
  });
  groundTex.repeat.set(Math.round(map.groundSize / 96), Math.round(map.groundSize / 96));

  const wallTex = canvasTex(256, 256, (ctx) => {
    ctx.fillStyle = pal.wall;
    ctx.fillRect(0, 0, 256, 256);
    if (theme === 'nuke') {
      // 大型混凝土墙板 + 接缝
      ctx.strokeStyle = 'rgba(45,50,58,0.5)';
      ctx.lineWidth = 2;
      for (let gx = 0; gx <= 256; gx += 128) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, 256); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, gx); ctx.lineTo(256, gx); ctx.stroke();
      }
      blotches(ctx, 256, 256, 'rgba(35,40,48,0.16)', 10, 20, 60, 1);
      blotches(ctx, 256, 256, 'rgba(140,150,160,0.18)', 6, 20, 50, 1);
    } else {
      // 砖/石砌块（错缝）
      for (let row = 0; row < 8; row++) {
        const y = row * 32;
        const off = row % 2 === 0 ? 0 : 32;
        for (let x = -32; x < 288; x += 64) {
          ctx.fillStyle = row % 2 === 0 ? pal.wallLight : pal.wallDark;
          ctx.fillRect(x + off + 2, y + 2, 60, 28);
        }
      }
      ctx.strokeStyle = pal.grout;
      ctx.lineWidth = 1.5;
      for (let y = 0; y <= 256; y += 32) {
        ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(256, y + 0.5); ctx.stroke();
      }
    }
    speckle(ctx, 256, 256, 0.5);
    blotches(ctx, 256, 256, 'rgba(0,0,0,0.12)', 8, 25, 70, 1);
    cracks(ctx, 256, 256, 'rgba(30,30,30,0.25)', theme === 'nuke' ? 6 : 3);
  });

  const crateTex = canvasTex(256, 256, (ctx) => {
    ctx.fillStyle = pal.crate;
    ctx.fillRect(0, 0, 256, 256);
    // 横向木板
    for (let y = 0; y < 256; y += 32) {
      ctx.fillStyle = y % 64 === 0 ? '#00000014' : '#ffffff10';
      ctx.fillRect(0, y, 256, 30);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    for (let y = 0; y <= 256; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke();
    }
    // 竖向支撑 + 铆钉
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = 0; x <= 256; x += 64) ctx.fillRect(x, 0, 8, 256);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let x = 4; x <= 256; x += 64) {
      for (let y = 4; y <= 256; y += 32) ctx.fillRect(x, y, 4, 4);
    }
    speckle(ctx, 256, 256, 0.4);
  });

  const groundMat = new THREE.MeshLambertMaterial({ map: groundTex });
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
  const crateMat = new THREE.MeshLambertMaterial({ map: crateTex });

  // ---- 渐变天空 ----
  const skyTop = theme === 'nuke' ? '#5d6b78' : theme === 'mirage' ? '#7fb2dc' : '#6fa8d8';
  const skyMid = theme === 'nuke' ? '#7f8b94' : theme === 'mirage' ? '#b7d4ec' : '#a9cde8';
  const skyLow = theme === 'nuke' ? '#99a2a6' : theme === 'mirage' ? '#e4dcc8' : '#e6ddc4';
  const skyTex = canvasTex(16, 256, (ctx) => {
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, skyTop);
    grad.addColorStop(0.5, skyMid);
    grad.addColorStop(1, skyLow);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 256);
  });
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(5200, 24, 12),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -1;
  group.add(sky);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(map.groundSize, map.groundSize),
    groundMat,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // 外框贴地阴影
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(map.groundSize, 4, map.groundSize),
    new THREE.MeshLambertMaterial({ color: 0x6f6a58 }),
  );
  edge.position.y = -4;
  group.add(edge);

  for (const b of map.brushes) {
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const d = b.max[2] - b.min[2];
    const isCrate = h < 100;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), isCrate ? crateMat : wallMat);
    mesh.position.set((b.min[0] + b.max[0]) / 2, h / 2, (b.min[2] + b.max[2]) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // 包点标记环 + 字母牌
  for (const s of map.sites) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(s.radius * 0.85, s.radius * 1.05, 40),
      new THREE.MeshBasicMaterial({
        color: s.id === 'A' ? 0x2ecc71 : 0xe67e22,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.pos.x, 0.6, s.pos.z);
    group.add(ring);

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = s.id === 'A' ? '#2ecc71' : '#e67e22';
    ctx.font = 'bold 84px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.id, 64, 68);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    sprite.scale.set(70, 70, 1);
    sprite.position.set(s.pos.x, 110, s.pos.z);
    group.add(sprite);
  }

  const ambient = new THREE.AmbientLight(0xffffff, 0.68);
  const sun = new THREE.DirectionalLight(0xfff2d9, 1.1);
  sun.position.set(300, 500, 200);
  sun.castShadow = true;
  sun.shadow.mapSize.set(512, 512);
  sun.shadow.camera.left = -1600;
  sun.shadow.camera.right = 1600;
  sun.shadow.camera.top = 1600;
  sun.shadow.camera.bottom = -1600;
  sun.shadow.camera.far = 1500;
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x8a7a5a, 0.42);
  group.add(ambient, sun, hemi);

  return { group, ground, sun };
}

// ---------------------------------------------------------------
// 炸弹 / 特效
// ---------------------------------------------------------------

export function createBombMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 10), new THREE.MeshLambertMaterial({ color: 0x151515 }));
  body.position.y = 4;
  const light = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
  light.position.y = 9.5;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 6), new THREE.MeshLambertMaterial({ color: 0x333333 }));
  handle.position.y = 8.5;
  handle.position.z = 2;
  g.add(body, light, handle);
  return g;
}

let flashTex: THREE.CanvasTexture | null = null;
export function getMuzzleFlashTexture(): THREE.CanvasTexture {
  if (flashTex) return flashTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,220,1)');
  grad.addColorStop(0.4, 'rgba(255,200,80,0.8)');
  grad.addColorStop(1, 'rgba(255,120,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  flashTex = new THREE.CanvasTexture(c);
  return flashTex;
}
