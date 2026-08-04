// 验证出生点：同队不重叠、朝向合理
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
  await sleep(1500);

  const s = await page.evaluate(() => {
    const g = window.__game;
    const pos = (p) => `${Math.round(p.x / 96)},${Math.round(p.z / 96)}`;
    const all = [
      { team: g.player.team, who: '玩家', pos: pos(g.player.move.pos), yaw: +g.player.yaw.toFixed(2) },
      ...g.bots.map((b) => ({ team: b.team, who: b.name, pos: pos(b.move.pos), yaw: +b.aimYaw.toFixed(2) })),
    ];
    return { all, sites: g.map.sites.map((s) => ({ id: s.id, pos: pos(s.pos) })) };
  });
  console.log('出生点分布:', JSON.stringify(s, null, 1));
  const t = s.all.filter((x) => x.team === 'T').map((x) => x.pos);
  const ct = s.all.filter((x) => x.team === 'CT').map((x) => x.pos);
  console.log('T 出生点去重后数量:', new Set(t).size, '/', t.length, '| CT:', new Set(ct).size, '/', ct.length);
  await browser.close();
} finally {
  server.kill();
}
