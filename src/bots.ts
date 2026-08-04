import * as THREE from 'three';
import { MATCH, WEAPONS, type BotDifficulty, type Team } from './config';
import { MovementController, type Brush } from './movement';
import { createBotModel, type BotModel } from './models';
import { WeaponSystem } from './weapons';
import type { CompiledMap, MapSite } from './maps';
import { sfx } from './audio';

export interface EnemyRef {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  alive: boolean;
  isPlayer: boolean;
}

export interface NoiseEvent {
  pos: THREE.Vector3;
  radius: number;
}

export interface BotWorld {
  map: CompiledMap;
  brushes: Brush[];
  bombPlanted: boolean;
  bombPos: THREE.Vector3;
  bombTimeLeft: number;
  bombDropped: THREE.Vector3 | null;
  noises: NoiseEvent[];
  time: number;
}

export interface BotActions {
  plant: boolean;
  plantProgress: number;
  defuse: boolean;
  defuseProgress: number;
  shot: { origin: THREE.Vector3; dir: THREE.Vector3 } | null;
}

export class Bot {
  name: string;
  team: Team;
  diff: BotDifficulty;
  isPlayer = false;
  move: MovementController;
  model: BotModel;
  weapons = new Map<string, WeaponSystem>();
  currentSlot: 'primary' | 'secondary' | 'melee' = 'secondary';
  private currentId = 'usp';

  health = 100;
  armor = 0;
  money = 4000;
  alive = true;
  hasBomb = false;
  hasKit = false;
  kills = 0;
  deaths = 0;
  frozen = false; // 调试用：冻结 AI（测试靶子）
  lockMove = false; // 冻结期锁移动

  state: 'idle' | 'advance' | 'combat' | 'plant' | 'defuse' | 'dead' = 'idle';
  role: 'siteA' | 'siteB' | 'mid' | 'bomb' = 'siteA';
  siteChoice: 'A' | 'B' = 'A';
  private path: THREE.Vector3[] = [];
  private pathIdx = 0;
  private repathT = 0;
  private aimYaw = 0;
  private aimPitch = 0;
  private target: EnemyRef | null = null;
  private reactionT = 0;
  private burstLeft = 0;
  private burstT = 0;
  private strafeDir = 1;
  private strafeT = 0;
  private seenT = -999;
  private lastSeenPos = new THREE.Vector3();
  private heardPos: THREE.Vector3 | null = null;
  private heardT = -999;
  private investigateT = 0;
  private wanderT = 0;
  private wanderOffset = new THREE.Vector3();
  private stuckT = 0;
  private deathT = 0;
  private interact: { type: 'plant' | 'defuse'; t: number; total: number } | null = null;
  actions: BotActions = {
    plant: false,
    plantProgress: 0,
    defuse: false,
    defuseProgress: 0,
    shot: null,
  };

  constructor(name: string, team: Team, diff: BotDifficulty, brushes: Brush[]) {
    this.name = name;
    this.team = team;
    this.diff = diff;
    this.move = new MovementController(brushes);
    this.model = createBotModel(team);
    this.weapons.set('knife', new WeaponSystem('knife'));
    this.weapons.set('usp', new WeaponSystem('usp'));
    this.health = diff.hp;
  }

  get weapon(): WeaponSystem {
    return this.weapons.get(this.currentId) ?? this.weapons.get('usp')!;
  }

  get eyePos(): THREE.Vector3 {
    return new THREE.Vector3(this.move.pos.x, this.move.pos.y + 60, this.move.pos.z);
  }

  get viewYaw() {
    return this.aimYaw;
  }

  get viewPitch() {
    return this.aimPitch;
  }

  reset(
    spawn: THREE.Vector3,
    team: Team,
    money: number,
    role: 'siteA' | 'siteB' | 'mid' | 'bomb',
    siteChoice: 'A' | 'B',
    keepWeapons: boolean,
    yaw = team === 'T' ? 0 : Math.PI,
  ) {
    this.team = team;
    this.move.reset(spawn);
    this.health = this.diff.hp;
    this.alive = true;
    this.state = 'idle';
    this.role = role;
    this.siteChoice = siteChoice;
    this.target = null;
    this.path = [];
    this.interact = null;
    this.heardPos = null;
    this.money = money;
    this.deathT = 0;
    this.model.group.rotation.set(0, 0, 0);
    this.model.group.position.copy(spawn);
    this.model.group.visible = true;
    if (!keepWeapons) {
      this.weapons.clear();
      this.weapons.set('knife', new WeaponSystem('knife'));
      this.weapons.set('usp', new WeaponSystem('usp'));
      this.switchSlot('secondary');
    }
    this.aimYaw = yaw;
  }

  buy() {
    // 简单购买策略：优先步枪/大狙 + 甲
    if (this.money >= 4750 && Math.random() < 0.22) {
      this.buyWeapon('awp');
    } else if (this.team === 'CT' && this.money >= 3100) {
      this.buyWeapon('m4');
    } else if (this.team === 'T' && this.money >= 2700) {
      this.buyWeapon('ak');
    }
    if (this.money >= 1000) {
      this.armor = 100;
      this.money -= 1000;
    }
    if (this.team === 'CT' && this.role === 'bomb' && this.money >= 400) {
      this.hasKit = true;
      this.money -= 400;
    }
  }

  buyWeapon(id: string) {
    const def = WEAPONS[id];
    if (!def || this.money < def.price) return false;
    this.money -= def.price;
    this.weapons.set(id, new WeaponSystem(id));
    this.switchSlot(def.slot as 'primary' | 'secondary' | 'melee');
    return true;
  }

  switchSlot(slot: 'primary' | 'secondary' | 'melee') {
    if (slot === 'primary' && ![...this.weapons.values()].some((w) => w.def.slot === 'primary')) return;
    this.currentSlot = slot;
    if (slot === 'primary') {
      const p = [...this.weapons.values()].find((w) => w.def.slot === 'primary');
      this.currentId = p ? p.def.id : 'usp';
    } else if (slot === 'secondary') {
      this.currentId = 'usp';
    } else {
      this.currentId = 'knife';
    }
  }

  applyDamage(dmg: number) {
    if (!this.alive) return;
    this.health -= dmg;
    this.interact = null; // 被打断拆/装
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deaths++;
      this.state = 'dead';
      this.deathT = 0;
      sfx.play('death');
    }
  }

  // ---------------------------------------------------------------
  update(dt: number, world: BotWorld, enemies: EnemyRef[]) {
    this.actions.plant = false;
    this.actions.defuse = false;
    this.actions.shot = null;
    if (!this.alive) {
      this.deathT += dt;
      // 倒地动画：缓缓倒下并下沉
      const t = Math.min(1, this.deathT * 2.5);
      this.model.group.rotation.x = -t * Math.PI / 2 * 0.94;
      this.model.group.position.y = this.move.pos.y - t * 4;
      return;
    }

    if (this.frozen) {
      this.model.group.position.copy(this.move.pos);
      this.model.group.rotation.y = this.aimYaw;
      return;
    }

    if (this.lockMove) {
      this.model.group.position.copy(this.move.pos);
      this.model.group.rotation.y = this.aimYaw;
      return;
    }

    const w = this.weapon;
    const hSpeed = Math.hypot(this.move.vel.x, this.move.vel.z);
    const movingFrac = Math.min(1, hSpeed / this.weapon.def.moveSpeed);
    w.update(dt, movingFrac, !this.move.onGround);

    // ---- 感知 ----
    this.repathT -= dt;
    this.strafeT -= dt;
    this.burstT -= dt;
    this.investigateT -= dt;

    const visible = this.findVisible(enemies, world);
    if (visible) {
      this.target = visible;
      this.reactionT -= dt;
      this.lastSeenPos.copy(visible.pos);
      this.seenT = world.time;
    } else {
      this.target = null;
      this.reactionT = this.diff.reactionMin + Math.random() * (this.diff.reactionMax - this.diff.reactionMin);
    }

    // 听到枪声
    for (const n of world.noises) {
      const d = this.move.pos.distanceTo(n.pos);
      if (d < n.radius && world.time - this.heardT > 1.2) {
        this.heardPos = n.pos.clone();
        this.heardT = world.time;
      }
    }

    // ---- 状态机 ----
    const isCarrier = this.team === 'T' && this.hasBomb && !world.bombPlanted;
    const distToTarget = this.target ? this.move.pos.distanceTo(this.target.pos) : Infinity;
    // 带包者以装包为第一要务：远处的敌人不恋战，冲到包点再说
    if (this.target && this.reactionT <= 0 && !(isCarrier && distToTarget > 380)) {
      this.state = 'combat';
    } else if (this.team === 'T' && world.bombPlanted) {
      this.state = 'advance'; // 回防炸弹
      this.role = 'bomb';
      this.setTarget(world.bombPos);
    } else if (this.team === 'CT' && world.bombPlanted) {
      this.state = 'advance';
      this.role = 'bomb';
      this.setTarget(world.bombPos);
    } else if (this.team === 'T' && this.hasBomb && !world.bombPlanted) {
      // 带包者优先去包点，不被枪声干扰
      this.state = 'advance';
      this.setTarget(this.objectivePos(world));
    } else if (this.team === 'T' && world.bombDropped && !this.hasBomb) {
      // 捡包优先于听声调查，否则炸弹永远没人捡
      this.state = 'advance';
      this.setTarget(world.bombDropped);
    } else if (world.time - this.heardT < 4 && this.heardPos) {
      this.state = 'advance';
      this.setTarget(this.heardPos);
    } else {
      this.state = 'advance';
      this.setTarget(this.objectivePos(world));
    }

    // ---- 装包 / 拆包 ----
    this.handleInteract(dt, world);

    // ---- 战斗 ----
    let wishX = 0, wishZ = 0, jump = false;
    if (this.state === 'combat' && this.target) {
      this.combatUpdate(dt, world);
      // 移动：横向拉扯，easy 停下来打
      if (this.diff.moveShoot || this.burstLeft <= 0) {
        if (this.strafeT <= 0) {
          this.strafeDir = Math.random() < 0.5 ? -1 : 1;
          this.strafeT = 0.5 + Math.random() * 0.8;
        }
        const f = new THREE.Vector3(Math.sin(this.aimYaw), 0, Math.cos(this.aimYaw));
        const r = new THREE.Vector3(f.z, 0, -f.x);
        wishX = r.x * this.strafeDir;
        wishZ = r.z * this.strafeDir;
      }
    } else {
      this.followPath(dt);
      const dir = this.nextPathDir();
      wishX = dir.x;
      wishZ = dir.z;
      // 朝移动方向转向，保证前进时面向敌人可能出现的方位
      if (wishX !== 0 || wishZ !== 0) {
        this.aimYaw = turnToward(this.aimYaw, Math.atan2(wishX, wishZ), 5 * dt);
      }
    }

    // 卡住检测：有路要走但 1 秒几乎没动 → 强制重新寻路
    if (this.state === 'advance' && this.path.length > 1) {
      if (Math.hypot(this.move.vel.x, this.move.vel.z) < 25) {
        this.stuckT += dt;
        if (this.stuckT > 1.0) {
          this.repathT = 0;
          this.stuckT = 0;
        }
      } else {
        this.stuckT = 0;
      }
    }

    if (this.lockMove) {
      wishX = 0;
      wishZ = 0;
      this.move.vel.x = 0;
      this.move.vel.z = 0;
    }
    // 固定子步长积分
    const STEP = 1 / 120;
    let remaining = dt;
    while (remaining > 0.0001) {
      const h = Math.min(STEP, remaining);
    this.move.update(h, wishX, wishZ, jump, false, false, this.weapon.def.moveSpeed);
      remaining -= h;
    }
    // 站桩时缓慢扫视，避免漏看侧后方敌人
    if (hSpeed < 25 && this.state !== 'combat' && this.move.onGround) {
      this.aimYaw += Math.sin(performance.now() / 1000 * 0.7) * 0.3 * dt;
    }
    this.model.group.position.set(this.move.pos.x, this.move.pos.y, this.move.pos.z);
    this.model.group.rotation.y = this.aimYaw;

    // 走路/持枪动画（拟人：持枪时双臂前伸端枪，刀时自然摆臂）
    const holdingGun = !this.weapon.isKnife;
    this.model.gun.visible = holdingGun;
    const t = performance.now() / 1000 * 9;
    if (hSpeed > 30 && this.move.onGround) {
      const swing = Math.sin(t);
      this.model.legs[0].rotation.x = swing * 0.7;
      this.model.legs[1].rotation.x = -swing * 0.7;
      if (holdingGun) {
        this.model.arms[0].rotation.x = -1.15 + Math.sin(t * 0.7) * 0.06;
        this.model.arms[1].rotation.x = -1.15 + Math.sin(t * 0.7 + 0.5) * 0.06;
      } else {
        this.model.arms[0].rotation.x = -swing * 0.5;
        this.model.arms[1].rotation.x = swing * 0.5;
      }
    } else {
      this.model.legs[0].rotation.x = 0;
      this.model.legs[1].rotation.x = 0;
      if (holdingGun) {
        this.model.arms[0].rotation.x = -1.15;
        this.model.arms[1].rotation.x = -1.15;
      } else {
        this.model.arms[0].rotation.x = 0;
        this.model.arms[1].rotation.x = 0;
      }
    }
    // 举枪跟随视线俯仰
    this.model.gun.rotation.x = -this.aimPitch * 0.8;
  }

  // ---------------------------------------------------------------
  private findVisible(enemies: EnemyRef[], world: BotWorld): EnemyRef | null {
    let best: EnemyRef | null = null;
    let bestScore = Infinity;
    const fwd = new THREE.Vector3(Math.sin(this.aimYaw), 0, Math.cos(this.aimYaw));
    const eye = this.eyePos;
    for (const e of enemies) {
      if (!e.alive) continue;
      const to = new THREE.Vector3().subVectors(e.pos, this.move.pos);
      const dist = to.length();
      if (dist > 4096) continue;
      to.y += 50;
      const dir = to.clone().normalize();
      // FOV
      const fovDot = Math.cos((this.diff.fov / 2) * Math.PI / 180);
      const flatDir = new THREE.Vector3(dir.x, 0, dir.z).normalize();
      if (fwd.dot(flatDir) < fovDot) continue;
      // LOS
      const hit = MovementController.raycastBrushes(world.brushes, eye, dir, dist + 10);
      if (hit <= dist - 6) continue;
      const score = dist - flatDir.dot(fwd) * 200; // 更近、更居中者优先
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  private objectivePos(world: BotWorld): THREE.Vector3 {
    if (this.team === 'T') {
      const site = world.map.sites.find((s) => s.id === this.siteChoice);
      if (site) return site.pos.clone();
    } else {
      if (this.role === 'mid') {
        const mid = new THREE.Vector3(
          (world.map.def.w / 2) * world.map.def.tile - world.map.def.tile,
          0,
          (world.map.def.h / 2) * world.map.def.tile - world.map.def.tile,
        );
        return mid;
      }
      const site = world.map.sites.find((s) => s.id === (this.role === 'siteA' ? 'A' : 'B'));
      if (site) return site.pos.clone();
    }
    return new THREE.Vector3(0, 0, 0);
  }

  private setTarget(pos: THREE.Vector3) {
    if (this.repathT > 0 && this.path.length > 1) return;
    if (!this.target || this.target.alive) {
      this.path = worldPath(this, pos);
      this.pathIdx = 0;
      this.repathT = 1.2;
    }
  }

  private nextPathDir(): THREE.Vector3 {
    if (!this.path.length) return new THREE.Vector3();
    const target = this.path[Math.min(this.pathIdx, this.path.length - 1)].clone();
    if (this.pathIdx >= this.path.length - 1) {
      // 终点的随机游走：若偏移指向墙里则吸附到最近可通行点，避免撞墙
      const nav = botWorldMap.get(this)?.nav;
      if (nav && this.wanderOffset.lengthSq() > 0) {
        const cand = target.clone().add(this.wanderOffset);
        const tile = nav.worldToTile(cand);
        if (nav.isWalkable(tile.x, tile.z)) {
          target.copy(cand);
        } else {
          const alt = nav.nearestWalkable(tile.x, tile.z);
          if (alt) target.copy(nav.tileToWorld(alt.x, alt.z));
          else this.wanderOffset.set(0, 0, 0); // 周围没空地就原地待着
        }
      }
    }
    const dx = target.x - this.move.pos.x;
    const dz = target.z - this.move.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 55) {
      this.pathIdx = Math.min(this.pathIdx + 1, this.path.length - 1);
    }
    return d > 0.001 ? new THREE.Vector3(dx / d, 0, dz / d) : new THREE.Vector3();
  }

  private followPath(dt: number) {
    // 快到目标时加一点随机游走，避免扎堆
    if (this.path.length && this.pathIdx >= this.path.length - 1) {
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = 1.5 + Math.random() * 2;
        this.wanderOffset.set((Math.random() - 0.5) * 180, 0, (Math.random() - 0.5) * 180);
      }
    }
  }

  private handleInteract(dt: number, world: BotWorld) {
    // T 装包
    if (this.team === 'T' && this.hasBomb && !world.bombPlanted) {
      const site = world.map.sites.find((s) => s.id === this.siteChoice);
      if (site && this.move.pos.distanceTo(site.pos) < site.radius) {
        if (!this.interact) this.interact = { type: 'plant', t: 0, total: MATCH.plantTime };
        this.interact.t += dt;
        this.actions.plant = true;
        this.actions.plantProgress = this.interact.t / this.interact.total;
        if (this.interact.t >= this.interact.total) {
          this.interact = null;
          this.hasBomb = false;
          this.actions.plantProgress = 1;
        }
        return;
      }
    }
    // CT 拆包
    if (this.team === 'CT' && world.bombPlanted) {
      if (this.move.pos.distanceTo(world.bombPos) < 120) {
        if (!this.interact) this.interact = {
          type: 'defuse',
          t: 0,
          total: this.hasKit ? MATCH.kitDefuseTime : MATCH.defuseTime,
        };
        this.interact.t += dt;
        this.actions.defuse = true;
        this.actions.defuseProgress = this.interact.t / this.interact.total;
        if (this.interact.t >= this.interact.total) {
          this.interact = null;
          this.actions.defuseProgress = 1;
        }
        return;
      }
    }
    this.interact = null;
  }

  private combatUpdate(dt: number, world: BotWorld) {
    const t = this.target!;
    // 瞄准：指向目标（含预判与误差）
    const eye = this.eyePos;
    const aim = new THREE.Vector3(t.pos.x, t.pos.y + 50, t.pos.z);
    if (t.isPlayer) aim.y += 10;
    // 预判
    const to = aim.clone().sub(eye);
    const dist = to.length();
    const projSpeed = this.weapon.def.id === 'awp' ? 3800 : 3000;
    aim.addScaledVector(t.vel, (dist / projSpeed) * this.diff.aimLead);
    const targetYaw = Math.atan2(aim.x - eye.x, aim.z - eye.z);
    const flat = Math.hypot(aim.x - eye.x, aim.z - eye.z);
    const targetPitch = Math.atan2(aim.y - eye.y, flat);

    // 带误差缓慢转向
    const err = (Math.random() - 0.5) * 2 * this.diff.aimError;
    const errP = (Math.random() - 0.5) * 2 * this.diff.aimError;
    const maxTurn = this.diff.aimTurnSpeed * dt;
    const dy = wrapAngle(targetYaw + err - this.aimYaw);
    this.aimYaw += Math.max(-maxTurn, Math.min(maxTurn, dy));
    const dp = clamp(targetPitch + errP - this.aimPitch, -1, 1);
    this.aimPitch += Math.max(-maxTurn, Math.min(maxTurn, dp));

    // 开火判定
    const fwd = new THREE.Vector3(
      Math.cos(this.aimPitch) * Math.sin(this.aimYaw),
      Math.sin(this.aimPitch),
      Math.cos(this.aimPitch) * Math.cos(this.aimYaw),
    );
    const toTarget = aim.clone().sub(eye).normalize();
    const align = fwd.dot(toTarget);

    if (align > 0.985) {
      // 距离太近 → 用刀
      if (dist < 110 && (this.weapon.isKnife || !this.weapon.def.id.startsWith('a'))) {
        this.switchSlot('melee');
      } else if (this.weapon.isKnife && dist > 120) {
        this.switchSlot(this.weapons.has('ak') || this.weapons.has('m4') || this.weapons.has('awp') ? 'primary' : 'secondary');
      }
      const w = this.weapon;
      if (w.isKnife) {
        if (dist < 110 && w.swingT <= 0) {
          const out = { dir: new THREE.Vector3() };
          w.fire(fwd, 0, false, out);
          this.actions.shot = { origin: this.eyePos, dir: out.dir };
        }
      } else {
        if (w.ammoInMag <= 0 && !w.reloading) {
          w.startReload();
          sfx.play('reload');
        }
        if (this.burstLeft <= 0 && this.burstT <= 0) {
          this.burstLeft = Math.floor(this.diff.burstMin + Math.random() * (this.diff.burstMax - this.diff.burstMin + 1));
          this.burstT = this.diff.burstPause;
        }
        if (this.burstLeft > 0 && this.burstT <= 0 && !w.reloading) {
          if (w.def.auto || w.def.id === 'awp' || w.def.id === 'usp') {
            const out = { dir: new THREE.Vector3() };
            const fired = w.fire(fwd, 0, false, out);
            if (fired) {
              this.actions.shot = { origin: this.eyePos, dir: out.dir };
              this.burstLeft--;
              const sound = w.def.id === 'awp' ? 'shot_awp' : w.def.slot === 'secondary' ? 'shot_pistol' : 'shot_rifle';
              sfx.play(sound);
              if (w.def.id === 'awp') this.burstLeft = 0;
            }
          }
        }
      }
    }

    // 被打后转身寻找
    if (world.time - this.seenT > 2.5 && !this.target?.alive) {
      this.aimYaw += Math.sin(world.time * 2) * 0.2;
    }
    void dt;
  }
}

const pathCache = new WeakMap<Bot, { from: THREE.Vector3; to: THREE.Vector3; path: THREE.Vector3[] | null }>();

function worldPath(bot: Bot, to: THREE.Vector3): THREE.Vector3[] {
  const map = botWorldMap.get(bot);
  if (!map) return [to.clone()];
  const cached = pathCache.get(bot);
  if (cached && cached.from.distanceToSquared(bot.move.pos) < 64 * 64 && cached.to.distanceToSquared(to) < 48 * 48) {
    return cached.path ?? [to.clone()];
  }
  const path = map.nav.findPath(bot.move.pos, to);
  pathCache.set(bot, { from: bot.move.pos.clone(), to: to.clone(), path });
  return path ?? [to.clone()];
}

const botWorldMap = new WeakMap<Bot, CompiledMap>();
export function attachBotWorldMap(bot: Bot, map: CompiledMap) {
  botWorldMap.set(bot, map);
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function turnToward(current: number, target: number, maxDelta: number) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + Math.max(-maxDelta, Math.min(maxDelta, d));
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
