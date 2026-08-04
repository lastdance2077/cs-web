// 自动化冒烟测试：启动 vite → 打开浏览器 → 截图 + 检查 HUD → 退出
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const NODE = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe';
const VITE = 'D:/good-thing/cs/node_modules/vite/bin/vite.js';
const URL = 'http://localhost:5199/';
const OUT = 'D:/good-thing/cs/.smoke';
mkdirSync(OUT, { recursive: true });

const server = spawn(NODE, [VITE, '--port', '5199', '--strictPort'], {
  cwd: 'D:/good-thing/cs',
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(URL);
      if (res.ok) return;
    } catch {
      /* 还没起 */
    }
    await sleep(500);
  }
  throw new Error('vite 未就绪:\n' + serverLog.slice(-2000));
}

let browser;
try {
  await waitReady();
  console.log('✓ vite 已就绪');

  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('[console] ' + msg.text());
  });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(800);
  await page.screenshot({ path: `${OUT}/01-menu.png` });
  console.log('✓ 主菜单截图完成');

  await page.click('#start-btn');
  await sleep(4000);
  await page.screenshot({ path: `${OUT}/02-game.png` });

  const hud = await page.evaluate(() => ({
    hud: !!document.querySelector('#game-hud'),
    menuGone: !document.querySelector('#menu'),
    timer: document.querySelector('#timer')?.textContent,
    health: document.querySelector('#health')?.textContent,
    ammo: document.querySelector('#ammo')?.textContent,
    score: document.querySelector('#score')?.textContent,
    canvas: !!document.querySelector('canvas'),
  }));
  console.log('✓ HUD 状态:', JSON.stringify(hud));

  // 等进入 live 后测移动（冻结期无法移动是预期行为）
  for (let i = 0; i < 20; i++) {
    const phase = await page.evaluate(() => window.__game?.phase);
    if (phase === 'live') break;
    await sleep(500);
  }
  const posBefore = await page.evaluate(() => window.__game?.player?.move?.pos?.toArray?.());
  await page.keyboard.down('w');
  await sleep(900);
  await page.keyboard.up('w');
  await page.keyboard.down('a');
  await sleep(500);
  await page.keyboard.up('a');
  await sleep(600);
  const posAfter = await page.evaluate(() => window.__game?.player?.move?.pos?.toArray?.());
  const moved = posBefore && posAfter ? Math.hypot(posAfter[0] - posBefore[0], posAfter[2] - posBefore[2]) : -1;
  console.log(`✓ 玩家移动距离: ${moved.toFixed(1)} 单位 (${JSON.stringify(posBefore)} → ${JSON.stringify(posAfter)})`);
  await page.screenshot({ path: `${OUT}/03-moved.png` });

  // 购买菜单（开局自动弹出）
  const buy = await page.evaluate(() => ({
    display: getComputedStyle(document.querySelector('#buy-menu')).display,
    items: document.querySelectorAll('.buy-item').length,
    disabled: [...document.querySelectorAll('.buy-item.disabled')].map((el) => el.dataset.buy),
  }));
  console.log('✓ 购买菜单(自动弹出):', JSON.stringify(buy));
  await page.screenshot({ path: `${OUT}/04-buy.png` });

  // 按 B 手动关闭（之后不再自动弹）
  await page.keyboard.press('b');
  await sleep(300);
  const buyClosed = await page.evaluate(() => getComputedStyle(document.querySelector('#buy-menu')).display);
  console.log('✓ 手动关闭菜单:', buyClosed);
  // 再按 B 打开，做购买测试
  await page.keyboard.press('b');
  await sleep(300);

  // 键盘购买：数字 2 = 主武器，数字 4 = 护甲
  await page.evaluate(() => {
    window.__game.player.money = 5000;
  });
  await page.keyboard.press('2');
  await sleep(250);
  const kb1 = await page.evaluate(() => {
    const p = window.__game.player;
    return {
      money: p.money,
      hasRifle: p.weapons.has('ak') || p.weapons.has('m4'),
      cur: p.weapon.def.id,
      menuClosed: getComputedStyle(document.querySelector('#buy-menu')).display === 'none',
    };
  });
  console.log('✓ 键盘购买(2):', JSON.stringify(kb1));
  // 购买后菜单自动关闭，重开再买护甲
  await page.keyboard.press('b');
  await sleep(300);
  await page.keyboard.press('4');
  await sleep(250);
  const kb2 = await page.evaluate(() => ({
    money: window.__game.player.money,
    armor: window.__game.player.armor,
    menuClosed: getComputedStyle(document.querySelector('#buy-menu')).display === 'none',
  }));
  console.log('✓ 键盘购买(4):', JSON.stringify(kb2));

  // 鼠标点击购买（重开菜单保证价格刷新）
  await page.evaluate(() => {
    window.__game.player.money = 5000;
    window.__game.player.armor = 0;
  });
  await page.keyboard.press('b');
  await sleep(300);
  const rifleId = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.buy-item')].find((e) => ['ak', 'm4'].includes(e.dataset.buy));
    return el && !el.classList.contains('disabled') ? el.dataset.buy : null;
  });
  if (rifleId) {
    await page.click(`.buy-item[data-buy="${rifleId}"]`);
    await sleep(250);
  }
  const clickBuy = await page.evaluate(() => {
    const p = window.__game.player;
    return {
      money: p.money,
      hasRifle: p.weapons.has('ak') || p.weapons.has('m4'),
      menuClosed: getComputedStyle(document.querySelector('#buy-menu')).display === 'none',
      toast: document.querySelector('#buy-toast')?.textContent,
    };
  });
  console.log('✓ 鼠标点击购买:', JSON.stringify(clickBuy));

  // 暂停 → 恢复
  await page.keyboard.press('Escape');
  await sleep(400);
  const pauseShown = await page.evaluate(() => ({
    display: getComputedStyle(document.querySelector('#pause-overlay')).display,
    paused: window.__game?.paused,
    lock: !!document.pointerLockElement,
    lastLockExitAge: performance.now() - (window.__game?.lastLockExit ?? 0),
  }));
  console.log('✓ 暂停菜单:', pauseShown);
  await page.screenshot({ path: `${OUT}/05-pause.png` });
  await page.click('#resume-btn');
  await sleep(600);

  // ---- 玩家射击命中测试 ----
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    // 恢复运行（避免退出指针锁触发自动暂停）
    g.paused = false;
    document.querySelector('#pause-overlay').style.display = 'none';
    g.phase = 'live';
    g.phaseT = 999;
    g.roundT = 115;
    const target = g.bots.find((b) => b.team !== p.team);
    g.bots.forEach((b) => {
      if (b !== target) {
        b.alive = false;
        b.move.pos.set(0, -50, 0);
      }
    });
    target.alive = true;
    target.health = 100;
    target.armor = 0;
    target.frozen = true; // 定住靶子
    // 把双方放到 Dust 中路开阔地带（地图中心附近）
    p.move.pos.set(0, 0, 0);
    target.move.pos.set(120, 0, 0);
    p.alive = true;
    p.god = true;
    p.yaw = -Math.PI / 2;
    p.pitch = 0;
    p.move.vel.set(0, 0, 0);
    window.__ammoBefore = p.weapon.ammoInMag;
  });
  await sleep(100);
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await sleep(1500);
  await page.mouse.up();
  const shot = await page.evaluate(() => {
    const g = window.__game;
    const target = g.bots.find((b) => b.team !== g.player.team);
    return {
      health: Math.round(target.health),
      alive: target.alive,
      kills: g.player.kills,
      ammoBefore: window.__ammoBefore,
      ammoAfter: g.player.weapon.ammoInMag,
      targetPos: target.move.pos.toArray(),
    };
  });
  console.log('✓ 射击测试:', JSON.stringify(shot));
  await page.screenshot({ path: `${OUT}/05-shot.png` });

  // ---- 确定性装包/爆炸测试 ----
  await page.evaluate(() => {
    const g = window.__game;
    const site = g.map.sites.find((s) => s.id === 'A');
    const p = g.player;
    // 强制进入 live 回合，避免上一轮结束/冻结期干扰
    g.phase = 'live';
    g.phaseT = 999;
    g.roundT = 115;
    g.bomb.planted = false;
    g.bomb.dropped = null;
    g.bomb.mesh.visible = false;
    // 保留至少一个 CT 存活（否则会直接判 T 全歼获胜），且全部冻结在 CT 出生点
    g.bots.forEach((b) => {
      if (b.team === 'CT') {
        b.alive = true;
        b.health = 100;
        b.frozen = true;
        const list = g.map.spawns.ct;
        b.move.pos.copy(list[0]);
      } else {
        b.alive = false;
      }
    });
    p.team = 'T'; // 强制 T 方，保证能装包
    p.alive = true;
    p.health = 100;
    p.god = true;
    p.hasBomb = true;
    p.move.pos.set(site.pos.x, 0, site.pos.z);
    // 把 Bot 全部挪回各自出生点，避免干扰
    g.bots.forEach((b) => {
      const list = b.team === 'T' ? g.map.spawns.t : g.map.spawns.ct;
      b.move.pos.copy(list[0]);
    });
  });
  await page.keyboard.down('e');
  await sleep(3800);
  await page.keyboard.up('e');
  const plantCheck = await page.evaluate(() => ({
    planted: window.__game.bomb.planted,
    bombVisible: window.__game.bomb.mesh.visible,
    bombTime: window.__game.bomb.planted ? Math.round(window.__game.bomb.time) : null,
  }));
  console.log('✓ 装包测试:', JSON.stringify(plantCheck));
  await page.screenshot({ path: `${OUT}/06-planted.png` });

  // ---- 爆炸测试 ----
  await page.evaluate(() => {
    window.__game.bomb.time = 0.7;
  });
  await sleep(2500);
  const boom = await page.evaluate(() => ({
    phase: window.__game.phase,
    score: window.__game.score,
    bannerTitle: document.querySelector('#banner-title')?.textContent,
  }));
  console.log('✓ 爆炸/胜负测试:', JSON.stringify(boom));
  await page.screenshot({ path: `${OUT}/07-boom.png` });

  // ---- 三张地图快速验证 ----
  const mapResults = [];
  for (const mapId of ['dust', 'nuke', 'mirage']) {
    const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs2 = [];
    p2.on('pageerror', (err) => errs2.push(err.message));
    p2.on('console', (msg) => {
      if (msg.type() === 'error') errs2.push(msg.text());
    });
    await p2.goto(`${URL}?map=${mapId}&diff=easy&team=T`, { waitUntil: 'networkidle' });
    await sleep(9000);
    const st = await p2.evaluate(() => ({
      phase: window.__game?.phase,
      hud: !!document.querySelector('#game-hud'),
      botCount: window.__game?.bots?.filter((b) => b.alive).length,
      playerPos: window.__game?.player?.move?.pos?.toArray?.(),
    }));
    await p2.screenshot({ path: `${OUT}/map-${mapId}.png` });
    mapResults.push({ mapId, ...st, errors: errs2 });
    await p2.close();
  }
  console.log('✓ 三图验证:', JSON.stringify(mapResults));

  /*
  // 等待 Bot 交火/装包/回合结束（最多 55 秒）
  const events = [];
  for (let i = 0; i < 55; i++) {
    await sleep(1000);
    const s = await page.evaluate(() => ({
      phase: window.__game?.phase,
      bombPlanted: window.__game?.bomb?.planted,
      bombTime: window.__game?.bomb?.planted ? Math.round(window.__game.bomb.time) : null,
      score: window.__game?.score,
      round: window.__game?.round,
      kills: window.__game?.player?.kills,
    }));
    if (!events.length || JSON.stringify(events[events.length - 1]) !== JSON.stringify(s)) events.push(s);
    if (s.phase === 'ended' || s.phase === 'matchover') break;
  }
  console.log('✓ 战局时间线:', JSON.stringify(events));
  await page.screenshot({ path: `${OUT}/06-later.png` });
  const later = await page.evaluate(() => ({
    killfeed: document.querySelectorAll('.kf-entry').length,
    score: document.querySelector('#score')?.textContent,
    banner: document.querySelector('#banner')?.style.display,
    bombStatus: document.querySelector('#bomb-status')?.textContent,
  }));
  console.log('✓ 战局状态:', JSON.stringify(later));
  */

  console.log('✓ 页面错误:', errors.length ? errors.slice(0, 10) : '无');
  await browser.close();
  console.log('DONE');
} catch (e) {
  console.error('测试失败:', e.message);
  if (browser) await browser.close().catch(() => {});
  process.exitCode = 1;
} finally {
  server.kill();
}
