// 测试跳跃：单次按空格，记录 y 高度曲线
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
  await sleep(3500);

  await page.evaluate(() => {
    const g = window.__game;
    g.paused = false;
    g.phase = 'live';
    g.phaseT = 999;
    g.roundT = 115;
    const p = g.player;
    p.alive = true;
    p.god = true;
    p.move.pos.set(0, 0, 0);
    p.move.vel.set(0, 0, 0);
    p.yaw = 0;
  });
  await sleep(200);

  const samples = [];
  await page.keyboard.down(' ');
  await sleep(250);
  await page.keyboard.up(' ');
  for (let i = 0; i < 18; i++) {
    await sleep(80);
    samples.push(await page.evaluate(() => {
      const p = window.__game.player;
      return { y: +p.move.pos.y.toFixed(1), g: p.move.onGround, vy: +p.move.vel.y.toFixed(0) };
    }));
  }
  console.log('跳跃采样:', samples.map((s) => `y=${s.y}(g=${s.g},vy=${s.vy})`).join('  '));
  const apex = Math.max(...samples.map((s) => s.y));
  console.log('最高点 y =', apex.toFixed(1), '(预期约 57)');
  await browser.close();
} finally {
  server.kill();
}
