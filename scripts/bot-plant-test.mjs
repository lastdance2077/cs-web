// 定向测试：给一个 T Bot 炸弹并放到包点，观察 12 秒内是否装包
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
  await sleep(4000);

  await page.evaluate(() => {
    const g = window.__game;
    g.phase = 'live';
    g.phaseT = 999;
    g.roundT = 115;
    const site = g.map.sites.find((s) => s.id === 'A');
    const carrier = g.bots.find((b) => b.team === 'T');
    // 冻结所有 Bot，只留 carrier 行动
    g.bots.forEach((b) => {
      b.frozen = b !== carrier;
      if (b.frozen) {
        b.move.pos.set(0, -200, 0);
      }
    });
    carrier.frozen = false;
    carrier.alive = true;
    carrier.health = 100;
    carrier.hasBomb = true;
    carrier.move.pos.set(site.pos.x - 60, 0, site.pos.z - 60);
    carrier.move.vel.set(0, 0, 0);
  });

  for (let i = 0; i < 12; i++) {
    await sleep(1000);
    const s = await page.evaluate(() => {
      const g = window.__game;
      const c = g.bots.find((b) => b.team === 'T' && !b.frozen);
      return {
        planted: g.bomb.planted,
        bombTime: g.bomb.planted ? Math.round(g.bomb.time) : null,
        carrierPos: c.move.pos.toArray().map((v) => Math.round(v)),
        carrierState: c.state,
        plantProgress: c.actions.plantProgress,
        dist: Math.round(c.move.pos.distanceTo(g.map.sites.find((s) => s.id === 'A').pos)),
      };
    });
    console.log(`t=${i + 1}s`, JSON.stringify(s));
    if (s.planted) break;
  }
  // 装包后观察 50 秒：炸弹倒计时与回合是否正常结束
  for (let i = 0; i < 10; i++) {
    await sleep(5000);
    const s = await page.evaluate(() => {
      const g = window.__game;
      return {
        phase: g.phase,
        planted: g.bomb.planted,
        bombTime: g.bomb.planted ? +g.bomb.time.toFixed(1) : null,
        score: { ...g.score },
        banner: document.querySelector('#banner-title')?.textContent,
      };
    });
    console.log(`装包后 ${(i + 1) * 5}s`, JSON.stringify(s));
    if (s.phase !== 'live') break;
  }
  await browser.close();
} finally {
  server.kill();
}
