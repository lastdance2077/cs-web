// 测量玩家实际移动速度（按住 W 1 秒的位移）
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
  await sleep(4000);

  await page.evaluate(() => {
    const g = window.__game;
    g.paused = false;
    g.phase = 'live';
    g.phaseT = 999;
    g.roundT = 115;
    const p = g.player;
    p.alive = true;
    p.god = true;
    p.yaw = 0; // 面向 -Z
    p.move.pos.set(0, 0, 0);
    p.move.vel.set(0, 0, 0);
    // 确保当前武器是 USP（moveSpeed 155）
    p.switchSlot('secondary');
  });
  await sleep(100);
  const before = await page.evaluate(() => window.__game.player.move.pos.toArray());
  console.log('起始位置:', JSON.stringify(before));
  await page.keyboard.down('w');
  const samples = [];
  for (let i = 0; i < 10; i++) {
    await sleep(100);
    samples.push(await page.evaluate(() => {
      const p = window.__game.player.move.pos;
      const v = window.__game.player.move.vel;
      return `pos(${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}) vel(${v.x.toFixed(0)},${v.y.toFixed(0)},${v.z.toFixed(0)}) g=${window.__game.player.move.onGround}`;
    }));
  }
  await page.keyboard.up('w');
  await sleep(200);
  console.log('位置采样(每100ms):', samples.join('  |  '));
  const after = await page.evaluate(() => window.__game.player.move.pos.toArray());
  const diag = await page.evaluate(() => {
    const g = window.__game;
    return {
      moveSpeed: g.player.weapon.def.moveSpeed,
      vel: g.player.move.vel.toArray().map((v) => +v.toFixed(1)),
      onGround: g.player.move.onGround,
      weaponId: g.player.weapon.def.id,
      lockMove: g.player.lockMove,
    };
  });
  const d = Math.hypot(after[0] - before[0], after[2] - before[2]);
  console.log('武器:', await page.evaluate(() => window.__game.player.weapon.def.id));
  console.log('1 秒位移:', d.toFixed(1), '单位 → 速度', d.toFixed(1), 'u/s (预期 USP=155)');
  console.log('诊断:', JSON.stringify(diag));
  await browser.close();
} finally {
  server.kill();
}
