// 分析 Bot 射击落点：在开枪瞬间判定命中身体还是打墙
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const NODE = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe';
const VITE = 'D:/good-thing/cs/node_modules/vite/bin/vite.js';
const URL = 'http://localhost:5199/?map=dust&diff=normal&team=CT';

const server = spawn(NODE, [VITE, '--port', '5199', '--strictPort'], { cwd: 'D:/good-thing/cs', stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(URL); if (r.ok) break; } catch { /* retry */ }
    await sleep(500);
  }
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 30; i++) {
    const phase = await page.evaluate(() => window.__game?.phase);
    if (phase === 'live') break;
    await sleep(500);
  }

  // 挂钩 resolveShot：在开枪瞬间判定
  await page.evaluate(() => {
    const g = window.__game;
    const THREE = window.__THREE;
    window.__shots = [];
    const realRaycast = g.player.move.constructor.raycastBrushes;
    const orig = g.resolveShot.bind(g);
    g.resolveShot = (origin, dir, team, shooter) => {
      const tgt = shooter.target;
      const wallDist = realRaycast(g.map.brushes, origin, dir, 8192);
      // 受击盒判定（与游戏一致）
      const meshes = [];
      const owner = new Map();
      const add = (entity, hitboxes) => {
        for (const hb of hitboxes) {
          meshes.push(hb.mesh);
          owner.set(hb.mesh, hb);
        }
      };
      if (g.player.team !== team && g.player.alive) add(g.player, g.player.hitboxes);
      for (const b of g.bots) if (b.team !== team && b.alive) add(b, b.model.hitboxes);
      const ray = new THREE.Raycaster(origin, dir, 0, Math.min(wallDist, 8192));
      const hits = ray.intersectObjects(meshes, false);
      window.__shots.push({
        shooter: shooter.name,
        weapon: shooter.weapon?.def?.id,
        hitBody: hits.length > 0,
        part: hits.length ? owner.get(hits[0].object).part : null,
        wallDist: +wallDist.toFixed(0),
        targetDist: tgt ? +Math.hypot(tgt.pos.x - origin.x, tgt.pos.y + 50 - origin.y, tgt.pos.z - origin.z).toFixed(0) : -1,
        deviationDeg: tgt ? +(
          Math.acos(Math.max(-1, Math.min(1, dir.dot(
            new THREE.Vector3(tgt.pos.x - origin.x, tgt.pos.y + 50 - origin.y, tgt.pos.z - origin.z).normalize(),
          )))) * 57.2958
        ).toFixed(1) : -1,
      });
      return orig(origin, dir, team, shooter);
    };
  });

  await sleep(15000);

  const result = await page.evaluate(() => window.__shots);
  const body = result.filter((s) => s.hitBody);
  const wall = result.filter((s) => !s.hitBody);
  const parts = {};
  for (const s of body) parts[s.part] = (parts[s.part] || 0) + 1;
  console.log(`总射击=${result.length} 命中身体=${body.length}(${result.length ? (body.length / result.length * 100).toFixed(0) : 0}%) 打墙/落空=${wall.length}`);
  console.log('命中部位分布:', JSON.stringify(parts));
  const blocked = wall.filter((s) => s.targetDist >= 0 && s.wallDist < s.targetDist - 12);
  const clearMiss = wall.filter((s) => s.targetDist >= 0 && s.wallDist >= s.targetDist - 12);
  console.log(`打墙细分: 弹道被墙挡=${blocked.length} 通畅但没打中=${clearMiss.length}`);
  if (clearMiss.length) {
    const dists = clearMiss.map((s) => s.targetDist);
    const devs = clearMiss.map((s) => s.deviationDeg);
    console.log(`  未命中: 距离 min=${Math.min(...dists)} max=${Math.max(...dists)} avg=${(dists.reduce((a, b) => a + b, 0) / dists.length).toFixed(0)}`);
    console.log(`  偏差角: min=${Math.min(...devs)}° max=${Math.max(...devs)}° avg=${(devs.reduce((a, b) => a + b, 0) / devs.length).toFixed(1)}°`);
    const close = clearMiss.filter((s) => s.deviationDeg < 3);
    console.log(`  偏差<3°仍没打中=${close.length}（说明命中判定或目标宽度有问题）`);
    for (const s of close.slice(0, 5)) console.log(`    ${s.shooter} ${s.weapon} 目标距=${s.targetDist} 偏差=${s.deviationDeg}° 墙距=${s.wallDist}`);
  }
  await browser.close();
} finally {
  server.kill();
}
