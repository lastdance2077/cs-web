import * as THREE from 'three';
import type { Brush } from './movement';
import type { Team } from './config';

// ---------------------------------------------------------------
// 地图 = 格子网格。格子类型：
//   0 空地  1 墙壁  2 木箱（可跳过不可穿）  3 A点  4 B点
//   5 T出生点  6 CT出生点
// 用“雕刻”方式构建：初始全是墙，然后 carve 挖出房间与走廊。
// ---------------------------------------------------------------

const EMPTY = 0, WALL = 1, CRATE = 2, SITE_A = 3, SITE_B = 4, SPAWN_T = 5, SPAWN_CT = 6;

export class GridBuilder {
  w: number;
  h: number;
  cells: Uint8Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.cells = new Uint8Array(w * h).fill(WALL);
  }

  idx(x: number, z: number) {
    return z * this.w + x;
  }

  get(x: number, z: number) {
    return this.cells[this.idx(x, z)];
  }

  set(x: number, z: number, v: number) {
    if (x < 0 || z < 0 || x >= this.w || z >= this.h) return;
    this.cells[this.idx(x, z)] = v;
  }

  /** 挖空一个矩形区域 */
  carve(x0: number, z0: number, x1: number, z1: number) {
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++)
        this.set(x, z, EMPTY);
  }

  /** 放木箱（保留可走地面，但导航视为障碍） */
  crate(x: number, z: number) {
    this.set(x, z, CRATE);
  }

  /** 重新砌墙（用于在已挖开的区域封门/封道） */
  fill(x0: number, z0: number, x1: number, z1: number) {
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++)
        this.set(x, z, WALL);
  }

  site(x: number, z: number, kind: 'A' | 'B') {
    this.set(x, z, kind === 'A' ? SITE_A : SITE_B);
  }

  spawn(x: number, z: number, team: Team) {
    this.set(x, z, team === 'T' ? SPAWN_T : SPAWN_CT);
  }

  toAscii(): string {
    let out = '';
    for (let z = 0; z < this.h; z++) {
      let line = '';
      for (let x = 0; x < this.w; x++) {
        line += [' ', '#', 'c', 'A', 'B', 'T', 'C'][this.get(x, z)];
      }
      out += line + '\n';
    }
    return out;
  }
}

// ---------------------------------------------------------------
// 导航网格 + A*
// ---------------------------------------------------------------

export class NavGrid {
  constructor(
    public w: number,
    public h: number,
    public walkable: Uint8Array,
    public tile: number,
    /** 墙体/木箱 brush（用于按角色半宽避让墙角），不含地面 */
    public blockers: Brush[] = [],
  ) {}

  isWalkable(x: number, z: number) {
    if (x < 0 || z < 0 || x >= this.w || z >= this.h) return false;
    return this.walkable[z * this.w + x] === 1;
  }

  worldToTile(pos: THREE.Vector3): { x: number; z: number } {
    return {
      x: Math.round(pos.x / this.tile + this.w / 2 - 0.5),
      z: Math.round(pos.z / this.tile + this.h / 2 - 0.5),
    };
  }

  tileToWorld(x: number, z: number): THREE.Vector3 {
    return new THREE.Vector3((x - this.w / 2 + 0.5) * this.tile, 0, (z - this.h / 2 + 0.5) * this.tile);
  }

  private lineClear(x0: number, z0: number, x1: number, z1: number): boolean {
    let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    let dy = -Math.abs(z1 - z0), sy = z0 < z1 ? 1 : -1;
    let err = dx + dy;
    let x = x0, z = z0;
    for (;;) {
      if (!this.isWalkable(x, z)) return false;
      if (x === x1 && z === z1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; z += sy; }
    }
    return true;
  }

  /** 直线 a->b 是否与所有障碍物（按角色半宽 r 膨胀后）不相交，避免斜穿墙角 */
  segmentClear(a: THREE.Vector3, b: THREE.Vector3, r = 16): boolean {
    for (const brush of this.blockers) {
      const [bx0, by0, bz0] = brush.min;
      const [bx1, by1, bz1] = brush.max;
      const ex = bx0 - r, fx = bx1 + r;
      const ey = by0 - r, fy = by1 + r;
      const ez = bz0 - r, fz = bz1 + r;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      let tmin = 0, tmax = 1;
      // X slab
      if (Math.abs(dx) < 1e-9) {
        if (a.x < ex || a.x > fx) continue;
      } else {
        let t1 = (ex - a.x) / dx, t2 = (fx - a.x) / dx;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      // Y slab
      if (Math.abs(dy) < 1e-9) {
        if (a.y < ey || a.y > fy) continue;
      } else {
        let t1 = (ey - a.y) / dy, t2 = (fy - a.y) / dy;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      // Z slab
      if (Math.abs(dz) < 1e-9) {
        if (a.z < ez || a.z > fz) continue;
      } else {
        let t1 = (ez - a.z) / dz, t2 = (fz - a.z) / dz;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      return false; // 线段穿过膨胀后的障碍
    }
    return true;
  }

  /** A* 寻路，返回世界坐标路径点（已做视线简化）。找不到返回 null */
  findPath(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null {
    const start = this.worldToTile(from);
    const goal = this.worldToTile(to);
    if (!this.isWalkable(start.x, start.z)) {
      const alt = this.nearestWalkable(start.x, start.z);
      if (!alt) return null;
      start.x = alt.x; start.z = alt.z;
    }
    if (!this.isWalkable(goal.x, goal.z)) {
      const alt = this.nearestWalkable(goal.x, goal.z);
      if (!alt) return null;
      goal.x = alt.x; goal.z = alt.z;
    }
    if (start.x === goal.x && start.z === goal.z) return [to.clone()];

    const open: Array<{ x: number; z: number; g: number; f: number; parent: { x: number; z: number } | null }> = [];
    const came = new Map<number, number>();
    const gScore = new Map<number, number>();
    const closed = new Set<number>();
    const key = (x: number, z: number) => z * this.w + x;
    const h = (x: number, z: number) => Math.abs(x - goal.x) + Math.abs(z - goal.z);

    open.push({ x: start.x, z: start.z, g: 0, f: h(start.x, start.z), parent: null });
    gScore.set(key(start.x, start.z), 0);

    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let guard = 0;
    while (open.length && guard++ < 5000) {
      open.sort((a, b) => a.f - b.f);
      const cur = open.shift()!;
      const k = key(cur.x, cur.z);
      if (closed.has(k)) continue;
      closed.add(k);
      if (cur.x === goal.x && cur.z === goal.z) {
        // 回溯
        const path: THREE.Vector3[] = [];
        let c: { x: number; z: number } | null = cur;
        while (c) {
          path.push(this.tileToWorld(c.x, c.z));
          const p = came.get(key(c.x, c.z));
          c = p !== undefined ? { x: p >> 16, z: p & 0xffff } : null;
        }
        path.reverse();
        path.push(to.clone());
        return this.smooth(path);
      }
      for (const [dx, dz] of dirs) {
        const nx = cur.x + dx, nz = cur.z + dz;
        if (!this.isWalkable(nx, nz)) continue;
        const nk = key(nx, nz);
        if (closed.has(nk)) continue;
        const ng = cur.g + 1;
        const old = gScore.get(nk);
        if (old !== undefined && old <= ng) continue;
        gScore.set(nk, ng);
        came.set(nk, (cur.x << 16) | (cur.z & 0xffff));
        open.push({ x: nx, z: nz, g: ng, f: ng + h(nx, nz), parent: cur });
      }
    }
    return null;
  }

  private smooth(path: THREE.Vector3[]): THREE.Vector3[] {
    if (path.length <= 2) return path;
    const out: THREE.Vector3[] = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      while (j > i + 1) {
        const a = this.worldToTile(path[i]);
        const b = this.worldToTile(path[j]);
        if (this.lineClear(a.x, a.z, b.x, b.z) && this.segmentClear(path[i], path[j])) break;
        j--;
      }
      out.push(path[j]);
      i = j;
    }
    return out;
  }

  nearestWalkable(x: number, z: number): { x: number; z: number } | null {
    for (let r = 1; r <= 6; r++) {
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (this.isWalkable(x + dx, z + dz)) return { x: x + dx, z: z + dz };
        }
    }
    return null;
  }
}

// ---------------------------------------------------------------
// 地图定义
// ---------------------------------------------------------------

export interface MapDef {
  id: string;
  name: string;
  desc: string;
  w: number;
  h: number;
  tile: number;
  build: (g: GridBuilder) => void;
}

export interface MapSite {
  id: 'A' | 'B';
  pos: THREE.Vector3;
  radius: number;
  /** 包点区域的世界坐标边界（用于装包/拆包判定，不再只看中心半径） */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface CompiledMap {
  def: MapDef;
  brushes: Brush[];
  spawns: { t: THREE.Vector3[]; ct: THREE.Vector3[] };
  sites: MapSite[];
  buyZones: { pos: THREE.Vector3; radius: number; team: Team }[];
  nav: NavGrid;
  groundSize: number;
}

const WALL_HEIGHT = 160;
const CRATE_HEIGHT = 44;
const CRATE_INSET = 18;

function buildMap(def: MapDef): CompiledMap {
  const g = new GridBuilder(def.w, def.h);
  def.build(g);

  const brushes: Brush[] = [];
  const spawns = { t: [] as THREE.Vector3[], ct: [] as THREE.Vector3[] };
  const sites: MapSite[] = [];
  const siteTiles: Array<{ x: number; z: number; kind: 'A' | 'B' }> = [];

  const cellCenter = (x: number, z: number) =>
    new THREE.Vector3((x - def.w / 2 + 0.5) * def.tile, 0, (z - def.h / 2 + 0.5) * def.tile);

  // 地面碰撞（防止玩家/Bot 掉出地图）
  const groundSize = Math.max(def.w, def.h) * def.tile;
  brushes.push({
    min: [-groundSize / 2 - 200, -24, -groundSize / 2 - 200],
    max: [groundSize / 2 + 200, 0, groundSize / 2 + 200],
  });

  for (let z = 0; z < def.h; z++) {
    for (let x = 0; x < def.w; x++) {
      const v = g.get(x, z);
      const c = cellCenter(x, z);
      if (v === WALL) {
        brushes.push({
          min: [c.x - def.tile / 2, 0, c.z - def.tile / 2],
          max: [c.x + def.tile / 2, WALL_HEIGHT, c.z + def.tile / 2],
        });
      } else if (v === CRATE) {
        brushes.push({
          min: [c.x - def.tile / 2 + CRATE_INSET, 0, c.z - def.tile / 2 + CRATE_INSET],
          max: [c.x + def.tile / 2 - CRATE_INSET, CRATE_HEIGHT, c.z + def.tile / 2 - CRATE_INSET],
        });
      } else if (v === SPAWN_T) {
        spawns.t.push(cellCenter(x, z));
      } else if (v === SPAWN_CT) {
        spawns.ct.push(cellCenter(x, z));
      } else if (v === SITE_A || v === SITE_B) {
        siteTiles.push({ x, z, kind: v === SITE_A ? 'A' : 'B' });
      }
    }
  }

  // 站点中心 = 同类格子的平均
  for (const kind of ['A', 'B'] as const) {
    const tiles = siteTiles.filter((t) => t.kind === kind);
    if (!tiles.length) continue;
    const cx = tiles.reduce((s, t) => s + (t.x - def.w / 2 + 0.5) * def.tile, 0) / tiles.length;
    const cz = tiles.reduce((s, t) => s + (t.z - def.h / 2 + 0.5) * def.tile, 0) / tiles.length;
    const ts = tiles.map((t) => t.x);
    const tz = tiles.map((t) => t.z);
    sites.push({
      id: kind,
      pos: new THREE.Vector3(cx, 0, cz),
      radius: def.tile * 1.4,
      bounds: {
        minX: (Math.min(...ts) - def.w / 2) * def.tile,
        maxX: (Math.max(...ts) - def.w / 2 + 1) * def.tile,
        minZ: (Math.min(...tz) - def.h / 2) * def.tile,
        maxZ: (Math.max(...tz) - def.h / 2 + 1) * def.tile,
      },
    });
  }

  // 出生点区域 = 购买区
  const buyZones: CompiledMap['buyZones'] = [];
  const avg = (arr: THREE.Vector3[]) =>
    arr.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(Math.max(1, arr.length));
  if (spawns.t.length) buyZones.push({ pos: avg(spawns.t), radius: def.tile * 4, team: 'T' });
  if (spawns.ct.length) buyZones.push({ pos: avg(spawns.ct), radius: def.tile * 4, team: 'CT' });

  // 导航网格：空地可行走（木箱/墙不行）
  const walkable = new Uint8Array(def.w * def.h);
  for (let z = 0; z < def.h; z++)
    for (let x = 0; x < def.w; x++) {
      const v = g.get(x, z);
      if (v === EMPTY || v === SITE_A || v === SITE_B || v === SPAWN_T || v === SPAWN_CT) {
        walkable[z * def.w + x] = 1;
      }
    }
  // 只把墙体/木箱交给导航做避让检查（地面 brush 会挡住所有路径）
  const blockers = brushes.filter((b) => b.max[1] > 0);
  const nav = new NavGrid(def.w, def.h, walkable, def.tile, blockers);

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[maps] ${def.name}:\n` + g.toAscii());
  }

  return {
    def,
    brushes,
    spawns,
    sites,
    buyZones,
    nav,
    groundSize,
  };
}

// ---------------------------------------------------------------
// 三张地图
// ---------------------------------------------------------------

const MAPS: MapDef[] = [
  {
    id: 'dust',
    name: 'Dust 荒漠遗迹',
    desc: '仿 de_dust2：A 大道/小道、中路、B 洞，出生点封闭看不到包点',
    w: 40,
    h: 36,
    tile: 96,
    build(g) {
      // ===== T 出生点（左上，封闭房间）=====
      g.carve(1, 1, 12, 6);
      g.spawn(2, 2, 'T'); g.spawn(4, 2, 'T'); g.spawn(6, 2, 'T');
      g.spawn(3, 4, 'T'); g.spawn(6, 5, 'T');
      // T 出口：东→A 大、南→短道、南→B 洞、南→中路
      g.carve(13, 3, 13, 6);
      g.carve(7, 7, 9, 7);
      g.carve(2, 7, 4, 7);
      g.carve(10, 7, 12, 7);

      // ===== A 大（北侧长廊，带转角，T → A 点）=====
      g.carve(14, 2, 26, 6);
      g.crate(16, 4); g.crate(19, 3); g.crate(22, 5);
      g.carve(24, 7, 28, 12); // 转角（A 大 → A 点西侧）
      g.crate(25, 9);
      g.crate(24, 4); // A 大转角掩体

      // ===== A 点（右上角，南侧两个入口）=====
      g.carve(27, 8, 38, 16);
      g.site(30, 11, 'A'); g.site(32, 11, 'A'); g.site(34, 11, 'A');
      g.crate(29, 13); g.crate(31, 14); g.crate(34, 12); g.crate(36, 10);
      g.crate(33, 15); // A 点南侧掩体

      // ===== 短道 + 猫道（T → A 点南侧）=====
      g.carve(7, 8, 9, 15);
      g.crate(8, 10); g.crate(9, 12); g.crate(7, 14);
      g.carve(13, 14, 26, 15); // 猫道
      g.crate(16, 14); g.crate(20, 15); g.crate(24, 14);

      // ===== 中路（T → CT 中，带隔墙）=====
      g.carve(10, 8, 12, 15);
      g.crate(10, 10); g.crate(11, 12);
      g.carve(13, 10, 18, 20);
      g.crate(14, 12); g.crate(16, 15); g.crate(15, 18);
      g.crate(17, 11); g.crate(15, 13); // 中路掩体
      g.fill(10, 16, 18, 16); // 中路隔墙
      g.carve(17, 16, 17, 16); // 隔墙右门
      g.carve(19, 17, 22, 20); // CT 中
      g.crate(20, 18);
      g.carve(22, 21, 22, 26); // CT 中 → CT 出生点北

      // ===== B 洞（T → B 点，带拐弯）=====
      g.carve(2, 8, 6, 11); // 上层
      g.crate(3, 9); g.crate(5, 10);
      g.carve(7, 10, 9, 11); // 东折
      g.carve(7, 12, 9, 20); // 下层
      g.crate(8, 14); g.crate(7, 17); g.crate(9, 19);

      // ===== B 点（左下角，封闭）=====
      g.carve(1, 21, 13, 33);
      g.site(4, 24, 'B'); g.site(6, 24, 'B'); g.site(8, 24, 'B');
      g.crate(3, 26); g.crate(6, 28); g.crate(9, 26); g.crate(11, 30); g.crate(2, 31);
      g.crate(7, 31); g.crate(10, 25); // B 点掩体
      g.fill(1, 20, 13, 20); // 北墙
      g.carve(7, 20, 8, 20); // 北门（B 洞下层）
      g.fill(13, 21, 13, 33); // 东墙
      g.carve(13, 31, 13, 31); // 东门（CT → B）

      // ===== CT 出生点（右下，封闭房间）=====
      g.carve(22, 27, 38, 35);
      g.spawn(24, 28, 'CT'); g.spawn(27, 28, 'CT'); g.spawn(30, 28, 'CT');
      g.spawn(25, 30, 'CT'); g.spawn(29, 30, 'CT');
      // CT → A 后路（带转角，防止直望 A 点）
      g.carve(27, 17, 31, 17); // A 点南门
      g.carve(27, 18, 31, 22); // 后路南段
      g.carve(32, 22, 36, 22); // 东折
      g.carve(36, 23, 36, 26); // 后路南段 2
      // CT → B 走廊（带转角）
      g.carve(14, 28, 21, 28);
      g.carve(14, 29, 14, 31);
    },
  },
  {
    id: 'nuke',
    name: 'Nuke 核子工厂',
    desc: '仿 de_nuke：T 家斜坡进仓库，A 点上层、B 点下层，CT 有绕后路线',
    w: 36,
    h: 36,
    tile: 96,
    build(g) {
      // ===== T 出生点（左侧，远离 A 点，A/B 都要穿过仓库）=====
      g.carve(6, 1, 12, 5);
      g.spawn(7, 2, 'T'); g.spawn(9, 2, 'T'); g.spawn(11, 2, 'T');
      g.spawn(8, 4, 'T'); g.spawn(10, 4, 'T');
      // T 出口：南→斜坡（A/B 都经仓库到达）
      g.carve(7, 6, 11, 6);

      // ===== 斜坡（T → 中央仓库，拉长进攻距离）=====
      g.carve(6, 7, 11, 11);
      g.crate(7, 8); g.crate(9, 10);
      // A 点第二入口：斜坡 → 北走廊 → A 点西北（双路进攻）
      g.carve(12, 8, 21, 11);
      g.crate(14, 9); g.crate(17, 10); g.crate(20, 9);
      g.carve(8, 12, 20, 16); // 中央仓库
      g.crate(11, 13); g.crate(15, 14); g.crate(18, 13);
      g.crate(19, 12); g.crate(19, 15); // A 门口掩体，给 T 推进用
      g.crate(10, 14); g.crate(13, 15); g.crate(16, 12); g.crate(17, 15); // 仓库之字形掩体
      g.crate(14, 13); g.crate(19, 15); // 仓库掩体

      // ===== A 点（右上，“上层”）=====
      g.carve(22, 7, 34, 16);
      g.site(25, 11, 'A'); g.site(27, 11, 'A'); g.site(29, 11, 'A');
      g.crate(24, 13); g.crate(27, 14); g.crate(30, 12); g.crate(32, 9);
      g.crate(23, 13); // A 点入口掩体
      // A 点西门（仓库 → A，加宽便于进攻）
      g.carve(21, 12, 21, 15);
      g.crate(23, 15); // 入口内掩体

      // ===== B 点（左下，“下层”，封闭）=====
      g.carve(1, 17, 12, 29);
      g.site(4, 22, 'B'); g.site(6, 22, 'B'); g.site(8, 22, 'B');
      g.crate(3, 24); g.crate(6, 26); g.crate(9, 24); g.crate(11, 27);
      g.crate(2, 27); // B 点角落掩体
      // B 点北墙与东墙
      g.fill(1, 16, 12, 16);
      g.fill(12, 17, 12, 29);
      g.carve(12, 29, 12, 29); // 东门（CT → B）
      // 仓库 → B 的连接走廊（带墙防直望）
      g.carve(8, 17, 18, 17);
      g.fill(13, 18, 18, 18);

      // ===== CT 出生点（右下，封闭）=====
      g.carve(22, 28, 34, 34);
      g.spawn(24, 29, 'CT'); g.spawn(27, 29, 'CT'); g.spawn(30, 29, 'CT');
      g.spawn(25, 32, 'CT'); g.spawn(28, 32, 'CT');
      // CT → A：北走廊（带转角）
      g.carve(22, 17, 24, 22);
      g.carve(25, 22, 28, 22);
      g.carve(28, 23, 28, 25);
      g.carve(26, 26, 28, 26);
      g.carve(26, 27, 28, 29); // S 形拉长 CT → A 回防路线
      // CT → B：西走廊（带转角）
      g.carve(13, 28, 22, 28);
      g.carve(13, 29, 13, 30);
    },
  },
  {
    id: 'mirage',
    name: 'Mirage 迷幻之沙',
    desc: '仿 de_mirage：宫殿走 A、公寓进 B、中路连接器，出生点封闭',
    w: 40,
    h: 36,
    tile: 96,
    build(g) {
      // ===== T 出生点（左上，封闭）=====
      g.carve(1, 1, 11, 5);
      g.spawn(2, 2, 'T'); g.spawn(4, 2, 'T'); g.spawn(6, 2, 'T');
      g.spawn(3, 4, 'T'); g.spawn(6, 4, 'T');
      // T 出口：东→宫殿、南→公寓、南→中路
      g.carve(12, 2, 12, 5);
      g.carve(8, 6, 10, 6);
      g.carve(12, 5, 13, 6);

      // ===== 宫殿（T → A 点，带转角）=====
      g.carve(13, 2, 26, 3); // 宫殿北廊
      g.crate(15, 3); g.crate(18, 2); g.crate(22, 3);
      g.carve(26, 4, 26, 8); // 宫殿东廊
      g.crate(25, 5);

      // ===== A 点（右上）=====
      g.carve(27, 4, 38, 14);
      g.site(30, 8, 'A'); g.site(32, 8, 'A'); g.site(34, 8, 'A');
      g.crate(29, 10); g.crate(31, 12); g.crate(34, 11); g.crate(36, 6);
      g.crate(29, 13); g.crate(27, 7); // A 点掩体
      // A 点西侧：宫殿入口（x26-27, z6-8）
      // A 点南墙：连接器入口
      g.carve(27, 15, 30, 15);

      // ===== 中路（T → CT 中，带隔墙）=====
      g.carve(13, 7, 17, 22);
      g.crate(15, 9); g.crate(14, 12); g.crate(16, 15); g.crate(15, 19);
      g.crate(17, 11); // 中路掩体
      g.fill(13, 16, 16, 16);
      g.carve(17, 16, 17, 16); // 隔墙门
      g.carve(18, 17, 22, 21); // CT 中
      g.crate(20, 19);
      g.carve(22, 22, 23, 26); // CT 中 → CT 出生点

      // ===== 连接器（CT 中 → A 点南）=====
      g.carve(21, 15, 25, 19);
      g.crate(23, 17);
      g.carve(26, 15, 26, 16); // 连接器 → A 点南门

      // ===== 公寓（T → B 点，带转角）=====
      g.carve(8, 7, 10, 14);
      g.crate(9, 9); g.crate(8, 12);
      g.carve(11, 13, 12, 15); // 公寓东折
      g.carve(12, 16, 12, 20); // 公寓南段

      // ===== B 点（左下，封闭）=====
      g.carve(1, 21, 13, 33);
      g.site(4, 24, 'B'); g.site(6, 24, 'B'); g.site(8, 24, 'B');
      g.crate(3, 26); g.crate(6, 28); g.crate(9, 26); g.crate(11, 30); g.crate(2, 31);
      g.crate(9, 28); // B 点掩体
      g.fill(1, 20, 13, 20); // 北墙
      g.carve(12, 20, 12, 20); // 北门（公寓 → B）
      g.fill(13, 21, 13, 33); // 东墙
      g.carve(13, 29, 13, 29); // 东门（CT → B）

      // ===== CT 出生点（右下，封闭）=====
      g.carve(23, 27, 38, 35);
      g.spawn(25, 28, 'CT'); g.spawn(28, 28, 'CT'); g.spawn(31, 28, 'CT');
      g.spawn(26, 30, 'CT'); g.spawn(30, 30, 'CT');
      // CT → B：西走廊（带转角）
      g.carve(14, 28, 22, 28);
      g.carve(14, 29, 14, 31);
    },
  },
];

export const MAP_LIST = MAPS.map((m) => ({ id: m.id, name: m.name, desc: m.desc }));
export const MAP_BY_ID: Record<string, MapDef> = Object.fromEntries(MAPS.map((m) => [m.id, m]));
export const compiledMaps = new Map<string, CompiledMap>();
export function getMap(id: string): CompiledMap {
  let c = compiledMaps.get(id);
  if (!c) {
    const def = MAP_BY_ID[id];
    if (!def) throw new Error('未知地图: ' + id);
    c = buildMap(def);
    compiledMaps.set(id, c);
  }
  return c;
}
