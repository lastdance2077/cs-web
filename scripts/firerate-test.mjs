// 精确测量 AK 射速：按住开火 2 秒，数弹药消耗
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
    p.money = 6000;
    p.move.pos.set(0, 0, 0);
    p.move.vel.set(0, 0, 0);
    p.buyWeapon('ak');
    g.buyOpen = false;
    g.buyAuto = false;
    document.querySelector('#buy-menu').style.display = 'none';
  });
  await sleep(200);
  const t0 = Date.now();
  await page.mouse.down({ button: 'left' });
  await sleep(2000);
  await page.mouse.up({ button: 'left' });
  const elapsed = Date.now() - t0;
  const res = await page.evaluate(() => ({
    fired: 30 - window.__game.player.weapon.ammoInMag,
    rpm: Math.round(((30 - window.__game.player.weapon.ammoInMag) / (2000 / 1000)) * 60),
  }));
  console.log(`按住 ${elapsed}ms，AK 消耗 ${res.fired} 发 → 射速约 ${res.rpm} rpm（配置 600）`);
  await browser.close();
} finally {
  server.kill();
}
