// 验证：小地图渲染、购买/投掷高爆/闪光/烟雾/燃烧、人机购买投掷物
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const NODE = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe';
const VITE = 'D:/good-thing/cs/node_modules/vite/bin/vite.js';
const URL = 'http://localhost:5199/?map=dust&diff=normal&team=T';

const server = spawn(NODE, [VITE, '--port', '5199', '--strictPort'], { cwd: 'D:/good-thing/cs', stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
};

try {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(URL); if (r.ok) break; } catch { /* retry */ }
    await sleep(500);
  }
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 30; i++) {
    const p = await page.evaluate(() => window.__game?.phase);
    if (p === 'live') break;
    await sleep(500);
  }

  // 小地图
  const mm = await page.evaluate(() => {
    const c = document.querySelector('#minimap');
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let nonZero = 0;
    for (let i = 0; i < data.length; i += 400) if (data[i] > 0) nonZero++;
    return { w: c.width, h: c.height, nonZero };
  });
  check('小地图画布存在且有内容', mm.w > 0 && mm.h > 0 && mm.nonZero > 100, JSON.stringify(mm));

  // 购买投掷物
  const buy = await page.evaluate(() => {
    const g = window.__game;
    g.player.money = 10000;
    g.buyItem('he');
    g.buyItem('flash');
    g.buyItem('flash');
    g.buyItem('smoke');
    g.buyItem('molotov');
    return { nades: { ...g.player.nades }, money: g.player.money };
  });
  check('购买投掷物（高爆1/闪光2/烟1/火1）', buy.nades.he === 1 && buy.nades.flash === 2 && buy.nades.smoke === 1 && buy.nades.molotov === 1, JSON.stringify(buy));

  // 布置：A 大走廊 玩家 vs Bot
  await page.evaluate(() => {
    const g = window.__game;
    // 冻结所有 Bot，避免乱跑/乱扔雷干扰测试
    for (const b of g.bots) b.frozen = true;
    const b = g.bots.find((x) => x.team === 'CT' && x.alive);
    g.player.move.pos.set(0, 0, -1200);
    g.player.yaw = 0;
    if (b) {
      b.move.pos.set(0, 0, -1500);
      b.health = 100;
      b.alive = true;
      b.frozen = true; // 冻结 AI，避免它走动/自己扔雷
    }
  });

  // 高爆：选中 → 按住 0.5s → 松手
  await page.evaluate(() => { const g = window.__game; g.nadeSelect = 'he'; g.prevSlot = g.player.currentSlot; });
  const sel = await page.evaluate(() => window.__game.nadeSelect);
  check('选中投掷物(he)', sel === 'he', String(sel));
  await page.evaluate(() => { window.__game.input.fire = true; });
  await sleep(500);
  await page.evaluate(() => { window.__game.input.fire = false; });
  await sleep(300);
  // 把玩家移出爆炸范围，避免自己被反弹的高爆炸死
  await page.evaluate(() => {
    const g = window.__game;
    g.player.health = 100;
    g.player.alive = true;
    g.player.move.pos.set(0, 0, -900);
  });
  const thrown = await page.evaluate(() => ({ count: window.__game.projectiles.length, nades: { ...window.__game.player.nades }, select: window.__game.nadeSelect }));
  check('松手投掷高爆，数量-1', thrown.count === 1 && thrown.nades.he === 0, JSON.stringify(thrown));
  await sleep(2500);
  const heResult = await page.evaluate(() => {
    const g = window.__game;
    const b = g.bots.find((x) => x.team === 'CT' && x.alive);
    return { projectiles: g.projectiles.length, botHealth: b ? Math.round(b.health) : -1 };
  });
  check('高爆爆炸伤害 Bot', heResult.botHealth < 100, JSON.stringify(heResult));

  // 闪光
  await page.evaluate(() => {
    const g = window.__game;
    const b = g.bots.find((x) => x.team === 'CT' && x.alive);
    if (b) { b.health = 100; b.blindT = 0; }
    if (b) b.frozen = true;
    g.player.health = 100;
    g.player.alive = true;
    g.player.move.pos.set(0, 0, -1150);
    g.nadeSelect = 'flash';
    g.prevSlot = g.player.currentSlot;
  });
  await page.evaluate(() => { window.__game.input.fire = true; });
  await sleep(350);
  await page.evaluate(() => { window.__game.input.fire = false; });
  await sleep(2500);
  const flashResult = await page.evaluate(() => {
    const g = window.__game;
    const b = g.bots.find((x) => x.team === 'CT' && x.alive);
    return { blindT: b ? +b.blindT.toFixed(2) : -1, overlay: g.flashOverlay };
  });
  check('闪光致盲 Bot', flashResult.blindT > 0.3, JSON.stringify(flashResult));

  // 烟雾
  await page.evaluate(() => {
    const g = window.__game;
    g.player.health = 100;
    g.player.alive = true;
    g.player.move.pos.set(0, 0, -1200);
    g.nadeSelect = 'smoke';
    g.prevSlot = g.player.currentSlot;
  });
  await page.evaluate(() => { window.__game.input.fire = true; });
  await sleep(120);
  await page.evaluate(() => { window.__game.input.fire = false; });
  await sleep(2200);
  const smokeResult = await page.evaluate(() => {
    const g = window.__game;
    return { smokes: g.smokes.length, t: g.smokes[0] ? +g.smokes[0].t.toFixed(1) : 0 };
  });
  check('烟雾生成（16 秒持续）', smokeResult.smokes === 1 && smokeResult.t > 10, JSON.stringify(smokeResult));

  // 燃烧瓶
  let molotovBotName = '';
  await page.evaluate(() => {
    const g = window.__game;
    const b = g.bots.find((x) => x.team === 'CT');
    if (b) { b.health = 100; b.move.pos.set(0, 0, -1450); }
  });
  molotovBotName = await page.evaluate(() => {
    const g = window.__game;
    return g.bots.find((x) => x.team === 'CT')?.name ?? '';
  });
  await page.evaluate(() => {
    const g = window.__game;
    g.player.health = 100;
    g.player.alive = true;
    g.player.move.pos.set(0, 0, -1300);
    g.nadeSelect = 'molotov';
    g.prevSlot = g.player.currentSlot;
  });
  await page.evaluate(() => { window.__game.input.fire = true; });
  await sleep(120);
  await page.evaluate(() => { window.__game.input.fire = false; });
  await sleep(4000);
  const fireResult = await page.evaluate((name) => {
    const g = window.__game;
    const b = g.bots.find((x) => x.name === name);
    return {
      fires: g.fires.length,
      firePos: g.fires[0] ? g.fires[0].pos.toArray().map((v) => Math.round(v)) : null,
      botPos: b ? b.move.pos.toArray().map((v) => Math.round(v)) : null,
      botHealth: b ? Math.round(b.health) : -1,
    };
  }, molotovBotName);
  const d = fireResult.firePos && fireResult.botPos
    ? Math.hypot(fireResult.firePos[0] - fireResult.botPos[0], fireResult.firePos[2] - fireResult.botPos[2])
    : -1;
  check('燃烧瓶持续灼烧', fireResult.fires === 1 && fireResult.botHealth < 100, JSON.stringify(fireResult) + ` 火距=${d.toFixed(0)}`);

  // 人机购买了投掷物
  const botNades = await page.evaluate(() => {
    const g = window.__game;
    const b = g.bots.find((x) => x.alive && (x.nades.he > 0 || x.nades.flash > 0));
    return b ? { name: b.name, nades: { ...b.nades } } : null;
  });
  check('人机购买投掷物', !!botNades, JSON.stringify(botNades));

  check('无页面错误', errs.length === 0, errs.join('; '));
  console.log(results.every((r) => r.ok) ? '\n全部通过 ✅' : '\n存在失败 ❌');
  await browser.close();
} finally {
  server.kill();
}
