// 验证武器跨回合保留/弹药刷新/购买替换逻辑
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

  // 1) 开局买 M4（CT 方）
  const buyM4 = await page.evaluate(() => {
    const g = window.__game;
    const moneyBefore = g.player.money;
    g.buyItem('m4');
    return {
      moneyBefore,
      moneyAfter: g.player.money,
      hasM4: g.player.weapons.has('m4'),
      currentId: g.player.currentId,
      mag: g.player.weapon.ammoInMag,
      reserve: g.player.weapon.reserve,
    };
  });
  console.log('① 买 M4:', JSON.stringify(buyM4));

  // 2) 打掉部分弹药，然后模拟存活进入下一回合
  const afterRound = await page.evaluate(() => {
    const g = window.__game;
    g.player.health = 100;
    g.player.alive = true;
    const m4 = g.player.weapons.get('m4');
    m4.ammoInMag = 5;
    m4.reserve = 9;
    g.startRound();
    const w = g.player.weapons.get('m4');
    return {
      phase: g.phase,
      keptM4: g.player.weapons.has('m4'),
      ammoInMag: w ? w.ammoInMag : -1,
      reserve: w ? w.reserve : -1,
      currentId: g.player.currentId,
      currentSlot: g.player.currentSlot,
    };
  });
  console.log('② 存活进下局（应保留 M4 且满弹 30/90）:', JSON.stringify(afterRound));

  // 3) 再买 AWP：应替换 M4，手里是 AWP
  const buyAwp = await page.evaluate(() => {
    const g = window.__game;
    g.player.money = 10000;
    const moneyBefore = g.player.money;
    g.buyItem('awp');
    return {
      moneyBefore,
      moneyAfter: g.player.money,
      hasM4: g.player.weapons.has('m4'),
      hasAwp: g.player.weapons.has('awp'),
      currentId: g.player.currentId,
      primaries: [...g.player.weapons.values()].filter((w) => w.def.slot === 'primary').map((w) => w.def.id),
    };
  });
  console.log('③ 买 AWP（应替换 M4）:', JSON.stringify(buyAwp));

  // 4) 再买一把 AWP：不扣钱、提示已拥有
  const rebuy = await page.evaluate(() => {
    const g = window.__game;
    const moneyBefore = g.player.money;
    g.buyItem('awp');
    return {
      moneyBefore,
      moneyAfter: g.player.money,
      toast: document.querySelector('#buy-toast')?.textContent,
    };
  });
  console.log('④ 重复购买 AWP（不应扣钱）:', JSON.stringify(rebuy));

  const pass =
    buyM4.currentId === 'm4' &&
    afterRound.keptM4 && afterRound.ammoInMag === 30 && afterRound.reserve === 90 && afterRound.currentId === 'm4' &&
    buyAwp.currentId === 'awp' && !buyAwp.hasM4 && buyAwp.hasAwp &&
    rebuy.moneyBefore === rebuy.moneyAfter && rebuy.toast === '已拥有该武器';
  console.log(pass ? 'PASS ✅ 全部通过' : 'FAIL ❌ 存在未通过的检查');
  await browser.close();
} finally {
  server.kill();
}
