// 三图综合功能测试：受伤转向 / 带包装包 / 掉包捡包
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const NODE = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe';
const VITE = 'D:/good-thing/cs/node_modules/vite/bin/vite.js';
const server = spawn(NODE, [VITE, '--port', '5199', '--strictPort'], { cwd: 'D:/good-thing/cs', stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (map, name, ok, extra = '') => {
  results.push({ map, name, ok });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
};

try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://localhost:5199/?map=dust&diff=normal&team=T'); if (r.ok) break; } catch {} await sleep(500); }
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();

  for (const map of ['dust', 'nuke', 'mirage']) {
    console.log(`\n===== ${map} =====`);
    await page.goto(`http://localhost:5199/?map=${map}&diff=normal&team=T`, { waitUntil: 'networkidle' });
    for (let i = 0; i < 30; i++) { const p = await page.evaluate(() => window.__game?.phase); if (p === 'live') break; await sleep(500); }
    await page.evaluate(() => {
      const g = window.__game;
      g.player.god = true;
      g.player.move.pos.set(9999, 0, 9999);
      for (const b of g.bots) b.frozen = true;
    });

    // 1) 受伤转向：CT 守点面北，被南侧偷袭
    const hurt = await page.evaluate(() => {
      const g = window.__game;
      const THREE = window.__THREE;
      const ct = g.bots.find((x) => x.team === 'CT');
      const site = g.map.sites[0];
      ct.move.pos.copy(site.pos);
      ct.model.group.position.copy(site.pos);
      ct.frozen = false;
      ct.role = 'siteA';
      ct.state = 'advance';
      ct.target = null;
      ct.path = [site.pos.clone()];
      ct.pathIdx = 0;
      ct.repathT = 0;
      ct.holdYaw = -3.0; // 面北
      ct.aimYaw = -3.0;
      ct.hurtAlertT = 0;
      ct.onHurt(new THREE.Vector3(site.pos.x, 0, site.pos.z + 600), g.roundT);
      window.__ct = ct;
      return true;
    });
    await sleep(1600);
    const hurtRes = await page.evaluate(() => {
      const ct = window.__ct;
      let a = ct.aimYaw;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      return { aim: +a.toFixed(2), alert: +ct.hurtAlertT.toFixed(1), hold: ct.holdYaw };
    });
    check(map, '受伤后转向攻击者', hurtRes.alert > 0 && hurtRes.hold === null && Math.abs(hurtRes.aim) < 1.2, JSON.stringify(hurtRes));

    // 2) 带包者能装包：放在 B 点
    const planted = await page.evaluate(() => {
      const g = window.__game;
      const t = g.bots.find((x) => x.team === 'T');
      const bSite = g.map.sites.find((s) => s.id === 'B');
      t.hasBomb = true;
      t.siteChoice = 'B';
      t.role = 'siteA';
      t.move.pos.copy(bSite.pos);
      t.model.group.position.copy(bSite.pos);
      t.frozen = false;
      t.path = [bSite.pos.clone()];
      t.pathIdx = 0;
      t.repathT = 0;
      t.route = null;
      t.state = 'advance';
      t.target = null;
      t.health = 100;
      t.alive = true;
      window.__t = t;
    });
    let okPlant = false;
    for (let i = 0; i < 10 && !okPlant; i++) {
      await sleep(1000);
      okPlant = await page.evaluate(() => window.__game.bomb.planted);
    }
    check(map, '带包者到点装包', okPlant);

    // 3) 掉包捡包：带包者死，另一个 T 去捡
    await page.evaluate(() => {
      const g = window.__game;
      const THREE = window.__THREE;
      g.bomb.planted = false;
      const t = window.__t;
      t.alive = false;
      t.health = 0;
      // 包丢在可走处（模拟 dropBombIfCarrier 的吸附）
      const bombPos = new THREE.Vector3(0, 0, 0);
      const bt = g.map.nav.worldToTile(bombPos);
      if (!g.map.nav.isWalkable(bt.x, bt.z)) {
        const alt = g.map.nav.nearestWalkable(bt.x, bt.z);
        if (alt) bombPos.copy(g.map.nav.tileToWorld(alt.x, alt.z));
      }
      g.bomb.dropped = bombPos;
      g.bomb.mesh.position.copy(bombPos);
      g.bomb.mesh.visible = true;
      const picker = g.bots.find((x) => x.team === 'T' && x !== t);
      picker.frozen = false;
      // 捡包者放在包附近 400 单位（吸附到可走处）
      const cand = bombPos.clone().add(new THREE.Vector3(0, 0, 400));
      const tile = g.map.nav.worldToTile(cand);
      if (!g.map.nav.isWalkable(tile.x, tile.z)) {
        const alt = g.map.nav.nearestWalkable(tile.x, tile.z);
        if (alt) cand.copy(g.map.nav.tileToWorld(alt.x, alt.z));
      }
      picker.move.pos.copy(cand);
      picker.model.group.position.copy(picker.move.pos);
      picker.repathT = 0;
      picker.route = null;
      picker.target = null;
      picker.state = 'advance';
      picker.health = 100;
      picker.alive = true;
      window.__picker = picker;
    });
    let okPick = false;
    for (let i = 0; i < 12 && !okPick; i++) {
      await sleep(1000);
      okPick = await page.evaluate(() => window.__picker.hasBomb);
    }
    check(map, '掉包后其他 T 去捡包', okPick);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? '✅ 三图功能检查全部通过' : `❌ ${failed.length} 项失败：` + failed.map((f) => `${f.map}/${f.name}`).join(', ')}`);
  await browser.close();
} finally {
  server.kill();
}
