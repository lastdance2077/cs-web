// 观察 Bot 行为：40 秒内记录位置/状态/击杀/回合
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

  let last = null;
  for (let i = 0; i < 35; i++) {
    await sleep(2000);
    const s = await page.evaluate(() => {
      const g = window.__game;
      const bots = g.bots.map((b) => ({
        t: b.team,
        alive: b.alive,
        state: b.state,
        x: Math.round(b.move.pos.x / 96),
        z: Math.round(b.move.pos.z / 96),
        hp: Math.round(b.health),
        bomb: b.hasBomb,
      }));
      const carrierIdx = g.bots.findIndex((b) => b.team === 'T' && b.hasBomb);
      const carrier = carrierIdx >= 0 ? g.bots[carrierIdx] : null;
      const carrierDetail = carrier
        ? {
            siteChoice: carrier.siteChoice,
            pathLen: carrier.path?.length ?? -1,
            pathEnd: carrier.path?.length
              ? carrier.path[carrier.path.length - 1].toArray().map((v) => Math.round(v / 96))
              : null,
            target: carrier.target?.pos.toArray().map((v) => Math.round(v / 96)) ?? null,
            repathT: +carrier.repathT.toFixed(1),
          }
        : null;
      return {
        phase: g.phase,
        round: g.round,
        score: { ...g.score },
        planted: g.bomb.planted,
        bombTime: g.bomb.planted ? +g.bomb.time.toFixed(1) : null,
        dropped: g.bomb.dropped ? g.bomb.dropped.toArray().map((v) => Math.round(v / 96)) : null,
        carrier: carrier
          ? { i: carrierIdx, alive: carrier.alive, state: carrier.state, x: Math.round(carrier.move.pos.x / 96), z: Math.round(carrier.move.pos.z / 96), hp: Math.round(carrier.health) }
          : null,
        carrierDetail,
        killfeed: document.querySelectorAll('.kf-entry').length,
        player: { x: Math.round(g.player.move.pos.x / 96), z: Math.round(g.player.move.pos.z / 96), alive: g.player.alive, bomb: g.player.hasBomb },
        bots,
      };
    });
    if (!last) {
      console.log(`t=${i * 2}s`, JSON.stringify(s));
      last = s;
      continue;
    }
    const moved = s.bots.filter((b, idx) => b.alive && (b.x !== last.bots[idx].x || b.z !== last.bots[idx].z)).length;
    const died = s.bots.filter((b, idx) => !b.alive && last.bots[idx].alive).length;
    const combat = s.bots.filter((b) => b.state === 'combat').length;
    console.log(
      `t=${i * 2}s phase=${s.phase} 移动=${moved} 死亡=${died} 战斗=${combat} 击杀=${s.killfeed} 比分=${s.score.t}:${s.score.ct} 装包=${s.planted} 炸弹时间=${s.bombTime ?? '-'} 掉落=${s.dropped ? JSON.stringify(s.dropped) : '-'} 带包=${s.carrier ? JSON.stringify(s.carrier) : '无'} 细节=${s.carrierDetail ? JSON.stringify(s.carrierDetail) : '-'}`,
    );
    if (s.carrier && !s.planted) {
      const detail = await page.evaluate(() => {
        const g = window.__game;
        const c = g.bots.find((b) => b.team === 'T' && b.hasBomb);
        if (!c) return null;
        return {
          pathLen: c.path ? c.path.length : -1,
          idx: c.pathIdx,
          vel: c.move.vel.toArray().map((v) => +v.toFixed(0)),
          onGround: c.move.onGround,
          target: c.target ? c.target.pos.toArray().map((v) => Math.round(v / 96)) : null,
          repathT: +c.repathT.toFixed(1),
          siteChoice: c.siteChoice,
          pathEnd: c.path && c.path.length ? c.path[c.path.length - 1].toArray().map((v) => Math.round(v / 96)) : null,
        };
      });
      if (detail) console.log('    带包者详情:', JSON.stringify(detail));
    }
    last = s;
  }
  const fails = await page.evaluate(() => window.__pathFails ?? []);
  console.log('寻路失败记录数:', fails.length, fails.slice(0, 5));
  await browser.close();
} finally {
  server.kill();
}
