// 验证：右键开镜、顶部存活状态、按住空格只跳一次
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
    p.money = 6000;
    p.move.pos.set(0, 0, 0);
    p.move.vel.set(0, 0, 0);
    p.buyWeapon('awp');
  });
  await sleep(300);

  // 右键开镜（AWP）
  await page.mouse.down({ button: 'right' });
  await sleep(900);
  const scoped = await page.evaluate(() => {
    const g = window.__game;
    return {
      scoped: g.player.weapon.scoped,
      defId: g.player.weapon.def.id,
      fov: +g.player.camera.fov.toFixed(1),
      elDisplay: g.el.scope.style.display,
      scopeShown: getComputedStyle(document.querySelector('#scope-overlay')).display,
      crosshairShown: getComputedStyle(document.querySelector('#crosshair')).display,
    };
  });
  await page.mouse.up({ button: 'right' });
  console.log('✓ 右键开镜:', JSON.stringify(scoped));

  // 顶部存活状态
  const ts = await page.evaluate(() => ({
    text: document.querySelector('#team-status').textContent,
    dots: document.querySelectorAll('#team-status .dot').length,
    aliveDots: document.querySelectorAll('#team-status .dot.alive').length,
  }));
  console.log('✓ 存活状态:', JSON.stringify(ts));

  // 按住空格：记录跳跃次数（y 峰值次数）
  await page.evaluate(() => {
    window.__jumpCount = 0;
    const g = window.__game;
    let air = false;
    const timer = setInterval(() => {
      if (g.player.move.onGround) {
        if (air) window.__jumpCount++;
        air = false;
      } else {
        air = true;
      }
    }, 50);
    window.__jumpTimer = timer;
  });
  await page.keyboard.down(' ');
  await sleep(2500);
  await page.keyboard.up(' ');
  const jumps = await page.evaluate(() => {
    clearInterval(window.__jumpTimer);
    return window.__jumpCount;
  });
  console.log('✓ 按住空格 2.5 秒的跳跃次数:', jumps, '(边沿触发应为 1)');

  // 死亡 → 队友视角
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    p.god = false;
    const killer = g.bots.find((b) => b.team !== p.team);
    g.dealDamage(p, 999, killer, false, new window.__THREE.Vector3(0, 60, 0));
  });
  await sleep(400);
  const spec = await page.evaluate(() => {
    const g = window.__game;
    const bot = g.spectateBot;
    return {
      dead: !g.player.alive,
      overlayDisplay: getComputedStyle(document.querySelector('#death-overlay')).display,
      overlayText: document.querySelector('#death-overlay').textContent.trim().slice(0, 20),
      specBot: bot ? bot.name : null,
      camPos: g.player.camera.position.toArray().map((v) => Math.round(v)),
      botPos: bot ? bot.eyePos.toArray().map((v) => Math.round(v)) : null,
      gunHidden: g.player.viewmodel.visible === false,
    };
  });
  console.log('✓ 死亡/队友视角:', JSON.stringify(spec));

  // 后坐力测试：AK 连射 1 秒，记录视角上抬峰值
  await page.evaluate(() => {
    const g = window.__game;
    g.phase = 'live';
    g.phaseT = 999;
    g.roundT = 115;
    const p = g.player;
    p.alive = true;
    p.god = true;
    p.money = 6000;
    p.move.pos.set(0, 0, 0);
    p.move.vel.set(0, 0, 0);
    p.yaw = 0;
    p.pitch = 0;
    p.buyWeapon('ak');
    g.buyOpen = false;
    g.buyAuto = false;
    document.querySelector('#buy-menu').style.display = 'none';
    window.__maxPunch = 0;
    const timer = setInterval(() => {
      window.__maxPunch = Math.max(window.__maxPunch, window.__game.player.viewPunchX);
    }, 30);
    window.__punchTimer = timer;
  });
  await sleep(200);
  await page.mouse.down({ button: 'left' });
  await sleep(1000);
  await page.mouse.up({ button: 'left' });
  const recoil = await page.evaluate(() => {
    clearInterval(window.__punchTimer);
    return {
      maxPunchRad: +window.__maxPunch.toFixed(3),
      maxPunchDeg: +(window.__maxPunch * 57.3).toFixed(1),
      shotsFired: 30 - window.__game.player.weapon.ammoInMag,
    };
  });
  console.log('✓ AK 连射后坐力:', JSON.stringify(recoil), '(连射 1 秒视角上抬峰值应明显小于之前)');

  // 购买 AWP：验证武器名/弹药/射速
  await page.evaluate(() => {
    const g = window.__game;
    g.phase = 'live';
    g.phaseT = 999;
    g.roundT = 115;
    const p = g.player;
    p.alive = true;
    p.god = true;
    p.money = 6000;
    p.move.pos.set(0, 0, 0);
    p.buyWeapon('awp');
    g.buyOpen = false;
    g.buyAuto = false;
    document.querySelector('#buy-menu').style.display = 'none';
  });
  await sleep(300);
  const awp1 = await page.evaluate(() => {
    const p = window.__game.player;
    return {
      defId: p.weapon.def.id,
      ammo: `${p.weapon.ammoInMag} / ${p.weapon.reserve}`,
      nameShown: document.querySelector('#weapon-name').textContent,
    };
  });
  console.log('✓ AWP 购买后:', JSON.stringify(awp1));
  await page.mouse.down({ button: 'left' });
  await sleep(3200);
  await page.mouse.up({ button: 'left' });
  const awp2 = await page.evaluate(() => ({
    ammoLeft: window.__game.player.weapon.ammoInMag,
  }));
  console.log('✓ AWP 按住 3.2 秒开火后剩余弹药:', awp2.ammoLeft, '(41rpm → 约剩 3 发)');
  await browser.close();
} finally {
  server.kill();
}
