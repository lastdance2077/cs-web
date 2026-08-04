// 从黑块屏幕坐标向场景射线，定位黑块物体
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const NODE = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe';
const VITE = 'D:/good-thing/cs/node_modules/vite/bin/vite.js';
const URL = 'http://localhost:5199/?map=dust&diff=easy&team=T';

const server = spawn(NODE, [VITE, '--port', '5199', '--strictPort'], { cwd: 'D:/good-thing/cs', stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(URL); if (r.ok) break; } catch { /* 重试 */ }
    await sleep(500);
  }
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(5000);

  // 等待 live 并冻结一帧，避免相机移动
  await page.evaluate(() => { window.__game.phase = 'live'; window.__game.roundT = 115; });
  await sleep(300);

  const result = await page.evaluate(() => {
    const g = window.__game;
    const T = window.__THREE;
    g.scene.updateMatrixWorld(true);
    const cam = g.player.camera;
    const px = 688, py = 214;
    const ndcX = (px / 1280) * 2 - 1;
    const ndcY = -((py / 800) * 2 - 1);
    const origin = cam.position.clone();
    const far = new T.Vector3(ndcX, ndcY, 0.5).unproject(cam);
    const dir = far.sub(origin).normalize();
    const raycaster = new T.Raycaster(origin, dir, 0, 6000);
    const meshes = [];
    g.scene.traverse((o) => {
      if (o.isMesh && o.visible !== false) meshes.push(o);
    });
    const hits = raycaster.intersectObjects(meshes, false);
    return hits.slice(0, 6).map((h) => ({
      type: h.object.type,
      color: h.object.material?.color ? '#' + h.object.material.color.getHexString() : null,
      parent: h.object.parent?.type || h.object.parent?.name || '',
      name: h.object.name || '',
      dist: Math.round(h.distance),
      point: [Math.round(h.point.x), Math.round(h.point.y), Math.round(h.point.z)],
    }));
  });
  console.log('射线命中:', JSON.stringify(result, null, 2));
  await page.screenshot({ path: 'D:/good-thing/cs/.smoke/ray-black.png' });
  await browser.close();
} finally {
  server.kill();
}
