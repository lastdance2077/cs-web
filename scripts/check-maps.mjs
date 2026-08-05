// 快速校验地图：模拟 GridBuilder，打印 ASCII，并检查出生点→A/B 点连通性。
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/maps.ts', import.meta.url), 'utf8');

const EMPTY = 0, WALL = 1, CRATE = 2, SITE_A = 3, SITE_B = 4, SPAWN_T = 5, SPAWN_CT = 6;

function makeBuilder(w, h) {
  const cells = new Uint8Array(w * h).fill(WALL);
  const idx = (x, z) => z * w + x;
  const get = (x, z) => cells[idx(x, z)];
  const set = (x, z, v) => { if (x >= 0 && z >= 0 && x < w && z < h) cells[idx(x, z)] = v; };
  const carve = (x0, z0, x1, z1) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, z, EMPTY);
  };
  const fill = (x0, z0, x1, z1) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, z, WALL);
  };
  const crate = (x, z) => set(x, z, CRATE);
  const site = (x, z, k) => set(x, z, k === 'A' ? SITE_A : SITE_B);
  const spawn = (x, z, t) => set(x, z, t === 'T' ? SPAWN_T : SPAWN_CT);
  return { cells, get, carve, fill, crate, site, spawn, w, h };
}

const opRe = /g\.(carve|site|spawn|crate|fill)\(([^)]*)\)/g;
const mapStartRe = /id:\s*'([^']+)',\s*\n\s*name:/g;

const starts = [...src.matchAll(mapStartRe)];
let ok = true;
for (let i = 0; i < starts.length; i++) {
  const id = starts[i][1];
  const start = starts[i].index;
  const end = i + 1 < starts.length ? starts[i + 1].index : src.indexOf('];', start);
  const block = src.slice(start, end);
  const dims = block.match(/w:\s*(\d+)[\s\S]*?h:\s*(\d+)[\s\S]*?tile:\s*(\d+)/);
  const body = block.match(/build\(g\)\s*\{([\s\S]*?)\n\s*\},/);
  if (!dims || !body) { console.error(`[${id}] 无法解析尺寸或 build`); ok = false; continue; }
  const w = +dims[1], h = +dims[2];
  const g = makeBuilder(w, h);
  for (const om of body[1].matchAll(opRe)) {
    const args = om[2].split(',').map((s) => s.trim());
    if (om[1] === 'carve') g.carve(+args[0], +args[1], +args[2], +args[3]);
    if (om[1] === 'fill') g.fill(+args[0], +args[1], +args[2], +args[3]);
    if (om[1] === 'crate') g.crate(+args[0], +args[1]);
    if (om[1] === 'site') g.site(+args[0], +args[1], args[2].replace(/'/g, ''));
    if (om[1] === 'spawn') g.spawn(+args[0], +args[1], args[2].replace(/'/g, ''));
  }

  console.log(`\n===== 地图: ${id} (${w}x${h}) =====`);
  for (let z = 0; z < h; z++) {
    let line = '';
    for (let x = 0; x < w; x++) line += [' ', '#', 'c', 'A', 'B', 'T', 'C'][g.get(x, z)];
    console.log(line);
  }

  const walkable = (x, z) => {
    const v = g.get(x, z);
    return v === EMPTY || v === SITE_A || v === SITE_B || v === SPAWN_T || v === SPAWN_CT;
  };
  const sites = [];
  const spawns = [];
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    const v = g.get(x, z);
    if (v === SITE_A || v === SITE_B) sites.push({ x, z, k: v === SITE_A ? 'A' : 'B' });
    if (v === SPAWN_T || v === SPAWN_CT) spawns.push({ x, z, k: v === SPAWN_T ? 'T' : 'CT' });
  }
  for (const s of sites) {
    for (const p of spawns) {
      const q = [[p.x, p.z]];
      const seen = new Set([p.z * w + p.x]);
      let reach = false;
      while (q.length) {
        const [cx, cz] = q.shift();
        if (cx === s.x && cz === s.z) { reach = true; break; }
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = cx + dx, nz = cz + dz;
          if (!walkable(nx, nz)) continue;
          const k = nz * w + nx;
          if (seen.has(k)) continue;
          seen.add(k);
          q.push([nx, nz]);
        }
      }
      if (!reach) {
        console.error(`  ✗ ${p.k}出生点(${p.x},${p.z}) 无法到达 ${s.k}点(${s.x},${s.z})`);
        ok = false;
      }
    }
  }
  // 出生点 → 包点直接视线检查（直线上的格子必须全部可走才视为“能看见”）
  for (const s of sites) {
    for (const p of spawns) {
      const dx = s.x - p.x, dz = s.z - p.z;
      const steps = Math.max(Math.abs(dx), Math.abs(dz));
      let clear = true;
      for (let i = 1; i <= steps; i++) {
        const x = Math.round(p.x + (dx * i) / steps);
        const z = Math.round(p.z + (dz * i) / steps);
        if (!walkable(x, z)) { clear = false; break; }
      }
      if (clear) {
        console.warn(`  ⚠ ${p.k}出生点(${p.x},${p.z}) 与 ${s.k}点(${s.x},${s.z}) 存在直接视线`);
      }
    }
  }
  console.log(`  站点: ${sites.map((s) => `${s.k}(${s.x},${s.z})`).join(' ')} | 出生点: ${spawns.map((s) => `${s.k}(${s.x},${s.z})`).join(' ')}`);
}

console.log(ok ? '\n✅ 所有地图连通性检查通过' : '\n❌ 存在断连，需要修复');
