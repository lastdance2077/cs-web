// 复现“隔墙听声”：Bot 听到墙后的枪声，观察它的寻路和移动
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

  const result = await page.evaluate(() => {
    const g = window.__game;
    const T = window.__THREE;
    g.phase = 'live';
    g.phaseT = 999;
    g.roundT = 115;

    // 冻结所有 Bot，只留一个测试 Bot
    const bot = g.bots[0];
    g.bots.forEach((b) => {
      b.frozen = b !== bot;
      if (b.frozen) b.move.pos.set(0, -200, 0);
    });
    bot.frozen = false;
    bot.alive = true;
    bot.health = 100;
    bot.move.pos.set(-1008, 0, -1008); // T 出生区
    bot.move.vel.set(0, 0, 0);

    // 枪声位置：B 点（中间隔着整面墙/迷宫）
    const siteB = g.map.sites.find((s) => s.id === 'B').pos;
    // 手动注入听觉
    bot.heardPos = siteB.clone();
    bot.heardT = 0;

    // 直接测 A* 路径
    const path = g.map.nav.findPath(bot.move.pos.clone(), siteB.clone());
    return {
      from: bot.move.pos.toArray().map((v) => Math.round(v)),
      to: siteB.toArray().map((v) => Math.round(v)),
      findPath: path ? path.map((p) => p.toArray().map((v) => Math.round(v / 96))) : null,
      pathLen: path ? path.length : -1,
    };
  });
  console.log('A* 寻路结果:', JSON.stringify(result));

  // 观察 Bot 8 秒的移动轨迹
  for (let i = 0; i < 8; i++) {
    await sleep(1000);
    const s = await page.evaluate(() => {
      const g = window.__game;
      const b = g.bots[0];
      return {
        pos: b.move.pos.toArray().map((v) => Math.round(v / 96)),
        pathLen: b.path ? b.path.length : -1,
        idx: b.pathIdx,
        state: b.state,
        onGround: b.move.onGround,
        vel: b.move.vel.toArray().map((v) => Math.round(v)),
      };
    });
    console.log(`t=${i + 1}s`, JSON.stringify(s));
  }
  await browser.close();
} finally {
  server.kill();
}
