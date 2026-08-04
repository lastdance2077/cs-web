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
    sites.push({ id: kind, pos: new THREE.Vector3(cx, 0, cz), radius: def.tile * 1.4 });
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
    desc: '仿 de_dust2：T 家双门出中、A 大道、A 小道、B 洞，CT 出生点可快速回防',
    w: 30,
    h: 26,
    tile: 96,
    build(g) {
      // —— T 出生区（左上，开阔大区）——
      g.carve(1, 1, 17, 5);
      g.spawn(2, 2, 'T'); g.spawn(4, 2, 'T'); g.spawn(6, 2, 'T');
      g.spawn(3, 4, 'T'); g.spawn(6, 4, 'T');

      // —— 中路（中央纵贯，T 家下方开“中门”）——
      g.carve(14, 6, 17, 23);
      g.fill(14, 5, 17, 5); // 中门上方封顶
      g.carve(14, 5, 15, 5); // 中路双门
      g.crate(15, 9); g.crate(16, 14); g.crate(15, 17);
      g.fill(14, 11, 16, 11); // 中路中段隔墙（打断出生点互望），门在右侧
      g.crate(16, 10); g.crate(14, 15);

      // —— A 大道（右侧纵贯，T 家直出）——
      g.carve(18, 2, 23, 5); // T 家 → 大道口
      g.carve(24, 2, 28, 13); // 大道
      g.crate(26, 5); g.crate(26, 8); g.crate(25, 10);

      // —— A 点（右上角）——
      g.carve(20, 14, 28, 19);
      g.site(22, 16, 'A'); g.site(24, 16, 'A');
      g.crate(22, 18); g.crate(23, 18); g.crate(26, 17); g.crate(21, 15);
      g.carve(24, 13, 28, 13); // 大道 → A 点
      g.carve(18, 11, 19, 15); // A 小道（中路 → A 点）
      g.crate(18, 14);

      // —— B 洞上层（T 家左侧直通 B）——
      g.carve(1, 6, 6, 12);
      g.crate(3, 8); g.crate(5, 10); g.crate(4, 12);
      g.carve(1, 13, 8, 16);

      // —— B 点（左下角）——
      g.carve(1, 17, 8, 23);
      g.site(4, 19, 'B'); g.site(5, 19, 'B');
      g.crate(3, 21); g.crate(6, 21); g.crate(7, 18);

      // —— B 洞下层（B 点 ↔ 中路）——
      g.carve(9, 17, 13, 23);
      g.fill(14, 17, 14, 20);
      g.carve(14, 21, 14, 22); // 下洞门
      g.crate(10, 20); g.crate(11, 22);

      // —— CT 出生区（右下）——
      g.carve(18, 21, 27, 24);
      g.spawn(20, 22, 'CT'); g.spawn(22, 22, 'CT'); g.spawn(24, 22, 'CT');
      g.spawn(21, 24, 'CT'); g.spawn(25, 24, 'CT');
      g.carve(20, 20, 21, 20); // CT → A 点后路
      g.carve(15, 22, 18, 24); // CT → 中路
    },
  },
  {
    id: 'nuke',
    name: 'Nuke 核子工厂',
    desc: '仿 de_nuke：T 家下坡进大厅，A 点“上坡”、B 点“下层”，CT 有密道和天堂位',
    w: 26,
    h: 26,
    tile: 96,
    build(g) {
      // —— T 出生区（顶部中央）——
      g.carve(10, 1, 16, 4);
      g.spawn(11, 2, 'T'); g.spawn(13, 2, 'T'); g.spawn(15, 2, 'T');
      g.spawn(12, 4, 'T'); g.spawn(14, 4, 'T');

      // —— T 家下坡进大厅 ——
      g.carve(9, 5, 17, 7);
      g.crate(11, 6); g.crate(15, 6);

      // —— 中央大厅 ——
      g.carve(8, 8, 17, 17);
      g.crate(12, 10); g.crate(13, 10); g.crate(12, 14); g.crate(13, 14);
      g.crate(15, 16);
      g.fill(11, 11, 14, 14); // 大厅中央立柱（打断 T/CT 出生点视线）
      g.crate(10, 15); g.crate(15, 15);

      // —— A 点（右上，“上坡”位）——
      g.carve(18, 8, 24, 17);
      g.fill(18, 8, 18, 12); // 大厅 → A 门（封大半）
      g.carve(18, 13, 18, 15); // 留 3 格门
      g.fill(18, 16, 18, 17);
      g.site(20, 11, 'A'); g.site(22, 11, 'A');
      g.crate(20, 15); g.crate(22, 14); g.crate(23, 12);

      // —— B 点（左下，“下层”）——
      g.carve(1, 14, 7, 22);
      g.fill(7, 16, 7, 17); // 大厅 → B 门（封大半）
      g.site(3, 16, 'B'); g.site(5, 16, 'B');
      g.crate(3, 19); g.crate(6, 19); g.crate(4, 21);

      // —— CT 密道（CT 家 → B 下层）——
      g.carve(8, 19, 11, 22);
      g.crate(9, 21);

      // —— CT 出生区（右下）——
      g.carve(12, 19, 24, 24);
      g.spawn(14, 20, 'CT'); g.spawn(16, 20, 'CT'); g.spawn(18, 20, 'CT');
      g.spawn(14, 23, 'CT'); g.spawn(19, 23, 'CT');
      g.carve(19, 17, 22, 18); // CT → A 天堂位
      g.carve(14, 18, 17, 19); // CT → 大厅（外场方向）
    },
  },
  {
    id: 'mirage',
    name: 'Mirage 迷幻之沙',
    desc: '仿 de_mirage：T 家宫殿走 A 短门、公寓进 B，中路跳台与 CT 通道',
    w: 30,
    h: 26,
    tile: 96,
    build(g) {
      // —— T 出生区（左上）——
      g.carve(1, 1, 9, 5);
      g.spawn(2, 2, 'T'); g.spawn(4, 2, 'T'); g.spawn(6, 2, 'T');
      g.spawn(3, 4, 'T'); g.spawn(6, 4, 'T');

      // —— 中路（中央纵贯）——
      g.carve(13, 5, 16, 22);
      g.crate(15, 8); g.crate(14, 12); g.crate(15, 15);
      g.fill(13, 11, 15, 11); // 中路中段隔墙（门在右侧）
      g.crate(16, 9); g.crate(13, 15);
      g.carve(9, 4, 12, 6); // T 家 → 中路

      // —— 宫殿（T 家 → A 短门）——
      g.carve(9, 6, 13, 10);
      g.crate(11, 8);
      g.carve(14, 9, 19, 13); // 短门走廊
      g.crate(15, 11); g.crate(17, 12);

      // —— A 点（右上）——
      g.carve(19, 8, 27, 15);
      g.site(22, 10, 'A'); g.site(24, 10, 'A');
      g.crate(22, 13); g.crate(24, 14); g.crate(26, 12); g.crate(21, 9);
      g.carve(17, 7, 18, 12); // 中路 → A（跳台/丛林方向）
      g.crate(17, 9);

      // —— 公寓（T 家 → B）——
      g.carve(9, 12, 12, 19);
      g.crate(10, 14); g.crate(11, 16);

      // —— B 点（左下）——
      g.carve(1, 17, 12, 23);
      g.site(4, 19, 'B'); g.site(5, 19, 'B');
      g.crate(3, 21); g.crate(7, 21); g.crate(4, 17);
      g.fill(13, 17, 13, 18); // 中路 → B 连接门（封上半）
      g.carve(13, 19, 13, 20); // 连接门
      g.fill(13, 21, 13, 22);
      g.crate(14, 19); g.crate(15, 20);

      // —— CT 出生区（右下）——
      g.carve(19, 18, 28, 24);
      g.spawn(21, 19, 'CT'); g.spawn(23, 19, 'CT'); g.spawn(25, 19, 'CT');
      g.spawn(22, 22, 'CT'); g.spawn(25, 22, 'CT');
      g.carve(16, 19, 18, 21); // CT → 中路下口
      g.carve(19, 16, 21, 17); // CT → A 斜坡
      g.crate(19, 14); // A 斜坡木箱
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
