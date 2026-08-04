// 从多个屏幕坐标向场景射线，识别暗区物体
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
    try { const r = await fetch(URL); if (r.ok) break; } catch { /* retry */ }
    await sleep(500);
  }
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(4500);

  const result = await page.evaluate(() => {
    const g = window.__game;
    const T = window.__THREE;
    g.scene.updateMatrixWorld(true);
    const cam = g.player.camera;
    const meshes = [];
    g.scene.traverse((o) => {
      if (o.isMesh && o.visible !== false) meshes.push(o);
    });
    const out = { camPos: cam.position.toArray().map(Math.round), yaw: +g.player.yaw.toFixed(2), pitch: +g.player.pitch.toFixed(2) };
    const points = [[700, 100], [900, 150], [1100, 200], [800, 300], [400, 150], [300, 400]];
    out.hits = points.map(([px, py]) => {
      const ndcX = (px / 1280) * 2 - 1;
      const ndcY = -((py / 800) * 2 - 1);
      const origin = cam.position.clone();
      const far = new T.Vector3(ndcX, ndcY, 0.5).unproject(cam);
      const dir = far.sub(origin).normalize();
      const ray = new T.Raycaster(origin, dir, 0, 8000);
      const hits = ray.intersectObjects(meshes, false);
      const h = hits[0];
      return {
        screen: [px, py],
        color: h && h.object.material?.color ? '#' + h.object.material.color.getHexString() : null,
        dist: h ? Math.round(h.distance) : null,
        pos: h ? h.point.toArray().map(Math.round) : null,
      };
    });
    return out;
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
} finally {
  server.kill();
}
